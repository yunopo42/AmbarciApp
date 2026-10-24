# Ambarcı — tasarım değerleri

Mobil ve web ekranları yazılırken renk, yazı tipi, boşluk, köşe ve gölge değerleri bu dosyadan alınır. Burada karşılığı olmayan bir değer gerekirse uydurulmaz; önce bu dosyaya eklenir.

- **Kaynak:** Google Stitch ile üretilen beş ekran ve Stitch'in tasarım sistemi notu (21 Ekim 2026).
- **Görseller:** Yalnızca görsel referanstır. Stitch'in ürettiği HTML kodu depoya alınmadı ve uygulamada kullanılmaz.
- **Ekranlar arası çelişkiler:** Stitch çıktısında üç değer ekranlar arasında farklıydı (ana renk, hata kırmızısı, zemin); bu dosyadaki değerler 21 Ekim'de seçildi.

## Ekranlar

| Ekran | Görsel | Kullanıldığı hafta |
| --- | --- | --- |
| Mobil sohbet ve işlem kartı | [1-mobil-sohbet.png](tasarim/1-mobil-sohbet.png) | 4–5 |
| Mobil stok listesi | [2-mobil-stok-listesi.png](tasarim/2-mobil-stok-listesi.png) | 3 |
| Web gösterge paneli | [3-web-gosterge-paneli.png](tasarim/3-web-gosterge-paneli.png) | 6 |
| Web onay kuyruğu | [4-web-onay-kuyrugu.png](tasarim/4-web-onay-kuyrugu.png) | 5–6 |
| Web belge (irsaliye) inceleme | [5-web-belge-inceleme.png](tasarim/5-web-belge-inceleme.png) | 7 |

Ekranlardaki kişi adları, sayılar ve ürün kodları örnektir.

## Renkler

Uygulamada renkler aşağıdaki **anlamsal adlarla** kullanılır; bileşen içine doğrudan renk kodu yazılmaz.

### Ana renk ve metin

| Ad | Değer | Kullanım |
| --- | --- | --- |
| `primary` | `#1E3A8A` | Ana düğmeler, başlıklar, seçili menü, kullanıcının sohbet balonu |
| `primary-action` | `#1D4ED8` | Ana düğmenin üzerine gelme ve basılı hâli, odak halkası, bağlantılar |
| `on-primary` | `#FFFFFF` | Ana renk üzerindeki metin ve ikon |
| `primary-soft` | `#EFF4FF` | Seçili menü satırı, bilgi rozetleri, açık mavi vurgular |
| `text` | `#0B1C30` | Ana metin |
| `text-muted` | `#444651` | İkincil metin, etiketler, açıklamalar |
| `text-subtle` | `#757682` | Yer tutucu metin, pasif ikonlar |

### Zeminler ve kenarlıklar

| Ad | Değer | Kullanım |
| --- | --- | --- |
| `canvas` | `#F8FAFC` | Sayfa zemini (mobil ekranlar ve web panel) |
| `card` | `#FFFFFF` | Kartlar, tablolar, paneller, giriş alanları |
| `border` | `#E2E8F0` | Kart ve tablo kenarlıkları |
| `border-strong` | `#CBD5E1` | Giriş alanı ve ikincil düğme kenarlığı, yüzen paneller |
| `divider` | `#F1F5F9` | Liste satırı ayırıcıları |

### Durum renkleri

Her durumun metin, dolgu, zemin ve kenarlık tonu birlikte kullanılır (örneğin rozet: zemin + kenarlık + metin).

| Durum | Metin | Dolgu (nokta, grafik) | Zemin | Kenarlık | Nerede |
| --- | --- | --- | --- | --- | --- |
| Onay bekliyor | `#D97706` | `#F59E0B` | `#FEF3C7` | `#FDE68A` | Önerilen işlem, onay kuyruğu, süre uyarısı |
| Uygulandı / yeterli | `#059669` | `#10B981` | `#ECFDF5` | `#A7F3D0` | Onaylanmış işlem, yeterli stok |
| Kritik / hata | `#DC2626` | `#DC2626` | `#FEF2F2` | `#FECACA` | Kritik stok, eksi stok, hata mesajı, iptal ve reddet düğmeleri |

Grafiklerde **giriş** `primary` (`#1E3A8A`), **çıkış** bekliyor dolgusu (`#F59E0B`) ile gösterilir; gösterge panelindeki "Son 14 gün" grafiğinde olduğu gibi.

Renk tek başına anlam taşımaz: her durum rengi yanında metin ya da ikonla birlikte kullanılır ("Kritik", "Onay bekliyor"). Renk körlüğü olan kullanıcılar da durumu okuyabilmelidir.

## Yazı tipi

**Inter**, bütün ağırlıklarda Türkçe karakterleri (ç ğ ı İ ö ş ü) destekler.

| Ad | Boyut / satır | Ağırlık | Harf aralığı | Kullanım |
| --- | --- | --- | --- | --- |
| `headline-lg` | 32 / 40 px | 700 | −0.02em | Web sayfa başlığı, büyük sayılar (KPI) |
| `headline-lg-mobile` | 26 / 34 px | 700 | −0.01em | Mobil ekran başlığı |
| `headline-md` | 24 / 32 px | 600 | −0.01em | Bölüm başlığı |
| `headline-sm` | 20 / 28 px | 600 | — | Kart başlığı, panel başlığı |
| `title-md` | 18 / 24 px | 600 | — | Liste ve kart içi başlık |
| `body-lg` | 16 / 24 px | 400 | — | Mobil gövde metni, sohbet mesajları |
| `body-lg-bold` | 16 / 24 px | 600 | — | Ürün adı (liste satırı) |
| `body-md` | 14 / 20 px | 400 | — | Web gövde metni, tablo hücreleri |
| `body-md-medium` | 14 / 20 px | 500 | — | Vurgulu tablo hücresi, form etiketi |
| `label-lg` | 15 / 20 px | 600 | 0.01em | Düğme metni |
| `label-md` | 13 / 18 px | 600 | 0.02em | Küçük düğme, sekme, alt bilgi |
| `label-sm` | 11 / 14 px | 700 | 0.04em | Rozet, tablo başlığı (büyük harf) |

- **Sayılar** (stok miktarı, ürün kodu, tutar) `tabular-nums` ile yazılır; tablolarda alt alta hizalı durur.
- **Büyük harf ve Türkçe:** Web'de `<html lang="tr">` tanımlı olduğu için CSS `uppercase`, `i` harfini doğru olarak `İ` yapar. React Native'de `textTransform: 'uppercase'` dile duyarlı değildir; mobilde büyük harfli etiketler metnin kendisinde büyük yazılır ("KRİTİK").
- **Yazı tipinin yüklenmesi:** Web'de Next.js'in kendi `next/font` modülüyle, ek paket olmadan. Mobilde `@expo-google-fonts/inter` gerekir; yeni bağımlılık olduğu için eklenmeden önce onay alınır.

## Boşluk ve yerleşim

8 px ızgara kullanılır.

| Ad | Değer |
| --- | --- |
| `space-xs` | 4 px |
| `space-sm` | 8 px |
| `space-md` | 16 px |
| `space-lg` | 24 px |
| `space-xl` | 32 px |

- **Mobil:** Kenar boşluğu 16 px, öğeler arası 16 px. Barkod ve hızlı işlem düğmeleri gibi sık kullanılan işlemler alt kısımda sabit durur.
- **Web:** İçerik en fazla 1280 px genişlikte ortalanır, kenar boşluğu 32 px. Sol menü sabit, içerik sağda.
- **Dokunma hedefi:** Mobilde her dokunulabilir öğe en az **48 × 48 px**. Saha çalışanı acele ediyor ya da eldiven takıyor olabilir.

## Köşe yarıçapı

| Ad | Değer | Kullanım |
| --- | --- | --- |
| `radius-sm` | 4 px | Onay kutusu, küçük etiket |
| `radius-md` | 8 px | Düğme, giriş alanı, açılır liste |
| `radius-lg` | 12 px | Kart, panel, tablo kutusu, sohbet balonu |
| `radius-full` | 9999 px | Durum rozetleri, filtre çipleri |

## Gölge (derinlik)

Koyu gölge kullanılmaz; derinlik ince kenarlık ve hafif gölgeyle verilir.

| Seviye | Gölge | Kullanım |
| --- | --- | --- |
| 0 | yok | Sayfa zemini (`canvas`) |
| 1 | `0 1px 2px 0 rgba(15, 23, 42, 0.05)` + `border` kenarlık | Kart, tablo |
| 2 | `0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -2px rgba(15, 23, 42, 0.04)` + `border-strong` kenarlık | Yapışkan üst çubuk, alttan açılan panel, filtre penceresi |
| 3 | `0 10px 15px -3px rgba(15, 23, 42, 0.12)` | Uyarı ve onay pencereleri |

Pencere (dialog) açıkken arkasındaki sayfa `overlay` ile karartılır: `text` rengi (`#0B1C30`) %40 saydamlıkta. *(24 Ekim 2026'da web formları için eklendi; Stitch ekranlarında karşılığı yoktu.)*

## Bileşen kuralları

| Bileşen | Kural |
| --- | --- |
| Ana düğme | Zemin `primary`, üzerine gelince `primary-action`; metin `on-primary`, `label-lg`; en az 48 px yükseklik, yatay 20 px iç boşluk, köşe 8 px; mobil panellerde tam genişlik |
| İkincil düğme | Zemin `card`, kenarlık 1 px `border-strong`, metin `primary`; en az 48 px |
| Küçük düğme (web) | Tablo satırındaki "Düzenle", sayfalama ve "Kopyala" gibi sık tekrar eden düğmeler: `label-md`, en az 40 px yükseklik, yatay 12 px. Mobilde kullanılmaz (dokunma hedefi 48 px). *(24 Ekim 2026'da eklendi.)* |
| Tehlikeli düğme | İptal, Reddet: kritik renk. Geri alınamaz işlemde dolu zemin, yan seçenek olarak kenarlıklı |
| Giriş alanı | En az 48 px, kenarlık 1,5 px `border-strong`, köşe 8 px; odakta 2 px `primary-action` halka; hata durumunda kritik kenarlık ve altında 13 px açıklama |
| Kart | Zemin `card`, kenarlık `border`, köşe 12 px, iç boşluk 16 px, gölge seviye 1 |
| Durum rozeti | Hap biçimi, dikey 4 px / yatay 10 px, `label-sm`, durum renk üçlüsü (zemin, kenarlık, metin) |
| Liste satırı | En az 56 px yükseklik, dikey 14 px iç boşluk, `divider` ayırıcı; solda ürün adı (`body-lg-bold`) ve konum (`body-md`), sağda miktar (`tabular-nums`) |
| Onay kutusu | Görünen kutu 22 px, dokunma alanı 48 px, köşe 4 px, seçiliyken `primary` dolgu |
| İşlem kartı (sohbet) | Başlıkta işlem türü ve "Onay bekliyor" rozeti; ürün, miktar (girilen birim ve ana birim), depo, cari ve stok değişimi (önce → sonra); "Onayla" ana düğme, "Düzenle" ve "İptal" ikincil; altında "Onaylamadan stok değişmez." notu |

## Tasarımdan alınmayacaklar

Stitch bazı ekranlara projenin kapsamı dışında kalan ya da mimarisiyle çelişen ögeler ekledi. Ekranlar yazılırken bunlar uygulanmaz:

| Tasarımdaki öge | Ekran | Neden alınmaz / yerine ne gelir |
| --- | --- | --- |
| "WhatsApp & Sesli Asistan Kaydı", "personele WhatsApp bildirimi gider", "WhatsApp ve Sesli Not" | Onay kuyruğu, gösterge paneli | WhatsApp kanalı MVP dışı (`docs/yol-haritasi.md`). Bildirimler push ile gider (6. hafta). |
| Ses kaydını oynatma (dalga formu, 0:06) | Onay kuyruğu | Ses cihazda yazıya çevrilir, ses dosyası saklanmaz (kişisel veri). Kaynak olarak yalnızca mesaj metni gösterilir. |
| "Senkronize Et", "Çevrimiçi • Eşzamanlı" göstergesi | Gösterge paneli, menü altı | Çevrimdışı mod MVP dışı. |
| "T.C. Maliye Onaylı" rozeti | Belge inceleme | e-irsaliye kesilmez ve doğrulanmaz; fotoğraftan okunan belge resmî onay taşımaz. |
| "OCR ile tarandı • Güven skoru %94", "Otomatik eşleşti (%98)" | Belge inceleme | Kalemleri Claude çıkarır. Ölçülmemiş yüzde gösterilmez; okunamayan alan "Okunamadı" olarak işaretlenir, eşleşme aday listesiyle sunulur. |
| "Sipariş Aç" | Gösterge paneli | Satın alma siparişi MVP dışı. |
| "Hızlı Stok Ekle", "Onayla ve Stoğu Güncelle", toplu onay | Menü, onay kuyruğu | Alınır, ama stok yalnızca onay uç noktasından değişir: hızlı ekleme bir işlem önerisi açar; toplu onayda her işlem ayrı onay isteğiyle (ayrı `Idempotency-Key`) gönderilir. |

## Uygulama notları

- **Tek kaynak:** Değerler, kod yazılırken tek bir yerde tanımlanır: web için Tailwind'in `@theme` değişkenleri (`apps/web/app/globals.css`), mobil için bir tema dosyası. İkisi bu tabloyla aynı kalır; değer değişince önce bu dosya güncellenir.
- **Koyu tema:** Şimdilik yok; yalnızca açık tema tasarlandı.

### Web'de (Tailwind) kullanılan adlar

`apps/web/app/globals.css` Tailwind'in hazır renk, yazı boyutu, köşe ve gölge ölçeklerini kapatır (`--color-*: initial` gibi). Bileşende `bg-blue-500` ya da `text-sm` yazılırsa stil üretilmez; yalnızca aşağıdaki adlar çalışır.

| Değer | Tailwind sınıfı |
| --- | --- |
| Renkler | Tablodaki adla: `bg-primary`, `hover:bg-primary-action`, `text-on-primary`, `bg-primary-soft`, `text-text`, `text-text-muted`, `text-text-subtle`, `bg-canvas`, `bg-card`, `border-border`, `border-border-strong`, `border-divider`, `bg-overlay` |
| Durum renkleri | Onay bekliyor `pending`, uygulandı/yeterli `applied`, kritik/hata `critical`; metin adın kendisi, dolgu `-fill`, zemin `-soft`, kenarlık `-border` (ör. `text-pending`, `bg-pending-soft`, `border-pending-border`) |
| Yazı | Ölçekteki adla; boyut, satır yüksekliği, ağırlık ve harf aralığı birlikte gelir: `text-headline-lg`, `text-body-md`, `text-label-sm`… Sayılar `tabular-nums` |
| Boşluk | Tailwind'in 4 px'lik adımı: `space-xs` = 1, `space-sm` = 2, `space-md` = 4, `space-lg` = 6, `space-xl` = 8 (ör. `p-4` = 16 px, `gap-6` = 24 px) |
| Köşe | `rounded-sm` 4 px, `rounded-md` 8 px, `rounded-lg` 12 px, `rounded-full` |
| Gölge | `shadow-1`, `shadow-2`, `shadow-3` |
| İçerik genişliği | `max-w-page` (1280 px) |

Bileşenler shadcn/ui kalıbıyla `apps/web/components/ui/` altında yazıldı (düğme, giriş alanı, açılır liste, onay kutusu, kart, rozet, tablo, pencere, uyarı). shadcn CLI kullanılmadı: `shadcn init` `globals.css`'e kendi renk paletini yazıyor; bileşenler bu dosyadaki adlarla elle uyarlandı. `lib/utils.ts` içindeki `cn`, çakışan sınıfları ayıklayan tailwind-merge'e buradaki yazı ve gölge adlarını tanıtır.
