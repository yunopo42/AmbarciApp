# Ambarcı — 1. Hafta Raporu: Araştırma ve Proje Önerisi

Oct 6, 2026 · @Yunus Emre Atmaz

|  |  |
| --- | --- |
| Öğrenci | Yunus Emre ATMAZ |
| Öğrenci no | 221450018 |
| Danışman | Ali Osman Çıbıkdiken |
| Ders | Senior Design Project |
| Hafta | 1. hafta (5–11 Ekim 2026) — Araştırma ve proje önerisi |
| Proje adı (geçici) | **Ambarcı** — Yapay Zekâ Destekli Saha Stok Asistanı |

Ambarcı; Türk toptancı ve dağıtıcılar için, saha çalışanlarının mobil uygulamadaki yapay zekâ asistanıyla konuşarak (yazı, ses, irsaliye fotoğrafı) stok işlemi yaptığı, yöneticilerin web panelinden yönettiği çok kiracılı bir stok sistemi. Asistan (Claude) yalnızca okur ve işlem önerir; stok, kullanıcının onayıyla ve tek bir veritabanı transaction'ıyla değişir.

## 1. Bu hafta yapılanlar: araştırma süreci

Bu hafta kod yazılmadan önce problem, pazar, teknoloji ve maliyet araştırıldı; araştırmanın sonucunda proje fikri iki kez değişti ve son haline geldi.

| Aşama | Ne araştırıldı | Sonuç |
| --- | --- | --- |
| 1. İlk fikir | WhatsApp üzerinden stok işlemi yapan bot; WhatsApp Cloud API, Meta'nın 2026 AI politikası ve mesaj fiyatlandırması | Kurulum zahmetli, 1 Ekim 2026'dan itibaren servis mesajları ücretli; arayüz düz metinle sınırlı |
| 2. Kanal değişikliği | Expo ile mobil uygulama, Next.js web paneli, uygulama içi sohbet; streaming, ses tanıma, push bildirim | Kendi uygulamamız seçildi; WhatsApp yol haritasına alındı |
| 3. LLM seçimi | Claude API modelleri, fiyatları, araç kullanımı (tool use), yapılandırılmış çıktı, görüntü anlama | Sohbet için Haiku 4.5, belge okuma için Sonnet 5.5 |
| 4. Belge okuma | Tesseract OCR ile multimodal LLM kıyası (literatür) | Doğrudan multimodal LLM + zorunlu insan onayı; kıyas deney olarak yapılacak |
| 5. Pazar ve mevzuat | Paraşüt, Bizim Hesap, Logo İşbası, Logo ERP stok modülleri; e-irsaliye zorunluluğu; VUK 274 stok değerleme | Türk ticaret pratiklerine uygun özellik listesi (çoklu depo, birim çevrimi, sayım, fire, cari) |
| 6. Altyapı ve maliyet | Supabase, Vercel, Render, Railway, EAS ücretsiz katmanları | Tüm altyapı ücretsiz katmanda; tek maliyet Claude kullanımı |
| 7. Bağımsız inceleme | Mimari bir inceleme raporuyla değerlendirildi | 5 öneriden 4'ü işlendi (bölüm 10) |

Araştırmanın ayrıntılı hali (kaynaklar, maliyet hesapları, risk tablosu) ekteki [Teknik Araştırma Raporu](https://claude.ai/code/artifact/da99ebd5-b2f1-4712-8d05-d052e2303bc9)'ndadır.

## 2. Problem ve araştırma bulguları

**Problem.** Toptancılarda depo bilgisi sahada, telefonda ve kağıt irsaliyelerde yaşar; sisteme sonradan elle girilir. Sonuç: gecikmeli stok, eksik kayıt ve "depoda kaç tane kaldı?" sorusuna telefonla cevap aramak.

**Temel bulgular:**

1. **Pazar.** Paraşüt, Bizim Hesap ve Logo İşbası gibi ürünlerde çoklu depo, depolar arası transfer, kritik stok uyarısı, barkod ve e-irsaliye artık temel beklenti. İncelenen ürünlerin hiçbirinde sahadaki hareketi konuşarak, sesle veya irsaliye fotoğrafıyla kaydeden bir asistan yok.
2. **Mevzuat.** 2024 veya 2025 brüt satış hasılatı 10 milyon TL ve üzeri olan e-Fatura mükellefleri 1 Temmuz 2026'dan beri e-irsaliye kullanmak zorunda. VUK 274'e göre stok maliyet bedeliyle değerlenir; LIFO 2004'ten beri kullanılmıyor.
3. **Kanal.** WhatsApp Business API'de genel amaçlı AI botları 15 Ocak 2026'dan beri yasak, iş odaklı botlar serbest; ancak servis mesajları 1 Ekim 2026'dan itibaren aylık 1.000 mesaj sonrası ücretli. Kendi uygulamamız bu kısıtları kaldırır ve onay kartı, kamera, barkod gibi zengin arayüze izin verir.
4. **LLM.** Claude Haiku 4.5 (1M token başına $1 girdi / $5 çıktı) araç kullanımı için yeterli ve ucuz; sohbetten bir stok işlemi yaklaşık 0,5–0,8 sent. Claude ses girdisi almadığı için ses telefonda yazıya çevrilir.
5. **Belge okuma.** Klasik OCR okuyamadığında bozuk metin üretir, multimodal LLM ise makul ama yanlış değer üretebilir. Bu yüzden çıkarılan kalemler fotoğrafla yan yana gösterilir ve onaysız stoka girmez.

**Projenin araştırma sorusu:** Güvenilmez bir bileşen olan LLM ajanı, stok gibi hata kaldırmayan bir iş sürecine nasıl güvenli biçimde yerleştirilir ve bu yaklaşım klasik form girişine göre ne kadar doğru ve hızlıdır?

## 3. Kesinleşen kararlar

| Konu | Karar |
| --- | --- |
| Hedef kullanıcı | 1–50 çalışanlı, 1–5 depolu toptancı ve dağıtıcılar; ilk demo "ABC Elektrik" |
| Konumlanma | Ön muhasebe programı değil; Paraşüt, Logo gibi yazılımların yanında sahadaki stok hareketini kaydeden katman |
| Kanal | Kendi mobil uygulamamız (Expo) ve web panelimiz (Next.js); WhatsApp yol haritasında |
| Backend ve veri | NestJS modüler monolit, PostgreSQL (Supabase), Drizzle, pg-boss + outbox |
| LLM | Claude API: sohbet ve araç kullanımı Haiku 4.5, irsaliye okuma Sonnet 5.5; ses cihazda yazıya çevrilir |
| Güvenlik ilkesi | LLM yalnızca okuma ve öneri aracı çağırır; onay LLM'den geçmeyen ayrı bir uç noktadadır; yanlış onay silinmez, ters kayıtla düzeltilir |
| Türkiye uyumu | Çoklu depo ve araç deposu, birim çevrimi, sayım ve fire fişi, cari kartı, hareketli ortalama maliyet |
| Hosting | Vercel (web), Render Free (API + worker tek süreç), Supabase Free, EAS Free; gecikme sorun olursa Railway |
| Maliyet | Altyapı 0 $; Claude 8 haftada \~10–30 $ (Console kredisi); mağaza hesapları isteğe bağlı |
| Çalışma düzeni | Commit'leri öğrenci atar; çekirdek modüller elle, çevre kod ajan desteğiyle; haftalık rapor repoda |

## 4. Kullanılacak teknolojiler

Tüm proje TypeScript ile, tek bir monorepo içinde geliştirilir; mobil, web ve backend aynı veri şemalarını paylaşır.

| Katman | Teknoloji | Ne için |
| --- | --- | --- |
| Dil ve depo | TypeScript, pnpm workspaces, GitHub | Tek dil, tek repo; hoca ilerlemeyi commit geçmişinden izler |
| Mobil uygulama | Expo (React Native), Expo Router, NativeWind | Saha çalışanı için iOS/Android uygulaması |
| Mobil yetenekler | expo-camera, expo-speech-recognition, expo-notifications, expo-secure-store | Kamera ve barkod, sesle komut, bildirim, güvenli oturum |
| Web paneli | Next.js, React, Tailwind CSS, shadcn/ui, TanStack Table | Yönetici paneli: ürün, depo, stok, onay, rapor |
| Ortak katman | Zod, OpenAPI'den üretilen API istemcisi, TanStack Query | Tip güvenli veri alışverişi |
| Backend | NestJS (Node.js), REST `/v1`, Swagger/OpenAPI, SSE | İş kuralları, yetki, asistan, akışlı sohbet |
| Veritabanı | PostgreSQL (Supabase), Drizzle ORM, pg\_trgm | İlişkisel stok verisi, transaction, bulanık ürün arama |
| Kimlik ve dosya | Supabase Auth, Supabase Storage | Giriş, JWT, irsaliye fotoğrafları |
| Arka plan işleri | pg-boss + outbox tablosu | Belge işleme, bildirim, olaylar |
| Yapay zekâ | Claude API (Haiku 4.5, Sonnet 5.5), @anthropic-ai/sdk | Sohbet ajanı, araç kullanımı, irsaliye okuma |
| Test ve kalite | Vitest, Supertest, Playwright, ESLint, GitHub Actions | Birim, API ve uçtan uca test; her push'ta CI |
| Yayın | Vercel (web), Render Free (API), EAS Build (mobil) | Ücretsiz katmanlarda canlı demo |

## 5. Genel sistem haritası

Sistem üç katmandan oluşur: istemciler (mobil ve web), tek bir NestJS uygulaması (API, asistan çekirdeği ve worker) ve Supabase üzerindeki veri katmanı. Claude ve Expo Push dış servislerdir.

&#91;embedded content: Ambarcı genel sistem haritası\]

Bir sohbet mesajı şu yolu izler: mobil uygulama mesajı API'ye gönderir → asistan çekirdeği Claude'u çağırır → Claude ürün arama ve öneri araçlarını kullanır → istemciye bir işlem kartı döner → kullanıcı Onayla'ya basınca API stok transaction'ını çalıştırır → worker bildirim ve denetim kaydını tamamlar. Kesik çizgili kutu, aynı çekirdeğe sonradan bağlanabilecek kanalları gösterir.

## 6. Veritabanı ilişki diyagramı

Veritabanı PostgreSQL'dedir ve altı alana ayrılır. Her kutu bir tablodur; ikinci satır temel alanları, üçüncü satır bağlı olduğu tabloyu (yabancı anahtar) gösterir.

&#91;embedded content: veritabanı ilişki diyagramı · 6 alan, 20 tablo\]

Önemli kurallar: (şirket, depo, ürün) üçlüsü `inventory` tablosunda benzersizdir ve miktar sıfırın altına inemez (`CHECK`); her stok hareketi bir `operations` kaydına bağlanır ve (operasyon, kalem) benzersiz olduğu için aynı onay iki kez uygulanamaz; miktarlar `NUMERIC(14,3)` ile tutulur.

## 7. Prototip ekranlar

Mobil uygulama tek bir sohbet ekranı etrafında kurulur; web paneli ise yöneticinin aynı işlemleri tablo, onay ve belge inceleme ekranlarından izlemesi içindir. Aşağıdaki çizim tasarım amaçlıdır; gerçek ekranlar 3.–7. haftalarda geliştirilecektir.

&#91;embedded content: prototip · mobil sohbet ekranı ve web yönetim paneli\]

Soldaki telefonda çalışan stok girişini yazıyla (ya da "Ses" düğmesiyle) bildirir, asistan bir işlem kartı çıkarır ve stok yalnızca "Onayla" ile değişir. Sağdaki panelde aynı işlem "Onay bekliyor" olarak görünür; belge inceleme alanı irsaliye fotoğrafını çıkarılan kalemlerle yan yana gösterir ve okunamayan kalemi işaretler.

## 8. MVP kapsamı ve plan

MVP'de olanlar: şirket ve davet, ürün/depo/stok yönetimi, sohbetten stok sorgusu, giriş, çıkış, transfer, sayım ve fire önerisi, onay kartı, yanlış onayın ters kayıtla geri alınması, irsaliye fotoğrafından kalem okuma, cihazda ses tanıma, barkod, kritik stok bildirimi, denetim kaydı, KVKK aydınlatma ve hesap silme. MVP'de olmayanlar: fatura ve e-irsaliye kesimi, lot/seri, varyant, ödeme, çevrimdışı mod.

| Hafta | Tarih | Odak | Kapı |
| --- | --- | --- | --- |
| 1 | 5–11 Ekim | Araştırma, monorepo, CI, Claude ve Expo denemesi | — |
| 2 | 12–18 Ekim | Veritabanı, web + mobil giriş, roller | İki şirket arasında veri sızıntısı yok |
| 3 | 19–25 Ekim | Manuel stok, mobil stok ekranları | — |
| 4 | 26 Ekim–1 Kasım | Asistan, SSE akışı, okuma araçları | Telefonda canlı stok sorgusu |
| 5 | 2–8 Kasım | Öneri araçları, onay, transaction, tekrar koruması | Onay stoğu tam bir kez değiştirir |
| 6 | 9–15 Kasım | 100 mesajlık değerlendirme, model kıyası, push | — |
| 7 | 16–22 Kasım | İrsaliye okuma, ses, barkod, pilot kullanıcı | — |
| 8 | 23–29 Kasım | Test, rapor, Android yayını, demo | Final demo ve ölçülmüş sonuçlar |

Not: 7. haftanın sonunda kapsam dondurulur; bu bir kapı değildir.

## 9. 8 haftalık geliştirme görevleri

Her görev GitHub'da bir issue, her hafta bir milestone olarak açılır; tamamlanan görevler haftalık raporda commit bağlantılarıyla işaretlenir.

### Hafta 1 — Araştırma ve iskelet (5–11 Ekim)

- [ ] Araştırma raporunu ve bu özeti tamamla, danışmana sun
- [ ] GitHub reposu, README, 8 milestone, 1. hafta issue'ları
- [ ] pnpm monorepo: `apps/mobile`, `apps/web`, `apps/api`, `packages/shared`
- [ ] GitHub Actions: lint, typecheck, build
- [ ] Supabase projesi, `.env.example`; web Vercel'de, API `/health` Render'da yayında
- [ ] Expo development build telefonda; Türkçe ses tanıma denemesi
- [ ] Claude API anahtarı ve harcama limiti; 20 örnek mesajla araç çağırma denemesi
- [ ] Demo verisi: ABC Elektrik, 15–20 ürün, 2 depo, 1 araç deposu

### Hafta 2 — Veritabanı ve kimlik (12–18 Ekim)

- [ ] Drizzle şeması ve migration'lar (ER diyagramındaki tablolar)
- [ ] Supabase Auth: web ve mobilde giriş/çıkış
- [ ] Şirket oluşturma, davet kodu, rol ve depo yetkisi
- [ ] Backend'de JWT doğrulama ve yetki guard'ları
- [ ] RLS politikaları; iki şirketli izolasyon testi
- [ ] Ekran tasarımları (Stitch veya Figma, yalnızca görsel referans; üretilen kod kullanılmaz): mobil sohbet + işlem kartı, mobil stok listesi, web dashboard, web onay kuyruğu, web belge inceleme. Renk, yazı tipi, boşluk ve köşe değerleri `docs/tasarim.md` dosyasına yazılır.
- [ ] Kapı: iki şirket arasında veri sızıntısı yok

### Hafta 3 — Manuel stok (19–25 Ekim)

- [ ] Ürün, birim, alternatif ad, depo ve cari yönetimi (web)
- [ ] Excel/CSV ile ürün içe aktarma
- [ ] Giriş, çıkış, transfer, sayım, fire ekranları ve stok transaction'ı
- [ ] Hareketli ortalama maliyet hesabı
- [ ] OpenAPI istemcisi; mobilde stok listesi ve ürün detayı
- [ ] Eşzamanlı çıkış ve rollback testleri

### Hafta 4 — Asistan altyapısı (26 Ekim – 1 Kasım)

- [ ] Sohbet ve mesaj tabloları, ajan döngüsü, araç kayıt defteri
- [ ] Okuma araçları: ürün arama (pg\_trgm), stok sorgusu, son hareketler
- [ ] SSE akışı; web ve mobilde sohbet ekranı
- [ ] `ai_runs` kayıtları (token, süre, maliyet)
- [ ] Kapı: telefondan canlı stok sorgusu

### Hafta 5 — Öneri ve onay (2–8 Kasım)

- [ ] Öneri araçları: giriş, çıkış, transfer, sayım, fire
- [ ] İşlem kartı (mobil + web), durum makinesi, onay uç noktası
- [ ] Idempotency, outbox, denetim kaydı; ters kayıtla geri alma (15 dk kendi işlemi, sonrası yönetici)
- [ ] Tekrar ve eşzamanlılık testleri
- [ ] Kapı: onay stoğu tam bir kez değiştirir

### Hafta 6 — Ölçüm ve bildirim (9–15 Kasım)

- [ ] 100 etiketli mesaj (60 geliştirme, 40 test); `pnpm eval` betiği
- [ ] Haiku–Sonnet kıyası, prompt iyileştirme, test kümesini dondurma
- [ ] Push bildirimi: onay bekleyen işlem, kritik stok
- [ ] Web onay kuyruğu ve dashboard

### Hafta 7 — Belge, ses, barkod (16–22 Kasım)

- [ ] Kamera ile irsaliye çekme, Sonnet ile kalem çıkarma, inceleme ekranı
- [ ] Tesseract + Haiku ile kıyas deneyi (30–50 belge)
- [ ] Cihazda ses tanıma ve sohbete bağlama
- [ ] Barkod okutma (zaman kalırsa e-irsaliye XML okuma)
- [ ] Pilot kullanıcı denemesi
- [ ] KVKK aydınlatma metni, gizlilik politikası sayfası ve uygulama içinden hesap silme akışı (mağaza yayını için zorunlu)

Not: Hafta sonunda kapsam dondurulur; bu bir kapı değildir.

### Hafta 8 — Test, rapor, demo (23–29 Kasım)

- [ ] Final değerlendirme ve işlem süresi deneyi (form vs. asistan)
- [ ] Hata düzeltme; yeni özellik yok
- [ ] Android dahili test yayını veya APK; web canlı adres
- [ ] Kurulum, mimari ve kullanım dokümantasyonu
- [ ] Bitirme raporu, sunum ve yedek demo videosu
- [ ] Kapı: final demo ve ölçülmüş sonuçlar

## 10. İnceleme raporuna yanıt

İnceleme, mimarinin ana kararlarını (LLM yalıtımı, kilit sırası, idempotency, outbox) doğru bulmuş ve beş iyileştirme önermiştir; dördü ana rapora işlendi, biri zaten vardı.

| # | Öneri | Durum |
| --- | --- | --- |
| 1 | Çok kiracılı bulanık aramada `organization_id` + trigram birleşik GIN indeksi (`btree_gin`) | Eklendi: veri modeli ve sohbet ajanı hattı |
| 2 | Supabase'in 7 günlük uykusuna karşı zamanlanmış canlı tutma | Zaten vardı; demo kontrol listesine Render da eklendi |
| 3 | Tek süreçte worker'ın olay döngüsünü kilitlemesi | Eklendi: en fazla 2 eşzamanlı belge işi; görüntü işleme yalnızca cihazda |
| 4 | Birim çevriminde yuvarlama hatası | Eklendi: katsayı NUMERIC(14,6), çevrim yalnızca çarpmayla, tek noktada yuvarlama |
| 5 | Gürültülü ortamda ses tanıma hatası | Eklendi: bağlamsal kelime listesi, sesli sayı/kod toleransı, bulanık katalog araması |

Bir düzeltme: İnceleme, hareketli ortalama maliyetin VUK 274 gereksinimlerini "karşıladığını" söylüyor. Sistem resmi defter tutmaz; bu maliyet yönetim raporu içindir ve yasal değerleme muhasebe yazılımının sorumluluğunda kalır. Savunmada bu sınır açıkça söylenmelidir.

Ayrıntılar: [1. Hafta Teknik Araştırma Raporu](https://claude.ai/code/artifact/da99ebd5-b2f1-4712-8d05-d052e2303bc9).

## 11. Sonraki hafta planı ve rapor formatı

**2. hafta (12–18 Ekim) hedefi:** veritabanı şeması kurulur, web ve mobilde giriş çalışır, şirket ve davet akışı tamamlanır; iki şirket arasında veri sızıntısı olmadığı testle gösterilir.

**Haftalık rapor formatı.** Sonraki tüm haftalık raporlar aynı yapıda yazılır ve repoda `docs/raporlar/hafta-XX.md` olarak tutulur:

1. Kapak bilgisi: öğrenci, no, danışman, ders, hafta ve tarih aralığı
2. Özet: haftanın sonucu 2–3 cümlede
3. Bu hafta yapılanlar: tamamlanan işler tablosu
4. Teknik açıklama: ne yapıldı, neden önemli, ne öğrenildi
5. Görseller: ekran görüntüsü, diyagram veya ölçüm grafiği
6. Tamamlanan görevler: issue ve commit bağlantılarıyla işaretli liste
7. Karşılaşılan sorunlar ve çözümler
8. Sonraki hafta planı
9. Kaynaklar

## 12. Kaynaklar

- [Claude — fiyatlandırma](https://platform.claude.com/docs/en/about-claude/pricing)
- [Claude — yapılandırılmış çıktı ve strict tool use](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Claude — görüntü (vision)](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Meta — WhatsApp Business Platform fiyatlandırma](https://developers.facebook.com/docs/whatsapp/pricing)
- [Wati — 1 Ekim 2026 servis mesajı ücretlendirmesi](https://support.wati.io/en/articles/16954666-whatsapp-business-platform-api-pricing-changes-service-messages-and-click-to-message-ads)
- [Alibaba Cloud — WhatsApp 2026 AI politikası](https://www.alibabacloud.com/help/en/chatapp/use-cases/whatsapp-ai-policy-2026-guide)
- [expo-speech-recognition](https://github.com/jamsch/expo-speech-recognition)
- [Expo — EAS fiyatlandırma](https://expo.dev/pricing)
- [Supabase — fiyatlandırma](https://supabase.com/pricing)
- [Render, Railway, Fly.io karşılaştırması (2026)](https://hostim.dev/blog/render-vs-railway-vs-fly-pricing/)
- [Paraşüt — depo takibi](https://announcekit.app/parasut/duyurular/depo-takibi-parasutte-2cT3BS)
- [Bizim Hesap — stok ve depo takibi](https://bizimhesap.com/ozellikler/stok-ve-depo-takibi)
- [Logo ERP depo yönetimi özeti](https://raporx.com.tr/blog-logo-depo-uretim.html)
- [MDP Group — e-irsaliye mükellefiyeti 2026](https://mdpgroup.com/blog/kimler-e-irsaliye-mukellefidir/)
- [VUK 274 ve ticari malların değerlemesi](https://www.muhasebedersleri.com/genel-muhasebe-2/degerleme-islemleri-2.html)
- [CEUR-WS — fatura ve fiş OCR derlemesi](https://ceur-ws.org/Vol-4044/paper12.pdf)
- [Ayrıntılı teknik araştırma raporu](https://claude.ai/code/artifact/da99ebd5-b2f1-4712-8d05-d052e2303bc9)
