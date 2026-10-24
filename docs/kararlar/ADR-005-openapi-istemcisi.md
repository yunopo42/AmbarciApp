# ADR-005: OpenAPI istemcisi: `openapi-typescript` + `openapi-fetch` + `openapi-react-query`

- **Durum:** Kabul edildi (22 Ekim 2026); uygulama #35 (24 Ekim 2026). Uygulamada taslaktan ayrılan üç nokta "Karar" bölümünde işaretli.
- **İlgili iş:** #35

## Bağlam

Teknik araştırma (`docs/teknik-arastirma.md`, 1. hafta) sunucu durumu için TanStack Query ile OpenAPI'den üretilen istemciyi (`openapi-typescript`, `openapi-fetch`) seçti. Bu ADR, kurulumdan önce o seçimi güncel durumla doğrular.

- API'nin OpenAPI belgesi `@nestjs/swagger` ile DTO sınıflarından üretiliyor (`/docs`).
- Web'de elle yazılmış bir `apiRequest` fonksiyonu var; yollar ve tipler elle eşleniyor. Mobilde henüz API çağrısı yok.
- Depo TypeScript 6.0 kullanıyor.

## Seçenekler

1. **`openapi-typescript` 7.13 + `openapi-fetch` 0.17 + `openapi-react-query` 0.5.**
   - Üretilen tek şey bir tip dosyasıdır. Çalışma zamanında `fetch` üzerine ince bir katman kalır.
   - Okunacak ve savunulacak kod az.
   - Eksi: `openapi-typescript` peer bağımlılık olarak TypeScript 5 istiyor. 21 Ekim'de TypeScript 6.0.3 ile ayrı bir klasörde denendi; tip üretimi sorunsuz çalıştı. Araç yalnızca geliştirmede çalışır, uygulama paketine girmez.
2. **`@hey-api/openapi-ts` 0.99.** TypeScript 6'yı resmen destekliyor; SDK fonksiyonları ve TanStack Query seçenekleri üretiyor.
   - Eksi: 1.0 öncesi, sürümler arası kırıcı değişiklik sık. Çok daha fazla üretilmiş kod çıkıyor.
3. **`orval` 8.** React Query hook'ları üretiyor. Eksi: çok sayıda üretilmiş dosya; ek peer bağımlılıklar (prettier, typedoc).
4. **Elle yazılmış istemci (bugünkü `apiRequest`).** Bağımlılık yok, ama yollar ve tipler elle senkron tutulur. Proje standartları bunu kabul etmiyor.

## Karar

1. seçenek. Web ve mobilde `@tanstack/react-query` 5 ile birlikte.

- **`packages/api-client`:**
  - `openapi.json`: API'den üretilen belge (commit edilir).
  - `src/schema.ts`: belgeden üretilen tipler (commit edilir). Taslakta `schema.d.ts` yazıyordu; `.d.ts` dosyaları derlemede `dist`'e kopyalanmadığı için tipler sıradan bir `.ts` modülünde.
  - `src/index.ts`: `createApiClient({ baseUrl, getAccessToken, organizationId })`. `Authorization` ve `X-Organization-Id` başlıkları tek bir ara katmanda (middleware) eklenir. `describeApiError` hataları tek biçime getirir: API'nin `{ error: { code, message } }` gövdesi, ağ hatası ya da beklenmeyen cevap.
- **Ayrılan nokta 1: TanStack Query sarmalayıcısı pakette değil, her uygulamada.** Taslakta `src/query.ts` vardı. `openapi-react-query` pakete bağımlılık olarak girerse pnpm onu paketin kendi `@tanstack/react-query` kopyasıyla çözer. Uygulamanın `QueryClientProvider`'ı başka bir kopyadan geldiği için sorgular istemciyi bulamaz. Bu yüzden paket yalnızca `openapi-fetch` istemcisini ve tipleri taşır; `createQueryHooks(client)` web'de `apps/web/lib/api-client.ts` içinde, mobilde de kendi dosyasında çağrılır.
- **Ayrılan nokta 2: aktif şirket başlığı OpenAPI'de güvenlik şeması.** `X-Organization-Id` her uçta zorunlu başlık parametresi olarak belgelenseydi, üretilen tipler onu her çağrıda elle istemeyi zorunlu kılardı ve "tek yerde ekleme" mümkün olmazdı. Başlık `apiKey` türünde bir güvenlik şeması olarak tanımlandı (`apps/api/src/app.setup.ts`). Değeri yine API'de üyelikle doğrulanır; Swagger arayüzünde "Authorize" penceresinden bir kez girilir. Onaydaki `Idempotency-Key` ise bilerek zorunlu başlık parametresi kaldı: her onay denemesinde çağıran yeni bir anahtar üretmeli.
- **Şirket başına istemci ve önbellek.** Sorgu anahtarları başlıkları içermez. Tek bir önbellekte, şirket değiştirildiğinde önceki şirketin cevabı yenisinin ekranında görünebilirdi. Web'de aktif şirket için ayrı bir istemci ve ayrı bir `QueryClient` kurulur ve şirket değişince ikisi baştan kurulur (`apps/web/components/api-provider.tsx`).
- **`pnpm gen:api`:** Nest uygulamasını porta bağlamadan ve veritabanına bağlanmadan oluşturur (`apps/api/src/scripts/generate-openapi.ts`). Swagger belgesini `openapi.json`'a yazar, ardından tipleri üretir. Aynı girdiyle iki üretim birebir aynı çıktı verir. CI bu komutu çalıştırır ve dosyalarda fark varsa başarısız olur; API değişip istemci güncellenmezse birleşme engellenir.
- **Ayrılan nokta 3: TypeScript peer uyarısı çıkmadı.** pnpm, `openapi-typescript`'i TypeScript 6.0.3 ile kurdu ve uyarı vermedi. Taslaktaki `peerDependencyRules` ayarına gerek kalmadı.
- **Cevap doğrulaması:** Web eskiden cevapları Zod ile ayrıştırıyordu. Tipli istemciyle cevap tipi derleme anında bilinir; cevaplar kendi API'mizden geldiği için çalışma zamanında yeniden ayrıştırılmaz. İstek gövdesi API'de Zod ile doğrulanmaya devam eder.
- **Kapsam dışı:** sohbetin SSE akışı (4. hafta) bu istemciden geçmez; mobilde `expo/fetch` ile ayrı yazılır.

## Sonuçlar

- Yeni bağımlılıklar:
  - `packages/api-client`: `openapi-fetch`; geliştirmede `openapi-typescript`.
  - `apps/web`: `@tanstack/react-query`, `openapi-react-query`.
- Zincir: Zod şeması (`packages/shared`) → Swagger DTO sınıfı (`implements` ile tipe bağlı) → `openapi.json` → istemci tipleri. DTO'daki Swagger açıklamaları elle yazıldığı için Zod şemasıyla küçük farklar (örneğin uzunluk sınırı) kalabilir. Bunu kapatmak için Zod'dan Swagger üreten bir kütüphane (ör. `nestjs-zod`) ileride ayrı bir ADR ile değerlendirilebilir.
- API'de bir DTO ya da uç değişince `pnpm gen:api` çalıştırılır ve üretilen dosyalar aynı commit'e girer; unutulursa CI hatırlatır.
- Kütüphane değişirse yalnızca `packages/api-client` ile uygulamalardaki sarmalayıcı dosyası değişir.
