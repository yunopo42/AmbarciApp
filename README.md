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

Tasarımın temel kuralları (henüz kodlanmadı):

- Asistan yalnızca okuma ve öneri araçlarını çağırabilecek; stok yazan bir aracı olmayacak. Öneri, onay bekleyen bir işlem kaydı oluşturacak.
- Stok yalnızca kullanıcı onayladığında, onay uç noktasında tek bir veritabanı transaction'ıyla değişecek.
- Her sorgu şirket kimliğiyle sınırlanacak; veritabanında ayrıca RLS politikaları olacak.

| Katman | Teknoloji | Durum |
| --- | --- | --- |
| Mobil | Expo, Expo Router | İskelet, development build, ses tanıma deneme ekranı |
| Web paneli | Next.js, Tailwind | İskelet, API durum kartı; Vercel'de yayında |
| API | NestJS, REST `/v1`, Swagger | Yalnızca `GET /v1/health`; Render'da yayında |
| Ortak şemalar | Zod | Sağlık cevabı şeması |
| Veritabanı | PostgreSQL (Supabase), Drizzle ORM | Planlandı (2. hafta) |
| Kimlik doğrulama | Supabase Auth | Planlandı (2. hafta) |
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
  db/              Drizzle şeması ve migration'lar (henüz boş)
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

   API depo kökündeki `.env` dosyasını okur. Web paneli bu dosyadan yalnızca `NEXT_PUBLIC_` ile başlayan değişkenleri alır. Şu an yalnızca `NEXT_PUBLIC_API_URL` ve `WEB_ORIGIN` kullanılıyor; örnek dosyadaki yerel değerler olduğu gibi çalışır. Supabase ve Claude değişkenleri ilgili işler bitince kullanılmaya başlanacak. `.env` dosyası commit edilmez.

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

### Mobil uygulama

Mobil uygulama yerel modül kullandığı için Expo Go'da çalışmaz; telefona kurulan bir development build gerekir. Build alma, telefona kurma ve Metro'ya bağlanma adımları: [docs/mobil-development-build.md](docs/mobil-development-build.md).

## Yayın

API Render'da, web paneli Vercel'de `main` dalından yayınlanır. Ortam değişkenlerinin hangi servise girildiği ve yayın adımları: [docs/yayin.md](docs/yayin.md).

## Haftalık raporlar

Haftalık ilerleme raporları [docs/raporlar/](docs/raporlar/) klasöründedir. Her hafta bir GitHub milestone'u, her görev bir issue olarak takip edilir: [milestone'lar](https://github.com/yunopo42/AmbarciApp/milestones), [issue'lar](https://github.com/yunopo42/AmbarciApp/issues).
