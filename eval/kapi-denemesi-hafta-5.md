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
| 1 | Giriş, birim çevrimi | "Merkez depoya 2 koli üçlü priz girişi yap" → **Onayla** | Kart: Stok girişi, 2 koli (40 adet), Merkez Depo, 13 → 53 adet. Onaydan sonra UYGULANDI; stok 53 | | |
| 2 | Çıkış, cari | "Merkezden 1 makara NYM 3x2.5 kablo çıkışı yap, Yıldız Yapı'ya gidecek" → **Onayla** | Kart: Stok çıkışı, 1 makara (100 metre), Cari: Yıldız Yapı İnşaat, 800 → 700 metre. Stok 700 | | |
| 3 | Sohbetle düzenleme (sürüm) | "Merkezden 2 adet adi anahtar çıkışı yap" → **Düzenle** → "3 adet olsun" → **Onayla** | Düzenle mesaj kutusuna odaklanır. Yeni kart açılmaz; kart 3 adet ve 120 → 117 gösterir. Stok 117 | | |
| 4 | Transfer | "Merkezden Ostim'e 20 metre spiral boru transfer et" → **Onayla** | Kart: Transfer, Merkez Depo → Ostim Depo, 150 → 130 metre; hedef 0 → 20 metre. Stok Merkez 130, Ostim 20 | | |
| 5 | Sayım | "Ostim'de LED ampul saydım, 98 adet çıktı" → **Onayla** | Kart: Sayım, Sayılan 98 adet, 100 → 98. Stok 98 | | |
| 6 | Fire | "Merkezde 1 vavien anahtar kırık geldi, fire yaz" → **Onayla** | Kart: Fire, 1 adet, 25 → 24; not "kırık geldi". Stok 24 | Model `propose_waste`'i aynı girdiyle dört turda çağırdı: dört ayrı fire kartı açıldı, dördü de onaylandı; stok 25 → 21. Her kart bir kez uygulandı (dört işlem, her birinde bir hareket ve bir denetim kaydı). Not boş kaldı; modelin cevabı "yanlışlıkla üç ayrı fire kartı oluştu" dedi (aslında dört) | Yanlış. Düzeltildi: aynı mesajdan aynı öneri artık bir kez açılır (`docs/asistan.md`, kapı bölümü, karar 1). Not sorunu açık (karar 2) |
| 7 | Çift dokunma | "Merkezden 2 adet LED ampul çıkışı yap" → **Onayla**'ya hızlıca iki kez dokun | Tek onay; stok 399 → 397 (iki kez düşmez) | 20 Kasım 09.33. Tek kart; işlem bir kez uygulandı: bir hareket (−2), bir denetim kaydı. Stok 397 | Doğru |
| 8 | Bağlantı kesikken onay | "Merkezden 1 adet LED ampul çıkışı yap" → uçak modunu aç → **Onayla** → uçak modunu kapat → **Onayla** | İlkinde "API'ye ulaşılamadı… Tekrar denersen stok iki kez değişmez."; ikincisinde UYGULANDI. Stok 396 | 20 Kasım 09.40. İşlem bir kez uygulandı: bir hareket (−1), bir denetim kaydı. Stok 396. Uçak modundaki hata metni: (kullanıcının notu) | Doğru (stok) |
| 9 | İki cihaz | "Merkezden 1 adet LED ampul çıkışı yap". Aynı çalışan hesabıyla web panelini aç, aynı sohbeti seç. Önce telefonda, sonra web'de **Onayla** | Web'de "Bu öneri başka bir cihazdan onaylanmış; stok bir kez değişti." ve UYGULANDI. Stok 395 | 20 Kasım 09.40–09.43. Model öneri açmadı: "1 adetlik çıkış kartı zaten hazırlandı ve onay bekliyor" dedi (iki kez). Oysa 7. ve 8. adımın kartları onaylanmıştı; model bunu bilmiyordu, çünkü öneri sonucu açıldığı andaki durumu ("Onay bekliyor") taşıyor ve kartın onayı sohbete yazılmıyor. Kullanıcı "ekranda görünmüyor" deyince model onaylanmış öneriyi düzenlemeye çalıştı ("onay beklemiyor" hatası), sonra hareketlere bakıp kartların onaylandığını söyledi. Stok değişmedi (396) | Yanlış. Düzeltildi: her yeni mesaja sohbetteki önerilerin şu anki durumu sunucu notu olarak ekleniyor (`docs/asistan.md`, kapı bölümü, karar 3). İki cihaz denemesi düzeltme Render'a çıkınca tekrarlanacak |
| 10 | İptal | "Merkezden 5 adet vavien anahtar çıkışı yap" → **İptal** | Kart İPTAL EDİLDİ; stok değişmez (6. adımdaki dört onaydan sonra 21) | | |
| 11 | Yetersiz stok | "Merkezden 100 koli üçlü priz çıkışı yap" → **İptal** | Kartta "Stok yetmiyor: 53 adet var, 2.000 adet gerekiyor."; Onayla yok; asistan eksi miktar söylemez. Stok 53 kalır | | |
| 12 | Geçmiş | Başka sohbete geç, bu sohbete dön | Kartlar cevapların altında, son hâlleriyle (Uygulandı, İptal edildi) | | |

## Sonuç

Deneme sonrası doldurulacak: doğru sayısı, gözlemler, web'deki hareket geçmişinin kontrolü, `ai_runs`'tan süre ve maliyet.

Ara gözlem (19 Kasım, 23.31): 7. adımın mesajı "Bugünkü asistan kullanım sınırınıza ulaştınız" uyarısıyla durdu. Model çağrılmadı, öneri açılmadı, stok değişmedi. Çalışan hesabı o gün 16 mesajda 522.399 token kullanmıştı (sınır 500.000). Bunun %88'i önbellekten okumaydı ve günün maliyeti 0,016 USD'ydi. Sınır önbellek okumasını tam sayıyor; öneri mesajı başına 23–40 bin token harcandığı için sınır sahada günde ancak 15–20 öneriye izin veriyor. Deneme ertesi sabah 7. adımdan sürdürüldü.
