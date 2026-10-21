# Ambarcı — 8 haftalık plan

Kaynak: `docs/raporlar/hafta-01-arastirma-ve-oneri.md`, bölüm 8 (kapılar) ve bölüm 9 (görevler). Dönem: 5 Ekim – 29 Kasım 2026.

**Plan değişikliği (17 Ekim 2026):** 1. hafta işleri 17 Ekim'e uzadı; yetişmeyen 1. hafta maddeleri 2. haftanın başına devredildi. 2. haftanın kapısı 22 Ekim'e alındı, 3. hafta 23–25 Ekim'e sıkıştırıldı. 4. haftanın kapısı ve sonraki haftalar değişmedi.

Her hafta bir GitHub milestone'u, her görev bir issue olarak açılır. Dört kapı vardır: 2., 4., 5. ve 8. hafta. Kapı geçilmeden sonraki faza geçilmez; geçilemezse kapsam daraltılır. Öncelik sırası: sohbet → öneri → onay → stok akışı, sonra irsaliye, sonra ses ve barkod. Son haftada yeni özellik eklenmez.

| Hafta | Tarih | Odak | Kapı |
| --- | --- | --- | --- |
| 1 | 5–11 Ekim | Araştırma ve iskelet | — |
| 2 | 12–22 Ekim | Veritabanı ve kimlik | İki şirket arasında veri sızıntısı yok (22 Ekim) |
| 3 | 23–25 Ekim | Manuel stok | — |
| 4 | 26 Ekim – 1 Kasım | Asistan altyapısı | Telefonda canlı stok sorgusu |
| 5 | 2–8 Kasım | Öneri ve onay | Onay stoğu tam bir kez değiştirir |
| 6 | 9–15 Kasım | Ölçüm ve bildirim | — |
| 7 | 16–22 Kasım | Belge, ses, barkod | — |
| 8 | 23–29 Kasım | Test, rapor, demo | Final demo ve ölçülmüş sonuçlar |

## Hafta 1 — Araştırma ve iskelet (5–11 Ekim)

**Kapı:** —

- [x] Araştırma raporunu ve bu özeti tamamla, danışmana sun
- [x] GitHub reposu, 1. hafta issue'ları
- [ ] README, 8 milestone — 2. haftanın başına devredildi
- [x] pnpm monorepo: `apps/mobile`, `apps/web`, `apps/api`, `packages/shared`
- [x] GitHub Actions: lint, typecheck, build
- [x] `.env.example`; web Vercel'de, API `/health` Render'da yayında
- [ ] Supabase projesi — 2. haftanın başına devredildi
- [x] Expo development build telefonda; Türkçe ses tanıma denemesi
- [ ] Claude API anahtarı ve harcama limiti; 20 örnek mesajla araç çağırma denemesi — 2. haftanın başına devredildi
- [ ] Demo verisi: ABC Elektrik, 15–20 ürün, 2 depo, 1 araç deposu — 2. haftanın başına devredildi

Ses denemesinden çıkan karar (`eval/ses-denemesi.md`): ürün eşleştirme isim benzerliğiyle yapılır; ürün kodu sesle alınmaz, kod için barkod okutulur.

## Hafta 2 — Veritabanı ve kimlik (12–22 Ekim)

**Kapı:** İki şirket arasında veri sızıntısı yok (22 Ekim) — **geçildi** (RLS ve API izolasyon testleri; `docs/raporlar/hafta-02.md`)

1. haftadan devredenler:

- [x] Supabase projesi
- [x] README, 8 milestone
- [x] Claude API anahtarı ve harcama limiti; 20 örnek mesajla araç çağırma denemesi
- [x] Demo verisi: ABC Elektrik, 15–20 ürün, 2 depo, 1 araç deposu (başlangıç stokları 3. haftada)

2. haftanın işleri:

- [x] Drizzle şeması ve migration'lar: 2. ve 3. haftada gereken 10 tablo; hareket ve işlem tabloları 3. haftaya alındı
- [x] Supabase Auth: web ve mobilde giriş/çıkış
- [x] Şirket oluşturma, davet kodu, rol ve depo yetkisi
- [x] Backend'de JWT doğrulama ve yetki guard'ları
- [x] RLS politikaları; iki şirketli izolasyon testi
- [x] Ekran tasarımları (Google Stitch, yalnızca görsel referans; üretilen kod kullanılmadı): mobil sohbet + işlem kartı, mobil stok listesi, web dashboard, web onay kuyruğu, web belge inceleme. Renk, yazı tipi, boşluk ve köşe değerleri `docs/tasarim.md` dosyasında.

## Hafta 3 — Manuel stok (23–25 Ekim)

**Kapı:** —

2. haftanın uzaması nedeniyle 23–25 Ekim'e sıkıştırıldı. 4. haftanın kapısı (telefonda canlı stok sorgusu) değişmedi.

- [ ] Hareket, işlem, sayım, denetim ve outbox tabloları; demo verisine açılış stokları (2. haftadan kapsam kararıyla)
- [ ] Ürün, birim, alternatif ad, depo ve cari yönetimi (web)
- [ ] Excel/CSV ile ürün içe aktarma
- [ ] Giriş, çıkış, transfer, sayım, fire ekranları ve stok transaction'ı
- [ ] Hareketli ortalama maliyet hesabı
- [ ] OpenAPI istemcisi; mobilde stok listesi ve ürün detayı
- [ ] Eşzamanlı çıkış ve rollback testleri (çok kalemli işlemde bir kalem başarısızsa hiçbir şey yazılmaz)

## Hafta 4 — Asistan altyapısı (26 Ekim – 1 Kasım)

**Kapı:** Telefondan canlı stok sorgusu

- [ ] Sohbet ve mesaj tabloları, ajan döngüsü, araç kayıt defteri
- [ ] Okuma araçları: ürün arama (`pg_trgm`), stok sorgusu, son hareketler
- [ ] SSE akışı; web ve mobilde sohbet ekranı
- [ ] `ai_runs` kayıtları (token, süre, maliyet)

29 Ekim resmi tatili bu haftadadır; bir günlük tampon bırakılmıştır.

## Hafta 5 — Öneri ve onay (2–8 Kasım)

**Kapı:** Onay stoğu tam bir kez değiştirir

- [ ] Öneri araçları: giriş, çıkış, transfer, sayım, fire
- [ ] İşlem kartı (mobil + web), durum makinesi, onay uç noktası
- [ ] Idempotency, outbox, denetim kaydı; ters kayıtla geri alma (15 dk kendi işlemi, sonrası yönetici)
- [ ] Tekrar ve eşzamanlılık testleri

## Hafta 6 — Ölçüm ve bildirim (9–15 Kasım)

**Kapı:** —

- [ ] 100 etiketli mesaj (60 geliştirme, 40 test); `pnpm eval` betiği
- [ ] Haiku–Sonnet kıyası, prompt iyileştirme, test kümesini dondurma
- [ ] Push bildirimi: onay bekleyen işlem, kritik stok
- [ ] Web onay kuyruğu ve dashboard

## Hafta 7 — Belge, ses, barkod (16–22 Kasım)

**Kapı:** —

- [ ] Kamera ile irsaliye çekme, Sonnet ile kalem çıkarma, inceleme ekranı
- [ ] Tesseract + Haiku ile kıyas deneyi (30–50 belge)
- [ ] Cihazda ses tanıma ve sohbete bağlama
- [ ] Barkod okutma (zaman kalırsa e-irsaliye XML okuma)
- [ ] Pilot kullanıcı denemesi
- [ ] KVKK aydınlatma metni, gizlilik politikası sayfası ve uygulama içinden hesap silme akışı (mağaza yayını için zorunlu)

Not: Hafta sonunda kapsam dondurulur; bu bir kapı değildir.

## Hafta 8 — Test, rapor, demo (23–29 Kasım)

**Kapı:** Final demo ve ölçülmüş sonuçlar

- [ ] Final değerlendirme ve işlem süresi deneyi (form vs. asistan)
- [ ] Hata düzeltme; yeni özellik yok
- [ ] Android dahili test yayını veya APK; web canlı adres
- [ ] Kurulum, mimari ve kullanım dokümantasyonu
- [ ] Bitirme raporu, sunum ve yedek demo videosu
