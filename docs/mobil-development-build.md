# Mobil: development build (Android)

Uygulama `expo-speech-recognition` gibi yerel modüller kullandığı için Expo Go'da çalışmaz;
kendi **development build**'imiz gerekir. Build bulutta (EAS Build) alınır, telefona APK olarak kurulur.
Bundan sonra günlük geliştirmede yalnızca bilgisayardaki Metro sunucusu çalışır; yeni build ancak
yerel bir modül eklendiğinde ya da `app.json` içindeki yerel ayarlar değiştiğinde gerekir.

Ayarlar `apps/mobile/eas.json` (profil: `development`) ve `apps/mobile/app.json` dosyalarındadır.

## 1. Bir kereye mahsus hazırlık

Komutları depo kökünden değil, `apps/mobile` klasöründen çalıştır.

```bash
npm install -g eas-cli
```

```bash
eas login
```

Expo hesabın yoksa önce [expo.dev](https://expo.dev) üzerinden ücretsiz hesap aç.

```bash
eas init
```

`eas init` EAS'ta `ambarci` projesini oluşturur ve kimliğini `app.json` dosyasına (`extra.eas.projectId`) yazar.
Bu değişiklik commit edilmelidir.

## 2. Build al

```bash
eas build --profile development --platform android
```

- İlk build'de "Generate a new Android Keystore?" sorusuna **Yes** de; imza anahtarını EAS saklar.
- Build bulutta kuyruğa girer; ücretsiz planda sıra beklemek gerekebilir. Terminali kapatabilirsin,
  durum [expo.dev](https://expo.dev) üzerindeki proje sayfasında da görünür.
- Ücretsiz planda aylık build sayısı sınırlıdır; gereksiz build alma.

## 3. Telefona kur

1. Build bitince terminalde bir QR kod ve bağlantı çıkar. Telefonun kamerasıyla QR kodu okut
   (ya da bağlantıyı telefonda aç) ve **Install** ile APK dosyasını indir.
2. Android "bu kaynaktan uygulama yüklemeye izin ver" diye sorarsa tarayıcı için izin ver.
3. İndirilen dosyayı açıp kur. Uygulama listesinde **Ambarcı** görünmeli.

## 4. Uygulamayı çalıştır

1. Telefon ve bilgisayar aynı Wi-Fi ağında olsun.
2. Bilgisayarda depo kökünden Metro'yu başlat:

   ```bash
   pnpm --filter @ambarci/mobile dev
   ```

   Windows Güvenlik Duvarı Node.js için izin sorarsa **özel ağlar** için izin ver.
3. Telefonda Ambarcı'yı aç. Açılış ekranında yerel ağdaki geliştirme sunucusu listelenir; üzerine dokun.
   Listede yoksa terminaldeki QR kodu telefonun kamerasıyla okut.
4. Ana ekran açılınca **Ses tanıma denemesi** bağlantısına gir ve `eval/ses-denemesi.md` dosyasındaki
   cümleleri sırayla dene.

Aynı ağda bağlanamıyorsan (okul ağı, misafir ağı gibi) tünel kullan:

```bash
pnpm --filter @ambarci/mobile exec expo start --tunnel
```

## Ses tanıma için telefonda gerekenler

- İlk kullanımda Android mikrofon izni sorar. Bu pencerenin metnini Android kendisi üretir ve telefonun
  dilinde gösterir; `app.json` içindeki Türkçe izin metinleri iOS içindir.
- Android 13 ve üzerinde **Speech Recognition & Synthesis** (Google) uygulaması, Android 12 ve altında
  **Google** uygulaması kurulu ve etkin olmalı. Deneme ekranı "ses tanıma servisi bulunamadı" derse
  buna bak.
- Varsayılan ayarda tanıma, telefonun ses tanıma servisine bırakılır ve servis internet kullanabilir.
  Denemede internet durumunu tabloya not et.

## Sorun giderme

| Belirti | Bakılacak yer |
| --- | --- |
| Build "Install dependencies" adımında duruyor | Build logundaki pnpm ve Node sürümüne bak. `eas.json` Node 24 ve Corepack ister; pnpm sürümü kökteki `package.json` (`packageManager`) dosyasından okunur. |
| Uygulama açılıyor ama sunucuyu bulamıyor | Aynı Wi-Fi, güvenlik duvarı izni; olmazsa `--tunnel`. |
| "Mikrofon izni verilmedi" | Telefon ayarları > Uygulamalar > Ambarcı > İzinler > Mikrofon. |
| Hata: `language-not-supported` | Telefonun ses tanıma servisinde Türkçe yok; Google uygulamasını güncelle. |
| Hata: `network` | İnternet bağlantısını kontrol et. |
