# Ambarcı

Ambarcı, saha çalışanlarının mobil uygulamadaki yapay zekâ asistanıyla yazarak veya konuşarak stok işlemi yapacağı, yöneticilerin ise web panelinden yöneteceği çok şirketli bir stok takip sistemidir. Asistan işlemi yalnızca önerecek; stok, kullanıcı öneriyi onayladığında değişecek. Proje bir bitirme projesidir (Senior Design Project) ve [8 haftalık plana](docs/plan.md) göre geliştirilmektedir.

**Durum:** Geliştirme aşamasında. Şu an monorepo iskeleti, CI, web ve API yayını ile mobil development build hazırdır. Veritabanı, kimlik doğrulama, stok işlemleri ve asistan henüz yoktur.

## Canlı bağlantılar

| | |
| --- | --- |
| Web paneli (Vercel) | [ambarci-app.vercel.app](https://ambarci-app.vercel.app) |
| API sağlık kontrolü (Render) | [ambarci-api.onrender.com/v1/health](https://ambarci-api.onrender.com/v1/health) |
| API belgesi (Swagger) | [ambarci-api.onrender.com/docs](https://ambarci-api.onrender.com/docs) |

Web panelinde şimdilik yalnızca API durumunu gösteren bir kart vardır. API ücretsiz planda çalıştığı için 15 dakika istek almazsa uyur; ilk istekte yaklaşık bir dakika beklemek gerekebilir.

## Mimari özet

Hedeflenen yapıda mobil uygulama ve web paneli aynı REST API'yi (`/v1`) kullanacak; API veriyi Supabase üzerindeki PostgreSQL'de tutacak ve asistan için Claude API'yi çağıracak. İstek ve cevap şemaları `packages/shared` içindeki Zod şemalarından türetilir; API ve istemciler aynı tipleri kullanır.

```text
Mobil (Expo) ──┐
               ├── REST /v1 ──> API (NestJS) ──> PostgreSQL (Supabase)
Web (Next.js) ─┘                    └──────────> Claude API
```

Tasarımın temel kuralları:

- Asistan yalnızca okuma ve öneri araçlarını çağırabilecek; stok yazan bir aracı olmayacak. Öneri, onay bekleyen bir işlem kaydı oluşturacak. *(Henüz kodlanmadı.)*
- Stok yalnızca kullanıcı onayladığında, onay uç noktasında tek bir veritabanı transaction'ıyla değişecek. *(Henüz kodlanmadı.)*
- Şirket verisi birbirinden ayrılır. Veritabanında RLS politikaları ve bileşik yabancı anahtarlar var; API sorgularındaki şirket filtresi uç noktalarla birlikte gelecek. Ayrıntı: [docs/veritabani.md](docs/veritabani.md).

| Katman | Teknoloji | Durum |
| --- | --- | --- |
| Mobil | Expo, Expo Router | İskelet, development build, ses tanıma deneme ekranı |
| Web paneli | Next.js, Tailwind | İskelet, API durum kartı; Vercel'de yayında |
| API | NestJS, REST `/v1`, Swagger | `GET /v1/health`, Supabase JWT doğrulaması, `GET /v1/auth/me`; Render'da yayında |
| Ortak şemalar | Zod | Sağlık, hata ve kullanıcı şemaları |
| Veritabanı | PostgreSQL (Supabase), Drizzle ORM | Şirket, depo, katalog ve stok tabloları (10 tablo), RLS politikaları ve iki şirketli izolasyon testi |
| Kimlik doğrulama | Supabase Auth | Web ve mobilde e-posta + şifreyle giriş/çıkış; API token'ı doğrular. Hesap açma davetle gelecek (#18) |
| Asistan | Claude API | Planlandı (4. hafta) |

Ayrıntılı mimari ve teknoloji seçimlerinin gerekçeleri: [docs/teknik-arastirma.md](docs/teknik-arastirma.md).

## Klasör yapısı

```text
apps/
  api/             NestJS API
  web/             Next.js yönetim paneli
  mobile/          Expo saha uygulaması
packages/
  shared/          Ortak Zod şemaları ve tipler
  db/              Drizzle şeması, migration'lar ve RLS testleri
  api-client/      OpenAPI'den üretilecek istemci (henüz boş)
eval/              Deneme ve değerlendirme sonuçları
docs/
  plan.md          8 haftalık plan
  raporlar/        Haftalık raporlar
  kararlar/        Mimari karar kayıtları, ADR (henüz boş)
  yayin.md         Render ve Vercel yayın adımları
  mobil-development-build.md
.github/workflows/ CI: lint, typecheck, test, build
render.yaml        Render (API) yapılandırması
```

## Yerelde çalıştırma

Gerekenler: Node.js 24 (sürüm `.nvmrc` dosyasında) ve Corepack. pnpm sürümü kökteki `package.json` dosyasındaki `packageManager` alanından okunur.

1. pnpm'i Corepack ile etkinleştir ve bağımlılıkları kur:

   ```bash
   corepack enable
   ```

   ```bash
   pnpm install
   ```

2. Ortam değişkenlerini hazırla. Depo kökünde `.env.example` dosyasını `.env` adıyla kopyala:

   ```bash
   cp .env.example .env
   ```

   API depo kökündeki `.env` dosyasını okur. Web paneli bu dosyadan yalnızca `NEXT_PUBLIC_` ile başlayan değişkenleri alır. Uygulamalar şu an yalnızca `NEXT_PUBLIC_API_URL` ve `WEB_ORIGIN` değişkenlerini kullanıyor; örnek dosyadaki yerel değerler olduğu gibi çalışır. `DATABASE_URL` yalnızca veritabanı komutlarında kullanılıyor (aşağıda). Supabase ve Claude değişkenleri ilgili işler bitince uygulamalarda kullanılmaya başlanacak. `.env` dosyası commit edilmez.

3. Geliştirme sunucularını başlat:

   ```bash
   pnpm dev
   ```

   Bu komut önce `packages/shared` paketini derler, sonra onu izleme modunda tutarak API, web ve mobil (Metro) geliştirme sunucularını birlikte başlatır:

   | Uygulama | Adres |
   | --- | --- |
   | Web paneli | http://localhost:3000 |
   | API | http://localhost:3001/v1/health |
   | Swagger | http://localhost:3001/docs |

   Tek bir uygulamayı başlatmak için önce ortak paketi derle, sonra uygulamayı filtreyle çalıştır:

   ```bash
   pnpm build:shared
   ```

   ```bash
   pnpm --filter @ambarci/api dev
   ```

   Web için `@ambarci/web`, mobil için `@ambarci/mobile` kullanılır.

### Diğer komutlar

Hepsi depo kökünden çalıştırılır ve CI'da da aynı sırayla çalışır.

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm build
```

### Veritabanı komutları

`.env` içindeki `DATABASE_URL` ile çalışır.

| Komut | Ne yapar |
| --- | --- |
| `pnpm db:check` | Veritabanına bağlanmayı dener |
| `pnpm db:generate` | `packages/db/schema` içindeki şemadan yeni migration üretir |
| `pnpm db:migrate` | Uygulanmamış migration'ları veritabanına uygular |
| `pnpm db:seed` | Demo verisini (ABC Elektrik, Kuzey Tesisat) yükler; tekrar çalıştırmak kayıt çoğaltmaz |
| `pnpm db:test` | İzolasyon ve seed testlerini gerçek veritabanında çalıştırır; her test kendi verisini geri alır |

Demo şirketine giriş yapabilmek için önce Supabase panelinde (**Authentication → Users**) kendine bir kullanıcı oluştur, e-postasını `.env` dosyasındaki `SEED_ADMIN_EMAIL` satırına yaz ve `pnpm db:seed` komutunu yeniden çalıştır. Bu kullanıcı ABC Elektrik'e yönetici olarak bağlanır.

### Mobil uygulama

Mobil uygulama yerel modül kullandığı için Expo Go'da çalışmaz; telefona kurulan bir development build gerekir. Build alma, telefona kurma ve Metro'ya bağlanma adımları: [docs/mobil-development-build.md](docs/mobil-development-build.md).

Web ve mobilde giriş yapabilmek için `.env` dosyasında `NEXT_PUBLIC_SUPABASE_*` ve `EXPO_PUBLIC_SUPABASE_*` değerleri dolu olmalı (`.env.example`) ve Supabase Auth'ta bir kullanıcı bulunmalı. Kullanıcıyı demo şirketine bağlamak için: [Veritabanı komutları](#veritabanı-komutları).

## Yayın

API Render'da, web paneli Vercel'de `main` dalından yayınlanır. Ortam değişkenlerinin hangi servise girildiği ve yayın adımları: [docs/yayin.md](docs/yayin.md).

## Haftalık raporlar

Haftalık ilerleme raporları [docs/raporlar/](docs/raporlar/) klasöründedir. Her hafta bir GitHub milestone'u, her görev bir issue olarak takip edilir: [milestone'lar](https://github.com/yunopo42/AmbarciApp/milestones), [issue'lar](https://github.com/yunopo42/AmbarciApp/issues).
