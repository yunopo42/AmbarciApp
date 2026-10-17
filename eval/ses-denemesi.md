# Türkçe ses tanıma denemesi

Amaç: telefondaki ses tanımanın (`expo-speech-recognition`, `tr-TR`) stok cümlelerini, özellikle
ürün adı, miktar, depo ve rakam rakam söylenen kodları ne kadar doğru yazıya çevirdiğini görmek.
Bu bir ön denemedir; asıl ölçüm 6. haftadaki etiketli veri kümesiyle yapılacak.

## Nasıl yapılır

1. Development build'i telefona kur ve uygulamayı aç (adımlar: `docs/mobil-development-build.md`).
2. Ana ekrandan **Ses tanıma denemesi** bağlantısına gir.
3. Her cümle için **Mikrofonu aç** düğmesine bas, cümleyi normal konuşma hızında bir kez söyle.
4. Ekranda numaralanan metni aşağıdaki tabloda **Tanınan** sütununa aynen yaz.
5. Bir cümleyi tekrar söylemen gerekirse bunu **Not** sütununa yaz; ilk denemenin sonucunu silme.

## Değerlendirme ölçütü

Bir cümle, aşağıdakilerin hepsi anlamı bozmayacak biçimde tanındıysa **doğru** sayılır:

- ürün adı ve teknik ölçüsü (ör. "üç çarpı iki buçuk"),
- miktar ve birim,
- depo adı,
- varsa ürün kodu (bütün rakamlar, doğru sırada).

Rakamların yazıyla ("altı iki sıfır dört") ya da sayıyla ("6204", "6 2 0 4") yazılması fark etmez.
Noktalama, büyük-küçük harf ve ek farkları ("depoya" / "depo'ya") hata sayılmaz.

## Deneme bilgileri

| Alan | Değer |
| --- | --- |
| Tarih | 2026-10-17 |
| Telefon modeli |Xiaomi 15|
| Android sürümü |16|
| Uygulama sürümü / build | 0.1.0, EAS development build `35c23890` (17.10.2026) |
| Ortam (sessiz oda, depo, araç içi…) | sessiz odada denendi. |
| İnternet (Wi-Fi, mobil veri, kapalı) | Wi-Fi |

## Cümleler ve sonuçlar

| # | Söylenen | Tanınan | Doğru mu (E/H) | Not |
| --- | --- | --- | --- | --- |
| 1 | Merkez depoya yüz metre üç çarpı iki buçuk NYM kablo girişi yap. | Merkez depoya 100 metre 3x2,5 nym kablo girişi yap | E | |
| 2 | Altı iki sıfır dört kodlu üründen merkez depoda kaç adet var? | 6 2 0 4 kodlu üründen Merkez depoda kaç adet var | E | Kod rakamları doğru ama boşluklu yazıldı. |
| 3 | Araç deposundan yirmi adet on altı amper otomatik sigorta çıkışı yap. | araç deposundan 20 adet 16 amper otomatik Sigorta çıkışı yap | E | |
| 4 | Merkez depodan şube deposuna elli adet topraklı priz transfer et. | Merkez Depodan şube deposuna 50 adet Topraklı priz transfer et | E | |
| 5 | Yedi sıfır bir beş kodlu üründen şube deposuna on iki kutu giriş yap. | 7.05 kodlu üründen şube deposuna 12 kota giriş yap | H | Kod 7015 yerine "7.05" (bir rakamı düştü, ondalık sayı gibi yazıldı); birim "kutu" yerine "kota". |
| 6 | Şube deposunda sayım yaptım, dokuz vat LED ampul kırk sekiz adet çıktı. | şube deposunda sayım yaptım 9 watt led ampul 48 adet çıktı | E | |
| 7 | Merkez depoda üç adet kırık anahtar var, fire olarak düş. | Merkez depoda 3 adet kırık anahtar var Fire olarak düş | E | |
| 8 | Yılmaz Elektrik'ten iki yüz elli metre iki çarpı bir buçuk TTR kablo geldi, merkez depoya al. | Yılmaz elektrik'ten 250 metre 2 x 1,5 ttr kablo geldi Merkez depoya al | E | |
| 9 | Sıfır sıfır dört yedi kodlu kablo kanalından araç deposuna on beş adet yükle. | 04 7 kodlu kablo kanalından araç deposuna 15 adet yükle | H | Kod 0047 yerine "04 7": baştaki iki sıfırdan biri düştü. |
| 10 | Dün merkez depoya girdiğim otuz adet sigorta yanlıştı, o işlemi geri al. | Dün Merkez depoya girdiğim 30 adet sigorta yanlıştı o işlemi geri al | E | |

Cümlelerin sınadığı durumlar:

- **Rakam rakam söylenen kod:** 2, 5, 9 (9. cümlede kod sıfırla başlıyor).
- **Teknik ölçü ve kısaltma:** 1, 3, 6, 8 ("üç çarpı iki buçuk", "on altı amper", "dokuz vat", NYM, TTR).
- **İki depo adı aynı cümlede:** 4.
- **Cari adı:** 8.
- **İşlem türleri:** giriş (1, 5, 8), sorgu (2), çıkış (3, 9), transfer (4), sayım (6), fire (7), geri alma (10).

Depo ve ürün adları geçicidir; demo verisi (ABC Elektrik) hazırlanınca cümleler ona göre güncellenecek.

## Özet

| Ölçüm | Sonuç |
| --- | --- |
| Doğru tanınan cümle | 8 / 10 |
| Kodu doğru tanınan cümle (2, 5, 9) | 1 / 3 |
| Miktarı doğru tanınan cümle | 9 / 9 (2. cümlede miktar yok) |

Gözlemler (hangi kelimeler karıştı, kodlar nasıl yazıldı, gecikme hissi):

- Sayılar ve teknik ölçüler rakamla yazıldı ("100", "3x2,5", "2 x 1,5", "16 amper", "9 watt"); ürün, depo ve cari adları doğru.
- Rakam rakam söylenen kodlar tutarsız: biri boşluklu ("6 2 0 4"), biri ondalık sayıya döndü ve bir rakam kaybetti ("7.05"),
  birinde baştaki sıfırlardan biri düştü ("04 7"). Kodlar konuşmadan güvenle çıkarılamıyor.
- Kısa birim kelimesi karıştı: "kutu" → "kota".
- Büyük harf kullanımı tutarsız (Merkez, Depodan, Sigorta, Fire), noktalama yok, kısaltmalar küçük harf (nym, ttr, led); anlamı etkilemiyor.
- Gecikme hissi: gecikme çok azdı. yeterli bir hızda tanımlama yapıyor.

Sonuç: Ürün adı, miktar ve depo büyük ölçüde doğru geliyor; kod ve birim hataları, asistanın tanınan metni katalogla
eşleştirmesi, belirsizlikte kullanıcıya sorması ve işlemi onay kartıyla göstermesi gerektiğini doğruluyor.
Kodları sınamak için daha çok cümle 6. haftadaki etiketli veri kümesine eklenmeli.
