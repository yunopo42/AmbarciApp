# Veritabanı şeması ve şirketler arası izolasyon

Bu belge `packages/db` altındaki şemanın ve RLS politikalarının neden böyle kurulduğunu anlatır. İlgili işler: #15 (şema ve ilk migration), #19 (RLS ve iki şirketli izolasyon testi), #32 (işlem, hareket, sayım, denetim ve outbox tabloları), #54 (sohbet, mesaj ve `ai_runs` tabloları; benzerlik araması).

## Kapsam

Şemada 19 tablo var. İlk 10 tablo 2. haftada geldi:

| Tablo | Ne tutar | Öne çıkan kurallar |
| --- | --- | --- |
| `organizations` | Şirket (kök kiracı), ayarlar (`jsonb`) | Ad boş olamaz |
| `organization_users` | Kullanıcının şirketteki üyeliği, rolü (`ADMIN`/`EMPLOYEE`), aktifliği | (şirket, kullanıcı) benzersiz; kullanıcı `auth.users`'a bağlı |
| `invitations` | Tek kullanımlık, süreli davet kodu ve rolü | Kod tüm sistemde benzersiz ve en az 8 karakter |
| `warehouses` | Depo, şube veya araç deposu | Aynı şirkette aynı ad iki kez kullanılamaz |
| `user_warehouse_access` | Çalışanın işlem yapabileceği depolar | Üye ile depo aynı şirkete ait olmak zorunda |
| `products` | Stok kartı: SKU, barkod, ad, ana birim, kritik stok | (şirket, SKU) ve (şirket, barkod) benzersiz |
| `product_units` | Ana birim dışındaki birimler (koli, palet) ve çevrim katsayısı | Katsayı > 0 |
| `product_aliases` | Ürünün sahadaki diğer adları | (şirket, ürün, ad) benzersiz |
| `parties` | Cari kart (tedarikçi, müşteri) | VKN/TCKN 10–11 rakam |
| `inventory` | Depo bazında stok ve hareketli ortalama maliyet | Miktar ≥ 0; (şirket, depo, ürün) benzersiz |

3. haftada stok defterinin 6 tablosu eklendi (#32; ayrıntı: [Stok defteri tabloları](#stok-defteri-tabloları)):

| Tablo | Ne tutar | Öne çıkan kurallar |
| --- | --- | --- |
| `operations` | İşlem (stok fişi): tür, durum, kaynak, sürüm, cari, onaylayan | Bir işlem en fazla bir kez geri alınır; onay anahtarı (`Idempotency-Key`) şirket içinde benzersiz |
| `operation_items` | İşlemin kalemleri: ürün, depo, miktar ve girilen birim | Birim, kalemdeki ürünün birimi olmak zorunda; (işlem, kalem no) benzersiz |
| `inventory_movements` | Stoğu değiştiren her hareket: işaretli miktar, maliyet, sonraki bakiye | Türü ile yönü uyumlu; (işlem, kalem, depo) benzersiz |
| `stock_counts` | Sayım sonucu: sistemdeki, sayılan ve fark | Farkı veritabanı hesaplar |
| `audit_logs` | Kim, ne zaman, hangi kaynaktan, neyi yaptı | Yalnızca yönetici okur |
| `outbox_events` | Stokla aynı transaction'da yazılan olaylar (bildirim vb. için) | İstemcilere tamamen kapalı |

4. haftada asistanın 3 tablosu eklendi (#54; ayrıntı: [Asistan tabloları](#asistan-tabloları)):

| Tablo | Ne tutar | Öne çıkan kurallar |
| --- | --- | --- |
| `conversations` | Asistanla sohbet: sahibi, kanal, başlık, son mesaj zamanı | Yalnızca sahibi okur; hesap silinince silinir |
| `messages` | Sohbetin mesajları: sıra, rol, Claude'un içerik blokları, istemci kimliği, cevap durumu | (sohbet, sıra) ve (sohbet, `client_message_id`) benzersiz; içerik boş olmayan blok dizisi |
| `ai_runs` | Her model çağrısı: model, prompt sürümü, effort, araçlar, token ve önbellek sayıları, süre, maliyet | Yalnızca yönetici okur; hesap silinince kişi ve mesaj bağlantısı boşalır, kayıt kalır |

Belge ve `push_tokens` tabloları ilgili haftalarda yeni migration'larla eklenir.

## Tasarım kararları

1. **Ayrı kullanıcı tablosu yok.** Kullanıcılar Supabase Auth'ta (`auth.users`) tutulur. `organization_users.user_id` oraya yabancı anahtarla bağlanır. Böylece şifre, e-posta doğrulama ve oturum Supabase'de kalır; bizim tablomuz yalnızca "kim hangi şirkette, hangi rolde" bilgisini tutar. Bir kullanıcı birden fazla şirkete üye olabilir. Hesap silinince (KVKK) üyelik de silinir (`on delete cascade`).

2. **Kimlikler UUID.** Sıralı sayı (1, 2, 3…) kayıt sayısını ve başka şirketlerin kayıt kimliklerini tahmin edilebilir kılar. UUID'ler veritabanında üretilir (`gen_random_uuid()`).

3. **Her tabloda `organization_id`.** Şirkete ait her satır, alt tablolar dahil (`product_units`, `product_aliases`, `user_warehouse_access`), şirket kimliğini taşır. Böylece her sorgu ve her RLS politikası tek bir kolona bakarak şirketi süzer; birleştirme (join) gerekmez.

4. **Bileşik yabancı anahtarlar.** Bağlı kayıt aynı şirketten olmak zorundadır. Örneğin `inventory (organization_id, product_id)` alanı `products (organization_id, id)` alanına bağlanır. A şirketinin stok satırı B şirketinin ürününe bağlanmaya çalışırsa veritabanı reddeder. Bunun için hedef tablolarda (şirket, id) çifti üzerinde benzersizlik kısıtı vardır.

5. **Sayılar `NUMERIC`.** Ondalık değerler kayan noktalı (`float`) tutulursa 0,1 + 0,2 gibi hesaplarda yuvarlama hatası birikir.
   - Miktar: `NUMERIC(14,3)`, örneğin 12,5 metre kablo.
   - Çevrim katsayısı: `NUMERIC(14,6)`.
   - Ortalama birim maliyet: `NUMERIC(14,4)`. Birim maliyet kuruşun altına inebilir: 1000 adetlik kutu 35 TL ise adet 0,035 TL'dir.
   - Drizzle bu değerleri JS'e metin olarak verir. Metin JS `number`'a çevrilip hesap yapılmaz; hesap SQL'de ya da ondalık kütüphanesiyle yapılır.

6. **Kısıtlar veritabanında (son savunma hattı).** API'de hata olsa bile veritabanı şu kuralları uygular:
   - Stok eksiye düşemez (`CHECK (quantity >= 0)`).
   - Çevrim katsayısı sıfır ya da negatif olamaz.
   - Ad ve kod alanları boş bırakılamaz.
   - VKN/TCKN yalnızca 10–11 rakam olabilir.
   - Davet kodu en az 8 karakterdir.

7. **Silme yok, pasife alma var.** Ürün, depo, cari ve üyelik silinmez; `is_active = false` yapılır. Hareketi olan bir ürün silinirse geçmiş kayıtlar anlamsızlaşır. İş verisi yabancı anahtarlarında `cascade` yoktur; bağlı kaydı olan satır silinemez. İki istisna var: hesap silinince üyelik silinir, üyelik silinince depo yetkileri silinir.

8. **Benzersizlik şirket içinde.** İki farklı şirkette aynı SKU (`PRZ-3`) ya da aynı depo adı ("Ana depo") olabilir; kısıtlar şirket kimliğiyle başlar. Tek istisna davet kodudur: kullanıcı katılırken şirketi bilmez, yalnızca kodu girer.

9. **Sabit listeler `enum`.** Rol, depo türü, cari türü ve alternatif ad kaynağı birer PostgreSQL `enum`'udur. Listeye yeni değer eklemek migration gerektirir; böylece kod ile veritabanı sessizce ayrışmaz.

10. **İndeksler sorgulara göre.** Benzersizlik kısıtları zaten indeks oluşturur. Ek olarak şu sorgular için indeks var:
    - Kullanıcının şirketleri (her istekte ve her RLS kontrolünde çalışır)
    - "Bu ürün hangi depolarda?"
    - Cari ve alternatif ad aramaları
    - Hesap silinince boşaltılan davet alanları

    Supabase'in performans denetimi indekssiz yabancı anahtar bulmuyor.

## Stok defteri tabloları

3. haftada eklenen tablolar (#32) stoğun nasıl değiştiğini kaydeder. Bu bölüm verinin hangi kurallarla tutulduğunu anlatır; stoğu değiştiren onay transaction'ı (#33), kilit sırası ve maliyet hesabı [stok-islemleri.md](stok-islemleri.md) dosyasında. Ondalık hesapların nerede yapıldığı: ADR-003.

**Bir işlemin yolu:**

```text
operations (PENDING_CONFIRMATION)
  └─ operation_items (kalem 1, 2, …)          ← ekran ya da asistan önerisi
        │  onay: POST /v1/operations/{id}/confirm, tek transaction
        ├─ inventory_movements (kalem başına 1, transferde 2 hareket)
        ├─ stock_counts (yalnızca sayımda)
        ├─ inventory (miktar ve ortalama maliyet güncellenir)
        ├─ audit_logs ("operation.applied")
        └─ outbox_events ("operation.applied")
operations → APPLIED
```

### Kararlar

1. **Kalemler ayrı tabloda, JSON alanında değil.** İşlemin kalemleri `operations` içinde tek bir `jsonb` alanında da tutulabilirdi; daha esnek olurdu. Ama o zaman veritabanı kalemdeki ürünün ve deponun aynı şirkete ait olduğunu ya da girilen birimin o ürünün birimi olduğunu denetleyemezdi. Ayrı tabloda her kalem bileşik yabancı anahtarlarla ürüne, depoya ve birime bağlı. Hareket de kaleme bağlı olduğu için uygulanmış bir işlemin kalemi silinemez.

2. **Hareket miktarı işaretli.** `quantity_change` girişte artı, çıkışta eksidir. Böylece bir depodaki ürünün bütün hareketlerinin toplamı `inventory.quantity`'ye eşittir; stok, hareketlerden yeniden hesaplanıp doğrulanabilir. Tür ile işaret bir CHECK kısıtıyla bağlıdır: `OUT` hareketi artı, `IN` hareketi eksi olamaz, sıfır miktarlı hareket yazılamaz. `REVERSAL` (ters kayıt, 5. hafta) iki yönde de olabilir, sıfır olamaz.

3. **Hareket, sonraki bakiyeyi de saklar.** `quantity_after` ve `average_cost_after`, hareketten hemen sonraki stok ve ortalama maliyettir; stok kartındaki bakiye satırı doğrudan buradan okunur. `unit_cost` hareketin ana birim başına maliyetidir (girişte alış maliyeti, çıkışta o anki ortalama). Ters kayıt bu maliyetle yazılacağı için saklanması gerekir. `unit_factor`, onay anındaki çevrim katsayısıdır; katsayı sonradan değişse de "3 koli × 12 = 36 adet" hesabı kayıtta kalır.

4. **Çift uygulamaya karşı benzersizlik.** `(organization_id, operation_id, line_no, warehouse_id)` benzersizdir: bir kalem bir depodaki stoğu en fazla bir kez değiştirebilir. Aynı işlem bir hata yüzünden ikinci kez uygulanmaya çalışılırsa ilk hareket eklemesi burada reddedilir ve transaction geri alınır. Depo da anahtarın içinde, çünkü transfer kaleminin iki hareketi vardır (çıkan ve giren depo). İşlem düzeyinde ayrıca `apply_idempotency_key` şirket içinde benzersizdir: aynı onay isteği tekrar gelirse API aynı cevabı döner (#33).

5. **Hareket, stok satırına bağlı.** `inventory_movements (organization_id, warehouse_id, product_id)` → `inventory`. Bu yabancı anahtar hem depo ile ürünün aynı şirketten olmasını hem de stok satırının önceden açılmış olmasını garanti eder. Zincir şöyle: hareket → kalem → işlem; hareket → stok satırı → depo ve ürün. Her halkada `organization_id` var, yani hiçbir hareket başka şirketin kaydına bağlanamaz.

6. **Bir işlem bir kez geri alınır.** Ters kayıt, `reversed_operation_id` alanıyla asıl işleme bağlanan yeni bir `REVERSAL` işlemidir. Bu alan şirket içinde benzersiz olduğu için ikinci bir ters kayıt veritabanında reddedilir. CHECK kısıtları da tür ile bağlantıyı birlikte tutar: `REVERSAL` türünde bağlantı zorunlu, diğer türlerde yasak; işlem kendini geri alamaz.

7. **Sayım farkını veritabanı hesaplar.** `stock_counts.difference`, `counted_quantity - system_quantity` olarak tanımlanmış, saklanan bir hesaplanmış kolondur (`GENERATED ALWAYS AS … STORED`). Elle yazılamaz; bu yüzden iki miktarla her zaman tutarlıdır. Sistemdeki miktar öneri anında değil, onay anında kilitli stok satırından okunur: arada başka bir çıkış olduysa fark doğru hesaplanır. Fark sıfırsa hareket yazılmaz, ama "sayıldı, tuttu" bilgisi bu tabloda kalır.

8. **Uygulanma zamanı durumla tutarlı.** `APPLIED` ve `REVERSED` durumundaki işlemin `applied_at` alanı doludur, diğerlerinin boştur (CHECK). Durum makinesindeki sekiz durumun hepsi `enum`'da baştan var (`RECEIVED` … `FAILED`). Böylece 5. haftada yeni durum için `enum` değiştirmek gerekmez.

9. **Hareketin zamanı `clock_timestamp()`.** PostgreSQL'de `now()`, transaction'ın başladığı anı verir. Kilit bekleyen bir transaction, kendisinden önce kilidi alan transaction'dan daha önce başlamış olabilir; `now()` ile hareketler yanlış sıralanırdı. `clock_timestamp()` eklemenin gerçek anını verir. Aynı stok satırı kilitli olduğu için o satırın hareketleri kilit sırasıyla eklenir ve zaman sırası bakiye sırasıyla aynı olur.

10. **Kişi bağlantısı silinince boşalır.** `operations.created_by`, `applied_by` ve `audit_logs.actor_id` doğrudan `auth.users`'a bağlıdır ve `on delete set null` kullanır. Kullanıcı hesabını silerse (KVKK) işlem ve denetim kaydı kalır, yalnızca kişi bilgisi boşalır. Bu, davet kodlarındaki kuralla aynıdır.

11. **Denetim kaydını yalnızca yönetici okur.** `audit_logs` için `adminCanRead` politikası kullanılır (davet kodlarındaki gibi). `details` alanına kişisel veri (telefon, e-posta, VKN/TCKN) ve mesaj içeriği yazılmaz. `action` alanı `nesne.eylem` biçimindedir (`operation.applied`); biçim CHECK ile denetlenir.

12. **Outbox istemcilere tamamen kapalı.** `outbox_events` için hiç okuma politikası yok, ayrıca `0004_outbox_grants.sql` ile anon ve authenticated rollerinin bütün yetkileri geri alındı. Politika yanlışlıkla eklense bile istemci tabloyu okuyamaz. Olayları API'nin içindeki worker okur (5–6. hafta). Bekleyen olaylar için kısmi indeks (`WHERE processed_at IS NULL`) var; işlenmiş olaylar indekse girmez. Supabase'in güvenlik denetimi bu tablo için "RLS açık ama politika yok" bilgisini (INFO) verir; bu bilinçli bir tercih.

13. **"Yalnızca eklenir" kuralı nasıl korunuyor?** Hareket ve denetim kayıtları güncellenmez, silinmez. İstemcilerin bu tablolara yazma yetkisi yok (testle doğrulandı); API'de de güncelleme ya da silme yolu yazılmayacak. Veritabanında bir tetikleyiciyle (trigger) güncelleme ve silmeyi tamamen engellemek de düşünüldü. Ama gerçek veritabanı testleri kendi verisini siliyor, KVKK hesap silme akışı (7. hafta) da kayıt silebilir; tetikleyici bu ikisini karmaşıklaştırırdı. Bu yüzden şimdilik eklenmedi; gerekirse ayrı bir migration'la eklenebilir.

14. **Kalem miktarı ve birimi.** `operation_items.quantity` kullanıcının girdiği birimdedir; birim boşsa ürünün ana birimidir. Sayımda bu, sayılan miktardır ve 0 olabilir; bu yüzden kalemde kısıt `>= 0`'dır. Diğer türlerde sıfır miktarı API reddeder; reddetmese bile hareket tablosundaki "sıfır hareket yazılamaz" kısıtı durdurur. Girişte `unit_cost` girilen birim başına fiyattır (koli fiyatı); ana birime onayda çevrilir (ADR-003). Ürünün birimi bir işlemde kullanıldıysa birimin adı değiştirilemez (yabancı anahtar); yeni bir birim eklenir.

### İndeksler

| İndeks | Hangi sorgu için |
| --- | --- |
| `operations (organization_id, status, created_at)` | Onay kuyruğu ve "onay bekleyen işlemlerim" |
| `inventory_movements (organization_id, warehouse_id, product_id, created_at)` | Stok kartı: bir depodaki ürünün hareketleri |
| `inventory_movements (organization_id, product_id, created_at)` | Ürünün bütün depolardaki son hareketleri (mobil ürün detayı, asistanın `list_recent_movements` aracı) |
| `audit_logs (organization_id, created_at)`, `(organization_id, entity_type, entity_id)` | Denetim listesi ve bir kaydın geçmişi |
| `outbox_events (created_at) WHERE processed_at IS NULL` | Worker'ın bekleyen olayları okuması |
| Diğerleri | Yabancı anahtarlar (Supabase performans denetimi indekssiz anahtar bırakmaz) |

Yeni tablolar boş olduğu için Supabase'in performans denetimi bu indeksleri "kullanılmamış" (INFO) olarak gösterir; veri geldikçe kullanılırlar.

## Asistan tabloları

4. haftada eklenen tablolar (#54) asistanın sohbet geçmişini ve her model çağrısının kaydını tutar. Model çağrısı `ai` modülünde (#55), ajan döngüsü ve araçlar `assistant` modülünde (#56), uçlar ve akış #57'de.

**Bir sohbetin yolu:**

```text
conversations (bir kullanıcının sohbeti)
  └─ messages
       1 USER       "Merkez depoda priz kaç tane?"    client_message_id; durum IN_PROGRESS → COMPLETED
       2 ASSISTANT  [düşünme] [tool_use: search_products]
       3 TOOL       [tool_result]
       4 ASSISTANT  [düşünme] [text: "Merkez depoda 10 adet var."]
ai_runs: 1. mesaja bağlı iki kayıt (tur 1: araç çağrısı, tur 2: cevap)
```

### Kararlar

1. **İçerik blokları olduğu gibi saklanır.** Claude'un cevabı bir blok dizisidir: düşünme (`thinking`), metin (`text`), araç çağrısı (`tool_use`). Araç sonuçları (`tool_result`) ayrı bir mesajdır. `messages.content` bu diziyi değiştirmeden `jsonb` olarak saklar. Haiku 5.5'te düşünme blokları araç sonuçlarıyla birlikte değiştirilmeden geri gönderilmeli ve geçmiş yalnızca sona eklenerek büyümeli (ADR-001). Yalnızca metin saklansaydı modele giden geçmiş birebir kurulamaz, istek 400 alabilirdi. Arayüz bu dizinin metin bloklarını gösterir.
2. **Araç sonucu ayrı rol.** Claude API araç sonuçlarını `user` rolüyle alır; tabloda `TOOL` rolüyle tutulur. Böylece arayüz yalnızca `USER` ve `ASSISTANT` mesajlarını gösterir, tekrar kontrolü yalnızca kullanıcının yazdığı mesajda çalışır. Adaptör `TOOL`'u API'ye `user` olarak gönderir.
3. **Sıra numarası ve tek cevap.** Mesajlar `position` (1, 2, 3…) ile sıralanır ve (sohbet, sıra) benzersizdir. Aynı transaction'daki eklemelerin zamanı aynı olabileceği için zaman damgası sıralamaya yetmez. Benzersizlik ayrıca aynı sohbette aynı anda iki cevap üretilmesini engeller: ikinci cevabın ilk mesajı aynı sırayı almaya çalışır ve reddedilir. Bu önemli, çünkü `tool_use` bloğundan hemen sonra onun sonucu gelmek zorunda; iki cevabın mesajları karışsaydı sohbet bozulurdu.
4. **Mesaj bir kez işlenir.** İstemci her mesaj için bir kimlik (`client_message_id`, UUID) üretir ve ağ hatasında aynı kimlikle tekrar gönderir; (sohbet, `client_message_id`) benzersizdir. Kullanıcı mesajının `status` alanı cevabın durumudur (`IN_PROGRESS`, `COMPLETED`, `FAILED`). Aynı kimlik tekrar gelirse API buna bakıp ya kayıtlı cevabı döner ya da 409 verir; modeli ikinci kez çağırmaz (#57). İstemci kimliği ve durum yalnızca kullanıcı mesajında bulunur ve orada zorunludur (CHECK).
5. **Boş mesaj yazılamaz.** İçerik, boş olmayan bir JSON dizisi olmak zorunda (CHECK). Claude API boş içerikli mesajı reddeder; böyle bir satır yazılsaydı sohbetin sonraki bütün istekleri hata verirdi.
6. **Sohbeti yalnızca sahibi okur.** Politika hem `user_id = auth.uid()` hem aktif üyelik ister. Aynı şirketin yöneticisi de başkasının sohbetini okuyamaz, çünkü mesajlar kişinin kendi yazdıklarıdır. Yönetici maliyet ve kullanım bilgisini `ai_runs`'tan görür; orada mesaj içeriği yoktur.
7. **Mesajda kullanıcı kolonu.** RLS her satırda tek kolona bakabilsin diye (tasarım kararı 3'teki `organization_id` gibi) mesaj da sohbetin sahibini taşır. Bileşik yabancı anahtar `(organization_id, conversation_id, user_id)` → `conversations` bu kolonun sohbetin sahibiyle aynı olmasını garanti eder: başka kullanıcıya ya da başka şirkete bağlı mesaj yazılamaz.
8. **Hesap silinince.** Sohbetler ve mesajlar silinir (`on delete cascade`), çünkü kişisel içeriktir (KVKK). `ai_runs` kişisel veri içermez; maliyet ve değerlendirme kaydı olarak kalır, `user_id` ve `message_id` boşalır. Bu, işlem ve denetim kayıtlarındaki kuralla aynıdır (stok defteri kararı 10).
9. **Kolon listeli SET NULL.** `ai_runs`'ın mesaja bağlantısı bileşik anahtardır: `(organization_id, message_id)`. Düz `ON DELETE SET NULL` mesaj silinince iki kolonu da boşaltmaya çalışır; `organization_id` NOT NULL olduğu için silme hata verirdi. PostgreSQL 15'ten beri `ON DELETE SET NULL (message_id)` yalnızca yazılan kolonu boşaltır (Supabase'de PostgreSQL 17). drizzle-kit bu sözdizimini üretemediği için migration'da elle yazıldı.
10. **Bir mesaj, birden fazla model çağrısı.** Bir soru, araç turları yüzünden birkaç model çağrısı sürer (2. hafta denemesinde mesaj başına ortalama 1,75 tur). Her çağrı ayrı bir `ai_runs` satırıdır; aynı kullanıcı mesajına bağlanır ve tur numarası (`round_no`) taşır. Mesaj başına süre, token ve maliyet bu satırların toplamıdır. `first_token_ms` ilk metin parçasına kadar geçen süredir; kullanıcının ilk kelimeyi ne kadar beklediğini ölçmek için (#60).
11. **Maliyet `NUMERIC`.** `cost_usd NUMERIC(12,8)`: bir çağrı kuruşun çok altında tutar (2. hafta denemesinde mesaj başına yaklaşık 0,001 $). Maliyet çağrı anındaki fiyatla token sayılarından SQL'de hesaplanır (ADR-003); fiyat sonradan değişse de kayıt değişmez. Effort da yazılır, çünkü aynı model farklı effort düzeyinde farklı token harcar (ADR-001).
12. **Bitiş nedeni metin.** `stop_reason` (`end_turn`, `tool_use`, `refusal`…) `enum` değil metindir: API yeni bir değer eklerse kayıt yazılamaz hâle gelmesin.

### İndeksler

| İndeks | Hangi sorgu için |
| --- | --- |
| `conversations (user_id, organization_id, last_message_at)` | "Sohbetlerim" listesi; hesap silinirken kullanıcının sohbetleri |
| `messages (organization_id, conversation_id, position)` (benzersiz) | Sohbet geçmişi, sırasıyla |
| `ai_runs (organization_id, created_at)` | Şirketin günlük token bütçesi ve maliyet raporu |
| `ai_runs (user_id, created_at)` | Kullanıcının günlük token bütçesi; hesap silinirken |
| `ai_runs (organization_id, message_id)` | Bir mesajın cevabındaki çağrılar |

## Benzerlik araması (pg_trgm)

Asistanın ürün arama aracı (`search_products`, #56) için. Sahada ürün adı yazım hatasıyla ("kabllo") ya da ses tanıma hatasıyla gelir; `ILIKE` ancak metin birebir geçiyorsa bulur.

- **pg_trgm** metni üçlü harf gruplarına (trigram) böler: "kablo" → "  k", " ka", "kab", "abl", "blo", "lo ". İki metnin ortak gruplarından 0–1 arası bir benzerlik skoru çıkar; `%` işleci skoru eşiğin (varsayılan 0,3) üstünde olanları bulur. Eklenti, Supabase'in önerdiği gibi `extensions` şemasında.
- **Türkçe harf dönüşümü:** `private.fold_search(metin)`, `apps/api/src/common/search.ts`'teki `foldForSearch` ile aynı dönüşümü yapar (I, İ, ı → i, sonra küçük harf). İkisinin aynı sonucu verdiği test ediliyor (`apps/api/test-db/search.db.spec.ts`). Fonksiyon indeks ifadesinde kullanıldığı için `IMMUTABLE`; `search_path` boş ve `private` şemasında (istemciler çağıramaz).
- **İndeksler:** `products (organization_id, fold_search(name))` ve `product_aliases (organization_id, fold_search(alias))`, ikisi de GIN. **btree_gin** eklentisi şirket kimliğini (uuid) trigram ile aynı GIN indeksine koymayı sağlar; arama her zaman tek şirketin ürünlerinde yapılır.
- **Sorgu indeksle aynı yazılmalı.** İndeks `private.fold_search(name)` ifadesi üzerine kurulu. Sorgu da `private.fold_search(name) % private.fold_search($1)` biçiminde yazılmazsa indeks kullanılamaz. Test, iki tabloda da planın trigram indeksini kullandığını `EXPLAIN` ile doğrular.
- **Canlıdaki ilk deneme** (ABC Elektrik demo verisi, geri alınan bir transaction'da): "kabllo nym 3x2,5" en yüksek skorla NYM kablo 3x2,5'u (0,833), "otomatk sigorta 16" Otomatik sigorta C16'yı (0,600) buldu. Alternatif adlarda şirket koşulu ve benzerlik koşulu aynı indeks taramasında çalıştı. "uclu priz" ürün adlarında bir şey bulmadı: dönüşüm ü ve ç gibi harfleri değiştirmiyor. Alternatif adlarda arama ve skor eşiği #56'da ayarlanacak.

## Şirketler arası izolasyon: dört katman

| Katman | Kimi durdurur | Nerede |
| --- | --- | --- |
| 1. API filtresi | API'yi kullanan istemci | Her sorgu `organization_id` ile süzülür; şirket kimliği oturumdan gelir, istemciden alınmaz (#17, #18) |
| 2. RLS politikaları | Supabase Data API'yi doğrudan kullanan istemci | `schema/rls.ts`, `0002_read_policies.sql`, `0003_operations_and_movements.sql`, `0006_conversations_and_ai_runs.sql` |
| 3. Rol yetkileri | Aynı istemci, politika yanlış yazılsa bile | `0001_rls_helpers.sql` |
| 4. Bileşik anahtarlar ve CHECK | API'deki bir programlama hatası | `0000_initial_schema.sql` |

**Neden RLS gerekiyor?** Supabase her projede tablolar için otomatik bir REST arayüzü (Data API) yayınlar. Anon anahtarı web ve mobil paketinin içinde herkese açık durur. RLS olmasaydı bu anahtarı bulan biri tablolara doğrudan erişebilirdi.

**API neden RLS'den etkilenmiyor?** API veritabanına tabloların sahibi olan `postgres` kullanıcısıyla bağlanır. Tablo sahibi RLS'ye takılmaz. Bu yüzden API'deki izolasyon her sorgudaki `organization_id` filtresinden gelir (1. katman). RLS ikinci savunma hattıdır.

**Politikalar:**

- Oturum açmış kullanıcı (`authenticated`) bir satırı ancak o satırın şirketinin **aktif** üyesiyse okuyabilir.
- Davet kodlarını yalnızca o şirketin yöneticisi okuyabilir; kod bir sırdır. Denetim kaydı (`audit_logs`) ve model çağrısı kayıtları (`ai_runs`) da yalnızca yöneticiye açıktır.
- Sohbeti ve mesajlarını yalnızca sahibi, o da şirketin aktif üyesiyse okuyabilir; aynı şirketin yöneticisi okuyamaz.
- `outbox_events` hiçbir istemciye açık değildir: politikası yoktur ve okuma yetkisi de geri alınmıştır.
- Yazma politikası yoktur. Ayrıca `anon` rolünün bütün yetkileri ve `authenticated` rolünün yazma yetkileri geri alınmıştır. Veri yalnızca API'den değişir; stok yalnızca onay uç noktasından değişir (mimari değişmez 2).
- Depo bazında yetki (çalışan yalnızca izinli depoda işlem yapar) RLS'de değil API'de uygulanır. RLS'nin görevi şirket sınırıdır; depo yetkisi işlem kuralıdır.

**Yardımcı fonksiyonlar** (`private.user_organization_ids()`, `private.admin_organization_ids()`):

- **`SECURITY DEFINER`:** Fonksiyon, sahibi olan `postgres`'in yetkisiyle çalışır. `organization_users` tablosunun kendi politikası da üyeliğe baktığından, aksi halde politika kendini sonsuz döngüyle çağırırdı.
- **`SET search_path = ''`:** Fonksiyon içindeki her ad şemasıyla yazılır (`public.organization_users`). Başka şemaya konmuş aynı adlı bir nesne araya giremez.
- **`private` şeması:** Data API bu şemayı yayınlamaz; istemci fonksiyonu doğrudan çağıramaz.
- **`(select private.user_organization_ids())` kalıbı:** Fonksiyon her satır için değil, sorgu başına bir kez çalışır.

## Migration'lar

| Dosya | İçerik | Nasıl üretildi |
| --- | --- | --- |
| `0000_initial_schema.sql` | Enum'lar, 10 tablo, kısıtlar, indeksler; her tabloda RLS açık | `drizzle-kit generate` |
| `0001_rls_helpers.sql` | `private` şeması, yardımcı fonksiyonlar, rol yetkilerinin geri alınması | Elle (`drizzle-kit generate --custom`) |
| `0002_read_policies.sql` | 10 okuma politikası | `drizzle-kit generate` |
| `0003_operations_and_movements.sql` | 4 enum, stok defterinin 6 tablosu, kısıtlar, indeksler, 5 okuma politikası; `parties` için (şirket, id) benzersizliği | `drizzle-kit generate` (bir satırın sırası elle düzeltildi, aşağıda) |
| `0004_outbox_grants.sql` | `outbox_events` üzerindeki istemci yetkilerinin geri alınması | Elle (`drizzle-kit generate --custom`) |
| `0005_trigram_search.sql` | `pg_trgm` ve `btree_gin` eklentileri, `private.fold_search` fonksiyonu | Elle (`drizzle-kit generate --custom`) |
| `0006_conversations_and_ai_runs.sql` | 3 enum, asistanın 3 tablosu, kısıtlar, indeksler, 3 okuma politikası; ürün adı ve alternatif ad trigram indeksleri | `drizzle-kit generate` (bir yabancı anahtar elle düzeltildi, aşağıda) |

Sıra önemlidir: politikalar fonksiyonları, fonksiyonlar da tabloları kullanır. RLS ilk migration'da açılır; politikalar gelene kadar tablolar herkese kapalıdır, açık kalmaz.

`0003` üretildiğinde drizzle-kit, `parties (organization_id, id)` benzersizlik kısıtını dosyanın sonuna, ona dayanan `operations_party_fk` yabancı anahtarından sonraya yazdı; PostgreSQL bu sırayı reddeder. Kısıt, uygulanmadan önce elle yabancı anahtarların önüne alındı (dosyada yorumla işaretli). Migration önce canlı veritabanında geri alınan bir transaction içinde denendi, sonra uygulandı.

`0005` elle yazıldı ve `0006`'dan önce gelir: trigram indeksleri `private.fold_search` fonksiyonunu kullandığı için fonksiyon indekslerden önce var olmalı. `0006`'da drizzle-kit `ai_runs_message_fk` için kolon listesiz `ON DELETE set null` üretti; elle `ON DELETE SET NULL (message_id)` yapıldı ([Asistan tabloları](#asistan-tabloları), karar 9; dosyada yorumla işaretli). İki migration da önce geri alınan bir transaction'da denendi, sonra uygulandı.

0001'deki varsayılan yetkiler (`ALTER DEFAULT PRIVILEGES`) sayesinde yeni tablolar da anon'a kapalı ve authenticated için salt okunur başlar; bunun için ayrıca migration yazılmadı.

Uygulanmış bir migration düzenlenmez; değişiklik yeni bir migration'la yapılır. Supabase'in güvenlik denetimi (Security Advisor) bu şemada uyarı vermiyor.

## Demo verisi

`pnpm db:seed` iki kurgusal şirket yükler (veri: `packages/db/seed/demo-data.ts`):

- **ABC Elektrik:** 18 ürün (kablo, priz, anahtar, sigorta, aydınlatma, tesisat malzemesi), her biri için bir ek birim (makara, koli, kutu…) ve sahada kullanılan adlar ("üçlü priz", "otomat"). Ayrıca 2 depo, 1 araç deposu ve 3 cari.
- **Kuzey Tesisat:** 1 depo, 3 ürün. İzolasyonu elle göstermek için ABC Elektrik ile aynı depo adını kullanır.

Kararlar:

- **Tekrar çalıştırılabilir.** Her kayıt doğal anahtarıyla eklenir ya da güncellenir (şirket: sabit kimlik, depo: ad, ürün: SKU, birim: ürün + birim, cari: VKN). İkinci çalıştırma kayıt çoğaltmaz; bunu `test/seed.spec.ts` doğrular.
- **Açılış stoğu işlemle girer.** Katalogdan sonra `pnpm db:seed`, ABC Elektrik'in her deposu için bir açılış işlemi (`OPENING`) açar ve kullanıcı onayıyla aynı transaction'dan geçirir; stok doğrudan yazılmaz. Tekrar çalıştırınca açılış ikinci kez girmez (#33, [stok-islemleri.md](stok-islemleri.md#açılış-stoğu)). Bazı ürünler bilerek kritik eşiğin altında başlar.
- **Kullanıcı hesabı açılmaz.** `SEED_ADMIN_EMAIL` verilirse o e-postayla Supabase Auth'ta zaten kayıtlı kullanıcı ABC Elektrik'e yönetici olarak bağlanır.
- **Barkodlar gerçek bir ürüne ait değil.** Mağaza içi kullanıma ayrılmış `200` önekli, geçerli kontrol haneli EAN-13 kodlarıdır; 7. haftada etiket basıp okutulabilir.
- **Cari VKN'leri kurgusal** (`999` önekli). TCKN kullanılmaz.

## İki şirketli izolasyon testi

`pnpm db:test` (dosya: `packages/db/test/rls.spec.ts`). Gerçek Supabase veritabanında çalışır; CI'daki `pnpm test` bunu çalıştırmaz, çünkü CI'da veritabanı bilgisi yok.

**Nasıl çalışır?**

1. Data API her isteği `authenticated` ya da `anon` rolüne geçerek çalıştırır ve kullanıcının JWT içeriğini `request.jwt.claims` ayarına yazar. Politikalardaki `auth.uid()` kullanıcı kimliğini buradan okur. Test aynı şeyi doğrudan SQL ile yapar.
2. Her test bir transaction açar. İçinde iki şirket (A, B), beş kullanıcı ve her tabloda örnek veri oluşturur. Kullanıcılar: A yöneticisi, A çalışanı, A'nın pasif üyesi, B yöneticisi ve hiçbir şirkete üye olmayan biri.
3. Test bitince transaction geri alınır. Veritabanında iz kalmaz; gerçek kullanıcı hesabı açılmaz.

**Neyi kanıtlar (49 test)?**

- On üç tablonun her birinde A kullanıcısı yalnızca A'nın, B kullanıcısı yalnızca B'nin satırlarını görür (3. haftada işlem, kalem, hareket ve sayım tabloları eklendi).
- B'nin ürünü kimliği bilinse bile okunamaz.
- Davet kodlarını, denetim kaydını ve model çağrısı kayıtlarını (`ai_runs`) yalnızca kendi şirketinin yöneticisi görür; çalışan göremez.
- Sohbeti ve mesajlarını yalnızca sahibi görür. Aynı şirketin yöneticisi, pasife alınan üye (kendi eski sohbeti dahil) ve şirkete üye olmayan kullanıcı göremez.
- Outbox olaylarını oturum açmış hiçbir kullanıcı, yönetici bile okuyamaz.
- Pasif üye ve hiçbir şirkete üye olmayan kullanıcı hiçbir satır görmez.
- Oturum açmamış istemci (`anon`) hiçbir tabloyu ve yardımcı fonksiyonları kullanamaz.
- Oturum açmış kullanıcı hiçbir şey yazamaz: ürün ekleme ya da güncelleme, stok değiştirme ya da silme, kendini başka şirkete üye yapma, rolünü yükseltme, işlem durumunu değiştirme, stok hareketi ekleme ya da silme, denetim kaydı silme, kendi sohbetine mesaj ekleme, sohbet başlığını değiştirme, model çağrısı kaydı silme.
- Veritabanı, şirketler arası bağlantıyı (A'nın stoğu → B'nin ürünü, A'nın hareketi → B'nin ürünü) ve eksi stoğu reddeder.
- Hareket kısıtları: türüyle yönü uyuşmayan ya da sıfır miktarlı hareket, aynı kalemin aynı depoya ikinci hareketi, aynı işlemin ikinci ters kaydı ve bağlantısız ters kayıt reddedilir; sayım farkını veritabanı hesaplar ve elle yazılamaz.
- Sohbet kısıtları: aynı `client_message_id` ve aynı sıra ikinci kez yazılamaz; mesaj, sohbetin sahibi olmayan kullanıcıya ya da başka şirkete bağlanamaz; istemci kimliği ve durum yalnızca kullanıcı mesajında bulunur; boş içerik reddedilir. Hesap silinince sohbet ve mesajlar silinir, `ai_runs` kayıtları şirkette kalır ve bağlantıları boşalır.

**Testin gerçekten sızıntı yakaladığı nasıl bilinir?** Geliştirme sırasında bir transaction içinde `products` tablosuna herkese açık bir politika (`using (true)`) eklendi. Aynı yöntemle bakıldığında A kullanıcısının gördüğü şirket sayısı 1'den 2'ye çıktı, yani test başarısız olurdu. Deneme geri alındı. 3. haftada aynı deneme `inventory_movements` tablosunda tekrarlandı; sonuç yine 1'den 2'ye çıktı. 4. haftada `messages` politikası, geri alınan bir transaction'da "şirketin her üyesi okur" biçimine çevrildi: yöneticinin gördüğü çalışan mesajı sayısı 0'dan 1'e çıktı.

**API üzerinden izolasyon** (`apps/api/test-db/organizations.db.spec.ts`, aynı `pnpm db:test` komutuyla). API gerçek veritabanıyla çalıştırılır; token'lar testin kendi anahtarıyla imzalanır. Test şunları doğrular:

- A şirketinin yöneticisi `X-Organization-Id` başlığına C şirketini yazınca 403 alır; C de A'ya erişemez (depolar, üyeler, davet üretimi).
- Kendi şirketinin depo listesinde başka şirketin deposu yoktur. Başka şirketin depo kimliği bilinse bile 404 döner ve o depoya yetki verilemez; bunu bileşik yabancı anahtar engeller.
- Aynı davet kodu iki kullanıcı tarafından aynı anda gönderildiğinde yalnızca biri üye olur (satır kilidi, `FOR UPDATE`).

Guard, rol, depo yetkisi ve davet kurallarının ayrıntılı senaryoları veritabanı olmadan CI'da çalışır (`apps/api/test/organizations.e2e.spec.ts`).

## Bölgeler arası gecikme ve onay süresi

Supabase projesi eu-west-1 (İrlanda), API Render'da Frankfurt'tadır (20 Ekim kararı, `docs/yayin.md`). Onay transaction'ı stok satırlarının kilidini COMMIT'e kadar tutar. Veritabanına giden her sorgu bir gidiş-dönüş beklediği için bölgeler arası gecikme, kilidin tutulduğu süreye doğrudan eklenir. Kilit ne kadar uzun tutulursa aynı ürüne gelen başka bir onay o kadar uzun bekler. #34'te bu süre ölçüldü.

**Yöntem.** Üç senaryo (1 kalem giriş, 5 kalem giriş, 1 kalem transfer), her biri 20 tekrar; ölçümden önce 3 ısınma onayı yapılır.
- Sunucudaki transaction süresi, onay cevabının `Server-Timing` başlığından okunur (BEGIN'den COMMIT'e, `db;dur=…`).
- Transaction başına SQL sayısı, bağlantıdan geçen sorgular sayılarak bulunur.
- Yerel ölçüm: `pnpm measure:latency` (API bu bilgisayarda, Türkiye → İrlanda).
- Render ölçümü: `pnpm measure:remote` (API Render'da, Frankfurt → İrlanda).
- Ham sonuçlar `eval/gecikme/` altındadır.

**Transaction başına sorgu sayısı:** BEGIN + işlemi kilitle + kalemler + yetki + birim çevrimi + stok satırlarını aç + kilitle + hareket başına 1 + APPLIED + denetim + outbox + COMMIT.

| Senaryo | Sorgu |
| --- | --- |
| 1 kalem giriş | 12 |
| 5 kalem giriş | 16 |
| 1 kalem transfer (iki hareket) | 13 |

**Bulgu: her sorgu iki gidiş-dönüş sürüyordu.** İlk yerel ölçümde 1 kalemli onay 1.794 ms sürdü. Yalın gidiş-dönüş (`select 1`) 80 ms olduğuna göre 12 sorgu için ~960 ms beklenirdi; ölçülen bunun iki katıydı. Nedeni: Drizzle'ın postgres.js sürücüsü sorguları hazırlanmamış (`prepare: false`) gönderir. postgres.js hazırlanmamış parametreli sorguda önce parametre tiplerini sorar, cevabı bekler, sonra sorguyu çalıştırır. Ayrı bir denemede parametreli sorgu hazırlanmış olarak 81 ms, hazırlanmamış olarak 159 ms sürdü. `packages/db/src/client.ts` içindeki `preparedByDefault` sarmalayıcısı sorguları hazırlanmış ifade (prepared statement) olarak gönderir. İfade bağlantı başına önbelleğe alınır ve aynı sorgunun sonraki çalıştırmaları tek gidiş-dönüş sürer.

| Yerel (Türkiye → İrlanda), 20 tekrar | Sorgu | Önce: medyan / p95 | Sonra: medyan / p95 | Fark |
| --- | --- | --- | --- | --- |
| 1 kalem giriş | 12 | 1.794 / 1.908 ms | 991 / 1.046 ms | −%45 |
| 5 kalem giriş | 16 | 2.447 / 2.503 ms | 1.335 / 1.517 ms | −%45 |
| 1 kalem transfer | 13 | 1.950 / 1.995 ms | 1.077 / 1.329 ms | −%45 |

*24 Ekim 2026; yalın gidiş-dönüş medyanı 80–81 ms. "Önce" ölçümü: `eval/gecikme/yerel-hazirlanmamis-2026-10-24.json`, "sonra": `eval/gecikme/yerel-2026-10-24.json`.*

**Model:** transaction süresi ≈ sorgu sayısı × gidiş-dönüş süresi. Sorgu sayısı sabittir (veriden bağımsız). Gecikmeyi belirleyen, API ile veritabanı arasındaki mesafedir. Hazırlanmış ifadelerden sonra yerel ölçüm bu modele oturuyor: 12 × 81 ms ≈ 972 ms, ölçülen 991 ms.

**Render (Frankfurt → İrlanda):** asıl kullanımda API Render'da çalışır. Ölçüm, hazırlanmış ifadelerin yayınlandığı sürümde yapıldı.

| Render, 20 tekrar | Sorgu | Transaction: medyan / p95 | Sorgu başına (medyan) | İstek, bu bilgisayardan: medyan |
| --- | --- | --- | --- | --- |
| 1 kalem giriş | 12 | 269 / 276 ms | 22 ms | 377 ms |
| 5 kalem giriş | 16 | 363 / 411 ms | 23 ms | 470 ms |
| 1 kalem transfer | 13 | 294 / 364 ms | 23 ms | 405 ms |

*24 Ekim 2026, `eval/gecikme/render-2026-10-24.json`. "Transaction" sunucudaki süredir (`Server-Timing`). "İstek", ölçümün yapıldığı bilgisayardan Render'a gidiş-dönüşü de içerir.*

Sorgu başına süre üç senaryoda da 22–23 ms; model burada da tutuyor: transaction süresi ≈ sorgu sayısı × Frankfurt–İrlanda gidiş-dönüşü. Render'da hazırlanmamış sorgulu eski sürüm ölçülmedi. Modele göre yaklaşık iki katı (~540 ms) sürerdi; bu bir tahmindir.

**Karar: proje İrlanda'da kalıyor.** Render'da 1 kalemli bir onay stok satırlarını ~270 ms, 5 kalemli bir onay ~360 ms kilitli tutuyor. Aynı ürüne aynı anda ikinci bir onay gelirse en fazla bu kadar bekler. Sahadaki kullanımda (bir depoda dakikada birkaç onay) bu bekleme fark edilmez; kullanıcının gördüğü süreyi asıl telefonla Frankfurt arasındaki ağ belirler.
- **Supabase projesini Frankfurt'ta yeniden kurmak:** API ile veritabanı aynı bölgede olur ve sorgu başına süre birkaç milisaniyeye iner. Ama Supabase'de projenin bölgesi sonradan değiştirilemez. Yeni proje, veri ve kullanıcıların taşınması, bütün anahtarların değişmesi gerekir. Bu ölçümle bu maliyet gerekmiyor.
- **Transaction'daki sorguları birleştirmek:** Ör. denetim ve outbox kaydını tek ifadede yazmak 1–2 sorgu kazandırır (~25–45 ms).
- Bu iki seçenek, pilot denemede (7. hafta) kilit beklemesi ya da onay süresi sorun olursa yeniden değerlendirilir.

**Kısıt:** Hazırlanmış ifadeler Supabase'in session pooler'ında (port 5432) çalışır, transaction pooler'da (6543) çalışmaz. `DATABASE_URL` her ortamda session pooler adresidir (`docs/yayin.md`).

## Savunmada sorulabilecek sorular

- **"Bir şirket başka şirketin verisini nasıl göremiyor?"** Dört katman var (yukarıdaki tablo). Data API yolunu RLS ve rol yetkileri kapatır; API yolunu her sorgudaki şirket filtresi; programlama hatalarına karşı da bileşik anahtarlar ve CHECK kısıtları devrededir. RLS katmanı 49 testle doğrulandı.
- **"RLS varken API'de neden ayrıca filtre var?"** API tablo sahibi kullanıcıyla bağlandığı için RLS'ye takılmaz. RLS, Data API'yi doğrudan kullanan istemciye karşı ikinci kilittir. Tek katmana güvenilmez.
- **"Stok neden eksiye düşemiyor?"** Uygulama kontrol eder; ayrıca veritabanında `CHECK (quantity >= 0)` var. İki eşzamanlı çıkış da olsa ikincisi veritabanında reddedilir.
- **"Miktarlar neden float değil?"** Kayan noktalı sayılar ondalık değerleri tam tutamaz ve hatalar birikir. `NUMERIC` tam ondalık tutar.
- **"Kullanıcı bilgileri nerede?"** Supabase Auth'ta. Bizim veritabanımız yalnızca üyelik ve rolü tutar; şifre bizde değildir.
- **"Neden silme yok?"** Hareket geçmişi ve denetim kaydı bozulmasın diye kayıtlar pasife alınır. Onaylanmış bir işlem de silinmez; ters kayıtla geri alınır (3.–5. hafta).
- **"Aynı işlem iki kez uygulanırsa ne olur?"** Hareket tablosunda (işlem, kalem, depo) benzersizdir; ikinci uygulamanın ilk hareketi veritabanında reddedilir ve bütün transaction geri alınır. API ayrıca işlemi `FOR UPDATE` ile kilitleyip durumunu kontrol eder ve `Idempotency-Key` ile tekrar gelen isteğe aynı cevabı döner (#33). Veritabanı burada da son savunma hattıdır.
- **"Stoğun doğru olduğunu nasıl bilirsiniz?"** Stok, hareketlerin toplamıdır. Hareket miktarı işaretli tutulduğu için bir depodaki ürünün hareketleri toplanınca `inventory.quantity` çıkmalıdır; her hareket ayrıca kendinden sonraki bakiyeyi saklar.
- **"Kalemleri neden JSON alanında tutmadınız?"** JSON'da veritabanı ürünün, deponun ve birimin aynı şirkete ait olduğunu denetleyemezdi. Ayrı tabloda bunu bileşik yabancı anahtarlar yapıyor.
- **"Veritabanı İrlanda'da, API Frankfurt'ta; bu bir sorun mu?"** Onay transaction'ı sabit sayıda sorgudan oluşur (1 kalemde 12) ve süresi yaklaşık sorgu sayısı × gidiş-dönüştür. Ölçümde her sorgunun iki gidiş-dönüş sürdüğü görüldü. Sorgular hazırlanmış ifade olarak gönderilince süre %45 kısaldı. Render'da 1 kalemli onay ~270 ms sürüyor (sorgu başına ~22 ms); saha kullanımında fark edilmeyecek bir süre olduğu için proje taşınmadı.
- **"Sayım farkı nasıl hesaplanıyor?"** Sistemdeki miktar onay anında kilitli stok satırından okunur, fark da veritabanında hesaplanan bir kolondur. Fark artıysa sayım fazlası, eksiyse sayım noksanı hareketi yazılır.
- **"Asistanın sohbet geçmişi neden düz metin değil de JSON blokları?"** Claude'un cevabı düşünme, metin ve araç çağrısı bloklarından oluşur. Bu bloklar modele bir sonraki istekte değiştirilmeden geri gönderilmek zorunda (ADR-001). Bloklar olduğu gibi saklandığı için geçmiş birebir yeniden kurulur.
- **"Aynı mesaj iki kez gönderilirse model iki kez mi çağrılır?"** Hayır. İstemci her mesaja bir kimlik verir ve tekrar denemede aynı kimliği gönderir. (sohbet, `client_message_id`) benzersizdir; ikinci istek kullanıcı mesajının durumuna bakar ve kayıtlı cevabı alır.
- **"Yönetici çalışanların sohbetlerini okuyabilir mi?"** Hayır. Sohbeti yalnızca sahibi okur. Yönetici maliyet ve kullanımı `ai_runs`'tan görür; orada mesaj içeriği yoktur. Asistanın hazırladığı her öneri zaten işlem ve denetim kaydı olarak yöneticiye görünür (5. hafta).
- **"Yazım hatalı ürün adı nasıl bulunuyor?"** pg_trgm iki metnin üçlü harf gruplarını karşılaştırıp benzerlik skoru verir. Kolon ve aranan metin önce aynı Türkçe dönüşümden geçer; şirket kimliği ve trigram aynı GIN indeksinde olduğu için arama hızlı ve tek şirketle sınırlıdır.
