# ADR-004: Excel/CSV içe aktarma: dosya tarayıcıda okunur (`read-excel-file`, `papaparse`)

- **Durum:** Kabul edildi (21 Ekim 2026 onaylandı; 25 Ekim 2026'da uygulandı)
- **İlgili iş:** #39

## Bağlam

Kurulumda yönetici ürün listesini dosyadan aktarır. Sütunlar: SKU, ad, ana birim, barkod, kritik stok, ek birim ve katsayısı, alternatif adlar, isteğe bağlı başlangıç stoku ve birim maliyet.

- Kullanıcıların elindeki dosya çoğunlukla `.xlsx`.
- Türkçe Excel'de "CSV olarak kaydet" `;` ayraçlı ve Windows-1254 kodlu dosya üretir. UTF-8 sanılarak okunursa ç, ğ, ı, İ, ş bozulur.
- API, Render'ın ücretsiz planında (512 MB bellek, paylaşımlı CPU). Mimari kural: sunucuda CPU yoğun iş yapılmaz.

## Seçenekler

**Dosya nerede okunur?**

- **A. Sunucuda:** dosya API'ye yüklenir. Dosya yükleme altyapısı ve boyut sınırı gerekir. `.xlsx` bir zip arşividir; kötü niyetli ya da çok büyük bir dosya (zip bombası) Render'ın belleğini doldurup API'yi düşürebilir.
- **B. Tarayıcıda:** dosya web panelinde okunur, API'ye satırlar JSON olarak gider. API dosya biçimi bilmez; yalnızca satırları Zod şemasıyla doğrular. Önizleme anında gösterilir. Bozuk bir dosya yalnızca kullanıcının kendi sekmesini etkiler. İstemciden gelen veriye güvenilmez; API her satırı yeniden doğrular.

**Hangi kütüphane?**

1. **SheetJS (`xlsx`):** En yaygını. npm'deki son sürümü 0.18.5 (Mart 2022) ve bilinen güvenlik açıkları var (CVE-2023-30533, CVE-2024-22363). Güncel sürümler yalnızca SheetJS'in kendi sunucusundan dağıtılıyor; npm denetiminin dışında kalıyor.
2. **`exceljs`:** Okuma ve yazma. Son kararlı sürüm 4.4.0 (Ekim 2023), paket 21 MB.
3. **`read-excel-file` 9.3** (MIT): Yalnızca okuma; tarayıcı ve web worker girişi var; düzenli güncelleniyor (son sürüm Ekim 2026). Bağımlılıkları küçük (`fflate`, `saxen`, `unzipper-esm`, `worker-f`). Eksi: tek geliştiricinin projesi.
4. **Yalnızca CSV:** Kullanıcı dosyayı kendisi CSV'ye çevirmek zorunda kalır; kodlama sorunu yine çözülmelidir.

**CSV ayrıştırma:** `papaparse` 5.7 (MIT, bağımlılığı yok). Ayracı (`,` / `;`) kendisi bulur; tırnak içindeki ayraç ve satır sonlarını doğru işler. Elle yazılmış bir ayrıştırıcı bu durumlarda hataya açıktır.

## Karar

B yöntemi, `.xlsx` için `read-excel-file`, `.csv` için `papaparse`. İkisi yalnızca `apps/web`'e eklenir; API'ye dosya kütüphanesi girmez.

- **CSV kodlaması:** dosya önce katı modda UTF-8 olarak çözülür (`new TextDecoder('utf-8', { fatal: true })`); hata verirse `windows-1254` ile çözülür. İki çözücü de tarayıcıda yerleşik.
- **CSV ayracı başlık satırından bulunur** (`;`, `,` ya da sekme; başlıklarda bunlar geçmez). papaparse'ın kendi tahminine bırakılmadı: deneme dosyasında ürün adlarındaki ve ondalıklardaki virgüller ("3x2,5", "45,9"), Türkçe Excel'in `;` ayraçlı dosyasında virgülü seçtirdi ve bütün satırlar boş okundu.
- **Sayılar metin kalır:** `.xlsx`'teki sayılar `parseNumber: (s) => s` ile hücredeki metin olarak okunur; tarayıcıda da JS sayısına çevrilmez (ADR-003). Virgüllü ondalık ("12,5") gönderilmeden önce noktaya çevrilir.
- **API:** `POST /v1/products/import`; en fazla 1.000 satır; tek tek eklemedeki ürün şeması; tek transaction (ya hepsi ya hiçbiri); hatalar satır numarasıyla döner. Ürünler, birimler ve alternatif adlar satır satır değil, toplu `INSERT` ile yazılır: Render'dan veritabanına her sorgu ~22 ms sürdüğü için 1.000 ürünü tek tek eklemek ~3.000 sorgu ve bir dakikadan uzun bir transaction olurdu.
- **Başlangıç stoku:** varsa seçilen depo için onay bekleyen açılış işlemleri açılır; stok yalnızca onayla değişir (mimari değişmez 2). Bir işlem en fazla 100 kalem alır; daha çok satır birden fazla işleme bölünür. Böylece her onay transaction'ı kısa kalır.
- **Şablon:** `;` ayraçlı, UTF-8 BOM'lu bir CSV şablonu sunulur; Türkçe Excel bu dosyayı doğru açar. Böylece `.xlsx` yazan bir kütüphane gerekmez.
- **Alternatif adlar** bir hücrede `|` ile ayrılır; ürün adlarında virgül geçtiği için ("NYM kablo 3x2,5") virgül ayraç olamaz.
- **Eski `.xls` biçimi** desteklenmez; kullanıcıya dosyayı `.xlsx` olarak kaydetmesi söylenir.

## Sonuçlar

- Web paketine iki bağımlılık eklenir (ve `papaparse`'ın tip tanımları), API'ye hiç eklenmez.
- Tarayıcıdaki dosya boyutu sınırı (5 MB) yalnızca kullanıcı deneyimi içindir; güvenlik sınırı API'deki satır sınırı ve şema doğrulamasıdır.
- API'nin JSON gövde sınırı 100 KB'tan 2 MB'a çıkarıldı: 1.000 satır 100 KB'ı aşabiliyor. Satır sınırı ve şema sınırları (ad 200, en fazla 30 alternatif ad) gövdenin üst sınırını belirler.
- `read-excel-file` bırakılırsa yerine yalnızca okuma kodu (`apps/web/lib/product-import-file.ts`) değişir; API sözleşmesi aynı kalır.
