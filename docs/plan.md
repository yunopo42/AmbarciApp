# Ambarcı — 8 haftalık plan

Kaynak: `docs/raporlar/hafta-01-arastirma-ve-oneri.md`, bölüm 8 (kapılar) ve bölüm 9 (görevler). Dönem: 5 Ekim – 6 Aralık 2026.

**Plan değişikliği (17 Ekim 2026):** 1. hafta işleri 17 Ekim'e uzadı; yetişmeyen 1. hafta maddeleri 2. haftanın başına devredildi. 2. haftanın kapısı 22 Ekim'e alındı, 3. hafta 23–25 Ekim'e sıkıştırıldı. 4. haftanın kapısı ve sonraki haftalar değişmedi.

**Plan değişikliği (1 Kasım 2026):** 2–6 Kasım sınav haftası olduğu için 4. hafta ve sonrası bir hafta kaydırıldı; işlere 7 Kasım'da devam edilir. 4. haftanın kapısı 8 Kasım'a alındı, 5–8. haftalar birer hafta kaydı ve final demo 6 Aralık'a geldi (#63). İlk plan 29 Kasım'da bitiyordu.

**Plan değişikliği (20 Kasım 2026):** 5. haftanın işleri 15 Kasım'a yetişmedi; hafta, kapısıyla birlikte 20 Kasım'da tamamlandı (#84). 6. hafta 21–22 Kasım'a sıkıştırıldı; kapsamı ölçüm (değerlendirme kümesi, Haiku–Sonnet kıyası) ve web onay kuyruğu. Push bildirimleri 7. haftaya alındı: önce outbox'ı okuyan worker'ın (pg-boss), cihaz token'larının ve EAS ayarının kurulması gerekiyor. Sohbetten geri alma (`chat-v3`) ve 5. hafta kapı denemesinin açık bulgusu (fire nedeninin nota yazılmaması) da 7. haftada. 7. ve 8. hafta ile final demo (6 Aralık) değişmedi.

Her hafta bir GitHub milestone'u, her görev bir issue olarak açılır. Dört kapı vardır: 2., 4., 5. ve 8. hafta. Kapı geçilmeden sonraki faza geçilmez; geçilemezse kapsam daraltılır. Öncelik sırası: sohbet → öneri → onay → stok akışı, sonra irsaliye, sonra ses ve barkod. Son haftada yeni özellik eklenmez.

| Hafta | Tarih | Odak | Kapı |
| --- | --- | --- | --- |
| 1 | 5–11 Ekim | Araştırma ve iskelet | — |
| 2 | 12–22 Ekim | Veritabanı ve kimlik | İki şirket arasında veri sızıntısı yok (22 Ekim) |
| 3 | 23–25 Ekim | Manuel stok | — |
| 4 | 26 Ekim – 8 Kasım (2–6 Kasım sınav arası) | Asistan altyapısı | Telefonda canlı stok sorgusu (8 Kasım) |
| 5 | 9–20 Kasım | Öneri ve onay | Onay stoğu tam bir kez değiştirir (20 Kasım) |
| 6 | 21–22 Kasım | Ölçüm ve onay kuyruğu | — |
| 7 | 23–29 Kasım | Belge, ses, barkod; bildirim | — |
| 8 | 30 Kasım – 6 Aralık | Test, rapor, demo | Final demo ve ölçülmüş sonuçlar |

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

2. haftanın uzaması nedeniyle 23–25 Ekim'e sıkıştırıldı. 4. haftanın kapısı (telefonda canlı stok sorgusu) değişmedi. İşlere 22 Ekim gecesi başlandı; bütün maddeler 25 Ekim'de tamamlandı (`docs/raporlar/hafta-03.md`).

- [x] Hareket, işlem, sayım, denetim ve outbox tabloları; demo verisine açılış stokları (2. haftadan kapsam kararıyla)
- [x] Ürün, birim, alternatif ad, depo ve cari yönetimi (web)
- [x] Excel/CSV ile ürün içe aktarma
- [x] Giriş, çıkış, transfer, sayım, fire ekranları ve stok transaction'ı
- [x] Hareketli ortalama maliyet hesabı
- [x] OpenAPI istemcisi; mobilde stok listesi ve ürün detayı
- [x] Eşzamanlı çıkış ve rollback testleri (çok kalemli işlemde bir kalem başarısızsa hiçbir şey yazılmaz)

Planda olmayan, eklenen işler: bölgeler arası gecikme ölçümü ve onay süresini yarıya indiren düzeltme (#34); Next.js, NestJS ve multer güvenlik güncellemesi (#45); onay bekleyen işlemler listesi (#39, 5–6. haftadaki onay kuyruğunun ilk adımı).

## Hafta 4 — Asistan altyapısı (26 Ekim – 8 Kasım)

**Kapı:** Telefondan canlı stok sorgusu — **geçildi** (7 Kasım; telefonda 9 sorunun 9'u doğru; `docs/raporlar/hafta-04.md`)

- [x] Sohbet ve mesaj tabloları, ajan döngüsü, araç kayıt defteri
- [x] Okuma araçları: ürün arama (`pg_trgm`), stok sorgusu, son hareketler
- [x] SSE akışı; web ve mobilde sohbet ekranı
- [x] `ai_runs` kayıtları (token, süre, maliyet)

29 Ekim resmi tatili bu haftadadır; bir günlük tampon bırakılmıştır. 2–6 Kasım sınav haftasında iş yapılmaz; işlere 7 Kasım'da devam edilir.

## Hafta 5 — Öneri ve onay (9–20 Kasım)

**Kapı:** Onay stoğu tam bir kez değiştirir — **geçildi** (20 Kasım; gerçek veritabanında tekrar ve eşzamanlılık testleri, telefon denemesi; `docs/raporlar/hafta-05.md`)

- [x] Öneri araçları: giriş, çıkış, transfer, sayım, fire
- [x] İşlem kartı (mobil + web), durum makinesi, onay uç noktası
- [x] Idempotency, outbox, denetim kaydı; ters kayıtla geri alma (15 dk kendi işlemi, sonrası yönetici)
- [x] Tekrar ve eşzamanlılık testleri

Planda olmayan, eklenen işler: Claude API adresinin kodda sabitlenmesi (#72); sohbette ses uyarısının temizlenmesi ve kalın yazının gösterilmesi (#73); Next.js güvenlik güncellemesi (#91); kapı denemesinde bulunan iki hatanın düzeltmesi (#79: aynı önerinin tekrar açılması, modelin kartın onaylandığını bilmemesi).

## Hafta 6 — Ölçüm ve onay kuyruğu (21–22 Kasım)

**Kapı:** —

- [x] 100 etiketli mesaj (60 geliştirme, 40 test); `pnpm eval` betiği
- [x] Haiku–Sonnet kıyası, prompt iyileştirme, test kümesini dondurma
- [x] Web onay kuyruğu ve dashboard

Push bildirimi 7. haftaya alındı (Plan değişikliği, 20 Kasım).

Planda olmayan, eklenen işler: fire nedeninin nota yazılmaması 7. haftadan öne alındı (#86: araç şemasında alan sırası); araç sonuçlarında sayı yazımının düzeltilmesi (#86); prompt sürümünü seçen `CLAUDE_CHAT_PROMPT` ve kayıtlı koşuyu yeniden puanlayan `pnpm eval --rescore` (#86).

## Hafta 7 — Belge, ses, barkod; bildirim (23–29 Kasım)

**Kapı:** —

- [ ] Push bildirimi: onay bekleyen işlem, kritik stok (6. haftadan; önce outbox worker'ı, cihaz token'ları ve EAS ayarı)
- [ ] Sohbetten geri alma: `propose_reversal` ve son işlemleri listeleyen okuma aracı (`chat-v4`; `chat-v3` 6. haftada değerlendirme bulgularıyla açıldı). Fire nedeninin nota yazılmaması 6. haftada, değerlendirmeyle birlikte ele alındı (#86).
- [ ] Kamera ile irsaliye çekme, Sonnet ile kalem çıkarma, inceleme ekranı
- [ ] Tesseract + Haiku ile kıyas deneyi (30–50 belge)
- [ ] Cihazda ses tanıma ve sohbete bağlama
- [ ] Barkod okutma (zaman kalırsa e-irsaliye XML okuma)
- [ ] Pilot kullanıcı denemesi
- [ ] KVKK aydınlatma metni, gizlilik politikası sayfası ve uygulama içinden hesap silme akışı (mağaza yayını için zorunlu)

Not: Hafta sonunda kapsam dondurulur; bu bir kapı değildir.

## Hafta 8 — Test, rapor, demo (30 Kasım – 6 Aralık)

**Kapı:** Final demo ve ölçülmüş sonuçlar

- [ ] Final değerlendirme ve işlem süresi deneyi (form vs. asistan)
- [ ] Hata düzeltme; yeni özellik yok
- [ ] Android dahili test yayını veya APK; web canlı adres
- [ ] Kurulum, mimari ve kullanım dokümantasyonu
- [ ] Bitirme raporu, sunum ve yedek demo videosu
