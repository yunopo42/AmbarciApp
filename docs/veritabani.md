# Veritabanı şeması ve şirketler arası izolasyon

Bu belge `packages/db` altındaki şemanın ve RLS politikalarının neden böyle kurulduğunu anlatır. İlgili işler: #15 (şema ve ilk migration), #19 (RLS ve iki şirketli izolasyon testi).

## Kapsam

İlk sürüm yalnızca 2. ve 3. haftada gereken 10 tabloyu içerir:

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

`inventory_movements`, `operations`, `stock_counts`, `audit_logs` ve `outbox_events` 3. haftada stok transaction'ıyla gelir. `inventory_movements.operation_id` alanı `operations` tablosuna bağlı olduğu için ikisi birlikte eklenir. Sohbet, `ai_runs`, belge ve `push_tokens` tabloları da ilgili haftalarda yeni migration'larla eklenir.

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

## Şirketler arası izolasyon: dört katman

| Katman | Kimi durdurur | Nerede |
| --- | --- | --- |
| 1. API filtresi | API'yi kullanan istemci | Her sorgu `organization_id` ile süzülür; şirket kimliği oturumdan gelir, istemciden alınmaz (#17, #18) |
| 2. RLS politikaları | Supabase Data API'yi doğrudan kullanan istemci | `schema/rls.ts`, `0002_read_policies.sql` |
| 3. Rol yetkileri | Aynı istemci, politika yanlış yazılsa bile | `0001_rls_helpers.sql` |
| 4. Bileşik anahtarlar ve CHECK | API'deki bir programlama hatası | `0000_initial_schema.sql` |

**Neden RLS gerekiyor?** Supabase her projede tablolar için otomatik bir REST arayüzü (Data API) yayınlar. Anon anahtarı web ve mobil paketinin içinde herkese açık durur. RLS olmasaydı bu anahtarı bulan biri tablolara doğrudan erişebilirdi.

**API neden RLS'den etkilenmiyor?** API veritabanına tabloların sahibi olan `postgres` kullanıcısıyla bağlanır. Tablo sahibi RLS'ye takılmaz. Bu yüzden API'deki izolasyon her sorgudaki `organization_id` filtresinden gelir (1. katman). RLS ikinci savunma hattıdır.

**Politikalar:**

- Oturum açmış kullanıcı (`authenticated`) bir satırı ancak o satırın şirketinin **aktif** üyesiyse okuyabilir.
- Davet kodlarını yalnızca o şirketin yöneticisi okuyabilir; kod bir sırdır.
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

Sıra önemlidir: politikalar fonksiyonları, fonksiyonlar da tabloları kullanır. RLS ilk migration'da açılır; politikalar gelene kadar tablolar herkese kapalıdır, açık kalmaz.

Uygulanmış bir migration düzenlenmez; değişiklik yeni bir migration'la yapılır. Supabase'in güvenlik denetimi (Security Advisor) bu şemada uyarı vermiyor.

## Demo verisi

`pnpm db:seed` iki kurgusal şirket yükler (veri: `packages/db/seed/demo-data.ts`):

- **ABC Elektrik:** 18 ürün (kablo, priz, anahtar, sigorta, aydınlatma, tesisat malzemesi), her biri için bir ek birim (makara, koli, kutu…) ve sahada kullanılan adlar ("üçlü priz", "otomat"). Ayrıca 2 depo, 1 araç deposu ve 3 cari.
- **Kuzey Tesisat:** 1 depo, 3 ürün. İzolasyonu elle göstermek için ABC Elektrik ile aynı depo adını kullanır.

Kararlar:

- **Tekrar çalıştırılabilir.** Her kayıt doğal anahtarıyla eklenir ya da güncellenir (şirket: sabit kimlik, depo: ad, ürün: SKU, birim: ürün + birim, cari: VKN). İkinci çalıştırma kayıt çoğaltmaz; bunu `test/seed.spec.ts` doğrular.
- **Başlangıç stoğu yok.** Stok yalnızca hareket kaydıyla değişmeli; hareket ve işlem tabloları 3. haftada gelince açılış stokları açılış işlemiyle girilecek.
- **Kullanıcı hesabı açılmaz.** `SEED_ADMIN_EMAIL` verilirse o e-postayla Supabase Auth'ta zaten kayıtlı kullanıcı ABC Elektrik'e yönetici olarak bağlanır.
- **Barkodlar gerçek bir ürüne ait değil.** Mağaza içi kullanıma ayrılmış `200` önekli, geçerli kontrol haneli EAN-13 kodlarıdır; 7. haftada etiket basıp okutulabilir.
- **Cari VKN'leri kurgusal** (`999` önekli). TCKN kullanılmaz.

## İki şirketli izolasyon testi

`pnpm db:test` (dosya: `packages/db/test/rls.spec.ts`). Gerçek Supabase veritabanında çalışır; CI'daki `pnpm test` bunu çalıştırmaz, çünkü CI'da veritabanı bilgisi yok.

**Nasıl çalışır?**

1. Data API her isteği `authenticated` ya da `anon` rolüne geçerek çalıştırır ve kullanıcının JWT içeriğini `request.jwt.claims` ayarına yazar. Politikalardaki `auth.uid()` kullanıcı kimliğini buradan okur. Test aynı şeyi doğrudan SQL ile yapar.
2. Her test bir transaction açar. İçinde iki şirket (A, B), beş kullanıcı ve her tabloda örnek veri oluşturur. Kullanıcılar: A yöneticisi, A çalışanı, A'nın pasif üyesi, B yöneticisi ve hiçbir şirkete üye olmayan biri.
3. Test bitince transaction geri alınır. Veritabanında iz kalmaz; gerçek kullanıcı hesabı açılmaz.

**Neyi kanıtlar (22 test)?**

- Dokuz tablonun her birinde A kullanıcısı yalnızca A'nın, B kullanıcısı yalnızca B'nin satırlarını görür.
- B'nin ürünü kimliği bilinse bile okunamaz.
- Davet kodlarını yalnızca kendi şirketinin yöneticisi görür; çalışan göremez.
- Pasif üye ve hiçbir şirkete üye olmayan kullanıcı hiçbir satır görmez.
- Oturum açmamış istemci (`anon`) hiçbir tabloyu ve yardımcı fonksiyonları kullanamaz.
- Oturum açmış kullanıcı hiçbir şey yazamaz: ürün ekleme ya da güncelleme, stok değiştirme ya da silme, kendini başka şirkete üye yapma, rolünü yükseltme.
- Veritabanı, şirketler arası bağlantıyı (A'nın stoğu → B'nin ürünü) ve eksi stoğu reddeder.

**Testin gerçekten sızıntı yakaladığı nasıl bilinir?** Geliştirme sırasında bir transaction içinde `products` tablosuna herkese açık bir politika (`using (true)`) eklendi. Aynı yöntemle bakıldığında A kullanıcısının gördüğü şirket sayısı 1'den 2'ye çıktı, yani test başarısız olurdu. Deneme geri alındı.

**Henüz kapsamadığı:** API üzerinden izolasyon. Şirket verisi döndüren uç noktalar #18 ile gelecek; o testler API'nin Vitest/Supertest testlerine eklenecek.

## Savunmada sorulabilecek sorular

- **"Bir şirket başka şirketin verisini nasıl göremiyor?"** Dört katman var (yukarıdaki tablo). Data API yolunu RLS ve rol yetkileri kapatır; API yolunu her sorgudaki şirket filtresi; programlama hatalarına karşı da bileşik anahtarlar ve CHECK kısıtları devrededir. RLS katmanı 22 testle doğrulandı.
- **"RLS varken API'de neden ayrıca filtre var?"** API tablo sahibi kullanıcıyla bağlandığı için RLS'ye takılmaz. RLS, Data API'yi doğrudan kullanan istemciye karşı ikinci kilittir. Tek katmana güvenilmez.
- **"Stok neden eksiye düşemiyor?"** Uygulama kontrol eder; ayrıca veritabanında `CHECK (quantity >= 0)` var. İki eşzamanlı çıkış da olsa ikincisi veritabanında reddedilir.
- **"Miktarlar neden float değil?"** Kayan noktalı sayılar ondalık değerleri tam tutamaz ve hatalar birikir. `NUMERIC` tam ondalık tutar.
- **"Kullanıcı bilgileri nerede?"** Supabase Auth'ta. Bizim veritabanımız yalnızca üyelik ve rolü tutar; şifre bizde değildir.
- **"Neden silme yok?"** Hareket geçmişi ve denetim kaydı bozulmasın diye kayıtlar pasife alınır. Onaylanmış bir işlem de silinmez; ters kayıtla geri alınır (3.–5. hafta).
- **"Hareket tabloları nerede?"** İşlem (`operations`) tablosuyla birlikte 3. haftada geliyor. Hareket satırı işlem kaydına bağlı olduğu için ayrı eklenemez.
