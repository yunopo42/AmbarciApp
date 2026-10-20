# ADR-002: Supabase JWT doğrulaması için `jose`

- **Durum:** Kabul edildi (20 Ekim 2026)
- **İlgili iş:** #17

## Bağlam

Web paneli ve mobil uygulama Supabase Auth ile oturum açar ve API'ye `Authorization: Bearer <token>` gönderir. API her istekte bu token'ın Supabase projemiz tarafından imzalandığını, süresinin dolmadığını ve oturum açmış bir kullanıcıya ait olduğunu doğrulamalıdır.

Projemiz token'ları asimetrik anahtarla (ES256) imzalar ve açık anahtarları `https://<proje>.supabase.co/auth/v1/.well-known/jwks.json` adresinde yayınlar. Böylece doğrulama, Supabase'e her istekte sormadan API içinde yapılabilir. Supabase projesi İrlanda'da, API Frankfurt'ta olduğu için istek başına ağ çağrısı yapmamak ayrıca önemlidir.

## Seçenekler

1. **`jose`**: Bağımlılığı olmayan JWT/JWKS kütüphanesi. JWKS'i indirip önbellekte tutar, bilinmeyen bir anahtar kimliği (`kid`) gelince yeniden indirir. İzin verilen algoritmalar, issuer ve audience tek çağrıda kontrol edilir.
2. **`supabase.auth.getUser(token)`**: Her istekte Supabase Auth'a ağ çağrısı yapar; gecikme ve Supabase'e bağımlılık artar.
3. **`@supabase/supabase-js` ile yerel doğrulama**: Yalnızca token doğrulamak için bütün istemci kütüphanesini API'ye ekler.
4. **`@nestjs/passport` + `passport-jwt` + `jwks-rsa`**: Nest'te yaygın, ancak üç ek paket ve ek soyutlama katmanı getirir.
5. **Node `crypto` ile elle doğrulama**: Yeni bağımlılık yok, ama imza, algoritma, süre ve anahtar yenileme kontrollerini elle yazmak güvenlik açısından riskli ve uzun.

## Karar

`jose` kullanılır. Doğrulama `apps/api/src/modules/auth/` altında `AccessTokenVerifier` portunun `SupabaseJwtVerifier` uygulamasındadır. Kurallar:

- Yalnızca `ES256` ve `RS256` kabul edilir; ortak sırla (`HS256`) imzalanmış token'lar ve `none` reddedilir.
- Issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated` olmalıdır. Böylece başka projenin token'ı ve anon anahtarı reddedilir.
- Uygulama genelindeki `AuthGuard` her uç noktada oturum ister; açık uç noktalar `@Public()` ile işaretlenir (şimdilik yalnızca `/v1/health`).

## Sonuçlar

- API açılışta `SUPABASE_URL` ister; tanımlı değilse açılmaz. Bu değişken API'nin yayına alınmasından önce Render'a eklenmelidir.
- Supabase projesi eski ortak JWT sırrına (HS256) geri dönerse doğrulama çalışmaz; bu bilinçli bir kısıttır.
- Anahtar yenilemede (rotation) yeni anahtar JWKS'te yayınlandığında `jose` onu kendisi indirir; kod değişikliği gerekmez.
- Testler ağa çıkmaz: test içinde üretilen ES256 anahtarıyla imzalanmış token'lar yerel JWKS ile doğrulanır.
- Kimlik sağlayıcı değişirse yalnızca `AccessTokenVerifier` uygulaması değişir.
