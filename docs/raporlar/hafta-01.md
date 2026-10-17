# Ambarcı — 1. Hafta Raporu: Araştırma ve iskelet

| | |
| --- | --- |
| Öğrenci | Yunus Emre ATMAZ |
| Öğrenci no | 221450018 |
| Danışman | Ali Osman Çıbıkdiken |
| Ders | Senior Design Project |
| Hafta | 1. hafta (5–11 Ekim 2026; çalışmalar 17 Ekim'e uzadı) |
| Proje | Ambarcı — Yapay Zekâ Destekli Saha Stok Asistanı |

## Proje bağlantıları

| | |
| --- | --- |
| GitHub deposu | [github.com/yunopo42/AmbarciApp](https://github.com/yunopo42/AmbarciApp) |
| 1. hafta sonu kod durumu (etiket) | [hafta-1](https://github.com/yunopo42/AmbarciApp/tree/hafta-1) |
| Commit geçmişi | [github.com/yunopo42/AmbarciApp/commits/main](https://github.com/yunopo42/AmbarciApp/commits/main) |
| Issue'lar ve PR'lar | [Issues](https://github.com/yunopo42/AmbarciApp/issues?q=is%3Aissue) · [Pull requests](https://github.com/yunopo42/AmbarciApp/pulls?q=is%3Apr) |
| Web paneli (Vercel) | [ambarci-app.vercel.app](https://ambarci-app.vercel.app) |
| API sağlık kontrolü (Render) | [ambarci-api.onrender.com/v1/health](https://ambarci-api.onrender.com/v1/health) |
| 8 haftalık plan | [docs/plan.md](https://github.com/yunopo42/AmbarciApp/blob/main/docs/plan.md) |
| Rapor ve belgeler (Drive) | [Proje klasörü](https://drive.google.com/drive/folders/1ON1zxHnz4k0fIdIXaCvwqlk0g4buD0_n?usp=sharing) |

API ücretsiz planda çalıştığı için 15 dakika istek almazsa uyur; ilk açılışta yaklaşık bir dakika beklemek gerekebilir.

## 1. Özet

Bu haftanın hedefi araştırmayı tamamlamak ve geliştirme iskeletini kurmaktı. Araştırma ve proje önerisi raporu danışmana gönderildi; pnpm monorepo, CI, web (Vercel) ve API (Render) yayını ile telefonda çalışan Expo development build tamamlandı ve Türkçe ses tanıma 10 cümleyle denendi. Supabase projesi, README ve milestone'lar, Claude araç çağırma denemesi ve demo verisi 2. haftanın başına devredildi. Bu haftanın kapısı yoktu.

## 2. Bu hafta yapılanlar

| İş | Durum | Not |
| --- | --- | --- |
| Araştırma raporu ve proje önerisi, danışmana sunum | Tamamlandı | Sunum olarak gönderildi: [hafta-01-arastirma-ve-oneri.md](https://github.com/yunopo42/AmbarciApp/blob/main/docs/raporlar/hafta-01-arastirma-ve-oneri.md) |
| GitHub reposu ve 1. hafta issue'ları | Tamamlandı | #1, #3, #5, #7 |
| README ve 8 milestone | Ertelendi | 2. haftanın başına devredildi |
| pnpm monorepo: mobile, web, api, shared | Tamamlandı | [PR #2](https://github.com/yunopo42/AmbarciApp/pull/2) |
| GitHub Actions | Tamamlandı | Her push'ta lint, typecheck, test, build |
| `.env.example`; web Vercel'de, API `/v1/health` Render'da yayında | Tamamlandı | [PR #4](https://github.com/yunopo42/AmbarciApp/pull/4) |
| Supabase projesi | Ertelendi | 2. haftanın başına devredildi |
| Expo development build telefonda; Türkçe ses tanıma denemesi | Tamamlandı | [PR #6](https://github.com/yunopo42/AmbarciApp/pull/6), [#8](https://github.com/yunopo42/AmbarciApp/pull/8); 10 cümlenin 8'i doğru tanındı |
| Claude API anahtarı, harcama limiti, 20 mesajla araç çağırma denemesi | Ertelendi | 2. haftanın başına devredildi |
| Demo verisi: ABC Elektrik, 15–20 ürün, 2 depo, 1 araç deposu | Ertelendi | 2. haftanın başına devredildi |

## 3. Teknik açıklama

### 3.1 Monorepo ve CI

**Ne yapıldı:** pnpm workspace içinde `apps/web` (Next.js 16, Tailwind), `apps/api` (NestJS 12), `apps/mobile` (Expo SDK 57, Expo Router) ve `packages/shared` (Zod) kuruldu. Ortak strict TypeScript ayarı, ESLint ve kök komutlar (dev, build, lint, typecheck, test) eklendi; API'deki `GET /v1/health` uç noktası Vitest ve Supertest ile test ediliyor. GitHub Actions her push'ta kurulum, lint, typecheck, test ve build adımlarını çalıştırıyor.

**Neden önemli:** Mobil, web ve API aynı Zod şemalarını paylaşacak; bir alan değiştiğinde üç taraf da derleme anında hata verir. CI, ana dala bozuk kod girmesini engelleyen ilk kontrol.

**Ne öğrenildi:** Ortak paket, onu kullanan uygulamalardan önce derlenmeli; pnpm'in `--filter "<paket>..."` seçicisi bir paketi bağımlılıklarıyla birlikte doğru sırada derliyor. Araçların en yeni sürümleri her zaman birlikte çalışmıyor: eklenti uyumu nedeniyle TypeScript 7 yerine 6.0, ESLint 10 yerine 9 seçildi.

### 3.2 Web ve API yayını

**Ne yapıldı:** API, kökteki `render.yaml` ile Render'ın ücretsiz planında (Frankfurt) yayınlandı; sağlık kontrolü `/v1/health`. Web paneli Vercel'de `apps/web` kök dizininden derleniyor. Web ana sayfasındaki durum kartı API'nin sağlık cevabını gösteriyor; API'de CORS yalnızca `WEB_ORIGIN` ortam değişkenindeki adrese açık.

**Neden önemli:** Monorepo yapısının gerçek platformlarda derlendiği erken doğrulandı; ileride yayın sorunları özellik geliştirmeyle karışmayacak. CORS kısıtı, API'nin tarayıcıdan yalnızca kendi panelimizce çağrılmasını sağlıyor.

**Ne öğrenildi:** Render'da kök dizin verilirse dışındaki dosyalar build'e alınmıyor; bu yüzden API depo kökünden derleniyor ve build filtresiyle yalnızca API'yi etkileyen değişikliklerde yeniden yayınlanıyor. `NEXT_PUBLIC_` önekli değişkenler build sırasında sayfaya gömüldüğü için değerleri değişince yeniden deploy gerekiyor. Render belgesine göre ücretsiz servis 15 dakika istek almazsa uyuyor ve ilk istekte yaklaşık bir dakikada uyanıyor.

### 3.3 Mobil development build ve Türkçe ses tanıma denemesi

**Ne yapıldı:** Mobil uygulamaya `expo-dev-client` ve `expo-speech-recognition` eklendi; EAS Build'de `development` profiliyle Android APK alındı ve telefona kuruldu. Geçici `/speech-test` ekranı `tr-TR` diliyle tanıma yapıyor. Ürün adı, miktar ve depo içeren 10 stok cümlesiyle deneme yapıldı; üç cümlede ürün kodu rakam rakam söylendi.

**Neden önemli:** Saha çalışanının asistana işlemi sesle söylemesi projenin temel giriş yollarından biri. Tanımanın hangi bilgide güvenilir olduğunu erken görmek, asistanın ürünü nasıl bulacağını belirliyor.

**Ne öğrenildi:** Ürün adı, miktar ve depo büyük ölçüde doğru tanındı; rakam rakam söylenen kodlar ise tutarsız yazıldı ve kısa birim kelimeleri karışabildi ("kutu" → "kota"). Bu yüzden şu karar alındı: ürün eşleştirme isim benzerliğiyle yapılacak (tanınan ürün adı katalogda `pg_trgm` benzerlik aramasıyla aranacak, birden fazla yakın aday varsa kullanıcıya sorulacak); ürün kodu sesle alınmayacak, kod gerektiğinde barkod okutulacak.

## 4. Görseller

| Ölçüm | Sonuç |
| --- | --- |
| Doğru tanınan cümle | 8 / 10 |
| Kodu doğru tanınan cümle | 1 / 3 |
| Miktarı doğru tanınan cümle | 9 / 9 (bir cümlede miktar yok) |

*Türkçe ses tanıma denemesinin özeti: Xiaomi 15 (Android 16), sessiz oda, Wi-Fi, tek konuşmacı, 10 cümle; tanıma telefonun varsayılan ses tanıma servisiyle (`expo-speech-recognition`, `tr-TR`) yapıldı. Ayrıntı: [eval/ses-denemesi.md](https://github.com/yunopo42/AmbarciApp/blob/main/eval/ses-denemesi.md).*

| Söylenen kod | Tanınan |
| --- | --- |
| altı iki sıfır dört (6204) | 6 2 0 4 |
| yedi sıfır bir beş (7015) | 7.05 |
| sıfır sıfır dört yedi (0047) | 04 7 |

*Rakam rakam söylenen üç kod üç farklı biçimde yazıldı; ürün kodunun barkodla alınması kararı bu sonuca dayanıyor.*

## 5. Tamamlanan görevler

- [x] Araştırma ve proje önerisi raporu danışmana gönderildi — [63ceab6](https://github.com/yunopo42/AmbarciApp/commit/63ceab6), [38eb87b](https://github.com/yunopo42/AmbarciApp/commit/38eb87b)
- [x] pnpm monorepo iskeleti ve CI — [#1](https://github.com/yunopo42/AmbarciApp/issues/1), [ff8e41d](https://github.com/yunopo42/AmbarciApp/commit/ff8e41d)
- [x] Web ve API yayını (Vercel + Render) — [#3](https://github.com/yunopo42/AmbarciApp/issues/3), [d72aed7](https://github.com/yunopo42/AmbarciApp/commit/d72aed7)
- [x] Expo development build ve Türkçe ses tanıma denemesi — [#5](https://github.com/yunopo42/AmbarciApp/issues/5), [c9b08c0](https://github.com/yunopo42/AmbarciApp/commit/c9b08c0), [d62c01b](https://github.com/yunopo42/AmbarciApp/commit/d62c01b)
- [x] EAS build pnpm kurulum hatası — [#7](https://github.com/yunopo42/AmbarciApp/issues/7), [8814141](https://github.com/yunopo42/AmbarciApp/commit/8814141)
- [ ] Supabase projesi — ertelendi, nedeni: 1. hafta işleri 17 Ekim'e uzadı; 2. haftanın başına devredildi
- [ ] README ve 8 milestone — ertelendi, nedeni: 1. hafta işleri 17 Ekim'e uzadı; 2. haftanın başına devredildi
- [ ] Claude API anahtarı, harcama limiti ve 20 mesajla araç çağırma denemesi — ertelendi, nedeni: 1. hafta işleri 17 Ekim'e uzadı; 2. haftanın başına devredildi
- [ ] Demo verisi (ABC Elektrik) — ertelendi, nedeni: 1. hafta işleri 17 Ekim'e uzadı; 2. haftanın başına devredildi

## 6. Karşılaşılan sorunlar ve çözümler

| Sorun | Çözüm / durum |
| --- | --- |
| EAS Build, pnpm 12'yi Corepack ile kuramadı ("Failed to install pnpm") | pnpm sürümü `eas.json` içinde 12.10.1 olarak sabitlendi; build başarılı (#7) |
| Proje klasörünün adındaki "İ" harfi Windows'ta ESLint'in yok sayma kurallarını bozdu; lint build çıktılarını da taradı | Lint komutları kaynak klasörlerini doğrudan hedefleyecek şekilde değiştirildi |
| TypeScript 7 ve ESLint 10, kullanılan eklentilerle uyumlu değil | TypeScript 6.0 ve ESLint 9 kullanıldı; eklentiler güncellenince yükseltilecek |
| pnpm, 24 saatten yeni paket sürümlerini reddediyor; Expo aynı gün yeni yama yayınladı | Bir önceki yama sürümü kullanıldı; güvenlik kuralına istisna eklenmedi |
| Bilgisayardaki sanal ağ bağdaştırıcıları yüzünden Metro yanlış adresi seçebiliyor | Metro, `REACT_NATIVE_PACKAGER_HOSTNAME` ile Wi-Fi adresinde başlatıldı; adım belgeye eklendi |
| Android emülatörüne development build kurulamadı; `adb` hata nedeni göstermedi | Deneme fiziksel telefonda yapıldı; emülatör sorunu açık |

## 7. Sonraki hafta planı

**Hafta 2 — Veritabanı ve kimlik (12–22 Ekim).** Kapı: iki şirket arasında veri sızıntısı yok (22 Ekim). Plan değişikliği: 2. haftanın kapısı 22 Ekim'e alındı, 3. hafta 23–25 Ekim'e sıkıştırıldı; 4. haftanın kapısı (telefonda canlı stok sorgusu) değişmedi.

1. Önceki haftadan devredenler: Supabase projesi, README ve 8 milestone, Claude API anahtarı ve harcama limiti ile 20 mesajlık araç çağırma denemesi, demo verisi.
2. Drizzle şeması ve migration'lar.
3. Supabase Auth ile web ve mobilde giriş/çıkış; backend'de JWT doğrulama ve yetki guard'ları.
4. Şirket oluşturma, davet kodu, rol ve depo yetkisi.
5. RLS politikaları ve iki şirketli izolasyon testi (kapı).
6. Ekran tasarımları ve `docs/tasarim.md`.

## 8. Kaynaklar

- [Ambarcı — 1. Hafta Raporu: Araştırma ve Proje Önerisi](https://github.com/yunopo42/AmbarciApp/blob/main/docs/raporlar/hafta-01-arastirma-ve-oneri.md)
- [Ambarcı — Teknik araştırma](https://github.com/yunopo42/AmbarciApp/blob/main/docs/teknik-arastirma.md)
- [Render — Blueprint YAML Reference](https://render.com/docs/blueprint-spec)
- [Render — Monorepo Support](https://render.com/docs/monorepo-support)
- [Vercel — Using Monorepos](https://vercel.com/docs/monorepos)
- [Expo — Work with monorepos](https://docs.expo.dev/guides/monorepos/)
- [Expo — eas.json reference](https://docs.expo.dev/eas/json/)
- [expo-speech-recognition](https://github.com/jamsch/expo-speech-recognition)
