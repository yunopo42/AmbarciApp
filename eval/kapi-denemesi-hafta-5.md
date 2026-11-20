# 5. hafta kapı denemesi: onay stoğu tam bir kez değiştirir

Amaç: 5. haftanın kapısını telefonda doğrulamak. Sohbette asistandan stok işlemi istenir, asistan onay bekleyen bir öneri hazırlar, öneri sohbette kart olarak görünür ve kartın **Onayla** düğmesiyle uygulanır. Stok yalnızca bu düğmeyle ve tam bir kez değişmelidir. Çift dokunma, bağlantı kesikken tekrar ve iki cihazdan onay da bunu değiştirmemelidir.

Aynı kurallar gerçek veritabanında otomatik olarak da sınanır: `apps/api/test-db/proposal-gate.db.spec.ts` (aynı anahtarla tekrar, aynı anda çift onay, iki cihazdan farklı anahtarla onay, onay ile iptalin yarışı, düzenleme ile eski kartın onayının yarışı, süresi dolmuş öneri). Bu deneme kullanıcının gördüğü akışı ve gerçek modeli sınar.

## Nasıl yapılır

1. Telefonda Ambarcı'yı aç; uygulama Render'daki API'ye bağlı olmalı, şirket **ABC Elektrik** seçili olmalı.
2. Hesap: **çalışan**, yalnızca Merkez Depo ve Ostim Depo'ya yetkili. Beklenen değerler bu hesabın gördüğü depolara göre yazıldı.
3. **Sohbetler → Yeni sohbet** ile yeni bir sohbet aç (eski sohbetler `chat-v1` ile çalışır, öneri hazırlayamaz). Mesajları aşağıdaki sırayla gönder.
4. Her öneride kartı oku: tür, ürün, miktar (girilen birim ve ana birim), depo, cari, stoğun önceki ve sonraki hâli, "ONAY BEKLİYOR" rozeti, "Onaylamadan stok değişmez." notu. Asistanın "onaylandı" ya da "yapıldı" dememesi gerekir.
5. Onaydan sonra **Stok** ekranında miktarı kontrol et ve **Gözlenen** sütununa yaz.
6. Bitince web panelinde (yönetici) ürünlerin hareket geçmişi açılır: her onaylanan öneri için tek bir hareket olmalı.

Başlangıç stoğu (19 Kasım 2026, veritabanından): Merkez Depo'da üçlü grup priz 13, NYM 3x2,5 kablo 800 metre, adi anahtar 120, spiral boru 150 metre, vavien anahtar 25, LED ampul 399; Ostim Depo'da LED ampul 100, NYM 300 metre, spiral boru yok (0). Birimler: üçlü priz 1 koli = 20 adet, NYM 1 makara = 100 metre.

## Deneme

| # | Ne sınanıyor | Mesaj ve yapılacak | Beklenen | Gözlenen | Sonuç |
| --- | --- | --- | --- | --- | --- |
| 1 | Giriş, birim çevrimi | "Merkez depoya 2 koli üçlü priz girişi yap" → **Onayla** | Kart: Stok girişi, 2 koli (40 adet), Merkez Depo, 13 → 53 adet. Onaydan sonra UYGULANDI; stok 53 | 19 Kasım 23.08. Tek kart, 2 koli; bir hareket (+40). Stok 53 | Doğru |
| 2 | Çıkış, cari | "Merkezden 1 makara NYM 3x2.5 kablo çıkışı yap, Yıldız Yapı'ya gidecek" → **Onayla** | Kart: Stok çıkışı, 1 makara (100 metre), Cari: Yıldız Yapı İnşaat, 800 → 700 metre. Stok 700 | 23.09. Tek kart, 1 makara, cari Yıldız Yapı İnşaat; model öneriyi turda bir kez düzenledi (sürüm 2). Bir hareket (−100). Stok 700 | Doğru |
| 3 | Sohbetle düzenleme (sürüm) | "Merkezden 2 adet adi anahtar çıkışı yap" → **Düzenle** → "3 adet olsun" → **Onayla** | Düzenle mesaj kutusuna odaklanır. Yeni kart açılmaz; kart 3 adet ve 120 → 117 gösterir. Stok 117 | 23.11. Tek işlem, sürüm 2 (3 adet); yeni kart açılmadı. Bir hareket (−3). Stok 117 | Doğru |
| 4 | Transfer | "Merkezden Ostim'e 20 metre spiral boru transfer et" → **Onayla** | Kart: Transfer, Merkez Depo → Ostim Depo, 150 → 130 metre; hedef 0 → 20 metre. Stok Merkez 130, Ostim 20 | 23.11. Tek kart; iki hareket (Merkez −20, Ostim +20). Stok Merkez 130, Ostim 20 | Doğru |
| 5 | Sayım | "Ostim'de LED ampul saydım, 98 adet çıktı" → **Onayla** | Kart: Sayım, Sayılan 98 adet, 100 → 98. Stok 98 | 23.12. Tek kart; bir hareket (sayım farkı −2). Stok 98 | Doğru |
| 6 | Fire | "Merkezde 1 vavien anahtar kırık geldi, fire yaz" → **Onayla** | Kart: Fire, 1 adet, 25 → 24; not "kırık geldi". Stok 24 | Model `propose_waste`'i aynı girdiyle dört turda çağırdı: dört ayrı fire kartı açıldı, dördü de onaylandı; stok 25 → 21. Her kart bir kez uygulandı (dört işlem, her birinde bir hareket ve bir denetim kaydı). Not boş kaldı; modelin cevabı "yanlışlıkla üç ayrı fire kartı oluştu" dedi (aslında dört) | Yanlış. Düzeltildi: aynı mesajdan aynı öneri artık bir kez açılır (`docs/asistan.md`, kapı bölümü, karar 1). Not sorunu açık (karar 2) |
| 6b | Fire, düzeltmeden sonra | Aynı mesaj, yeni sohbette | Tek kart; 21 → 20 | 20 Kasım 10.04, yeni sürümün yayına çıkmasından (10.04.03) 18 saniye sonra. Model aynı turda hem aynı öneriyi yeniden açtı hem kendi önerisini düzenledi: iki kart açıldı, ikisi de onaylandı; stok 21 → 19. Bu çağrı düzeni gerçek veritabanında testle kuruldu ve yeni kodda tek öneri kaldı; isteği hangi sunucunun cevapladığı (yayın geçişi sırasında eskisi mi, yenisi mi) kesinleştirilemedi | Yanlış (açıklaması kesin değil) |
| 6c | Fire, yayın kesinleştikten sonra | Aynı mesaj, yeni sohbette | Tek kart; 19 → 18 | 20 Kasım 10.24. Tek kart. Model notu eklemek için öneriyi bir kez düzenledi (sürüm 2), yeni öneri açmadı. Bir hareket (−1). Stok 18. Not yine boş | Doğru (not açık bulgu) |
| 7 | Çift dokunma | "Merkezden 2 adet LED ampul çıkışı yap" → **Onayla**'ya hızlıca iki kez dokun | Tek onay; stok 399 → 397 (iki kez düşmez) | 20 Kasım 09.33. Tek kart; işlem bir kez uygulandı: bir hareket (−2), bir denetim kaydı. Stok 397 | Doğru |
| 8 | Bağlantı kesikken onay | "Merkezden 1 adet LED ampul çıkışı yap" → uçak modunu aç → **Onayla** → uçak modunu kapat → **Onayla** | İlkinde "API'ye ulaşılamadı… Tekrar denersen stok iki kez değişmez."; ikincisinde UYGULANDI. Stok 396 | 20 Kasım 09.40. İşlem bir kez uygulandı: bir hareket (−1), bir denetim kaydı. Stok 396. Uçak modundaki hata metni kaydedilmedi | Doğru |
| 9 | İki cihaz | "Merkezden 1 adet LED ampul çıkışı yap". Aynı çalışan hesabıyla web panelini aç, aynı sohbeti seç. Önce telefonda, sonra web'de **Onayla** | Web'de "Bu öneri başka bir cihazdan onaylanmış; stok bir kez değişti." ve UYGULANDI. Stok 395 | 20 Kasım 09.40–09.43. Model öneri açmadı: "1 adetlik çıkış kartı zaten hazırlandı ve onay bekliyor" dedi (iki kez). Oysa 7. ve 8. adımın kartları onaylanmıştı; model bunu bilmiyordu, çünkü öneri sonucu açıldığı andaki durumu ("Onay bekliyor") taşıyor ve kartın onayı sohbete yazılmıyor. Kullanıcı "ekranda görünmüyor" deyince model onaylanmış öneriyi düzenlemeye çalıştı ("onay beklemiyor" hatası), sonra hareketlere bakıp kartların onaylandığını söyledi. Stok değişmedi (396) | Yanlış. Düzeltildi: her yeni mesaja sohbetteki önerilerin şu anki durumu sunucu notu olarak ekleniyor (`docs/asistan.md`, kapı bölümü, karar 3). İki cihaz denemesi düzeltme Render'a çıkınca tekrarlandı (9b) |
| 9b | İki cihaz, düzeltmeden sonra | 6c'nin sohbetinde aynı mesaj; önce telefonda, sonra web'de **Onayla** | Model yeni kart açar; web'de "başka bir cihazdan onaylanmış"; stok 395 | 20 Kasım 10.25. Kullanıcı mesajına sunucu notu eklendi (6c'nin önerisi: Fire, Uygulandı); model "kart zaten hazır" demeden yeni çıkış kartı açtı. Telefondan onaylandı (10.26); web'deki ikinci onay kullanıcının gözlemine göre "başka bir cihazdan onaylanmış" uyarısını gösterdi. Bir hareket (−1), bir denetim kaydı. Stok 395 | Doğru |
| 10 | İptal | "Merkezden 5 adet vavien anahtar çıkışı yap" → **İptal** | Kart İPTAL EDİLDİ; stok değişmez (6c'den sonra 18) | 20 Kasım 10.27. Tek kart, 18 → 13 gösterdi; iptal edildi, hareket yok. Stok 18 | Doğru |
| 11 | Yetersiz stok | "Merkezden 100 koli üçlü priz çıkışı yap" → **İptal** | Kartta "Stok yetmiyor: 53 adet var, 2.000 adet gerekiyor."; Onayla yok; asistan eksi miktar söylemez. Stok 53 kalır | 20 Kasım 10.27. Asistan "100 koli 2.000 adet demek, depoda 53 adet var; bu hâliyle onaylayamazsın" dedi ve seçenek sordu; eksi miktar söylemedi. İptal edildi, hareket yok. Stok 53 | Doğru |
| 12 | Geçmiş | Başka sohbete geç, bu sohbete dön | Kartlar cevapların altında, son hâlleriyle (Uygulandı, İptal edildi) | Kullanıcının gözlemine göre kartlar son hâlleriyle göründü | Doğru |

## Sonuç

**Kapı geçti: onaylanan her kart stoğu tam bir kez değiştirdi.** Denemede onaylanan her önerinin veritabanında kalem başına tek hareketi (transferde iki depo için iki hareket) ve tek `operation.applied` denetim kaydı var; iptal edilen ve süresi dolan önerilerin hiç hareketi yok. Çift dokunma (7), bağlantı kesikken onay ve tekrar (8) ve iki cihazdan onay (9b) stoğu bir kez değiştirdi. Hareket geçmişi web'den tek tek açılmadı, aynı kontrol veritabanından yapıldı.

İlk geçişte 12 adımın 10'u doğruydu. Yanlış olan ikisi kartın kuralından değil, modelin davranışından çıktı ve sunucuda düzeltildi:

- **6. adım:** Model tek fire isteği için aynı öneriyi dört kez açtı; kullanıcı dördünü de onaylayabildi. Artık aynı mesajdan aynı kalemli öneri bir kez açılıyor (karar 1). Yayın geçişindeki tekrar (6b) belirsiz kaldı, yayın kesinleştikten sonra (6c) doğru.
- **9. adım:** Model kartların sohbet dışında onaylandığını bilmiyordu ve yeni öneri açmadı. Artık her yeni mesaja önerilerin şu anki durumu sunucu notu olarak ekleniyor (karar 3). Tekrarında (9b) doğru.

Açık kalanlar:

- **Fire nedeni nota yazılmıyor** (karar 2). Model notu her denemede eklemeye çalışıyor ve bunun için önerisini yeniden düzenliyor (6c'de sürüm 2). Gerçek modelle ölçüm gerekiyor.
- **Günlük kullanım sınırı** önbellek okumasını tam saydığı için deneme ilk gün 16 mesajda durdu (aşağıdaki ara gözlem). Sınırın maliyete göre sayılması ayrı bir iş olarak önerildi.

Model ölçümleri (`ai_runs`, `chat-v2`, 19 Kasım 21.00 – 20 Kasım 10.28, çalışan hesabı; denemenin tekrarları ve ara mesajları dahil 26 mesaj): mesaj başına ortalama 2,9 model çağrısı (en çok 6), modelin toplam süresi medyan 5,5 sn, p90 10,8 sn (araçların süresi hariç), ortalama 30.000 token ve 0,0011 USD; 26 mesajın toplamı 0,028 USD. Model hatası yok.

Ara gözlem (19 Kasım, 23.31): 7. adımın mesajı "Bugünkü asistan kullanım sınırınıza ulaştınız" uyarısıyla durdu. Model çağrılmadı, öneri açılmadı, stok değişmedi. Çalışan hesabı o gün 16 mesajda 522.399 token kullanmıştı (sınır 500.000). Bunun %88'i önbellekten okumaydı ve günün maliyeti 0,016 USD'ydi. Sınır önbellek okumasını tam sayıyor; öneri mesajı başına 23–40 bin token harcandığı için sınır sahada günde ancak 15–20 öneriye izin veriyor. Deneme ertesi sabah 7. adımdan sürdürüldü.
