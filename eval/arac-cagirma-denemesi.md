# Claude araç çağırma denemesi (Haiku 4.5 – Haiku 5.5)

Amaç: 4. haftadaki asistan altyapısından önce, Türkçe saha mesajlarında Claude'un doğru aracı doğru
parametrelerle çağırıp çağırmadığını, belirsiz mesajda öneri yerine soru sorup sormadığını ve sohbet için
hangi modelin uygun olduğunu görmek. Bu bir ön denemedir; asıl ölçüm 6. haftadaki 100 etiketli mesajla
(`pnpm eval`) yapılacak.

## Deneme düzeni

- Betik: `eval/tool-calling/` (uygulama kodundan ayrı, bağımlılıksız; Node 24'ün yerleşik `fetch`'i ile
  doğrudan `POST /v1/messages` çağrılır, SDK kullanılmaz).
  - `messages.mts`: beklenen davranışı etiketlenmiş 20 mesaj.
  - `tools.mts`: sistem promptu (`arac-denemesi-v1`) ve strict JSON şemalı araç tanımları.
  - `catalog.mts`: kurgusal ABC Elektrik kataloğu (18 ürün, 3 depo) ve sahte araç sonuçları.
  - `grade.mts`: puanlama; `run.mts`: çalıştırıcı; `report.mts`: bu belgedeki tabloları üretir.
  - `results/*.json`: her yapılandırmanın ham sonuçları (araç çağrıları, son cevaplar, token, süre).
- Araçlar: okuma için `search_products(query)`, `get_stock(product_id, warehouse_id?)`, `list_warehouses`;
  öneri için `propose_stock_in`, `propose_stock_out`, `propose_transfer`. Hepsi `strict: true`.
  Stok yazan veya onaylayan araç (`confirm_*`, `apply_*`) tanımlanmadı.
- Sahte sonuçlar bellekteki katalogdan döner. `search_products`, `pg_trgm` benzeri üçlü (trigram)
  benzerlikle en iyi 5 adayı skoruyla verir. Öneri araçları hiçbir şey yazmaz; yalnızca
  `PENDING_CONFIRMATION` durumunda bir öneri numarası döner.
- Mesaj başına en fazla 5 araç turu. Altıncı cevap hâlâ araç isterse konuşma kesilir ve "tur sınırı" sayılır.

Yeniden çalıştırmak için (depo kökünden; anahtar `.env` dosyasından okunur, ekrana yazılmaz):

```bash
node --env-file=.env eval/tool-calling/run.mts
```

```bash
node eval/tool-calling/report.mts
```

## Değerlendirme ölçütü

Her mesaj için üç ayrı sonuç tutulur:

- **İlk araç:** `list_warehouses` dışındaki ilk çağrı `search_products` olmalı ve sorgu ürünün temel
  adını içermeli (ör. "nym", "priz"). Ürün kimliği aramadan tahmin edilmemeli. `list_warehouses`
  önce ya da aynı turda çağrılabilir.
- **Doğru araç:** giriş, çıkış ve transferde beklenen `propose_*` aracı çağrılmış ve başka öneri aracı
  çağrılmamış olmalı. Stok sorgusunda `get_stock` çağrılmış, öneri aracı çağrılmamış olmalı.
  Belirsiz mesajda hiçbir öneri aracı çağrılmamalı.
- **Doğru parametre / doğru soru:** öneride depo kimlikleri, kalemler (ürün kimliği ve miktar, sıra
  önemsiz) ve 6. mesajda cari adı birebir tutmalı; tek bir öneri çağrısı beklenir (iki kalemli mesajı iki
  öneriye bölmek yanlış sayılır). Stok sorgusunda ürün ve (söylendiyse) depo tutmalı. Belirsiz mesajda son
  cevap soru içermeli ve adayları ayırt eden ölçüleri (ör. "3x2,5" ve "3x1,5") ya da eksik alanı
  (depo, miktar) anmalı. Bu son kontrol metin eşleştirmesiyle yapılır; belirsiz mesajların cevapları ayrıca
  elle okundu.

"Tam doğru" = doğru araç ve doğru parametre birlikte.

## Koşullar

| Alan | Değer |
| --- | --- |
| Tarih | 2026-10-20, 21:24–21:30 (TSİ) |
| Modeller | `claude-haiku-4-5` (API'nin döndürdüğü sürüm: `claude-haiku-4-5-20251001`) ve `claude-haiku-5-5` |
| Haiku 4.5 | Düşünme kapalı (varsayılan); `effort` bu modelde desteklenmiyor |
| Haiku 5.5 (medium) | Adaptive thinking (varsayılan, düşünme metni gizli); `effort: medium` (varsayılan değer, açıkça gönderildi) |
| Haiku 5.5 (low) | Adaptive thinking; `effort: low` |
| Ortak ayarlar | `max_tokens` 4096; `tool_choice` auto; sıcaklık varsayılan; önbellek (prompt caching) kapalı; akışsız (non-streaming) istek; sistem promptu `arac-denemesi-v1` |
| Tekrar ve sıra | Her mesaj her yapılandırmada bir kez çalıştırıldı. Mesajlar yapılandırmalar arasında dönüşümlü gönderildi (1. mesaj üç yapılandırmada, sonra 2. mesaj…); API yükündeki dalgalanma tek modelin aleyhine çalışmasın diye |
| Isınma | Her yapılandırma önce ölçüm dışı bir istek ("Hangi depolar var?") attı; strict şemaların ilk derlenmesi ölçüme girmesin diye |
| Süre ölçümü | İstemci tarafında, isteğin gönderilmesinden cevap gövdesinin okunmasına kadar; ağ gecikmesi dahil, geliştirici bilgisayarından (Windows 11). Mesaj süresi, o mesajdaki tüm model çağrılarının toplamıdır; sahte araçların süresi ihmal edilebilir |
| Fiyat | `claude-api` skill'indeki model tablosu (tablo tarihi 2026-10-06), milyon token başına: Haiku 4.5 girdi 1 $ / çıktı 5 $; Haiku 5.5 (istem 100K tokenın altındayken) 0,10 $ / 0,50 $. Maliyet, cevaplardaki `usage` token sayılarından hesaplandı. Haiku 5.5'in çıktı tokenları gizli düşünme tokenlarını da içerir |
| Toplam harcama | Tam koşu ve ısınmalar yaklaşık 0,27 $. Ayrıca sonuç dosyasına yazılmayan bir deneme isteği atıldı (1. mesaj, Haiku 4.5 ve Haiku 5.5 low) |

## Sonuçlar

Aşağıdaki tablolar `node eval/tool-calling/report.mts` çıktısıdır; ham veri `eval/tool-calling/results/` altındadır.

### Etiketler

| # | Kategori | Mesaj | Beklenen ilk araç | Beklenen karar ve parametreler |
| --- | --- | --- | --- | --- |
| 1 | Stok sorgusu | Merkez depoda NYM 3x2,5 kablodan kaç metre kaldı? | `search_products` (sorguda: nym) | `get_stock`: NYM Kablo 3x2,5 mm², Merkez Depo; öneri yok |
| 2 | Stok sorgusu | 16 amperlik otomatik sigortadan elimizde ne kadar var? | `search_products` (sorguda: sigorta) | `get_stock`: Otomatik Sigorta C16 16A, depo belirtilmedi; öneri yok |
| 3 | Stok sorgusu | Araçta 9 watt LED ampul kaç tane var? | `search_products` (sorguda: ampul / led) | `get_stock`: LED Ampul 9W E27, Araç 1 (34 ABC 101); öneri yok |
| 4 | Stok sorgusu | Şube depoda beyaz topraklı prizden kaç adet var? | `search_products` (sorguda: priz) | `get_stock`: Topraklı Priz Beyaz, Şube Depo (Kadıköy); öneri yok |
| 5 | Giriş | Merkez depoya 100 metre NYM 3x2,5 kablo girişi yap. | `search_products` (sorguda: nym) | `propose_stock_in`: Merkez Depo; NYM Kablo 3x2,5 mm² × 100 metre |
| 6 | Giriş | Yılmaz Elektrik'ten 250 metre 2x1,5 TTR kablo geldi, merkez depoya al. | `search_products` (sorguda: ttr) | `propose_stock_in`: Merkez Depo; TTR Kablo 2x1,5 mm² × 250 metre; cari: Yılmaz Elektrik |
| 7 | Giriş | Şube depoya 40 adet 12 watt LED ampul girişi yap. | `search_products` (sorguda: ampul / led) | `propose_stock_in`: Şube Depo (Kadıköy); LED Ampul 12W E27 × 40 adet |
| 8 | Giriş | Merkez depoya 30 tane 100'lük buat ve 50 metre 16'lık spiral boru girdi. | `search_products` (sorguda: buat / spiral) | `propose_stock_in`: Merkez Depo; Buat 100x100 × 30 adet, Spiral Boru 16 mm × 50 metre |
| 9 | Çıkış | Araç deposundan 20 adet 16 amper otomatik sigorta çıkışı yap. | `search_products` (sorguda: sigorta) | `propose_stock_out`: Araç 1 (34 ABC 101); Otomatik Sigorta C16 16A × 20 adet |
| 10 | Çıkış | Merkez depodan 2 tane kaçak akım rölesi çıkışı yap, Ataşehir şantiyesine gitti. | `search_products` (sorguda: kacak / role) | `propose_stock_out`: Merkez Depo; Kaçak Akım Rölesi 40A 30mA × 2 adet |
| 11 | Çıkış | Şube depodan 15 adet krem topraklı priz düş. | `search_products` (sorguda: priz) | `propose_stock_out`: Şube Depo (Kadıköy); Topraklı Priz Krem × 15 adet |
| 12 | Çıkış | Araçtan 3 elektrik bandı ve 10 metre 3x2,5 TTR kablo kullandım. | `search_products` (sorguda: bant / band / ttr) | `propose_stock_out`: Araç 1 (34 ABC 101); Elektrik Bandı 19 mm × 3 adet, TTR Kablo 3x2,5 mm² × 10 metre |
| 13 | Transfer | Merkez depodan şube deposuna 50 adet beyaz topraklı priz transfer et. | `search_products` (sorguda: priz) | `propose_transfer`: Merkez Depo → Şube Depo (Kadıköy); Topraklı Priz Beyaz × 50 adet |
| 14 | Transfer | Şubeden araca 10 tane 25 amper sigorta aktar. | `search_products` (sorguda: sigorta) | `propose_transfer`: Şube Depo (Kadıköy) → Araç 1 (34 ABC 101); Otomatik Sigorta C25 25A × 10 adet |
| 15 | Transfer | Araçtaki 5 kablo kanalını merkez depoya geri bıraktım. | `search_products` (sorguda: kanal) | `propose_transfer`: Araç 1 (34 ABC 101) → Merkez Depo; Kablo Kanalı 40x16 (2 m) × 5 adet |
| 16 | Belirsiz | Merkez depoya 100 metre NYM kablo girişi yap. | `search_products` (sorguda: nym) | Öneri yok; adaylarla soru: NYM Kablo 3x2,5 mm² / NYM Kablo 3x1,5 mm² |
| 17 | Belirsiz | Araçtan 10 adet LED ampul çıkışı yap. | `search_products` (sorguda: ampul / led) | Öneri yok; adaylarla soru: LED Ampul 9W E27 / LED Ampul 12W E27 |
| 18 | Belirsiz | Merkez depodan araca 30 metre TTR kablo aktar. | `search_products` (sorguda: ttr) | Öneri yok; adaylarla soru: TTR Kablo 2x1,5 mm² / TTR Kablo 3x2,5 mm² |
| 19 | Belirsiz | 25 adet 16 amper otomatik sigorta çıkışı yap. | `search_products` (sorguda: sigorta) | Öneri yok; hangi depo diye soru |
| 20 | Belirsiz | Şube depoya beyaz topraklı priz girişi yap. | `search_products` (sorguda: priz) | Öneri yok; kaç adet diye soru |

### Özet oranlar

| Ölçüm | Haiku 4.5 | Haiku 5.5 (medium) | Haiku 5.5 (low) |
| --- | --- | --- | --- |
| İlk araç doğru | 20 / 20 | 20 / 20 | 20 / 20 |
| Doğru araç | 20 / 20 | 20 / 20 | 20 / 20 |
| Doğru parametre / doğru soru | 20 / 20 | 20 / 20 | 20 / 20 |
| Stok sorgusu: araç ve parametre doğru | 4 / 4 | 4 / 4 | 4 / 4 |
| Giriş: araç ve parametre doğru | 4 / 4 | 4 / 4 | 4 / 4 |
| Çıkış: araç ve parametre doğru | 4 / 4 | 4 / 4 | 4 / 4 |
| Transfer: araç ve parametre doğru | 3 / 3 | 3 / 3 | 3 / 3 |
| Belirsiz: araç ve parametre doğru | 5 / 5 | 5 / 5 | 5 / 5 |
| Belirsiz mesajda öneri aracı çağrısı | 0 | 0 | 0 |
| `note` alanı doldurulan öneri | 7 / 11 (#8, #9, #10, #11, #12, #14, #15) | 1 / 11 (#10) | 1 / 11 (#10) |
| Tur sınırına (5) takılan | 0 | 0 | 0 |
| Hatalı araç sonucu dönen çağrı | 0 | 0 | 0 |
| Ortalama araç turu / mesaj | 1,80 | 1,75 | 1,75 |
| İstek hatası | 0 | 0 | 0 |
| Yeniden denenen istek | 0 | 0 | 0 |

### Token, süre ve maliyet

| Ölçüm (20 mesaj) | Haiku 4.5 | Haiku 5.5 (medium) | Haiku 5.5 (low) |
| --- | --- | --- | --- |
| Model çağrısı | 56 | 55 | 55 |
| Giriş token (toplam) | 195051 | 167153 | 166679 |
| Çıkış token (toplam) | 5645 | 7396 | 6827 |
| Giriş token / mesaj (ort.) | 9753 | 8358 | 8334 |
| Çıkış token / mesaj (ort.) | 282 | 370 | 341 |
| En büyük tek istem (giriş token) | 4139 | 3930 | 3868 |
| Süre / mesaj, medyan (sn) | 6,70 | 5,04 | 4,13 |
| Süre / mesaj, ortalama (sn) | 7,12 | 5,13 | 4,77 |
| Süre / mesaj, p90 (sn) | 9,56 | 6,62 | 6,91 |
| Süre / model çağrısı, medyan (sn) | 2,64 | 1,86 | 1,63 |
| Maliyet (toplam) | 0,2233 $ | 0,0204 $ | 0,0201 $ |
| Maliyet / mesaj (ort.) | 0,01116 $ | 0,00102 $ | 0,00100 $ |
| 1000 mesaj için hesaplanan maliyet | 11,16 $ | 1,02 $ | 1,00 $ |
| Isınma isteği maliyeti (ölçüme dahil değil) | 0,0070 $ | 0,0006 $ | 0,0006 $ |

### Mesaj bazında doğruluk

Her hücre sırasıyla ilk araç, doğru araç ve doğru parametre / soru sonucudur.

| # | Kategori | Haiku 4.5 | Haiku 5.5 (medium) | Haiku 5.5 (low) |
| --- | --- | --- | --- | --- |
| 1 | Stok sorgusu | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 2 | Stok sorgusu | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 3 | Stok sorgusu | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 4 | Stok sorgusu | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 5 | Giriş | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 6 | Giriş | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 7 | Giriş | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 8 | Giriş | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 9 | Çıkış | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 10 | Çıkış | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 11 | Çıkış | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 12 | Çıkış | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 13 | Transfer | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 14 | Transfer | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 15 | Transfer | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 16 | Belirsiz | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 17 | Belirsiz | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 18 | Belirsiz | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 19 | Belirsiz | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |
| 20 | Belirsiz | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ ✓ ✓ |

### Haiku 4.5: mesaj bazında ayrıntı

| # | Çağrılan araçlar (turlar →) | İlk | Araç | Param. | Giriş tok. | Çıkış tok. | Süre (sn) | Maliyet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | search_products + list_warehouses → get_stock | ✓ | ✓ | ✓ | 10535 | 248 | 5,71 | 0,01178 $ |
| 2 | search_products → get_stock | ✓ | ✓ | ✓ | 10156 | 248 | 7,02 | 0,01140 $ |
| 3 | search_products + list_warehouses → get_stock | ✓ | ✓ | ✓ | 10397 | 237 | 10,23 | 0,01158 $ |
| 4 | search_products + list_warehouses → get_stock | ✓ | ✓ | ✓ | 10300 | 238 | 7,93 | 0,01149 $ |
| 5 | search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 10604 | 329 | 6,70 | 0,01225 $ |
| 6 | search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 10666 | 347 | 11,93 | 0,01240 $ |
| 7 | search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 10446 | 284 | 5,66 | 0,01187 $ |
| 8 | search_products + search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 11113 | 379 | 8,98 | 0,01301 $ |
| 9 | list_warehouses + search_products → propose_stock_out | ✓ | ✓ | ✓ | 10610 | 317 | 5,04 | 0,01219 $ |
| 10 | search_products + list_warehouses → propose_stock_out | ✓ | ✓ | ✓ | 10350 | 366 | 9,02 | 0,01218 $ |
| 11 | search_products + list_warehouses → propose_stock_out | ✓ | ✓ | ✓ | 10419 | 338 | 5,40 | 0,01211 $ |
| 12 | list_warehouses + search_products + search_products → propose_stock_out | ✓ | ✓ | ✓ | 10935 | 411 | 5,71 | 0,01299 $ |
| 13 | search_products + list_warehouses → propose_transfer | ✓ | ✓ | ✓ | 10408 | 315 | 8,68 | 0,01198 $ |
| 14 | list_warehouses + search_products → propose_transfer | ✓ | ✓ | ✓ | 10572 | 319 | 7,08 | 0,01217 $ |
| 15 | search_products + list_warehouses → propose_transfer | ✓ | ✓ | ✓ | 10696 | 388 | 9,56 | 0,01264 $ |
| 16 | search_products + list_warehouses | ✓ | ✓ | ✓ | 6694 | 155 | 3,96 | 0,00747 $ |
| 17 | search_products + list_warehouses | ✓ | ✓ | ✓ | 6648 | 164 | 5,47 | 0,00747 $ |
| 18 | search_products + list_warehouses | ✓ | ✓ | ✓ | 6695 | 165 | 5,22 | 0,00752 $ |
| 19 | search_products → list_warehouses | ✓ | ✓ | ✓ | 10196 | 260 | 8,06 | 0,01150 $ |
| 20 | search_products + list_warehouses | ✓ | ✓ | ✓ | 6611 | 137 | 5,11 | 0,00730 $ |

### Haiku 5.5 (medium): mesaj bazında ayrıntı

| # | Çağrılan araçlar (turlar →) | İlk | Araç | Param. | Giriş tok. | Çıkış tok. | Süre (sn) | Maliyet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | search_products + list_warehouses → get_stock | ✓ | ✓ | ✓ | 9166 | 245 | 4,28 | 0,00104 $ |
| 2 | search_products → get_stock | ✓ | ✓ | ✓ | 8727 | 271 | 5,54 | 0,00101 $ |
| 3 | search_products + list_warehouses → get_stock | ✓ | ✓ | ✓ | 8974 | 247 | 5,31 | 0,00102 $ |
| 4 | search_products + list_warehouses → get_stock | ✓ | ✓ | ✓ | 8874 | 240 | 5,19 | 0,00101 $ |
| 5 | search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 9276 | 354 | 6,46 | 0,00110 $ |
| 6 | search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 9372 | 404 | 5,24 | 0,00114 $ |
| 7 | search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 9161 | 374 | 4,06 | 0,00110 $ |
| 8 | search_products + search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 10053 | 567 | 4,97 | 0,00129 $ |
| 9 | search_products + list_warehouses → propose_stock_out | ✓ | ✓ | ✓ | 9291 | 403 | 5,18 | 0,00113 $ |
| 10 | search_products + list_warehouses → propose_stock_out | ✓ | ✓ | ✓ | 8914 | 400 | 6,62 | 0,00109 $ |
| 11 | search_products + list_warehouses → propose_stock_out | ✓ | ✓ | ✓ | 9071 | 398 | 3,98 | 0,00111 $ |
| 12 | search_products + search_products + list_warehouses → propose_stock_out | ✓ | ✓ | ✓ | 9756 | 557 | 7,59 | 0,00125 $ |
| 13 | search_products + list_warehouses → propose_transfer | ✓ | ✓ | ✓ | 9035 | 400 | 5,04 | 0,00110 $ |
| 14 | search_products + list_warehouses → propose_transfer | ✓ | ✓ | ✓ | 9323 | 468 | 6,82 | 0,00117 $ |
| 15 | search_products + list_warehouses → propose_transfer | ✓ | ✓ | ✓ | 9411 | 464 | 6,08 | 0,00117 $ |
| 16 | search_products + list_warehouses | ✓ | ✓ | ✓ | 5796 | 323 | 3,87 | 0,00074 $ |
| 17 | search_products + list_warehouses | ✓ | ✓ | ✓ | 5724 | 313 | 4,89 | 0,00073 $ |
| 18 | search_products + list_warehouses | ✓ | ✓ | ✓ | 5763 | 303 | 3,33 | 0,00073 $ |
| 19 | search_products + list_warehouses | ✓ | ✓ | ✓ | 5797 | 364 | 3,50 | 0,00076 $ |
| 20 | search_products + list_warehouses | ✓ | ✓ | ✓ | 5669 | 301 | 4,74 | 0,00072 $ |

### Haiku 5.5 (low): mesaj bazında ayrıntı

| # | Çağrılan araçlar (turlar →) | İlk | Araç | Param. | Giriş tok. | Çıkış tok. | Süre (sn) | Maliyet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | search_products + list_warehouses → get_stock | ✓ | ✓ | ✓ | 9140 | 236 | 3,58 | 0,00103 $ |
| 2 | search_products → get_stock | ✓ | ✓ | ✓ | 8716 | 273 | 6,91 | 0,00101 $ |
| 3 | search_products + list_warehouses → get_stock | ✓ | ✓ | ✓ | 8974 | 242 | 3,96 | 0,00102 $ |
| 4 | search_products + list_warehouses → get_stock | ✓ | ✓ | ✓ | 8852 | 229 | 5,08 | 0,00100 $ |
| 5 | search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 9228 | 293 | 6,28 | 0,00107 $ |
| 6 | search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 9362 | 376 | 4,06 | 0,00112 $ |
| 7 | search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 9060 | 313 | 3,91 | 0,00106 $ |
| 8 | search_products + search_products + list_warehouses → propose_stock_in | ✓ | ✓ | ✓ | 9950 | 505 | 4,64 | 0,00125 $ |
| 9 | search_products + list_warehouses → propose_stock_out | ✓ | ✓ | ✓ | 9303 | 401 | 4,37 | 0,00113 $ |
| 10 | search_products + list_warehouses → propose_stock_out | ✓ | ✓ | ✓ | 8940 | 412 | 6,76 | 0,00110 $ |
| 11 | search_products + list_warehouses → propose_stock_out | ✓ | ✓ | ✓ | 9024 | 362 | 4,09 | 0,00108 $ |
| 12 | search_products + search_products + list_warehouses → propose_stock_out | ✓ | ✓ | ✓ | 9730 | 544 | 7,13 | 0,00125 $ |
| 13 | search_products + list_warehouses → propose_transfer | ✓ | ✓ | ✓ | 8984 | 346 | 4,13 | 0,00107 $ |
| 14 | search_products + list_warehouses → propose_transfer | ✓ | ✓ | ✓ | 9328 | 461 | 7,03 | 0,00116 $ |
| 15 | search_products + list_warehouses → propose_transfer | ✓ | ✓ | ✓ | 9387 | 441 | 6,12 | 0,00116 $ |
| 16 | search_products + list_warehouses | ✓ | ✓ | ✓ | 5796 | 246 | 3,02 | 0,00070 $ |
| 17 | search_products + list_warehouses | ✓ | ✓ | ✓ | 5718 | 332 | 4,95 | 0,00074 $ |
| 18 | search_products + list_warehouses | ✓ | ✓ | ✓ | 5772 | 291 | 2,85 | 0,00072 $ |
| 19 | search_products + list_warehouses | ✓ | ✓ | ✓ | 5761 | 316 | 3,21 | 0,00073 $ |
| 20 | search_products + list_warehouses | ✓ | ✓ | ✓ | 5654 | 208 | 3,24 | 0,00067 $ |

### Yanlış sonuçların notları

**Haiku 4.5:** yok.

**Haiku 5.5 (medium):** yok.

**Haiku 5.5 (low):** yok.

## Gözlemler

- **Doğruluk:** Üç yapılandırma da üç ölçütte 20 / 20 aldı. Hiçbir belirsiz mesajda öneri aracı çağrılmadı;
  aday mesajlarında (16–18) iki aday ölçüleriyle listelendi, 19'da depo, 20'de miktar soruldu (cevaplar elle
  de okundu). Bu küme modelleri doğrulukta ayırt etmiyor; farklar süre, maliyet ve talimata uyumda çıktı.
- **Araç kullanımı:** Üç yapılandırma da aynı deseni izledi: ilk turda `search_products` ile
  `list_warehouses` paralel, ikinci turda karar aracı (`get_stock` ya da `propose_*`). Ortalama 1,75–1,80 tur;
  tur sınırına takılan, hata dönen araç çağrısı veya yeniden denenen istek olmadı. İki kalemli mesajlar
  (8, 12) üç yapılandırmada da tek öneride birleştirildi.
- **`note` alanı:** Haiku 4.5, 11 önerinin 7'sinde `note` doldurdu. Bunlardan yalnızca 10. mesajda kullanıcının
  verdiği bir not vardı ("Ataşehir şantiyesine gitti"); diğer altısını model uydurdu (ör. 9. mesajda
  "Araç 1 gözlemleme çıkışı", 8. mesajda "Gelen mallar"). Oysa araç tanımı "Yoksa gönderme" diyor. Haiku 5.5
  iki effort düzeyinde de yalnızca 10. mesajda not yazdı. Not metni öneri kartına ve denetim kaydına gideceği
  için bu fark önemli.
- **Türkçe ve üslup:** Haiku 4.5'in cevaplarında dil hataları ve tuhaf ifadeler var: "Kaptı!" ve "öneri
  hazırlıklı" (7), "giriş öneri oluşturdum" (6), "Onayla kartında" (15); emoji kullandı ve 16 ile 18'de iç
  kimlikleri (`p-01`) kullanıcıya gösterdi. Haiku 5.5'in cevapları düzgün; ürünü stok koduyla (ABC-1001)
  gösteriyor. Buna karşılık bazı cevaplara isteğe bağlı bir ek teklif ekledi ("tedarikçi eklemek ister
  misin?" gibi; medium: 8, 12, 20; low: 8, 12, 19). Bu, sistem promptundaki "tek bir soru sor" kuralını esnetiyor.
- **Stok toplamı:** 2. mesajda üç yapılandırma da üç deponun stoğunu kendisi toplayıp "139 adet" yazdı. Sonuç
  doğru, ama rakam araçtan değil modelin aritmetiğinden geliyor; gerçek `get_stock` toplamı da döndürmeli.
- **Süre:** Mesaj başına medyan süre Haiku 4.5'te 6,70 sn, Haiku 5.5 medium'da 5,04 sn, low'da 4,13 sn
  (Haiku 4.5'e göre medyanda yaklaşık %25 ve %38 daha kısa). Model çağrısı başına medyan 2,64 / 1,86 / 1,63 sn.
  Bunlar akışsız toplam sürelerdir; uygulamada SSE ile ilk kelime daha erken görünür (ilk token süresi
  ölçülmedi).
- **Strict şema derlemesi:** Koşudan önceki deneme isteğinde ısınma Haiku 4.5'te 39,2 sn, Haiku 5.5 low'da
  13,4 sn sürdü; tam koşudaki ısınmalar 5,1 / 2,0 / 2,0 sn'ye indi. `claude-api` skill'ine göre yeni bir şema
  ilk istekte derlenir ve 24 saat önbellekte kalır. Araç şeması değiştikten sonraki ilk kullanıcı isteği bu
  yüzden çok yavaş olabilir; yayından sonra bir ısınma isteği atılmalı.
- **Token:** Haiku 5.5 mesaj başına daha az giriş tokenı kullandı (8.358 ve 8.334; Haiku 4.5'te 9.753).
  Skill, Haiku 5.5'in aynı metin için yaklaşık %30 daha fazla token ürettiğini söylüyor; bu denemede tersi
  ölçüldü. Nedeni (ör. araç kullanımının modele eklediği sistem metni) incelenmedi. Çıktı tokenları Haiku
  5.5'te daha yüksek (370 ve 341; Haiku 4.5'te 282), çünkü gizli düşünme de çıktı sayılıyor.
- **Maliyet:** Mesaj başına Haiku 4.5 0,01116 $, Haiku 5.5 yaklaşık 0,0010 $: yaklaşık 11 kat fark. Giriş
  mesajları (5–8) Haiku 4.5'te 0,0119–0,0130 $ tuttu; `docs/teknik-arastirma.md` önbellekli varsayımla
  işlem başına 0,005–0,008 $ tahmin ediyordu. Bu denemede önbellek kapalıydı. Skill'e göre Haiku 4.5'te
  önbelleğe alınabilecek en kısa istem 4.096 token; bu denemedeki en büyük tek istem 4.139 token olduğundan,
  sistem promptu ve araç tanımları Haiku 4.5'te büyük olasılıkla önbelleğe alınamaz. Haiku 5.5'te bu sınır
  512 token. Önbellekli maliyet ölçülmedi.

## Sonuç

Bu 20 mesajda üç yapılandırma da aynı doğruluğu verdi. Haiku 5.5 ise daha hızlı, yaklaşık 11 kat ucuz,
araç tanımındaki talimata (`note`) daha iyi uyuyor ve Türkçesi daha düzgün. `low` ile `medium` arasında
doğruluk ve maliyet farkı yok, `low` medyanda daha hızlı. Bu sonuçla sohbet modeli olarak `effort: low` ile
Haiku 5.5 seçildi; gerekçe ve uygulama etkileri `docs/kararlar/ADR-001-sohbet-modeli.md` dosyasında (kabul edildi).

## Sınırlamalar

- 20 mesaj, her biri tek kez çalıştırıldı. Üç yapılandırma da tavana vurduğu için doğruluk farkı bu kümeyle
  ölçülemez; zor mesajlarda `low` ile `medium` farkı 6. haftada yeniden ölçülmeli.
- Katalog küçük ve temiz; sahte arama doğru adayı her zaman ilk sıralarda veriyor. Gerçek `pg_trgm`
  sonuçları, ses tanıma hataları (`eval/ses-denemesi.md`'deki "kutu" → "kota" gibi) ve yazım hataları denenmedi.
- Konuşmalar tek mesajlık. Belirsizlik sorusuna kullanıcının cevabından sonra öneriye geçiş, düzeltme,
  sayım, fire ve geri alma denenmedi.
- Önbellek ve akış kapalıydı; maliyet önbelleksiz değerdir, ilk token süresi ölçülmedi.
- Süreler tek bir akşam saatinde, tek bilgisayardan ve ağ gecikmesi dahil ölçüldü.
- Belirsiz mesajların puanlaması metin eşleştirmesiyle yapıldı; cevaplar ayrıca elle okundu.

## Kabul kriterleri (issue #13)

- [x] API anahtarı yalnızca yerel `.env` dosyasında; betik anahtarı ortam değişkeninden okur, istemci
  paketlerine girmez. Konsoldaki aylık harcama limiti kullanıcı tarafından tanımlandı (20 Ekim'de onaylandı).
- [x] 20 saha mesajı okuma ve `propose_*` araçlarıyla denendi; stok yazan veya onaylayan araç tanımlanmadı.
- [x] Aynı 20 mesaj Haiku 4.5 ve Haiku 5.5 (medium ve low) ile çalıştırıldı; doğru araç, doğru parametre,
  token, süre ve maliyet yukarıdaki tablolarda.
- [x] Sonuç bu belgede; sohbet modeli değişikliği `docs/kararlar/ADR-001-sohbet-modeli.md` ile kabul edildi
  ve `.env.example` güncellendi.
