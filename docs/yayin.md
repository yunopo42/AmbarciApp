# Yayın: Render (API) ve Vercel (web)

API, Render'ın ücretsiz planında; web paneli Vercel'de çalışır. Ayarların çoğu depodadır:
Render için kökteki `render.yaml`, Vercel için `apps/web/vercel.json`. Panelde yalnızca
aşağıdaki adımlar elle yapılır.

## Hangi değişken nereye

| Servis | Değişken | Değer |
| --- | --- | --- |
| Render (`ambarci-api`) | `WEB_ORIGIN` | Önce `http://localhost:3000`, Vercel adresi belli olunca `https://<proje>.vercel.app` |
| Vercel (web) | `NEXT_PUBLIC_API_URL` | Render'ın verdiği adres, örn. `https://ambarci-api.onrender.com` |
| Vercel (web) | `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

- `PORT` ve `NODE_ENV` değişkenlerini Render kendisi verir; Node sürümü kökteki `.nvmrc` dosyasından okunur.

### Supabase ve Claude değişkenleri

Bu değişkenler şimdilik yalnızca yerel `.env` dosyasındadır; API henüz kullanmıyor. Her biri, onu kullanan iş
`main` dalına birleşince Render'a eklenir. Yerelde veritabanı bağlantısı `pnpm db:check` ile denenir.

| Değişken | Girildiği yer | Asla girilmez | Render'a ne zaman |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yerel `.env`, Render | Vercel, mobil | API veritabanını kullanmaya başlayınca |
| `SUPABASE_URL` | Yerel `.env`, Render | — | API JWT doğrulamaya başlayınca (#17) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yerel `.env`; Render'a yalnızca API kullanacaksa | Vercel, mobil | Gerekirse |
| `SUPABASE_ANON_KEY` | Yerel `.env` (testler) | — | Gerekmez |
| `ANTHROPIC_API_KEY`, `CLAUDE_CHAT_MODEL`, `CLAUDE_DOC_MODEL` | Yerel `.env`, Render | Vercel, mobil | Asistan altyapısıyla (4. hafta) |

- Service role anahtarı RLS'yi atlar; `DATABASE_URL` veritabanına tam erişim verir. İkisi ve Claude anahtarı
  yalnızca backend'de durur. `NEXT_PUBLIC_` ve `EXPO_PUBLIC_` önekli değişkenler web ve mobil paketine gömülür
  ve herkes tarafından okunabilir; bu öneklerle gizli değer tanımlanmaz.
- Render yalnızca IPv4 kullandığı için `DATABASE_URL` olarak Supabase'in **Session pooler** adresi (port 5432)
  girilir; doğrudan bağlantı adresi (`db.<proje>.supabase.co`) IPv6'dır.
- Supabase projesi eu-west-1 (İrlanda), API ise Render'da Frankfurt'tadır; Render'da İrlanda bölgesi yoktur.
  Bu yüzden her veritabanı sorgusuna bölgeler arası gidiş-dönüş süresi eklenir. Proje 20 Ekim kararıyla
  İrlanda'da bırakıldı; gecikme 3. haftadaki transaction testlerinde ölçülecek.
- Web paneli ve mobil uygulama Supabase adresini ve anon anahtarını kendi önekli değişkenleriyle alacak
  (`NEXT_PUBLIC_…`, `EXPO_PUBLIC_…`); bu satırlar giriş/çıkış işiyle (#16) tabloya eklenecek.
- `ENABLE_EXPERIMENTAL_COREPACK=1` olmazsa Vercel, `package.json` içindeki pnpm sürümü yerine kendi seçtiği
  sürümü kullanır ve kurulum bozulabilir.

## Sıra

İki adres birbirine bağlı olduğu için sıra önemlidir: önce API, sonra web, en son API'ye web adresi.

### 0. Hazırlık

1. Bu daldaki değişiklikleri `main` dalına birleştir ve GitHub'a gönder. İki servis de `main` dalını yayınlar.

### 1. Render: API

1. [dashboard.render.com](https://dashboard.render.com) adresinde **New > Blueprint** seç.
2. Depo listesinde Ambarcı deposunun yanındaki **Connect** düğmesine bas. GitHub hesabı bağlı değilse önce onu bağlaman istenir.
3. Blueprint'e bir ad ver (örn. `ambarci`), dal olarak `main` seç. **Blueprint Path** alanını boş bırak (`render.yaml` kökte).
4. Render `WEB_ORIGIN` için değer sorar. Şimdilik `http://localhost:3000` yaz.
5. Oluşturulacak kaynak listesinde tek bir servis görmelisin: `ambarci-api`, Free, Frankfurt. **Deploy Blueprint** düğmesine bas.
6. Deploy bitince servis sayfasının üstündeki adresi kopyala (örn. `https://ambarci-api.onrender.com`).
   Ad başkası tarafından alınmışsa Render sonuna ek getirir; her zaman sayfadaki adresi kullan.
7. Tarayıcıda `<adres>/v1/health` aç. `{"status":"ok"}` görmelisin.

### 2. Vercel: web

1. [vercel.com](https://vercel.com) panelinde **Add New… > Project** seç.
2. **Import Git Repository** bölümünde Ambarcı deposunun yanındaki **Import** düğmesine bas.
3. **Root Directory** satırındaki **Edit** düğmesine bas ve `apps/web` klasörünü seç.
4. Framework olarak **Next.js** seçili gelmeli. Build ve Install komutlarına dokunma; build komutu `apps/web/vercel.json` dosyasından okunur.
5. **Environment Variables** bölümüne iki değişken ekle:
   - `NEXT_PUBLIC_API_URL` = 1. bölümün 6. adımında kopyaladığın Render adresi
   - `ENABLE_EXPERIMENTAL_COREPACK` = `1`
6. **Deploy** düğmesine bas.
7. Deploy bitince projenin üretim adresini kopyala (örn. `https://ambarci.vercel.app`).
   Bu aşamada sayfadaki kart "API'ye ulaşılamadı" der; çünkü API henüz bu adrese izin vermiyor.

### 3. Render: web adresine izin ver

1. Render'da `ambarci-api` servisini aç, soldan **Environment** sekmesine gir.
2. `WEB_ORIGIN` değerini Vercel üretim adresiyle değiştir. Yalnızca `https://alan-adi` kısmı; sonuna yol ekleme.
3. Kaydederken **Save and deploy** seç. Kod değişmediği için yeniden build gerekmez.

### 4. Kontrol

1. Vercel adresini aç. "API durumu" kartında **Çalışıyor (status: ok)** yazmalı.
2. Kart uzun süre "Kontrol ediliyor…" diyorsa bekle: Render'ın ücretsiz servisi 15 dakika istek almazsa uyur ve ilk istekte yaklaşık bir dakikada uyanır.

## Sonradan bilinmesi gerekenler

- `NEXT_PUBLIC_API_URL` build sırasında sayfaya gömülür. Değeri değiştirirsen Vercel'de **Deployments** sayfasından son deploy'u **Redeploy** etmen gerekir.
- `WEB_ORIGIN` tek bir adres kabul eder. Vercel'in her dal için ürettiği önizleme adresleri farklı olduğundan, önizlemelerde kart "API'ye ulaşılamadı" gösterir; bu beklenen davranıştır.
- Render yalnızca API'yi etkileyen dosyalar değişince yeniden yayınlar (`render.yaml` içindeki `buildFilter`). Vercel de yalnızca web'i veya `packages/shared` paketini etkileyen commit'lerde build alır.
- `sync: false` olan değişkenler yalnızca Blueprint ilk oluşturulurken sorulur. Sonradan eklenen gizli değişkenler Render panelinden elle girilir.

## Sorun giderme

| Belirti | Bakılacak yer |
| --- | --- |
| Kart "API'ye ulaşılamadı" | `WEB_ORIGIN` Vercel üretim adresiyle birebir aynı mı (https, sonda yol yok)? `NEXT_PUBLIC_API_URL` doğru mu ve değiştirdikten sonra Redeploy yapıldı mı? |
| Kart "NEXT_PUBLIC_API_URL tanımlı değil" | Değişken Vercel'e eklenmemiş ya da eklendikten sonra yeniden deploy edilmemiş. |
| Vercel kurulumu pnpm hatasıyla duruyor | `ENABLE_EXPERIMENTAL_COREPACK=1` eksik. |
| Render deploy'u "health check" aşamasında kalıyor | Servisin **Logs** sekmesine bak; uygulama açılmadıysa hata orada görünür. `WEB_ORIGIN` geçerli bir adres değilse API açılışta durur. |
