# Ambarcı — 8 haftalık plan

Kaynak: `docs/raporlar/hafta-01.md`, bölüm 8 (kapılar) ve bölüm 9 (görevler). Dönem: 5 Ekim – 29 Kasım 2026.

Her hafta bir GitHub milestone'u, her görev bir issue olarak açılır. Dört kapı vardır: 2., 4., 5. ve 8. hafta. Kapı geçilmeden sonraki faza geçilmez; geçilemezse kapsam daraltılır. Öncelik sırası: sohbet → öneri → onay → stok akışı, sonra irsaliye, sonra ses ve barkod. Son haftada yeni özellik eklenmez.

| Hafta | Tarih | Odak | Kapı |
| --- | --- | --- | --- |
| 1 | 5–11 Ekim | Araştırma ve iskelet | — |
| 2 | 12–18 Ekim | Veritabanı ve kimlik | İki şirket arasında veri sızıntısı yok |
| 3 | 19–25 Ekim | Manuel stok | — |
| 4 | 26 Ekim – 1 Kasım | Asistan altyapısı | Telefonda canlı stok sorgusu |
| 5 | 2–8 Kasım | Öneri ve onay | Onay stoğu tam bir kez değiştirir |
| 6 | 9–15 Kasım | Ölçüm ve bildirim | — |
| 7 | 16–22 Kasım | Belge, ses, barkod | — |
| 8 | 23–29 Kasım | Test, rapor, demo | Final demo ve ölçülmüş sonuçlar |

## Hafta 1 — Araştırma ve iskelet (5–11 Ekim)

**Kapı:** —

- [ ] Araştırma raporunu ve bu özeti tamamla, danışmana sun
- [ ] GitHub reposu, README, 8 milestone, 1. hafta issue'ları
- [ ] pnpm monorepo: `apps/mobile`, `apps/web`, `apps/api`, `packages/shared`
- [ ] GitHub Actions: lint, typecheck, build
- [ ] Supabase projesi, `.env.example`; web Vercel'de, API `/health` Render'da yayında
- [ ] Expo development build telefonda; Türkçe ses tanıma denemesi
- [ ] Claude API anahtarı ve harcama limiti; 20 örnek mesajla araç çağırma denemesi
- [ ] Demo verisi: ABC Elektrik, 15–20 ürün, 2 depo, 1 araç deposu

## Hafta 2 — Veritabanı ve kimlik (12–18 Ekim)

**Kapı:** İki şirket arasında veri sızıntısı yok

- [ ] Drizzle şeması ve migration'lar (ER diyagramındaki tablolar)
- [ ] Supabase Auth: web ve mobilde giriş/çıkış
- [ ] Şirket oluşturma, davet kodu, rol ve depo yetkisi
- [ ] Backend'de JWT doğrulama ve yetki guard'ları
- [ ] RLS politikaları; iki şirketli izolasyon testi
- [ ] Ekran tasarımları (Stitch veya Figma, yalnızca görsel referans; üretilen kod kullanılmaz): mobil sohbet + işlem kartı, mobil stok listesi, web dashboard, web onay kuyruğu, web belge inceleme. Renk, yazı tipi, boşluk ve köşe değerleri `docs/tasarim.md` dosyasına yazılır.

## Hafta 3 — Manuel stok (19–25 Ekim)

**Kapı:** —

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
