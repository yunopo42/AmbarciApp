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
| Tarih | |
| Telefon modeli | |
| Android sürümü | |
| Uygulama sürümü / build | |
| Ortam (sessiz oda, depo, araç içi…) | |
| İnternet (Wi-Fi, mobil veri, kapalı) | |

## Cümleler ve sonuçlar

| # | Söylenen | Tanınan | Doğru mu (E/H) | Not |
| --- | --- | --- | --- | --- |
| 1 | Merkez depoya yüz metre üç çarpı iki buçuk NYM kablo girişi yap. | | | |
| 2 | Altı iki sıfır dört kodlu üründen merkez depoda kaç adet var? | | | |
| 3 | Araç deposundan yirmi adet on altı amper otomatik sigorta çıkışı yap. | | | |
| 4 | Merkez depodan şube deposuna elli adet topraklı priz transfer et. | | | |
| 5 | Yedi sıfır bir beş kodlu üründen şube deposuna on iki kutu giriş yap. | | | |
| 6 | Şube deposunda sayım yaptım, dokuz vat LED ampul kırk sekiz adet çıktı. | | | |
| 7 | Merkez depoda üç adet kırık anahtar var, fire olarak düş. | | | |
| 8 | Yılmaz Elektrik'ten iki yüz elli metre iki çarpı bir buçuk TTR kablo geldi, merkez depoya al. | | | |
| 9 | Sıfır sıfır dört yedi kodlu kablo kanalından araç deposuna on beş adet yükle. | | | |
| 10 | Dün merkez depoya girdiğim otuz adet sigorta yanlıştı, o işlemi geri al. | | | |

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
| Doğru tanınan cümle | … / 10 |
| Kodu doğru tanınan cümle (2, 5, 9) | … / 3 |
| Miktarı doğru tanınan cümle | … / 10 |

Gözlemler (hangi kelimeler karıştı, kodlar nasıl yazıldı, gecikme hissi):

-
