# Stok işlemleri ve onay transaction'ı

Bu belge stoğun nasıl değiştiğini anlatır: işlemin açılması, onay transaction'ı, kilit sırası, hareketli ortalama maliyet, tekrar eden onay ve hata kodları. İlgili işler: #33 (onay transaction'ı), #37 (web ekranları, önizleme ve stok okuma uçları). Tablolar ve kısıtlar: [veritabani.md](veritabani.md#stok-defteri-tabloları). Ondalık hesap kararı: [ADR-003](kararlar/ADR-003-ondalik-hesap-sql.md).

## Kural: stok yalnızca onayla değişir

Ekrandan, asistandan (5. hafta) ya da içe aktarmadan (#39) gelen her işlem önce **onay bekleyen** (`PENDING_CONFIRMATION`) bir kayıt olarak açılır; bu adımda stok değişmez. Stoğu değiştiren tek yol `POST /v1/operations/{id}/confirm` uç noktasıdır (mimari değişmez 2). Açılış stoğu da istisna değildir: demo verisinin açılışı da bir işlem olarak açılır ve aynı onaydan geçer.

| Uç nokta | Ne yapar |
| --- | --- |
| `POST /v1/operations` | İşlemi açar: tür, kalemler (ürün, depo, miktar, birim), isteğe bağlı cari ve not. Ürün, birim, depo ve yetki burada kontrol edilir; stok değişmez. |
| `GET /v1/operations/{id}` | İşlem ve kalemleri |
| `GET /v1/operations/{id}/preview` | Onay ekranının özeti: ürün ve depo adları, ana birim karşılığı ve onay bekleyen işlemde stoğun önce → sonra hâli. Stok değişmez (aşağıda: Önizleme) |
| `POST /v1/operations/{id}/confirm` | Onay. Gövde: `{ "version": 1 }`; başlık: `Idempotency-Key`. Stok, hareketler ve maliyet tek transaction'da yazılır. |
| `POST /v1/operations/{id}/cancel` | Onay bekleyen işlemi iptal eder (açan kişi ya da yönetici) |
| `GET /v1/warehouses/{id}/stock` | Depodaki stok: aktif ürünler, miktar, ortalama maliyet, kritik eşik altında mı. Arama ve sayfalama ürün listesindekiyle aynı; depoda hareketi olmayan ürün 0 görünür |
| `GET /v1/products/{id}/movements` | Ürünün hareketleri, en yeni önce; depo süzgeci ve sayfalama |
| `GET /v1/products/{id}/stock` | Ürünün depolara göre stoğu ve toplamı (mobil ürün detayı; 4. haftada asistanın stok sorgusu). Çalışan yalnızca yetkili depoları görür, toplam da onların toplamıdır |

İşlem türleri: giriş (`STOCK_IN`), çıkış (`STOCK_OUT`), transfer (`TRANSFER`), sayım (`COUNT`), fire (`WASTE`), açılış (`OPENING`, yalnızca yönetici). Ters kayıt (`REVERSAL`) 5. haftada gelir.

## Onay transaction'ı adım adım

Kod: `apps/api/src/modules/operations/operations.service.ts` (`confirm`) ve `apps/api/src/modules/inventory/apply-stock.service.ts` (`apply`).

```text
BEGIN
 1. operations satırını FOR UPDATE ile kilitle                 ← aynı işlemin ikinci onayı burada bekler
 2. durum = APPLIED ve aynı Idempotency-Key  → ilk cevabı tekrar dön (stok değişmez)
    durum = APPLIED, başka anahtar           → 409 OPERATION_ALREADY_APPLIED
    durum onay beklemiyor                    → 409 OPERATION_NOT_PENDING
    sürüm farklı                             → 409 OPERATION_VERSION_MISMATCH
 3. kalemleri oku; yetkiyi (üyelik, rol, depo) kilit altında yeniden kontrol et;
    kalemleri ana birime çevir (SQL'de)
 4. stok satırlarını aç (yoksa) ve ürün, sonra depo kimliği sırasıyla FOR UPDATE ile kilitle
    kalemleri sırayla uygula: stok + hareket (+ sayım sonucu) tek ifadede
    yetersiz stok varsa                      → 409 INSUFFICIENT_STOCK (hepsi geri alınır)
 5. işlemi APPLIED yap; audit_logs ve outbox_events kaydını yaz
COMMIT
```

Adımlardan biri hata verirse transaction'ın tamamı geri alınır: çok kalemli bir işlemde tek kalem bile uygulanamazsa hiçbir hareket, stok, maliyet, denetim ya da outbox kaydı kalmaz.

**Neden bir modül her şeyi yazmıyor?** Her modül yalnızca kendi tablosuna yazar: stok ve hareketler `inventory`, birim çevrimi `catalog`, denetim kaydı `audit`, olay `events`. Onay transaction'ını `operations` modülü açar ve aynı transaction nesnesini (`DbExecutor`) diğer modüllerin servislerine verir. Böylece modül sınırı korunur, yine de her şey tek transaction'da kalır.

## Kilitler ve kilit sırası

- **İşlem satırı (`operations`):** İlk iş kilitlenir. Aynı işlem için aynı anda iki onay isteği gelirse ikincisi bekler; birincisi bitince işlemi `APPLIED` görür ve stoğa dokunmaz.
- **Stok satırları (`inventory`):** Ürün kimliğine, aynı üründe depo kimliğine göre artan sırada kilitlenir (`ORDER BY product_id, warehouse_id FOR UPDATE`). Neden sıra? A işlemi önce priz sonra kablo, B işlemi önce kablo sonra priz satırını kilitlerse her biri ötekinin tuttuğu satırı bekler ve ikisi de ilerleyemez (deadlock). Herkes aynı sırayla kilitlerse bu döngü oluşamaz.
- **Henüz olmayan stok satırı** (ör. bir depoya ilk giriş) önce `INSERT … ON CONFLICT DO NOTHING` ile miktar 0 olarak açılır. Bu ekleme de aynı sırayla yapılır; aynı satırı aynı anda açmaya çalışan iki transaction aynı sırayla bekler.
- Kilitler transaction bitince (COMMIT ya da ROLLBACK) kalkar. Bu yüzden transaction kısa tutulur: kalem doğrulaması ve yetki gibi okumalar stok satırları kilitlenmeden önce yapılır.

## Hesaplar (hepsi SQL'de, ADR-003)

| Hesap | Formül | Nerede |
| --- | --- | --- |
| Birim çevrimi | ana birim miktar = round(girilen × katsayı, 3); 3 koli × 12 = 36 adet | `catalog.repository.ts` |
| Ana birim maliyeti | round(girilen birim maliyet ÷ katsayı, 4); koli 120 TL → adet 10 TL | `catalog.repository.ts` |
| Giriş (maliyetli) | yeni ortalama = round((stok × ortalama + giren × maliyet) ÷ (stok + giren), 4) | `stock-ledger.repository.ts` (`increase`) |
| Giriş (maliyetsiz) | ortalama değişmez; hareket mevcut ortalamayla yazılır | aynı |
| Çıkış, fire | stok azalır; ortalama değişmez; hareket o anki ortalamayla yazılır | `decrease` |
| Transfer | kaynaktan çıkış + hedefe giriş; mal, kaynak deponun ortalamasıyla girer | `apply-stock.service.ts` |
| Sayım | fark = sayılan − sistemdeki (onay anında, kilitli satırdan); artıysa sayım fazlası (mevcut ortalamayla), eksiyse sayım noksanı | `recordCount` |

**Örnek (`test-db/operations.db.spec.ts` aynı adımları izler):** Merkez depoya 10 koli priz koli başı 120 TL'den girer: 120 adet, ortalama 10 TL. Sonra 60 adet 13 TL'den girer: (120 × 10 + 60 × 13) ÷ 180 = 11 TL. Maliyeti girilmemiş 20 adet daha girer: stok 200, ortalama yine 11 TL. 30 adet çıkar: stok 170, ortalama değişmez. 50 adet Ostim'e transfer edilir; Ostim'de priz 11 TL'den başlar. Ostim'e 50 adet 15 TL'den alış yapılırsa Ostim'in ortalaması (50 × 11 + 50 × 15) ÷ 100 = 13 TL olur; Merkez'in ortalaması değişmez.

**Neden SET içinde eski değerler?** PostgreSQL'de `UPDATE … SET average_cost = f(quantity), quantity = quantity + x` ifadesinde sağ taraftaki `quantity` satırın güncelleme öncesi değeridir. Ortalama formülü bu yüzden eski stokla doğru hesaplanır.

**Yetersiz stok nasıl anlaşılır?** Çıkış ifadesi `WHERE quantity >= çıkan` koşuluyla çalışır. Stok yetmiyorsa hiçbir satır güncellenmez, hareket de yazılmaz. Servis bütün kalemleri dener, yetmeyenleri toplar ve tek hata döner (`details`: kalem, istenen, mevcut). Bu kontrol atlansa bile veritabanındaki `CHECK (quantity >= 0)` eksi stoğu reddeder.

## Tekrar eden onay (idempotency)

- İstemci her onay denemesi için bir `Idempotency-Key` üretir (UUID önerilir) ve ağ hatasında aynı anahtarla tekrar dener.
- Uygulanan işlemin anahtarı `operations.apply_idempotency_key` alanına yazılır. Aynı anahtarla gelen ikinci istek kilidi bekler, işlemi `APPLIED` ve anahtarı aynı bulur; ilk cevabı (işlem ve hareketler) tekrar döner. Stok ikinci kez değişmez.
- Başka anahtarla gelen onay `409 OPERATION_ALREADY_APPLIED` alır.
- Anahtar şirket içinde benzersizdir. Bir anahtar başka bir işlemin onayında kullanılırsa veritabanı kısıtı ihlal edilir, transaction geri alınır ve `409 IDEMPOTENCY_KEY_REUSED` döner.
- Son savunma hattı: hareket tablosunda (işlem, kalem, depo) benzersizdir. Bir hata yüzünden işlem ikinci kez uygulanmaya çalışılsa bile ilk hareket eklemesi reddedilir.

## Sürüm

Her işlemin bir sürümü vardır (`version`, başlangıçta 1). Onay isteği kullanıcının gördüğü sürümü gönderir. 5. haftada asistan öneriyi düzenlediğinde sürüm artacak; kullanıcının eski hâli onaylaması `409 OPERATION_VERSION_MISMATCH` ile reddedilir. Kullanıcı güncel hâli görüp yeniden onaylar.

## Yetki

- İşlemi açan ve onaylayan kullanıcı, işlemdeki her depoda (transferde hedef depo dahil) yetkili olmalıdır. Yöneticiler tüm depolarda yetkilidir; çalışan yalnızca `user_warehouse_access`'te kayıtlı depolarda.
- Yetki işlem açılırken ve onayda, kilit altında, yeniden kontrol edilir: işlem açıldıktan sonra yetkisi kaldırılan çalışan onaylayamaz.
- Açılış stoğunu yalnızca yönetici girer. İşlemi iptal edebilen: işlemi açan kişi ya da yönetici.
- Şirket ve kullanıcı kimliği oturumdan gelir; istek gövdesinde şirket alanı yoktur. Başka şirketin işlemi `404 OPERATION_NOT_FOUND` alır (varlığı sızmaz).

## Hata kodları

| Durum | Kod | Ne zaman |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | Gövde şemaya uymuyor (`details`: alan ve neden) |
| 400 | `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID` | Onayda başlık yok ya da geçersiz |
| 403 | `WAREHOUSE_FORBIDDEN` | Çalışanın yetkisi olmayan depo (`details.warehouseIds`) |
| 403 | `ROLE_FORBIDDEN`, `OPERATION_FORBIDDEN` | Açılışı çalışan girdi; işlemi başkası iptal etmeye çalıştı |
| 404 | `OPERATION_NOT_FOUND` | İşlem yok ya da başka şirketin |
| 409 | `INSUFFICIENT_STOCK` | Stok yetmiyor (`details`: kalem, ürün, depo, istenen, mevcut) |
| 409 | `OPERATION_ALREADY_APPLIED`, `OPERATION_NOT_PENDING`, `OPERATION_VERSION_MISMATCH`, `IDEMPOTENCY_KEY_REUSED` | Yukarıdaki bölümler |
| 422 | `OPERATION_LINES_INVALID` | Ürün, birim ya da depo yok/pasif; miktar ana birime çevrilince sıfır (`details`: kalem no, alan, kod) |
| 422 | `PARTY_NOT_FOUND`, `WAREHOUSE_INACTIVE` | Cari yok ya da pasif; onay anında pasif depo |

## Önizleme (onaydan önce "önce → sonra")

Kod: `operations.service.ts` (`preview`), `inventory/stock-preview.ts` ve `stock-ledger.repository.ts` (`previewEffects`).

- Kalemler, onayın uygulayacağı sırayla stok etkilerine çevrilir: giriş +, çıkış ve fire −, transferde önce kaynaktan −, sonra hedefe +, sayımda stok sayılan miktara eşitlenir.
- Hesap SQL'de yapılır. Her etkinin "önce"si, depodaki stok ile aynı depo ve ürüne düşen önceki etkilerin toplamıdır (`sum(...) over (partition by depo, ürün order by sıra)`). Aynı üründen iki çıkış kalemi varsa ikincisinin "önce"si birincinin "sonra"sıdır; onay da kalemleri bu sırayla uygular.
- "Sonra" eksiye düşen kalem `sufficient: false` döner; web bu kalemi "Yetersiz stok" diye işaretler ve onay düğmesini kapatır.
- Önizleme **kilit almaz ve stoğu değiştirmez.** Onay anında stok kilit altında yeniden okunur. Arada başka bir işlem onaylandıysa sonuç farklı olabilir; o durumda onay `409 INSUFFICIENT_STOCK` döner ve web hatayı ilgili kalemde gösterir.
- Yalnızca onay bekleyen işlemde hesaplanır. Onaylanmış ya da iptal edilmiş işlemde stok o işlemden sonra da değiştiği için `stock: null` döner.
- Özeti, işlemi onaylayabilecek kullanıcı görür: depo yetkisi işlem açarken ve onaydakiyle aynı kuralla denetlenir (`403 WAREHOUSE_FORBIDDEN`).

## Web ekranları

| Sayfa | Ne var |
| --- | --- |
| `/operations/new` | Fiş formu: tür (giriş, çıkış, transfer, sayım, fire), depo (transferde çıkış ve hedef), girişte tedarikçi, çıkışta müşteri, not; kalemler: ürün arama penceresi, birim (ana birim ya da ek birimler, "1 koli = 12 adet"), miktar, girişte birim maliyet. Kaydedince işlem onay bekleyen olarak açılır |
| `/operations/{id}` | Özet: kalem başına girilen miktar ve ana birim karşılığı, depo, stok önce → sonra (transferde iki depo), yeterli/yetersiz. "Onayla" ve "İptal et". Onaydan sonra yazılan hareketler ve yeni stok |
| `/stock` | Depo bazında stok: depo seçimi, arama, sayfalama; miktar, kritik eşik, "Kritik"/"Yeterli" rozeti, ortalama maliyet |
| `/products/{id}` | Ürün formunun altında hareket geçmişi (depo süzgeci, sayfalama) |
| Mobil: stok listesi ve ürün detayı | Depo çipleri, arama, "KRİTİK"/"YETERLİ" rozeti, kaydırdıkça sonraki sayfa; ürün detayında depolara göre stok, birimler, alternatif adlar, son 10 hareket (#38) |

- **Çift tıklama:** Özet sayfası açılınca bir `Idempotency-Key` (UUID) üretilir ve o sayfadaki bütün onay denemeleri aynı anahtarla gider. Düğme istek sürerken kapalıdır; yine de ikinci istek giderse API işlemi uygulanmış ve anahtarı aynı bulur, ilk cevabı döner. Stok bir kez değişir.
- **Depo yetkisi:** Çalışanın yetkili olduğu depolar üyelik bilgisinde gelir (`GET /v1/organizations` → `warehouseIds`). Formdaki ve stok listesindeki depo seçenekleri buna göre süzülür; asıl kontrol API'de.
- **Ana birim karşılığı** formda çarpılarak gösterilmez (JS'de ondalık hesap yok, ADR-003); formda katsayı ("1 koli = 12 adet"), özette sunucunun hesapladığı miktar ("3 koli = 36 adet") görünür.
- **Bilinen sınır:** İşlem listesi (onay kuyruğu) 5–6. haftada gelir. Onaylanmadan bırakılan işleme şimdilik yalnızca adresinden dönülebilir.

## Açılış stoğu

`pnpm db:seed` önce katalogu (şirket, depo, ürün, cari) yükler, sonra `apps/api/src/scripts/seed-opening-stock.ts` betiğini çalıştırır. Betik ABC Elektrik'in her deposu için bir `OPENING` işlemi açar (kaynak `SYSTEM`, işlemi açan boş) ve aynı onay transaction'ından geçirir; hareketler, maliyet, denetim ve outbox kayıtları kullanıcı onayındaki gibi oluşur. Her deponun açılışı sabit bir anahtar taşır (`seed-opening:<depo kimliği>`). Betik tekrar çalıştırılınca o anahtarla uygulanmış işlem bulunur ve depo atlanır. Açılış miktarları ve maliyetleri `packages/db/seed/demo-data.ts` dosyasındadır; bazı ürünler bilerek kritik eşiğin altında başlar.

## Testler

| Test | Ortam | Ne doğrular |
| --- | --- | --- |
| `apps/api/test/operations-rules.spec.ts` | CI | Durum makinesi, kilit sırası (ters sıralı iki işlem aynı sırayı üretir), işlem şeması |
| `apps/api/test/operations.e2e.spec.ts` | CI | Şema hataları, depo yetkisi, açılış rolü, Idempotency-Key zorunluluğu |
| `apps/api/test-db/operations.db.spec.ts` | Gerçek veritabanı (`pnpm db:test`) | Beş işlem türü, birim çevrimi, ortalama maliyet, sayımın onay anındaki farkı, yetersiz stok (hiçbir şey yazılmaz), aynı onayın tekrarı, sürüm, başka şirket, depo yetkisi, açılış betiğinin tekrarı, stok = hareketlerin toplamı |
| `apps/api/test/stock-preview.spec.ts` | CI | Önizlemenin etkileri onayın uygulama sırasıyla üretmesi (transferde kaynak sonra hedef) |
| `apps/api/test-db/stock.db.spec.ts` | Gerçek veritabanı (`pnpm db:test`) | Önizleme: aynı üründen iki çıkış kalemi, transfer, sayım, yetersiz kalem, onaylanmış işlem; depo bazında stok ve kritik eşik; hareket geçmişi, depo süzgeci ve sayfalama; çalışanın depo yetkisi; başka şirketin ürünü |
| `apps/api/test-db/concurrency.db.spec.ts` | Gerçek veritabanı (`pnpm db:test`) | Eşzamanlı çıkış, deadlock tehlikesi ve kilit sırası, aynı anda gelen çift onay, çok kalemli rollback (aşağıda) |
| `apps/api/test-db/latency.measure.ts` | Gerçek veritabanı, ölçüm (`measure:latency`) | Onay süresi ve transaction başına sorgu sayısı ([veritabani.md](veritabani.md#bölgeler-arası-gecikme-ve-onay-süresi)) |

## Eşzamanlılık ve geri alma (testlerle)

Yarışı rastlantıya bırakmamak için testler aynı yöntemi kullanır (`test-db/support/stock-fixture.ts`, `raceWhileLocked`):
1. Test, ilgili satırı kendi transaction'ında `FOR UPDATE` ile kilitler.
2. İki onay isteğini gönderir.
3. PostgreSQL'de ikisinin de kilit beklediğini görür (`pg_stat_activity`).
4. Kilidi bırakır.

İki istek böylece her çalıştırmada gerçekten aynı anda aynı satıra yarışır.

| Senaryo | Beklenen ve doğrulanan |
| --- | --- |
| 10 adet stoktan iki ayrı 7 adetlik çıkış aynı anda | Biri 200, öteki 409 `INSUFFICIENT_STOCK` (mevcut: 3); stok 3, tek çıkış hareketi |
| Ters sırayla kilitleyen iki ham transaction (A→B, B→A) | PostgreSQL döngüyü görür ve birini `40P01` (deadlock) hatasıyla geri alır. Uygulamanın değil, korunduğumuz tehlikenin gösterimi |
| Kalemleri ters sırada olan iki işlem ([A, B] ve [B, A]) aynı anda | İkisi de 200. Kilitler ürün kimliği sırasıyla alındığı için ikisi de önce A'yı bekler, döngü oluşmaz |
| Aynı işleme aynı anda iki onay, aynı `Idempotency-Key` | İkisi de 200 ve aynı cevap; stok bir kez değişir; 1 hareket, 1 denetim, 1 outbox kaydı |
| Aynı işleme aynı anda iki onay, farklı anahtar | Biri 200, öteki 409 `OPERATION_ALREADY_APPLIED`; stok bir kez değişir |
| Üç kalemli transfer; 2. kalem yetmiyor | 409; kaynak stok ve ortalama maliyet aynı, hedef depoda açılan stok satırları da geri alındı; hareket, denetim, outbox yok; işlem onay bekliyor |
| İki kalemli giriş; stok ve maliyet yazıldıktan sonra son adımda hata (anahtar başka işlemde kullanılmış) | 409 `IDEMPOTENCY_KEY_REUSED`; yazılmış stok, ortalama maliyet ve hareketler geri alındı: transaction sınırı bütün adımları kapsıyor |

## Savunmada sorulabilecek sorular

- **"İki kişi aynı anda son 5 prizi çıkarmaya çalışırsa ne olur?"** İkisi de stok satırını `FOR UPDATE` ile kilitlemek ister; biri bekler. Birincisi stoğu 0'a indirip bitirince ikincisi kilidi alır, `quantity >= 5` koşulu artık sağlanmaz ve `409 INSUFFICIENT_STOCK` alır. Stok eksiye düşmez; düşmeye çalışsa `CHECK` kısıtı da reddeder.
- **"Deadlock nasıl önleniyor?"** Bütün transaction'lar stok satırlarını aynı sırayla (ürün, sonra depo kimliği) kilitler. Kilit bekleme döngüsü ancak iki transaction satırları farklı sırayla kilitlerse oluşur. Testte iki ham transaction ters sırayla kilitleyince PostgreSQL birini `40P01` ile geri aldı; uygulamada kalemleri ters sırada olan iki işlem aynı anda onaylanınca ikisi de tamamlandı.
- **"Eşzamanlılık testinin gerçekten yarıştığını nasıl biliyorsunuz?"** Test satırı önce kendisi kilitler ve iki isteğin de kilidi beklediğini `pg_stat_activity`'de görmeden kilidi bırakmaz. İstekler sırayla değil, aynı anda aynı kilidi bekler.
- **"Ağ koptu, kullanıcı Onayla'ya tekrar bastı; stok iki kez düşer mi?"** Hayır. İstemci aynı `Idempotency-Key`'i gönderir; API işlemi `APPLIED` ve anahtarı aynı bulur, ilk cevabı tekrar döner.
- **"Ortalama maliyeti neden JavaScript'te hesaplamadınız?"** Kayan nokta ondalık sayıyı tam tutamaz. Hesap, değerin zaten kilitli olduğu satırda, kolonla aynı `NUMERIC` tipinde ve tek yuvarlama kuralıyla SQL'de yapılır (ADR-003).
- **"Sayımda sistemdeki miktar ne zaman okunuyor?"** Onay anında, kilitli satırdan. Sayım açıldıktan sonra çıkış olduysa fark ona göre hesaplanır; testte 115 → 112 örneği var.
- **"Bildirim neden stok koduyla birlikte gönderilmiyor?"** Bildirim transaction'ın içinden gönderilse ve transaction sonra geri alınsa, gerçekleşmemiş bir işlem için bildirim gitmiş olurdu. Olay `outbox_events`'e aynı transaction'da yazılır; worker (5–6. hafta) yalnızca kalıcı olmuş olayları işler.
