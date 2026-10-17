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
- EAS'in hazır imajındaki pnpm sürümü projeninkinden eski olduğu için pnpm sürümü `eas.json` içinde
  (`"pnpm"`) sabitlenir. Bu değer kökteki `package.json` dosyasındaki `packageManager` sürümüyle aynı
  olmalı; pnpm güncellenirse ikisi birlikte güncellenir. `"corepack": true` ile EAS pnpm 12'yi kuramadı (issue #7).

## 3. Telefona kur

1. Build bitince terminalde bir QR kod ve bağlantı çıkar. Telefonun kamerasıyla QR kodu okut
   (ya da bağlantıyı telefonda aç) ve **Install** ile APK dosyasını indir.
2. Android "bu kaynaktan uygulama yüklemeye izin ver" diye sorarsa tarayıcı için izin ver.
3. İndirilen dosyayı açıp kur. Uygulama listesinde **Ambarcı** görünmeli.

## 4. Uygulamayı çalıştır

1. Telefon ve bilgisayar aynı Wi-Fi ağında olsun.
2. Bilgisayarın Wi-Fi adresini bul: `ipconfig` çıktısında **Wi-Fi** bağdaştırıcısının **IPv4 Address**
   satırı (örn. `192.168.0.10`). Bilgisayarda VirtualBox veya Hyper-V gibi sanal ağ bağdaştırıcıları
   varsa Expo yanlış adresi seçebilir; bu yüzden adresi Metro'ya açıkça ver.
3. Depo kökünden, PowerShell'de Metro'yu başlat (adresi kendi Wi-Fi adresinle değiştir):

   ```powershell
   $env:REACT_NATIVE_PACKAGER_HOSTNAME = "192.168.0.10"
   pnpm --filter @ambarci/mobile dev
   ```

   Windows Güvenlik Duvarı Node.js için izin sorarsa bağlı olduğun ağın türü için izin ver
   (ev Wi-Fi'ı Windows'ta "Genel" ağ olarak görünebilir).
4. Telefonda Ambarcı'yı aç. Açılış ekranında geliştirme sunucusu listelenirse üzerine dokun. Listede yoksa
   adres alanına `http://<Wi-Fi adresi>:8081` yazıp **Connect**'e bas ya da **Scan QR Code** ile
   terminaldeki QR kodu okut.
5. Ana ekran açılınca **Ses tanıma denemesi** bağlantısına gir ve `eval/ses-denemesi.md` dosyasındaki
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
| Build "Failed to install pnpm" ya da "Install dependencies" adımında duruyor | `eas.json` içindeki `pnpm` sürümü kökteki `package.json` (`packageManager`) ile aynı mı? Node sürümü (`node`) 24 mü? |
| Uygulama açılıyor ama sunucuyu bulamıyor | Telefonun tarayıcısında `http://<Wi-Fi adresi>:8081/status` adresini aç. `packager-status:running` görünmüyorsa sorun ağdadır: aynı Wi-Fi mi, güvenlik duvarı Node.js'e izin veriyor mu, Metro `REACT_NATIVE_PACKAGER_HOSTNAME` ile doğru adreste mi? Misafir ağlarında cihazlar birbirini görmeyebilir; o zaman `--tunnel`. |
| "Mikrofon izni verilmedi" | Telefon ayarları > Uygulamalar > Ambarcı > İzinler > Mikrofon. |
| Hata: `language-not-supported` | Telefonun ses tanıma servisinde Türkçe yok; Google uygulamasını güncelle. |
| Hata: `network` | İnternet bağlantısını kontrol et. |
