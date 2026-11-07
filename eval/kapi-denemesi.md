# 4. hafta kapı denemesi: telefondan canlı stok sorgusu

Amaç: 4. haftanın kapısını doğrulamak. Telefonda, Render'daki API'ye karşı yazarak ve konuşarak gerçek stok soruları sorulur; cevaplar veritabanındaki stokla karşılaştırılır. Asistanın asıl değerlendirmesi 6. haftada etiketli veri kümesiyle (`pnpm eval`) yapılacak; bu deneme küçük ve elle yapılan bir ön denemedir.

Akışın Render'daki zamanlaması ve maliyet ayrıca betikle ölçüldü: `pnpm measure:chat` (sonuç `eval/sohbet/render-2026-11-07.json`, yorum `docs/asistan.md` → "Kapı denemesi ve ilk ölçüm").

## Nasıl yapılır

1. Telefonda Ambarcı'yı aç. Uygulama Render'daki API'ye bağlı olmalı (`EXPO_PUBLIC_API_URL`), şirket **ABC Elektrik** seçili olmalı.
2. **Sohbetler → Yeni sohbet** ile yeni bir sohbet aç. Bütün sorular bu sohbette, aşağıdaki sırayla sorulur.
3. "Yazarak" sorularını kutuya yaz ve gönder.
4. "Sesle" sorularında **Konuş**'a bas ve cümleyi normal hızda bir kez söyle. Tanınan metin yanlışsa düzelt, sonra gönder; düzelttiysen **Not** sütununa yaz.
5. Her cevabı ekranda oku: cevap parça parça mı geldi, araç durum satırı ("Ürün aranıyor…") göründü mü.
6. Bitince sohbet ve model çağrısı kayıtları veritabanından okunur, cevaplar o anki stokla ve kullanıcının depo yetkisiyle karşılaştırılır.

**Beklenen cevap, kullanıcının görebildiği depolara göre hesaplanır.** Yönetici bütün depoları, çalışan yalnızca yetkili olduğu depoları görür. Asistanın araçları da bu kuralı uygular.

## Deneme (7 Kasım 2026, 23:11–23:14)

- **Cihaz ve bağlantı:** Android development build, Wi-Fi, Render'daki API (Frankfurt).
- **Hesap:** ABC Elektrik'te **çalışan**; yalnızca Merkez Depo ve Ostim Depo'ya yetkili. Şirketin üçüncü deposu Servis Aracı 1 (araç deposu) bu hesaba görünmez.
- **Model:** Claude Haiku 5.5, effort `low`, prompt `chat-v1`.

| # | Yol | Soru (sohbete giden metin) | Beklenen (bu hesap için) | Asistanın cevabı | Sonuç |
| --- | --- | --- | --- | --- | --- |
| 1 | Yazarak | Ostim depoda NYM 3x2.5 kaç metre var? | 300 metre | Ostim Depo'da 300 metre | Doğru |
| 2 | Yazarak | Topraklı priz toplam kaç adet var? | 240 adet (Merkez 180 + Ostim 60) | 240 adet; Merkez 180, Ostim 60 | Doğru |
| 3 | Yazarak | Spiral boru kritik seviyenin altında mı? | Evet: 150 metre, en az 200 | Evet; 150 metre, en az 200 | Doğru |
| 4 | Yazarak | Merkezden 2 kaçak akım rölesi çıkışı yap. | Reddeder; stok 4 adet kalır | Asistanda henüz yapamadığını söyledi; stok 4 adet kaldı | Doğru |
| 5 | Sesle | Merkez depoda vavien anahtar kaç tane var | 25 adet (en az 30: kritik) | 25 adet, kritik seviyenin altında | Doğru |
| 6 | Sesle | araç deposunda otomat kaç adet var | Araç deposu bu hesaba görünmez | Görebildiği depolarda araç deposu olmadığını söyledi; "otomat" için iki aday (C16, C25) gösterip hangisi olduğunu sordu | Doğru |
| 7 | Sesle | Halojen free kablodan kaç metre kaldı | 150 metre (Merkez) | 150 metre; Merkez 150, Ostim 0 | Doğru |
| 8 | Sesle | Ostim'de led ampul kaç tane | 100 adet | Ostim Depo'da 100 adet | Doğru |
| 9 | Sesle | depoda trafo var mı | Katalogda yok | Bulunamadığını söyledi, başka bir adla sormasını istedi | Doğru |

## Sonuç

- **9 sorunun 9'u doğru** cevaplandı (kullanıcının yetkili olduğu depolara göre).
- **Ses tanıma:** 5 sesli sorunun tanınan metni söylenen cümleyle aynı geldi; düzeltme gerekmedi.
- **Ekranda:** Cevaplar parça parça geldi, araç çalışırken durum satırı göründü.
- **Stok değişmedi:** Stok değiştirme isteği reddedildi; kaçak akım rölesinin Merkez stoğu denemeden sonra da 4 adet.
- **Süre ve maliyet** (`ai_runs`, sunucu tarafı, 9 mesaj):

  | Ölçüm | Değer |
  | --- | --- |
  | Cevabın tamamı, medyan | 2,5 saniye |
  | İlk metin parçası, medyan | 2,3 saniye |
  | En uzun cevap | 3,3 saniye |
  | Mesaj başına model çağrısı | 1–3 tur |
  | Toplam maliyet | 0,0029 dolar |
  | Başarısız model çağrısı | 0 |

- **Yetki kuralı:** Deneme listesindeki 2. ve 6. sorunun beklenen cevapları önce yönetici gibi bütün depolar üzerinden yazılmıştı (250 adet; Servis Aracı 1: 6 adet). Telefondaki hesap çalışan olduğu için asistan Servis Aracı 1'i görmedi; bu, yetki kuralının asistanda da uygulandığını gösteriyor. Beklenenler bu hesaba göre düzeltildi.

### Gözlemler

- **Toplamın kapsamı:** 2. soruda verilen toplam yalnızca görünen depoların toplamı, ama cevap bunu söylemiyor ("toplam 240 adet"). Çalışan bunu şirketin toplamı sanabilir.
- **Ses uyarısı:** Bir ses denemesinin "Ses algılanmadı" uyarısı, sonraki mesajlar gönderildiği hâlde ekranda kaldı.
- **Telefonda süre:** Telefonda istemci tarafı süre ölçülmedi; süreler sunucu kayıtlarından.
