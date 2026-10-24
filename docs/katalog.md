# Katalog ve depo yönetimi

Bu belge ürün (stok kartı), birim, alternatif ad, depo ve cari yönetiminin kurallarını anlatır. İlgili iş: #36 (API; web ekranları aynı işin ikinci adımında). Tablolar ve kısıtlar: [veritabani.md](veritabani.md).

## Uç noktalar

Okuma şirketin her aktif üyesine, ekleme ve değiştirme yalnızca yöneticiye (`ADMIN`) açık. Çalışanın değiştirme isteği `403 ROLE_FORBIDDEN` alır.

| Uç nokta | Ne yapar |
| --- | --- |
| `GET /v1/products?search=&status=&page=&pageSize=` | Ürünler; ad, SKU, barkod ya da alternatif adda arama. `status`: `active` (varsayılan), `inactive`, `all`. Sayfa en fazla 100 kayıt |
| `GET /v1/products/{id}` | Ürün, birimleri ve alternatif adları |
| `POST /v1/products`, `PUT /v1/products/{id}` | Ürünü birimleri ve adlarıyla ekler ya da günceller (tek transaction) |
| `GET /v1/parties?search=&type=&status=&page=&pageSize=`, `GET /v1/parties/{id}` | Cariler; ad içinde ya da vergi numarasının başında arama, türe göre süzme |
| `POST /v1/parties`, `PUT /v1/parties/{id}` | Cari ekler ya da günceller |
| `POST /v1/warehouses`, `PUT /v1/warehouses/{id}` | Depo, şube ya da araç deposu ekler ya da günceller (listeleme 2. haftadan beri var) |

Kodlar: `apps/api/src/modules/catalog/` (ürün ve cari), `apps/api/src/modules/inventory/warehouses.controller.ts` ve `inventory.service.ts` (depo). Şemalar: `packages/shared/src/catalog.ts`, `packages/shared/src/inventory.ts`.

## Kurallar

1. **Silme yok, pasife alma var.** Ürün, depo ve cari silinmez; `isActive: false` ile pasife alınır. Pasif kayıt varsayılan listede görünmez. Yeni işlemde kullanılamaz: işlem açılırken `422 PRODUCT_INACTIVE` ya da `WAREHOUSE_INACTIVE` döner. Geçmiş hareketler ve denetim kaydı bozulmaz.

2. **PUT, listenin tamamını yazar.** Ürün güncellenirken birim ve alternatif ad listeleri gönderilen listeyle aynı yapılır: yeni olan eklenir, olanın katsayısı ya da barkodu güncellenir, listede olmayan silinir. Hepsi ürünle aynı transaction'dadır; bir adım hata verirse hiçbiri yazılmaz.

3. **İşlemde kullanılmış birim silinemez.** İşlem kalemi girilen birime yabancı anahtarla bağlıdır (`operation_items_unit_fk`). Kullanılmış "koli" birimi silinmek ya da adı değiştirilmek istenirse veritabanı reddeder, API `409 UNIT_IN_USE` döner. Katsayı ise değişebilir: geçmiş hareket, onay anındaki katsayıyı kendisi saklar (`inventory_movements.unit_factor`).

4. **Hareketi olan ürünün ana birimi değişmez.** Stok ve hareketler ana birimde tutulur. "adet" olan ana birim "paket" yapılırsa geçmiş miktarlar anlamsızlaşır. Bu yüzden ürünün herhangi bir hareketi varsa `409 BASE_UNIT_LOCKED` döner. Ürünün hareketi olup olmadığını catalog modülü, inventory modülünün servisinden öğrenir; hareket tablosuna doğrudan bakmaz (modül sınırı).

5. **Benzersizlik veritabanında.** Aynı şirkette aynı SKU, ürün barkodu, birim barkodu, depo adı ya da VKN/TCKN ikinci kez kullanılamaz. API bunu önceden ayrıca sorgulamaz: veritabanının benzersizlik kısıtı ihlal edilince kısıtın adına bakıp anlamlı bir 409 döner (`PRODUCT_SKU_TAKEN`, `PRODUCT_BARCODE_TAKEN`, `UNIT_BARCODE_TAKEN`, `WAREHOUSE_NAME_TAKEN`, `PARTY_TAX_ID_TAKEN`). Önceden sorgulamak, iki eşzamanlı istekte ikisinin de "boş" görmesine açık kalırdı; kısıt bu yarışı kapatır. Başka şirkette aynı SKU ya da depo adı serbesttir.

6. **Başka şirketin kaydı yoktur.** Her sorgu şirket kimliğiyle sınırlanır; başka şirketin ürünü ya da carisi kimliği bilinse bile `404` alır, değiştirilemez.

7. **Türkçe arama.** PostgreSQL'in `ILIKE`'ı büyük "I"yı "i"ye çevirir, oysa Türkçede küçüğü "ı"dır: "YANGIN" araması "yangın"ı bulmazdı. Arama metni ve kolon aynı biçime getirilir: I, İ, ı ve i harflerinin hepsi "i" olur, sonra küçük harfe çevrilir (`apps/api/src/common/search.ts`). Böylece "YANGIN", "yangın" ve İngilizce klavyeyle yazılan "yangin" aynı ürünü bulur. `%` ve `_` gibi özel karakterler düz karakter olarak aranır. Benzerlik araması (yazım hatalarına dayanıklı, `pg_trgm`) 4. haftada asistanın ürün arama aracıyla gelir.

8. **Sayılar metin.** Katsayı (`"12"`), kritik stok (`"50"`) ve vergi numarası metin olarak taşınır ve sayıya çevrilmez (ADR-003). Katsayı en fazla 6 ondalık hanelidir ve sıfırdan büyük olmalıdır; ana birim ek birim olarak yazılamaz; aynı birim ya da ad iki kez yazılamaz. Bu son iki kontrolde büyük/küçük harf ve Türkçe I/İ farkı gözetilmez.

## Testler

| Test | Ortam | Ne doğrular |
| --- | --- | --- |
| `apps/api/test/catalog-rules.spec.ts` | CI | Ürün ve cari şeması, sorgu parametreleri, Türkçe arama biçimi |
| `apps/api/test/catalog.e2e.spec.ts` | CI | Depo ekleme, güncelleme, aynı ad (409), başka şirketin deposu (404); çalışanın ürün, cari ve depo değiştiremediği (403); şema hataları |
| `apps/api/test-db/catalog.db.spec.ts` | Gerçek veritabanı (`pnpm db:test`) | Ürün birimleri ve adlarıyla; arama (Türkçe dahil) ve sayfalama; aynı SKU/barkod/VKN; başka şirketin kaydı; pasife alma; kullanılmış birim, ana birim kilidi ve katsayı değişikliği |

## Savunmada sorulabilecek sorular

- **"Ürünü neden silmiyorsunuz?"** Hareketi olan ürün silinirse stok kartı ve denetim kaydı anlamsızlaşır. Pasife alınan ürün listelerde ve yeni işlemlerde görünmez, geçmişi kalır.
- **"Aynı SKU'yu iki kişi aynı anda eklerse?"** Benzersizlik veritabanında. İkinci ekleme kısıt ihlaliyle reddedilir ve API `409 PRODUCT_SKU_TAKEN` döner. Uygulamada önceden "var mı" diye sormak bu yarışı kapatmazdı.
- **"Koli 12 adetken 10 adete düşürülürse geçmiş stok bozulur mu?"** Hayır. Stok ana birimde tutulur ve her hareket onay anındaki katsayıyı saklar. Yeni katsayı yalnızca yeni işlemlerde kullanılır. Ama işlemde kullanılmış bir birim silinemez, ana birim de hareket varsa değişmez.
- **"Türkçe karakterli arama nasıl çalışıyor?"** I/İ/ı/i farkı ve büyük/küçük harf, hem aranan metinde hem kolonda aynı biçime getirilerek giderilir.
