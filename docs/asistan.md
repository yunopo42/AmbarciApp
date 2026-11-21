# Asistan altyapısı

Bu belge 4. haftada kurulan asistan altyapısını anlatır ve işler birleştikçe büyür. İlgili işler: #54 (sohbet, mesaj ve `ai_runs` tabloları; tablolar [veritabani.md](veritabani.md#asistan-tabloları)), #55 (model çağrısı, bu belgenin ilk bölümü), #56 (ajan döngüsü ve okuma araçları, ikinci bölüm), #57 (sohbet uçları ve SSE akışı, üçüncü bölüm), #58 (mobil sohbet ekranı, dördüncü bölüm), #59 (web sohbet paneli, beşinci bölüm), #60 (kapı denemesi ve ölçüm, altıncı bölüm). 5. hafta: #72 (Claude API adresinin sabitlenmesi, ilk bölümün 12. kararı), #73 (ses uyarısının temizlenmesi ve kalın yazı; mobil bölümün 12., web bölümünün 8. kararı), #74 (öneri araçları ve `chat-v2`, yedinci bölüm), #75 (sohbette işlem kartı için API ve süre aşımı, sekizinci bölüm), #76 (mobilde işlem kartı, mobil bölümün 13. kararı), #77 (web panelinde işlem kartı, web bölümünün 9. kararı), #79 (5. hafta kapı denemesi, aynı önerinin tekrarına karşı kural ve önerilerin durum notu, dokuzuncu bölüm). Model seçimi: [ADR-001](kararlar/ADR-001-sohbet-modeli.md).

## Model çağrısı (`ai` modülü, #55)

```text
assistant modülü (ajan döngüsü, #56)
  │  her kullanıcı mesajının başında: AiService.assertWithinBudget
  │  her araç turunda:                AiService.createTurn
  ▼
AiService ──────────────► ai_runs (her çağrı: token, süre, maliyet)
  │  AIProvider (port)
  ▼
ClaudeAdapter (@anthropic-ai/sdk, yalnızca modules/ai/adapters/) ──► Claude API
```

Kod: `apps/api/src/modules/ai/`. Uç noktası yok; asistan modülü (#56) kullanır. Modül, ayarları açılışta doğrulasın diye şimdiden `AppModule`'e bağlı.

### Kararlar

1. **Port ve adaptör (mimari değişmez 9).** Asistan modeli `AIProvider` arayüzüyle çağırır; Claude SDK'sı yalnızca `adapters/claude.adapter.ts` içinde import edilir. Adaptör SDK'nın hata sınıflarını kendi hata koduna (`AiProviderError`) çevirir; SDK tipleri modülün dışına çıkmaz. Testlerde aynı arayüzü uygulayan sahte sağlayıcı (`test/support/scripted-ai-provider.ts`) kullanılır; testler gerçek model çağırmaz.
2. **İstek ADR-001'e uyar.** Model ve effort ortam değişkeninden (`claude-haiku-5-5`, `low`). Adaptive thinking açıkça yazılır. `temperature`, `top_p` ve `top_k` gönderilmez: Haiku 5.5 varsayılan dışı değeri, SDK 1.x'in kullandığı `2026-10-21` API sürümü ise herhangi bir değeri reddeder. `max_tokens` 4.096: düşünmeye pay kalır, 2. hafta denemesinde yetti.
3. **Geçmiş değiştirilmeden gönderilir.** Modelin döndürdüğü bloklar (düşünme blokları dahil, metni boş olsa bile) düz JSON'a çevrilip `messages.content`'e olduğu gibi yazılır ve sonraki istekte aynen geri gönderilir. Haiku 5.5'te daha önce gönderilmiş bir mesaj, sistem promptu ya da araç listesi değişirse geri gönderilen düşünme blokları geçersiz olur ve istek reddedilebilir (ADR-001). Test, SDK'nın gerçekten gönderdiği gövdede geçmişin birebir aynı olduğunu doğrular.
4. **Sistem promptu sürümlü ve sabit.** `prompts/chat.v1.ts` (`chat-v1`). Metne tarih, şirket ya da kullanıcı adı gibi değişen bilgi yazılmaz: hem önbellek bozulur hem de sohbetin ortasında sistem promptu değişmiş olur. Prompt değişecekse dosya düzenlenmez, `chat.v2.ts` açılır; eski sürümler silinmez, süren bir sohbet başladığı sürümle devam edebilir (`chatPrompt(version)`). Sürüm her çağrıda `ai_runs.prompt_version`'a yazılır.
5. **Araçlar strict.** Araç tanımları `strict: true` ile gider; API modelin girdisini şemaya uydurur. Akışta araç girdisini parça parça almak için `eager_input_streaming` bilerek kapalı: bizim araç girdilerimiz birkaç düzine bayt, açıkken de API girdiyi doğrulamaz. Asistan girdiyi ayrıca kendi şemasıyla doğrular (#56).
6. **Önbellek.** İki işaret var: sistem bloğundaki işaret araç tanımlarını ve sistem promptunu (API bunları bu sırayla işler), üst düzeydeki işaret geçmişin sonuna kadarını önbelleğe alır. Bir sorunun ikinci model çağrısı (araç turundan sonra) aynı ön eki önbellekten okur. Haiku 5.5'te önbelleğe alınabilen en kısa istem 512 token. Kapı denemesinde (#60) mesaj başına önbelleksiz girdi 4–8 token kaldı; girdinin geri kalanı önbellekten okundu (Kapı denemesi bölümü).
7. **Her çağrı `ai_runs`'a yazılır (mimari değişmez 10).** Başarılı çağrı; modelin reddettiği çağrı (tokenları faturalanır); sağlayıcı hatası (sıfır token, hata koduyla, süresiyle). Yalnızca anahtar tanımlı değilken kayıt yazılmaz, çünkü istek hiç gönderilmemiştir. Kayıt, modelin cevabından bağımsız yazılır: model çağrıldıysa maliyet oluşmuştur.
8. **Maliyet SQL'de (ADR-003).** `cost_usd = round((giriş × giriş fiyatı + önbelleğe yazma × yazma fiyatı + önbellekten okuma × okuma fiyatı + çıkış × çıkış fiyatı) / 1.000.000, 8)`. Fiyatlar `pricing.ts`'te metin olarak durur ve JS'te hesaba girmez. Haiku 5.5: giriş 0,10 $, çıkış 0,50 $, önbelleğe yazma 0,125 $, önbellekten okuma 0,01 $ (milyon token başına; claude-api skill'i, 2026-10-06). İstem 100K tokenı aşarsa uzun istem fiyatı (0,50 $ / 2,50 $) uygulanır; hangi fiyatın seçileceği token sayılarından (tam sayı) bulunur. Kayıt, çağrı anındaki fiyatla kalır.
9. **Model reddederse ya da cevap yarım kalırsa.** `stop_reason: "refusal"` → `422 AI_REFUSED` ve kullanıcıya sorusunu farklı sorması söylenir; Haiku 5.5'te sunucu tarafında yedek model yoktur. Araç çağrısı yazılırken çıktı sınırına takılan cevap (`max_tokens`) çalıştırılmaz: yarım kalmış girdi geçerli görünebilir → `502 AI_RESPONSE_TRUNCATED`. İki durumda da çağrı önce kaydedilir; reddedilen ya da yarım içerik geçmişe eklenmez.
10. **Günlük token bütçesi.** Bugünkü (Türkiye saatiyle gece yarısından beri) giriş, çıkış ve önbellek tokenlarının toplamı; kullanıcı başına 500.000, şirket başına 2.000.000 (ortam değişkeniyle değişir). 2. hafta denemesinde bir mesaj önbelleksiz ~9.000 token tuttu: kullanıcı başına ~55, şirket başına ~220 mesaj. Sınır `ai_runs`'tan tek sorguyla okunur (`(organization_id, created_at)` indeksi). Kontrol her kullanıcı mesajının başında bir kez yapılır, her araç turunda değil: bir cevabın araç turlarının ortasında kesilmemesi için. Bu yüzden sınır en fazla bir cevabın çağrıları kadar aşılabilir. Önce şirketin sınırına bakılır: şirketin sınırı dolduysa kullanıcıya kendi sınırı dolmuş gibi görünmesin.
11. **Anahtar yoksa API yine açılır.** `ANTHROPIC_API_KEY` boşsa asistan kapalıdır ve sohbet isteği `503 AI_NOT_CONFIGURED` alır; API'nin geri kalanı çalışır. Böylece Render'a anahtar eklenmeden birleşen bir sürüm yayını durdurmaz. Buna karşılık yanlış yazılmış bir effort ya da fiyatı bilinmeyen bir model açılışta hata verir: maliyeti yazılamayacak bir çağrı yapılmamalı.
12. **Adres kodda sabit (#72).** Adaptör SDK'ya `https://api.anthropic.com` adresini açıkça verir (`CLAUDE_API_BASE_URL`). Adres verilmezse SDK `ANTHROPIC_BASE_URL` ortam değişkenini okur; 4. haftada geliştirici bilgisayarında bu değişken başka bir araç için `http://127.0.0.1:1337` olarak tanımlıydı ve yerel API'nin istekleri o boş porta gitti (Web sohbet paneli bölümü). Sabit adres iki şeyi önler: yanlış ortam ayarı asistanı kapatmaz ve API anahtarı beklenmeyen bir sunucuya gönderilmez. Testler kendi adresini ya da sahte fetch'ini adaptörün `client` ayarıyla verir; bu ayar sabit adresten sonra uygulanır. Bağlantı hatasında SDK yalnızca "Connection error." yazdığı için log, hedef sunucuyu ve hatanın alttaki nedenini de yazar (`Claude API'ye ulaşılamadı (api.anthropic.com): Connection error. Neden: fetch failed ← connect ECONNREFUSED …`). Mesaj içeriği loga girmez; API anahtarı hata metnine karışsa bile loga yazılmadan silinir.

### Hata kodları

| Durum | Kod | Ne zaman |
| --- | --- | --- |
| 429 | `AI_BUDGET_EXCEEDED` | Günlük bütçe doldu (`details`: `scope` = `user` / `organization`, `limit`, `used`) |
| 422 | `AI_REFUSED` | Model isteği reddetti |
| 422 | `AGENT_TOOL_LIMIT` | 5 araç turundan sonra model hâlâ araç istedi (#56; çağrı `ai_runs`'a bu kodla yazılır) |
| 502 | `AI_RESPONSE_TRUNCATED` | Araç çağrısı yazılırken çıktı sınırına takıldı |
| 502 | `AI_REQUEST_REJECTED` | Claude API isteğimizi reddetti (400/404/422; ayrıntı yalnızca logda) |
| 503 | `AI_NOT_CONFIGURED`, `AI_AUTH_FAILED` | Anahtar tanımlı değil ya da reddedildi |
| 503 | `AI_RATE_LIMITED`, `AI_OVERLOADED`, `AI_UNAVAILABLE` | Claude API sınırı, aşırı yük (529), bağlantı hatası ya da 5xx (SDK önce iki kez yeniden dener) |
| 503 | `AI_ABORTED` | Çağrı iptal edildi |

Kullanıcı Türkçe mesajı görür; sağlayıcının teknik mesajı yalnızca loga yazılır. Mesaj içeriği loglanmaz.

### Ortam değişkenleri

| Değişken | Varsayılan | Not |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Yalnızca backend'de (mimari değişmez 12). Boşsa asistan kapalı |
| `CLAUDE_CHAT_MODEL` | `claude-haiku-5-5` | `pricing.ts`'te fiyatı olmalı |
| `CLAUDE_CHAT_EFFORT` | `low` | `low`, `medium`, `high`, `xhigh`, `max` |
| `AI_DAILY_TOKEN_LIMIT_USER` | 500000 | Kullanıcının o şirketteki günlük tokenları |
| `AI_DAILY_TOKEN_LIMIT_ORG` | 2000000 | Şirketin günlük tokenları |
| `ANTHROPIC_BASE_URL` | — | **Okunmaz.** Adres kodda sabit (karar 12); tanımlı olsa da istekler `api.anthropic.com`'a gider |

### Bağımlılık notu

`@anthropic-ai/sdk` 1.3.0 eklendi (25 Ekim'de onaylandı). SDK `@opentelemetry/api` paketini getiriyor. `drizzle-orm` bu paketi isteğe bağlı eş bağımlılık olarak kullanır: paket API'nin bağımlılık ağacına girince pnpm `apps/api` için drizzle'ın ikinci bir kopyasını kurdu ve iki paketin (`apps/api`, `packages/db`) sorgu tipleri birbirini tutmadı. `@opentelemetry/api` `packages/db`'ye de açıkça eklenince iki paket aynı tek kopyayı kullanıyor. Lockfile'da hiçbir paketin sürümü değişmedi; yalnızca drizzle, Next.js, supabase-js ve Vitest'in isteğe bağlı eşi çözümlendi. OpenTelemetry'nin yalnızca arayüzü kurulu, izleme açık değil; çalışma anında etkisi yok.

### Testler

| Test | Ortam | Ne doğrular |
| --- | --- | --- |
| `apps/api/test/ai-claude-adapter.spec.ts` | CI (SDK'ya sahte fetch) | SDK'nın gönderdiği gövde: örnekleme parametresi yok, adaptive thinking, effort, `max_tokens`, önbellek işaretleri, strict araçlar, geçmiş ve düşünme blokları birebir; akışın sonuca çevrilmesi (bloklar, metin parçaları, araç çağrısı, token sayıları); 429, 529, 500, 401, 400, bağlantı hatası ve iptalin hata kodları; `ANTHROPIC_BASE_URL` başka bir adrese ayarlıyken isteğin yine `api.anthropic.com`'a gitmesi, testin kendi adresini verebilmesi, bağlantı hatası mesajında hedef sunucu ve alttaki neden (`ECONNREFUSED`), mesajda API anahtarı ve mesaj içeriğinin olmaması (#72) |
| `apps/api/test/ai-rules.spec.ts` | CI | Ortam değişkenleri (varsayılanlar, boş değerler, geçersiz effort, bilinmeyen model), uzun istem fiyatı, prompt sürümleri, sahte sağlayıcı |
| `apps/api/test-db/ai.db.spec.ts` | Gerçek veritabanı (`pnpm db:test`) | Maliyetin dört token türüyle SQL'de hesaplanması (546,5 / 1.000.000 $), uzun istem fiyatı, reddin ve yarım cevabın kaydedilip hataya çevrilmesi, sağlayıcı hatasının sıfır tokenla kaydı, anahtar yokken kayıt yazılmaması; günlük bütçe: dünkü ve başka şirketteki kullanım sayılmaz, kullanıcı sınırı, aynı şirketteki başka kullanıcı, şirket sınırı |

### Savunmada sorulabilecek sorular

- **"Model değişirse ne olur?"** Asistan modeli `AIProvider` arayüzüyle çağırır. Başka bir model için yalnızca ortam değişkeni ve `pricing.ts`'teki fiyat değişir; başka bir sağlayıcı için yeni bir adaptör yazılır, asistan kodu değişmez.
- **"Maliyeti nasıl biliyorsunuz?"** Her model çağrısının token sayıları API'nin cevabından `ai_runs`'a yazılır ve maliyet o anki fiyatla SQL'de hesaplanır. Mesaj başına maliyet, o mesaja bağlı satırların toplamıdır.
- **"Bir kullanıcı API anahtarınızı tüketebilir mi?"** Kullanıcı ve şirket başına günlük token bütçesi var; sınır `ai_runs`'tan okunur ve aşılınca istek modele gitmeden reddedilir. Ayrıca Anthropic konsolunda aylık harcama sınırı tanımlı (2. hafta).
- **"Model reddederse kullanıcı ne görür?"** "Asistan bu isteğe cevap veremedi" mesajını; reddedilen içerik sohbet geçmişine eklenmez, çağrı yine maliyetiyle kaydedilir.
- **"API anahtarınız yanlış bir sunucuya gidebilir mi?"** Hayır. Adres kodda sabit (`https://api.anthropic.com`); SDK'nın ortam değişkeninden adres okuması kapalı. Test, değişken başka bir adrese ayarlıyken isteğin yine Anthropic'e gittiğini doğruluyor; düzeltme geri alınınca aynı test isteğin `127.0.0.1:1337`'ye gittiğini gösterip kırılıyor.
- **"Neden temperature yok?"** Haiku 5.5 varsayılan dışı örnekleme ayarını kabul etmiyor; kullandığımız API sürümü bu alanları tamamen kaldırdı. Tutarlılık, strict araç şemaları ve sistem promptuyla sağlanıyor.

## Ajan döngüsü ve okuma araçları (`assistant` modülü, #56)

```text
kullanıcı mesajı ──► AgentLoop.run
                      1. AiService.assertWithinBudget (mesaj başına bir kez)
                      2. AiService.createTurn (tur 1 … en fazla 6)
                           model araç isterse ──► ToolRegistry.execute (paralel) ──► okuma servisleri
                           sonuçlar tek TOOL mesajında modele ──► sonraki tur
                      3. model metinle cevaplayınca biter
                      her tur: onRound([ASSISTANT, TOOL]) … son tur: onRound([ASSISTANT]) → mesajları #57 yazar
```

Kod: `apps/api/src/modules/assistant/` (`agent-loop.ts`, `tools/registry.ts`, `tools/read-tools.ts`, `tools/strict-json-schema.ts`). Araç girdileri: `packages/shared/src/assistant-tools.ts`. Ürün araması: `catalog/products.repository.ts` (`searchSimilar`).

### Kararlar

1. **Tur sınırı (mimari değişmez 10).** Mesaj başına en fazla 5 araç turu; son cevapla birlikte en fazla 6 model çağrısı. 6. çağrı hâlâ araç isterse araçlar çalıştırılmaz, çağrı `ai_runs`'a `AGENT_TOOL_LIMIT` koduyla yazılır ve `422 AGENT_TOOL_LIMIT` döner. 2. hafta denemesinde mesaj başına ortalama 1,75 tur yetti; sınır sonsuz döngüye ve kontrolsüz maliyete karşı.
2. **Paralel araç çağrıları tek mesajda.** Model bir turda birden fazla araç isteyebilir (denemede çoğunlukla `search_products` ile `list_warehouses` birlikte). Araçlar birlikte çalışır, sonuçlar çağrı sırasıyla tek bir TOOL mesajında döner. API bunu ister; sonuçları ayrı mesajlara bölmek modelin paralel çağrıyı bırakmasına yol açar.
3. **Kayıt defteri.** Her aracın adı, açıklaması, durum etiketi ("Ürün aranıyor"), sınıfı (`read` / `propose`), yetki kuralı (izin verilen roller) ve girdi şeması var. Modele giden strict JSON şeması `packages/shared`'daki Zod şemasından üretilir; aynı şema sunucuda girdiyi yeniden doğrular. Strict modun desteklemediği kurallar (uzunluk, sayı sınırı, desen) modele giden şemadan çıkarılır ve yalnızca Zod'da kalır. Kayıt defteri `confirm_` ya da `apply_` ile başlayan bir aracı reddeder (mimari değişmez 2). `propose` araçları 5. haftada geldi (Öneri araçları bölümü, #74).
4. **Hata konuşmayı kesmez.** Bilinmeyen araç, yetkisiz rol, şemaya uymayan girdi ve aracın hatası modele `is_error: true` sonucuyla döner; model buna göre soru sorar ya da başka bir yol dener. Servisin Türkçe hatası ("Ürün bulunamadı.") modele aynen gider. Beklenmeyen hatanın ayrıntısı yalnızca loga yazılır, modele genel bir mesaj gider.
5. **Kimlik oturumdan (mimari değişmez 5).** Araçlar şirketi, rolü ve kullanıcıyı `ToolContext`'ten alır; hiçbir aracın girdisinde şirket ya da kullanıcı alanı yok. Şemalar `strictObject`: model fazladan bir `organization_id` yazsa bile girdi reddedilir.
6. **Araçlar ekranların okuma servislerini kullanır.** `get_stock` ve `list_recent_movements`, mobil ürün detayının kullandığı `StockService`'i çağırır. Depo yetkisi ekranlardakiyle aynıdır: çalışan yalnızca yetkili olduğu depoları görür, toplam da onların toplamıdır; yetkisiz bir depoyu açıkça sorarsa "yetkisi yok" cevabını alır. Başka şirketin ürünü "bulunamadı" görünür. Rakamlar veritabanından gelir, toplamı SQL hesaplar (2. hafta denemesinde model toplamı kendisi hesaplamıştı).
7. **Miktarlar metin olarak, sondaki sıfırlar atılarak.** Veritabanı "1412.500" döner; "120.000" ise Türkçede yüz yirmi bin diye okunur ve model bunu kullanıcıya olduğu gibi aktarabilirdi. 4. haftada araçlar miktarı Türkçe yazımla ("1.412,5", `formatDecimal`) veriyordu. **21 Kasım'dan beri (#86)** binlik ayırıcısız ve ondalık noktalı veriyor ("1412.5", `assistant/tools/model-number.ts`): değerlendirmede model "2.000 adet"i "2 adet" okudu. Bu, modelin araçlara gönderdiği biçimle aynı; kullanıcıya Türkçe yazımla yazmasını `chat-v3` söyler. JS'te hesap yok (ADR-003). Tarihler Türkiye saatiyle ("05.11.2026 14:32"): model saat dilimi çevirmez.
8. **Benzerlik araması.** Skor, düz benzerlik ile kelime benzerliğinin büyüğüdür: kısa bir sorgu ("priz") uzun bir adda ("Topraklı priz, beyaz") düz benzerlikte 0,25, kelime benzerliğinde 1,0 çıkar. Kelime eşiği varsayılan 0,6 yerine 0,4: demo verisinde İngilizce klavyeyle yazılmış "kacak akim" (0,57) ve "uclu priz" (0,50) varsayılanın altında kalıyordu. Eşik yalnızca aramanın transaction'ında ayarlanır (`set_config(..., true)`), havuzdaki bağlantıya sızmaz. Ad ve alternatif ad trigram indeksini kullanır; stok kodu ya da barkod tam eşleşirse skor 1. Aday bir alternatif adla bulunduysa o ad da döner. Pasif ürün aday olmaz.
9. **Mesajları döngü yazmaz.** Döngü her turun mesajlarını `onRound` ile verir: araç turunda [ASSISTANT, TOOL] birlikte, son turda [ASSISTANT]. Araç çağrısı yazılıp sonucu yazılmadan sunucu çökseydi geçmiş bozulurdu, çünkü API her `tool_use` bloğunun ardından sonucunu ister. İkisi birlikte verilince sohbet uçları (#57) onları tek transaction'da yazabilir.
10. **Geçmiş değişmeden büyür.** Saklanan TOOL mesajı API'ye `user` rolüyle, içeriği değişmeden gider. Sistem promptu ve araç listesi her turda aynıdır (araçların sırası sabit). Süren bir sohbet başladığı prompt sürümüyle devam eder (`promptVersion`).

### Araçlar

| Araç | Girdi | Çıktı |
| --- | --- | --- |
| `search_products` | `query` | En iyi 5 aday: `product_id`, `sku`, `name`, `base_unit`, `score` (0–1), `matched_alias` |
| `list_warehouses` | — | Kullanıcının görebildiği aktif depolar: `warehouse_id`, `name`, `type` (Depo / Şube / Araç) |
| `get_stock` | `product_id`, isteğe bağlı `warehouse_id` | `total`, depo başına `quantity` ve `below_min_stock`, `min_stock`, `base_unit` |
| `list_recent_movements` | `product_id`, isteğe bağlı `warehouse_id` ve `limit` (1–20, varsayılan 10) | `total`; hareketler: `date`, `warehouse`, `type`, `quantity_change` (işaretli), `quantity_after` |

### Testler

| Test | Ortam | Ne doğrular |
| --- | --- | --- |
| `apps/api/test/assistant-tools.spec.ts` | CI | Strict şemalar (desteklenmeyen kural yok, isteğe bağlı alanlar, uuid biçimi); `confirm_` aracının reddi; bilinmeyen araç, şemaya uymayan girdi, fazladan `organization_id`, rol kuralı; servis hatası ve beklenmeyen hata; Türkçe miktar ve tarih biçimi; çalışanın depo yetkisi |
| `apps/api/test/agent-loop.spec.ts` | CI (sahte sağlayıcı) | İki araç turu ve son cevap; paralel çağrıların tek mesajda dönmesi; geçmişin ve düşünme bloklarının değişmeden büyümesi; araç durumu ve metin olayları; tur sınırı ve `AGENT_TOOL_LIMIT` kaydı; bütçe dolunca modelin hiç çağrılmaması; hatalı girdinin modele hata olarak dönmesi; red; prompt sürümü; TOOL → `user` |
| `apps/api/test-db/assistant-tools.db.spec.ts` | Gerçek veritabanı (`pnpm db:test`) | Yazım hatalı arama ("kabllo nym 3x2,5"), "yangin" / "YANGIN KABLOSU", alternatif ad ("üçlü priz", "uclu priz"), stok kodu; pasif ve başka şirketin ürünü aday olmaz; stok toplamı ve depo yetkisi; başka şirketin ürünü ve deposu; hareketler ve depolar |

### Savunmada sorulabilecek sorular

- **"Model başka şirketin stoğunu sorabilir mi?"** Hayır. Araç girdisinde şirket alanı yok; şirket oturumdan gelir ve şema fazladan alanı reddeder. Başka şirketin ürün kimliği bilinse bile servis "bulunamadı" döner.
- **"Model sonsuz döngüye girerse?"** 5 araç turundan sonra durur; kullanıcı Türkçe bir hata görür, çağrı `ai_runs`'ta `AGENT_TOOL_LIMIT` koduyla işaretlidir.
- **"Model aracı yanlış girdiyle çağırırsa?"** Girdi Zod şemasıyla doğrulanır; uymazsa araç çalışmaz, hata modele döner ve model düzeltir ya da kullanıcıya sorar.
- **"Miktarları neden metin olarak veriyorsunuz?"** Ondalık sayı JS'te tam tutulamaz ve veritabanının "120.000" biçimi Türkçede yüz yirmi bin diye okunur. Miktar sondaki sıfırları atılmış, binlik ayırıcısız metin olarak verilir ("1412.5"; Türkçe binlik ayırıcıyı model ondalık sandı, #86), toplamı SQL hesaplar.

## Sohbet uçları ve cevabın akışı (SSE, #57)

| Uç nokta | Ne yapar |
| --- | --- |
| `POST /v1/conversations` | Yeni sohbet açar (başlık ilk mesajdan konur) |
| `GET /v1/conversations?page=&pageSize=` | Kullanıcının aktif şirketteki sohbetleri, en son konuşulan önce |
| `GET /v1/conversations/{id}/messages` | Ekranda gösterilen mesajlar: kullanıcının yazdıkları ve asistanın metin cevapları; araç sonuçları ve düşünme blokları gönderilmez. Her mesajda `operationIds`: altında gösterilecek işlem kartları (#75) |
| `POST /v1/conversations/{id}/messages` | Gövde `{ clientMessageId, text }`; cevap `text/event-stream` olarak akar |

Kod: `apps/api/src/modules/assistant/` (`conversations.controller.ts`, `conversations.service.ts`, `conversations.repository.ts`, `sse-stream.ts`). Şemalar: `packages/shared/src/conversations.ts`.

**Akışın olayları** (`chatStreamEventSchema`): her olay `event: <tür>` ve JSON `data:` satırıdır.

```text
event: message_started   {"messageId": "...", "clientMessageId": "..."}   mesaj kaydedildi
event: tool_status       {"tool": "search_products", "label": "Ürün aranıyor", "status": "started"}
event: tool_status       {... "status": "succeeded"}
event: operation_card    {"operationId": "...", "version": 1}              yalnızca öneri aracından sonra (#75)
event: text_delta        {"text": "Merkez Depo’da "}                       parça parça
event: text_delta        {"text": "1.400 metre var."}
event: done              {"messageId": "...", "text": "<son cevap>", "replayed": false}
: ping                                                                    15 saniyede bir, olay değil
```

Akış her zaman `done` ya da `error` (`{ code, message }`) ile biter. `done.text` son cevabın metnidir; istemci akan parçaları bununla değiştirir.

### Kararlar

1. **Tekrar gönderim (mimari değişmez 6).** İstemci her mesaj için bir kimlik (`clientMessageId`, UUID) üretir ve ağ hatasında aynı kimlikle tekrar gönderir; (sohbet, `client_message_id`) veritabanında benzersizdir. Aynı kimlik gelirse: cevap tamamlanmışsa kayıtlı cevap `replayed: true` ile döner, model çağrılmaz; cevap sürüyorsa `409 MESSAGE_IN_PROGRESS`; başarısız olduysa yeni kayıt açılmadan aynı mesaj için cevap yeniden üretilir.
2. **Sohbette tek cevap.** Bir sohbette cevap sürerken yeni mesaj `409 CONVERSATION_BUSY` alır. Cevap başlarken sohbet satırı kısa bir transaction'da `FOR UPDATE` ile kilitlenir: aynı anda gelen iki istek sırayla karar verir. Kilit yalnızca bu kararı kapsar (5–6 sorgu); model çağrısını kapsamaz. Sıra numarasının benzersizliği (#54) son savunma hattıdır.
3. **Model akarken veritabanı bağlantısı tutulmaz.** Supabase'in oturum havuzu 15 istemciyle sınırlı; bir cevap birkaç saniye, araç turlarıyla daha uzun sürebilir. Veritabanına yalnızca cevap başlarken (kısa transaction), her tur bitince (o turun mesajları tek ifadeyle) ve en sonda (mesaj durumu) gidilir.
4. **İstemci koparsa cevap tamamlanır.** Model çağrısı istemcinin bağlantısına bağlı değildir; kopmuş bağlantıya yazma sessizce atlanır, cevap kaydedilir. Kullanıcı aynı kimlikle tekrar gönderince kayıtlı cevabı alır, model ikinci kez çağrılmaz. Sahada telefonun bağlantısı sık kopar; cevabı yarıda bırakmak hem maliyeti boşa harcar hem geçmişi yarım bırakırdı.
5. **Yarıda kalan cevap.** Sunucu cevap sürerken yeniden başlarsa kullanıcı mesajı `IN_PROGRESS` kalır. Sohbet 5 dakikadır hareketsizse (her tur sohbeti "dokunur") bu mesaj başarısız sayılır ve tekrar gönderilebilir. Tek bir model çağrısı yeniden denemelerle en fazla 3 dakika sürdüğü için 5 dakika, süren bir cevabı yanlışlıkla kesmez.
6. **Kararlar akış açılmadan verilir.** Doğrulama, sohbet sahipliği (404), tekrar gönderim ve meşgul sohbet (409) akış açılmadan denetlenir; bu hatalar normal JSON hata gövdesiyle döner. Akış açıldıktan sonraki hatalar (model hatası, bütçe, araç sınırı) `error` olayıyla gelir ve mesaj başarısız olarak kalır.
7. **Sohbeti yalnızca sahibi görür.** Bütün sorgular şirket ve kullanıcıyla sınırlanır; başka kullanıcının ya da başka şirketin sohbeti `404 CONVERSATION_NOT_FOUND` döner (varlığı sızmaz). Veritabanındaki RLS politikası da aynı kuralı uygular (#54).
8. **Süren sohbet başladığı prompt sürümüyle devam eder.** Sürüm, sohbetin kullanıcı mesajlarına bağlı ilk `ai_runs` kaydından okunur (sorgu yalnızca `ai_runs`'a bakar; modül sınırı).
9. **Nest'in `@Sse()` dekoratörü kullanılmadı.** O dekoratör yalnızca GET isteğiyle çalışır; mesaj gövdeyle POST edildiği için Express yanıtına doğrudan yazılır. Başlıklar: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` (ara vekil sunucular cevabı biriktirmesin), başlıklar hemen gönderilir.

### Render ve `: ping`

Render'ın belgelerine göre (6 Kasım 2026'da okundu):

- Ücretsiz plandaki servis 15 dakika gelen trafik olmazsa uyur; bir dakikada uyanır ([render.com/docs/free](https://render.com/docs/free)).
- WebSocket için sabit bir zaman aşımı yoktur; bağlantılar deploy gibi durumlarda kapanır ve iki tarafın aralıklarla canlı tutma mesajı göndermesi önerilir (örnekte 30 saniye) ([render.com/docs/websocket](https://render.com/docs/websocket)). Uzun HTTP akışı için ayrı bir süre ya da tamponlama belgelenmemiş.

Bu yüzden akış boyunca 15 saniyede bir `: ping` yorum satırı gönderilir: model ya da araç uzun sürdüğünde aradaki vekil sunucular ve mobil ağlar bağlantıyı boşta sanıp kesmesin. Bir cevap normalde bundan kısa sürer (2. hafta denemesinde akışsız istekle mesaj başına medyan 4,13 saniye); ping çoğu cevapta hiç gönderilmez. **Ölçüldü (#60, 7 Kasım 2026):** Render akışı biriktirmeden iletiyor; ilk metin parçasından son olaya kadar istemcide geçen süre sunucudakiyle neredeyse aynı (fark 70–115 ms). 17,9 saniyelik bir cevapta akış 11,5 saniye sessiz kaldı, arada bir `: ping` geldi ve bağlantı kopmadı. 30 saniyeden uzun bir sessizlik denenmedi. Ayrıntı: Kapı denemesi bölümü.

### Hata kodları (sohbet)

| Durum | Kod | Ne zaman |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | `clientMessageId` UUID değil, metin boş ya da 2.000 karakterden uzun |
| 404 | `CONVERSATION_NOT_FOUND` | Sohbet yok, başka kullanıcının ya da başka şirketin |
| 409 | `MESSAGE_IN_PROGRESS` | Aynı mesajın cevabı hâlâ hazırlanıyor |
| 409 | `CONVERSATION_BUSY` | Sohbette başka bir mesajın cevabı hâlâ hazırlanıyor |
| `error` olayı | `AI_*`, `AGENT_TOOL_LIMIT`, `INTERNAL_ERROR` | Akış açıldıktan sonraki hatalar (yukarıdaki tablolar) |

### Testler

| Test | Ortam | Ne doğrular |
| --- | --- | --- |
| `apps/api/test/conversations-rules.spec.ts` | CI | SSE yazıcısı: başlıklar, olay biçimi, ping aralığı, kopmuş bağlantıya yazmama; ekranda gösterilen mesajlar; kayıtlı cevabın bulunması; sohbet başlığı; mesaj şeması |
| `apps/api/test/conversations.e2e.spec.ts` | CI | Dört uçta kimliksiz istek (401), şirket başlığı olmadan istek, şemaya uymayan mesaj (400, akış açılmaz) |
| `apps/api/test-db/conversations.db.spec.ts` | Gerçek veritabanı (`pnpm db:test`, sahte sağlayıcı) | Olay sırası; mesajların sırasıyla kaydı, başlık ve `ai_runs` bağlantısı; ekranda gösterilen mesajlar; aynı kimlikle tekrar (model çağrılmaz); 409 `MESSAGE_IN_PROGRESS` ve `CONVERSATION_BUSY`; 5 dakikadır hareketsiz sohbette yarıda kalan cevabın yeniden üretilmesi; model hatasında `error` olayı ve tekrar gönderim; başka kullanıcının ve başka şirketin sohbeti (404); istemci koptuğunda cevabın tamamlanıp kaydedilmesi |

### Savunmada sorulabilecek sorular

- **"Ağ koptu, kullanıcı mesajı tekrar gönderdi; model iki kez mi çağrılır?"** Hayır. Mesaj istemcinin ürettiği kimlikle gelir; aynı kimlik ikinci kez gelince cevap tamamlanmışsa kayıtlı cevap döner, sürüyorsa 409 verilir.
- **"Neden WebSocket değil SSE?"** Cevap tek yönlü akıyor (sunucudan istemciye); SSE düz HTTP üzerinde çalışır, kimlik doğrulama ve CORS diğer uçlarla aynı kalır. Mobilde `expo/fetch`, web'de `fetch` akışı okuyabilir. Teknik araştırma raporundaki yığın kararı da bu.
- **"Model cevap üretirken veritabanı bağlantısı açık mı kalıyor?"** Hayır. Bağlantı yalnızca cevap başlarken, her tur bitince ve en sonda kısa sorgular için alınır; havuz 15 istemciyle sınırlı olduğu için bu önemli.
- **"İki kişi aynı sohbete aynı anda yazarsa?"** Sohbeti yalnızca sahibi görür. Aynı kullanıcı iki cihazdan aynı anda yazarsa sohbet satırı kilitlenir; ikinci mesaj 409 alır, sıra numarası benzersizliği de son savunma hattıdır.

## Mobil sohbet ekranı (#58)

Giriş yapınca sohbet açılır (ana ekran). Kullanıcı sorusunu yazar ya da **Konuş**'a basar; tanınan metin kutuya yazılır, kullanıcı düzeltip **Gönder**'e basar. Cevap parça parça görünür; araç çalışırken "Ürün aranıyor…" gibi bir durum satırı çıkar. Başlıkta **Sohbetler** (geçmiş ve yeni sohbet) ve **Stok** (3. haftanın stok listesi) var. Yeni sohbet ilk mesajla açılır: önce `POST /v1/conversations`, ardından mesajın akışı.

Kod: `apps/mobile/src/app/index.tsx` (ana ekran) ve `apps/mobile/src/chat/` (`use-chat.ts` gönderim ve tekrar gönderme, `stream.ts` expo/fetch, `use-speech-input.ts` ses, `chat-parts.tsx`, `composer.tsx`, `conversation-picker.tsx`). Akışın okunması `packages/api-client/src/chat-stream.ts`'te, turun durumu `chat-turn.ts`'te (#59'da ortak pakete taşındı); web paneli ikisini de kullanıyor.

### Kararlar

1. **Akış tipli istemciden okunur.** `streamChatMessage` isteği `packages/api-client`'ın tipli istemcisiyle gönderir: yol, gövde, oturum ve şirket başlıkları öbür isteklerle aynı ara katmandan gelir. Yalnızca cevabın gövdesi JSON yerine akış olarak alınır (`parseAs: 'stream'`). SSE satırları istemcide ayrılır ve her olay `chatStreamEventSchema` ile doğrulanır; tanınmayan olay atlanır, sunucuya yeni olay türü eklenince eski uygulama bozulmaz. Elle yazılmış ayrı bir fetch çağrısı yok.
2. **Mobilde `expo/fetch`.** React Native'in eski fetch'i cevabı ancak tamamı gelince verir; `expo/fetch` gövdeyi parça parça verir. Expo 57 genel fetch'i zaten `expo/fetch` ile değiştiriyor; sohbet onu yine de açıkça kullanıyor, akış bu ayara bağlı kalmasın. Parçaları metne çeviren `TextDecoder` de Expo'nun çalışma ortamında hazır geliyor; yeni paket eklenmedi.
3. **Tekrar gönderme elle.** Her mesaja istemcide bir kimlik (`clientMessageId`, UUID) verilir. Ağ hatası, kopan akış ya da model hatasında mesajın altında Türkçe hata ve **Tekrar gönder** çıkar; düğme mesajı aynı kimlikle gönderir. Cevap sunucuda tamamlanmışsa kayıtlı cevap gelir, model ikinci kez çağrılmaz; cevap hâlâ sürüyorsa API'nin "hâlâ hazırlanıyor" mesajı (409) gösterilir. Kendiliğinden tekrar denenmez: kullanıcı ne olduğunu görür, ikinci gönderim onun kararıdır.
4. **Uygulama kapansa da başarısız mesaj görünür.** Geçmişte son kullanıcı mesajının cevabı başarısızsa "Bu mesaja cevap alınamadı." ve **Tekrar gönder** çıkar; cevap hâlâ sürüyorsa "Cevap hâlâ hazırlanıyor." ve **Yenile**. Yalnızca son mesaj için: daha eski bir mesaj sonradan cevaplanırsa sohbetin sırası bozulurdu.
5. **Akan cevap ile kayıtlı geçmiş.** Gönderilen mesaj, cevabı bitene kadar ekranda yerel bir "tur" olarak durur. `done` gelince sohbetin mesajları yeniden yüklenir; kayıtlı mesajlar cevabı içerince tur ekrandan çekilir, yerini kayıtlı mesajlar alır. Kullanıcı ekrandan çıkar ya da başka sohbete geçerse akışın okunması durur; sunucu cevabı tamamlayıp kaydeder, sohbete dönülünce cevap görünür (#57).
6. **Kopan akış.** `done` ya da `error` gelmeden biten akış `STREAM_INTERRUPTED` olur: "Bağlantı koptu. Cevap sunucuda tamamlanmış olabilir; tekrar gönderince kaydedilen cevap gelir." Son olaydan sonra kopan bağlantı cevabı bozmaz.
7. **Ses kutuya yazılır, kendiliğinden gönderilmez.** Tanıma telefonun ses tanıma servisiyle yapılır (`expo-speech-recognition`, `tr-TR`, ara sonuçlarla). 1. hafta denemesinde ürün kodları ve bazı ölçüler yanlış tanındı (`eval/ses-denemesi.md`); bu yüzden kullanıcı metni görüp düzeltir. 1. haftanın deneme ekranı (`/speech-test`) kaldırıldı.
8. **Tek eylem düğmesi.** Tasarımdaki gibi kutunun sağında tek ana düğme var: kutu boşken **Konuş**, dinlerken **Dur**, kutuda metin varken **Gönder**. İkon kütüphanesi yeni bağımlılık olduğu için eklenmedi; düğmeler metinli.
9. **Gezinme.** Sohbet ana ekran oldu; stok listesi `/stock`'a taşındı ve başlıktaki **Stok**'tan açılıyor. Tasarımdaki alt sekme çubuğu (Sohbet, Stok, İşlemlerim) ikon gerektirdiği ve "İşlemlerim" ekranı henüz olmadığı için yapılmadı.
10. **İstemci kimliği.** React Native'de `crypto.randomUUID` yok; kimlik UUID v4 biçiminde `Math.random` ile üretiliyor (`randomUuid`, `packages/api-client/src/chat-turn.ts`). Gizli bir değer değil, yalnızca kendi sohbetinde benzersiz olması gerekiyor; bunun için `expo-crypto` eklenmedi.
11. **Klavye.** Mesaj kutusu klavyenin üstünde kalsın diye `KeyboardAvoidingView` kullanılıyor; ekran başlığının yüksekliği, ekranın pencere içindeki konumu ölçülerek veriliyor. Klavye kapalıyken kutu telefonun alt çubuğunun üstünde durur.
12. **Ses uyarısı son denemeyle ilgilidir (#73).** "Ses algılanmadı" gibi bir uyarı yeni bir **Konuş** denemesinde, kullanıcı kutuya yazmaya başlayınca ya da mesajı gönderince kalkar. 4. hafta kapı denemesinde uyarı sonraki mesajlar gönderildiği hâlde ekranda kalıyordu; kullanıcı yeni mesajda da bir sorun olduğunu sanabilirdi.
13. **İşlem kartı (#76).** Asistan öneri hazırlayınca sohbette kart çıkar (`src/chat/operation-card.tsx`; `docs/tasarim.md` "İşlem kartı (sohbet)", `docs/tasarim/1-mobil-sohbet.png`).
    - **Ne gösterir:** İşlem türü ve rozet ("ONAY BEKLİYOR"); kalem başına ürün, miktar (girilen birim ve ana birim, "2 koli (40 adet)"), depo (transferde "Merkez Depo → Ostim Depo"), stoğun önceki ve sonraki hâli; cari ve not. Altta "Onaylamadan stok değişmez."
    - **Nereden okur:** Kart işlemin güncel hâlini önizleme ucundan okur. Akışta kart, `operation_card` gelince cevabın metninden önce görünür; sohbet yeniden açılınca `operationIds` ile turun cevabının altında. Öneri sohbette düzenlenince akışta yeni sürüm gelir ve kart yeniden okunur.
    - **Onayla:** Asistandan geçmez, `POST /v1/operations/{id}/confirm`'e doğrudan gider (mimari değişmez 2). `Idempotency-Key` o sürümün ilk onay denemesinde üretilir. Aynı sürümün bütün denemeleri (çift dokunma, ağ hatasından sonra tekrar) aynı anahtarla gider ve stok bir kez değişir. Anahtar bir ref'te tutulduğu için aynı anda iki dokunuşta da aynıdır. Öneri düzenlenip sürüm değişince yeni anahtar üretilir. İstek sürerken düğmeler kapalıdır.
    - **Hatalar:** Sürüm değiştiyse ("Öneri değişti"), başka cihazdan onaylandıysa, süre dolduysa ya da stok yetmiyorsa kart Türkçe açıklamayı gösterir ve kendini yeniden okur. Ağ hatasında kart yenilenmez; mesaj tekrar denemenin güvenli olduğunu söyler.
    - **Durumlar:** Uygulandı (yeşil), iptal edildi ve süresi doldu (gri). Stok yetmeyen kalemde eksi değer yerine "35 adet var, 40 adet gerekiyor" yazar; Onayla kapalı, Düzenle ve İptal açıktır. Son onay anı geçince kart cihazın saatiyle kendiliğinden "Süresi doldu" olur; asıl kontrol sunucuda, onayda kilit altında.
    - **Düzenle:** Ayrı bir form açmaz. Mesaj kutusuna odaklanır ve ipucunu "Neyi değiştirelim? (ör. 3 koli olsun)" yapar; asistan aynı öneriyi düzenler (#74, karar 8 Kasım).
    - **Ortak mantık:** Kartın ne göstereceği, hangi düğmenin açık olduğu, anahtarın ne zaman yenileneceği ve hataların anlamı `packages/api-client/src/operation-card.ts`'te; web kartı (#77) aynısını kullanır. Mobilde test altyapısı olmadığı için bu kurallar orada test edilir.
    - **Bağımlılık:** Yeni paket yok; düğmeler metinli, durum noktası ve rozet temadaki renklerle.

### Ekranda görünen hatalar

| Durum | Gösterilen |
| --- | --- |
| Sunucuya ulaşılamadı (`NETWORK_ERROR`) | "API'ye ulaşılamadı. Sunucu uykudaysa bir dakika sonra tekrar deneyin." |
| Akış koptu (`STREAM_INTERRUPTED`) | "Bağlantı koptu. Cevap sunucuda tamamlanmış olabilir; tekrar gönderince kaydedilen cevap gelir." |
| 409, 404 ve akıştaki `error` olayı (`AI_*`, `AGENT_TOOL_LIMIT`) | API'nin Türkçe mesajı (yukarıdaki tablolar) |
| Ses: izin yok, servis yok, ses algılanmadı, Türkçe yok, internet yok | Mesaj kutusunun üstünde Türkçe açıklama (`use-speech-input.ts`); yeni ses denemesinde, kutuya yazınca ya da mesaj gönderilince kalkar |

İlk mesaj gönderilirken "Gönderiliyor… Sunucu uykudaysa ilk cevap bir dakika sürebilir." yazar: Render'daki ücretsiz servis 15 dakika istek almazsa uyur.

### Testler

| Test | Ortam | Ne doğrular |
| --- | --- | --- |
| `packages/api-client/test/chat-stream.spec.ts` | CI | SSE satırları (`: ping`, çok satırlı `data`, `\r\n`); satırın ve çok baytlı Türkçe harfin ortasında bölünen parçalar; yarım kalan son olayın atılması; isteğin yolu, oturum ve şirket başlıkları ve gövdesi; olayların sırası ve son olay; tanınmayan ve bozuk olayın atlanması; `error` olayı; 409'un API koduyla fırlaması; son olay gelmeden biten ya da kopan akış (`STREAM_INTERRUPTED`); son olaydan sonra kopan bağlantı |

Mobil pakette test altyapısı yok. Ekran 7 Kasım 2026'da Android development build'de, Render'daki API'ye karşı elle denendi: yazarak ve sesle stok sorusu (cevaplar stok ekranındaki miktarlarla aynı), cevabın parça parça gelmesi, klavye, ağ hatasında tekrar gönderme ve sohbet geçmişi. Süre, ilk metin parçasına kadar geçen süre, token ve maliyet kapı denemesinde (#60) ölçüldü.

### Savunmada sorulabilecek sorular

- **"Telefon cevabı nasıl parça parça gösteriyor?"** Sunucu cevabı SSE olarak akıtıyor. Uygulama `expo/fetch` ile gövdeyi parça parça okuyor, satırları olaylara ayırıyor ve her `text_delta` parçasını ekrandaki cevabın sonuna ekliyor. `done` gelince cevap, kaydedilen metnin tamamıyla değiştiriliyor.
- **"Ağ koptu; kullanıcı ne görüyor?"** Mesajın altında "Bağlantı koptu…" ve **Tekrar gönder**. Düğme aynı istemci kimliğiyle gönderiyor; cevap sunucuda tamamlandıysa kayıtlı cevap geliyor, model ikinci kez çağrılmıyor.
- **"Sesle söylenen mesaj neden kendiliğinden gönderilmiyor?"** Ses tanıma ürün kodlarında ve ölçülerde yanılabiliyor (1. hafta denemesi). Kullanıcı tanınan metni görüp düzeltiyor; yanlış ürünle soru sorulmuyor.
- **"Ses kaydı nereye gidiyor?"** Ambarcı'nın sunucusuna gitmiyor ve hiçbir yerde saklanmıyor; sunucuya yalnızca tanınan metin gidiyor. Tanımayı telefonun ses tanıma servisi yapıyor (Android'de Google'ın servisi); bu servis tanıma için internet kullanabilir.

## Web sohbet paneli (#59)

Panelin her sayfasında, sol menüdeki **Asistana sor** düğmesi sağda bir sohbet paneli açar. Panel sayfayı kapatmaz: yönetici stok listesine bakarken soru sorabilir. Geniş ekranda (1280 px ve üstü) panel açıkken içerik onun solunda kalır; dar ekranda panel sayfanın üstüne açılır. Başlıkta **Sohbetler** (geçmiş), yeni sohbet ve kapat düğmeleri var; **Esc** paneli kapatır. Mesaj kutusunda Enter gönderir, Shift+Enter yeni satır açar.

Kod: `apps/web/components/chat/` (`chat-panel.tsx` panel ve açık sohbet, `use-chat.ts`, `chat-rows.tsx`, `chat-composer.tsx`, `conversation-list.tsx`, `use-chat-panel-open.ts`) ve `apps/web/components/app-shell.tsx` (düğme ve panelin yeri).

### Kararlar

1. **Mobille aynı kural, aynı kod.** Olay şeması `packages/shared`'da (#57). Akışın okunması (`chat-stream.ts`) ile turun durumu ve kayıtlı geçmişle birleştirilmesi (`chat-turn.ts`) `packages/api-client`'ta; mobil ve web ikisini de kullanıyor. Tur mantığı #58'de mobilin içindeydi; bu işte ortak pakete taşındı ve testlendi. Her uygulamada kalan yalnızca React kancası (sorgu, gönderim, iptal) ve görünüm: React Query'nin tek kopyası her uygulamada kurulur (ADR-005).
2. **Tekrar gönderme.** Mobildekiyle aynı: her mesaja istemcide bir kimlik verilir; hata olunca mesajın altında Türkçe açıklama ve **Tekrar gönder** çıkar, düğme mesajı aynı kimlikle gönderir. Tarayıcının fetch'i cevabın gövdesini parça parça verdiği için akış tipli istemcinin kendi fetch'iyle okunur; ayrı bir fetch kodu yok.
3. **Şirket değişince o şirketin sohbetleri.** Panel, aktif şirketin istemcisi ve sorgu önbelleğinin içinde kurulur. Şirket değişince bu katman baştan kurulur (organization-provider.tsx); panel yeni şirketin sohbet listesini gösterir, önceki şirketin sohbeti ekranda kalamaz. Sunucu da her sorguyu şirket ve kullanıcıyla sınırlar (#57).
4. **Panel sayfalar arasında kurulu kalır.** Panel oturumlu sayfaların ortak düzeninde (`app/(app)/layout.tsx` → `AppShell`) durur; sayfa değişince yeniden kurulmaz, akan cevap kesilmez. Kapatılınca gizlenir ama sohbet kaybolmaz. Açık olup olmadığı tarayıcıda hatırlanır; sunucuda çizilen sayfa bunu bilmediği için `useSyncExternalStore` ile sayfa açıldıktan sonra okunur (sunucu ve tarayıcı çıktısı uyuşmazlığı olmaz).
5. **Kaydırma en altta durur.** Mesaj listesi ters sütunlu (`flex-col-reverse`) bir kaydırma kutusunun içinde tek bir kutudur: tarayıcı kaydırmayı kendiliğinden en altta tutar, yeni parça gelince altta kalır; JavaScript gerekmez. İç kutudaki sıra eskiden yeniye olduğu için ekran okuyucu mesajları doğru sırayla okur. Liste `role="log"` ve cevap sürerken `aria-busy`: ekran okuyucu her parçayı ayrı ayrı okumaz. İç kutu küçülmez (`shrink-0`): #74 denemesinde uzun bir sohbette iç kutu kaydırma kutusunun boyuna kadar küçüldü, mesajlar alt kenarından taştı ve ters sütunda alttan taşan kısım kaydırılamadığı için son cevap kesik kaldı. 4. haftanın kısa cevaplarında bu görünmemişti.
6. **Ses yok.** Web paneli masa başındaki yönetici içindir; ses düğmesi yalnızca mobilde.
7. **İstemci kimliği güvenli olmayan sayfada da üretilir.** Tarayıcıda `crypto.randomUUID` yalnızca güvenli bağlamda (https, localhost) var. Panel başka bir cihazdan bilgisayarın ağ adresiyle (http) açılırsa kimlik `Math.random` ile üretilir (`randomUuid`, `chat-turn.ts`).
8. **Kalın yazı, mobilde de (#73).** Model bazı cevaplarda Markdown kalın yazı (`**…**`) kullanıyor; düz metinde yıldızlar görünüyordu. Ortak paketteki `splitBoldText` (`packages/api-client/src/bold-text.ts`) cevabı düz ve kalın parçalara ayırır; web `<strong>` (600 ağırlık), mobil iç içe `AppText` (`bodyLgBold`) ile gösterir. İç içe metin olduğu için satır kaydırma ve metin seçme tek metindeki gibi çalışır. Markdown kütüphanesi eklenmedi (yeni bağımlılık yok): yalnızca kalın yazı desteklenir; başlık, liste ya da italik işaretleri olduğu gibi görünür. Kapanmamış işaret düz kalır: akış sürerken `**180 ad` önce yıldızlarıyla, kapanış gelince kalın görünür. Kullanıcının kendi mesajı biçimlendirilmez; yazdığı yıldızlar olduğu gibi kalır. "Markdown kullanma" kuralı prompt'un yeni sürümüne (`chat-v2`, #74) eklenecek; görünüm yine de düzeltildi, çünkü süren sohbetler `chat-v1` ile devam ediyor ve model kuralı her zaman tutmayabilir.
9. **İşlem kartı panelde de (#77).** Asistanın önerisi panelde mobildekiyle aynı kart olarak çıkar (`components/chat/operation-card.tsx`).
   - **Aynı kart:** Alanlar, rozet, düğmeler, stok yetmeyen kalemin açıklaması ve süre dolunca kapanan düğmeler mobil kartla aynı. Ne gösterileceği ortak paketteki `operationCardView`'dan (#76).
   - **Aynı onay kodu:** Önizleme, onay ve iptal, 3. haftanın özet sayfasıyla aynı kancadan geçer (`components/use-operation-actions.ts`). Özet sayfası (`operation-review.tsx`) bu işte o kancaya taşındı; kod kopyalanmadı. Onay anahtarı o sürümün ilk denemesinde üretilir, aynı sürümün bütün denemeleri aynı anahtarla gider; sürüm değişince yenisi.
   - **Yenileme:** Başarılı işlemden ya da durumu veya stoğu değiştiren bir hatadan sonra önizleme ve stok listeleri yeniden okunur. Ağ hatasında okunmaz: eldeki kart kalır, tekrar denenebilir.
   - **Özet sayfasına bağlantı:** Kartın altındaki bağlantı işlemin özet sayfasını açar (kalem tablosu, yazılan hareketler).
   - **Düzenle:** Mesaj kutusuna odaklanır ve ipucunu "Neyi değiştirelim? (ör. 3 koli olsun)" yapar.
   - **İki cihaz:** Telefonda açılan öneri paneldeki sohbet geçmişinde de görünür. İki yerden onaylanırsa ikinci onay farklı anahtarla gittiği için `409 OPERATION_ALREADY_APPLIED` alır; kart "başka bir cihazdan onaylanmış" der ve kendini yeniler. Stok bir kez değişir.

### Testler

| Test | Ortam | Ne doğrular |
| --- | --- | --- |
| `packages/api-client/test/chat-turn.spec.ts` | CI | Olayların tura işlenmesi (metin parçalarının eklenmesi, araç etiketinin araç bitince kalkması, `done`'ın cevabın tamamıyla değiştirmesi, `error` ve istek hatası); durum satırları; yalnızca son kullanıcı mesajına "başarısız" ya da "sürüyor" notu; tur sürerken kayıtlı kaydının gizlenmesi; cevap gelen turun geçmiş yenilenince çekilmesi; başarısız turun kayıtlı kaydın yerine gösterilmesi; `crypto.randomUUID` yokken de UUID v4 üretilmesi |
| `packages/api-client/test/chat-stream.spec.ts` | CI | Akışın okunması (#58) |
| `packages/api-client/test/operation-card.spec.ts` | CI | İşlem kartı (#76, #77): tasarımdaki alanlar ve rozet; girilen ve ana birim; transferde iki depo ve iki stok; sayımda "Sayılan"; yetmeyen stokta eksi değer yok, açıklama var, Onayla kapalı; cihazın saatiyle süre dolunca düğmeler kapalı; sonuçlanmış öneri; anahtarın aynı sürümde aynı, yeni sürümde yeni olması; hangi hatanın kartı yenilediği |
| `packages/api-client/test/bold-text.spec.ts` | CI | Kalın yazının ayrılması (#73): tek ve birden çok kalın parça, satır sonları, kapanmamış ve içi boş işaret, tek yıldız, Türkçe harfler, akış sürerken yarım gelen işaret, parçaların birleşiminin metnin kendisi olması |

Web paneli için bileşen testi yok (web paketinde test altyapısı yok); `next build` geçiyor. Panel 7 Kasım 2026'da yerelde (web `localhost:3000`, API `localhost:3001`) elle denendi: stok sorusu ve parça parça gelen cevap, cevap akarken sayfa değiştirme, geniş ve dar ekranda yerleşim, Esc ve sayfa yenilenince açık kalması, telefondan açılan sohbetlerin listede görünmesi, şirket değişince o şirketin sohbetleri, tarayıcı çevrimdışıyken hata ve aynı kimlikle tekrar gönderme. Ortak koda taşınan mobil ekran da telefonda yeniden denendi.

Denemede bulunan ortam sorunu: geliştirici bilgisayarında Windows kullanıcı değişkeni olarak `ANTHROPIC_BASE_URL=http://127.0.0.1:1337` tanımlıydı. Claude SDK'sı bu değişkeni okuduğu için yerel API istekleri o boş porta gönderdi (`AI_UNAVAILABLE`, altta `ECONNREFUSED`). Terminalde değişken kaldırılınca (`Remove-Item Env:ANTHROPIC_BASE_URL`) çalıştı. Render'da bu değişken yok. Adres #72'de kodda sabitlendi (Model çağrısı, karar 12); değişkeni kaldırmak artık gerekmiyor.

### Savunmada sorulabilecek sorular

- **"Mobil ve web aynı kuralı nasıl uyguluyor?"** Akışın okunması ve turun durumu ortak pakette (`packages/api-client`), ikisi de aynı fonksiyonları çağırıyor ve bu fonksiyonların testi var. Uygulamalarda yalnızca görünüm ve React kancası farklı.
- **"Şirket değiştirince başka şirketin sohbeti görünebilir mi?"** Hayır. Panel aktif şirketin istemcisi ve önbelleğiyle birlikte baştan kuruluyor; sunucu da sohbeti yalnızca sahibine, o şirkette gösteriyor (başkasınınki 404).
- **"Kullanıcı sayfa değiştirirse cevap yarıda kalır mı?"** Hayır. Panel bütün oturumlu sayfaların ortak düzeninde duruyor; sayfa değişse de kurulu kalıyor ve akış sürüyor. Tarayıcı sekmesi kapanırsa da cevap sunucuda tamamlanıp kaydediliyor (#57).

## Kapı denemesi ve ilk ölçüm (#60)

7 Kasım 2026'da iki ölçüm yapıldı. İkisi de Render'daki API'ye karşı, gerçek model çağrısıyla (Claude Haiku 5.5, effort `low`, prompt `chat-v1`). Asıl değerlendirme 6. haftada 100 etiketli mesajla (`pnpm eval`, [degerlendirme.md](degerlendirme.md)); buradaki sayılar küçük bir örneklemden çıkan göstergelerdir.

1. **Ölçüm betiği** (`pnpm measure:chat`, `apps/api/src/scripts/measure-chat-remote.ts`). API üzerinden geçici bir şirket kurulur: 2 depo, 6 ürün, onaylanmış giriş ve çıkış işlemleri. 9 sabit soru, her biri ayrı bir sohbette sorulur. Her akış olayının bu bilgisayara geliş zamanı ve aynı soruların `ai_runs` kayıtları okunur; sonunda geçici şirket bütün kayıtlarıyla silinir. Sonuç dosyası: `eval/sohbet/render-2026-11-07.json`.
2. **Telefon denemesi** ([eval/kapi-denemesi.md](../eval/kapi-denemesi.md)). Android development build, ABC Elektrik; 4 soru yazarak, 5 soru sesle, tek sohbette.

### Sonuçlar

| | Betik (9 soru, her biri ayrı sohbet) | Telefon (9 soru, tek sohbet) |
| --- | --- | --- |
| Doğru cevap | 9/9 | 9/9 (kullanıcının yetkili olduğu depolara göre, aşağıda) |
| Mesaj başına model çağrısı | 1–3 tur | 1–3 tur |
| İlk metin parçası, medyan | İstemcide 2,9 sn (sunucuda 2,3 sn) | Sunucuda 2,3 sn |
| Cevabın tamamı, medyan | İstemcide 3,4 sn (sunucuda 2,6 sn) | Sunucuda 2,5 sn |
| En uzun cevap | 17,9 sn (31 araç çağrısı, 3 tur) | Sunucuda 3,3 sn |
| Mesaj başına maliyet | 0,0001–0,0005 dolar; uzun soru 0,0035 dolar | 0,0001–0,0005 dolar |
| Toplam maliyet | 0,0055 dolar | 0,0029 dolar |
| Stok değiştirme isteğinden sonra stok | Değişmedi (API'den doğrulandı) | Değişmedi (kaçak akım rölesi 4 adet) |
| Başarısız model çağrısı | 0 | 0 |

"Sunucuda" süre, `ai_runs`'taki model çağrılarının toplamıdır. "İstemcide" süre, isteğin bu bilgisayardan gönderilmesinden son olayın gelmesine kadar geçen süredir. Telefonda istemci tarafı süre ölçülmedi (uygulama süre kaydetmiyor); cevabın parça parça geldiği ekranda görüldü.

### Ne anlama geliyor

- **Render akışı biriktirmeden iletiyor.** Her soruda ilk metin parçasından son olaya kadar istemcide geçen süre sunucudakiyle neredeyse aynı (fark 70–115 ms). Uzun soruda metin 2.363 ms boyunca parça parça geldi; sunucuda bu süre 2.259 ms. Render biriktirseydi bütün parçalar aynı anda gelir, istemcideki süre sıfıra yakın olurdu.
- **Uzun cevapta bağlantı ping'le sürdü.** 17,9 saniyelik cevapta model araçları çalıştırırken akış 11,5 saniye boyunca olay göndermedi; bu arada bir `: ping` geldi ve bağlantı kopmadı. 30 saniyeden uzun bir sessizlik denenmedi; ping 15 saniyede bir gittiği için böyle bir sessizlik oluşmuyor.
- **Kullanıcı boş ekran görmüyor.** İstek yaklaşık 0,3 saniyede kabul ediliyor (`message_started`), ilk araç durum satırı ("Ürün aranıyor…") 1–2 saniyede çıkıyor, ilk metin yaklaşık 3 saniyede geliyor. İlk metin toplam sürenin %85 kadarında geliyor, çünkü cevap ancak ürün bulunup stok okunduktan sonra yazılıyor.
- **Render ve ağ payı yaklaşık 0,8 saniye.** İstemcideki süre ile model çağrılarının toplamı arasındaki fark bu: evden Frankfurt'a ağ, sohbetin kilitlenip kaydedilmesi ve araçların veritabanı sorguları.
- **Önbellek çalışıyor.** Mesaj başına önbelleksiz girdi 4–8 token; girdinin geri kalanı (2.000–19.000 token) önbellekten okunuyor (milyon token başına 0,01 dolar). Aynı sohbette geçmiş uzadıkça önbellekten okunan miktar artıyor, önbelleğe yeni yazılan azalıyor. Maliyetin çoğu önbelleğe yazmadan ve çıktıdan geliyor. Bu fiyatla 1.000 soru yaklaşık 0,3 dolar tutar (medyan mesaj maliyetinden tahmin).
- **Araç turu sınırına yaklaşılmadı.** Model araçları paralel çağırıyor: 6 ürünlük soruda 6 arama, 12 stok ve 12 hareket sorgusu 3 turda bitti (sınır 5).
- **Depo yetkisi asistanda da geçerli.** Telefondaki hesap çalışan ve yalnızca Merkez Depo ile Ostim Depo'ya yetkili. "Topraklı priz toplam" sorusunda asistan bu iki deponun toplamını verdi (240); Servis Aracı 1'deki 10 adedi saymadı. "Araç deposunda otomat" sorusunda araç deposunu göremediğini söyledi. Bu doğru davranış: araçlar şirketi ve kullanıcıyı oturumdan alır ve depo yetkisini uygular (mimari değişmez 5). Deneme listesindeki beklenen cevaplar yönetici gibi bütün depolar üzerinden hesaplanmıştı; liste sonradan düzeltildi.
- **Ses tanıma.** 5 sesli sorunun tanınan metni listedeki cümleyle aynı geldi; düzeltme gerekmedi.

### Sınırlamalar ve sonraki adımlar

- **Örneklem küçük:** betikte 9, telefonda 9 soru; tek gün, tek ağ. Sayılar ölçülen değerler ama genelleme yapmaya yetmez; asıl değerlendirme 6. haftada.
- **Markdown:** Model bazı cevaplarda kalın yazı (`**…**`) kullanıyor; mobil ve web düz metin gösterdiği için yıldızlar ekranda görünüyordu. #73'te kalın yazı görünümde düzeltildi (Web sohbet paneli, karar 8). "Markdown kullanma" kuralı prompt sürümünü değiştirdiği için öneri araçlarıyla aynı sürümde (`chat-v2`, #74) gelecek.
- **"Toplam" ifadesi:** Çalışana verilen toplam, yalnızca yetkili olduğu depoların toplamı; cevap bunu açıkça söylemiyor ("toplam 240 adet"). Prompta "görebildiğin depolarda" ifadesi aynı sürümde eklenebilir.
- **Hitap:** Bir cevapta "sen" yerine "siz" kullanıldı.
- **Ses uyarısı ekranda kalıyordu:** Telefonda "Ses algılanmadı" uyarısı, sonraki mesajlar gönderildiği hâlde ekranda kaldı. #73'te düzeltildi: uyarı kutuya yazınca ya da mesaj gönderilince kalkıyor (Mobil sohbet ekranı, karar 12).
- **Telefonda süre:** Telefonda istemci tarafı süre ölçülmedi.
- **Yerel geliştirme:** Geliştirici bilgisayarında tanımlı bir `ANTHROPIC_BASE_URL` SDK'nın adresini değiştirebiliyordu (#59 denemesi, Web sohbet paneli bölümü). #72'de adres kodda sabitlendi (Model çağrısı, karar 12).

### Savunmada sorulabilecek sorular

- **"Render cevabı gerçekten parça parça iletiyor mu? Nasıl biliyorsunuz?"** Betik her parçanın bilgisayara geliş zamanını kaydetti. İlk parçadan son olaya kadar istemcide geçen süre, sunucudaki süreyle neredeyse aynı (fark 0,1 saniyenin altında). Render biriktirseydi bütün parçalar aynı anda gelirdi.
- **"Bir soru ne kadara mal oluyor?"** Çoğu soru 0,0001–0,0005 dolar; 6 ürünlük uzun soru 0,0035 dolar. Girdinin neredeyse tamamı önbellekten okunduğu için ucuz. 1.000 soru yaklaşık 0,3 dolar tutar.
- **"Kullanıcı ilk kelimeyi kaç saniyede görüyor?"** Yaklaşık 3 saniyede. Ondan önce, 1–2 saniyede "Ürün aranıyor…" gibi bir durum satırı çıkıyor.
- **"Asistan çalışana yetkisi olmadığı deponun stoğunu söyler mi?"** Hayır. Telefon denemesindeki çalışan hesabı Servis Aracı 1'i göremedi; asistan bunu söyledi ve toplamı yalnızca yetkili depolardan verdi.

## Öneri araçları ve `chat-v2` (#74)

Kullanıcı "Merkezden 2 koli üçlü priz çıkışı yap" deyince asistan ürünü ve depoyu bulur, sonra bir **öneri aracı** çağırır. Araç işlemi **onay bekleyen** olarak açar ve modele kartın bilgilerini (ürün, miktar, depo, stoğun önceki ve sonraki hâli) döner. Asistan özeti yazar ve kullanıcıdan kartı kontrol edip **Onayla**'ya basmasını ister. Stok yalnızca o düğmeyle, `POST /v1/operations/{id}/confirm` ucunda değişir.

```text
kullanıcı mesajı ──► AgentLoop (chat-v2, 10 araç)
                      search_products, list_warehouses, search_parties  ── kimlikleri bulur
                      propose_stock_out(...) ──► OperationsService.create(..., source: CHAT, sourceMessageId)
                                               ──► OperationsService.preview  (önce → sonra, SQL'de)
                      ◄── { operation_id, version, lines, insufficient_stock, next_step }
                      metin: "Çıkış önerisi hazır; kartı kontrol edip Onayla'ya bas."
kart (mobil, web; #76, #77) ──► POST /v1/operations/{id}/confirm + Idempotency-Key   ← stok yalnızca burada değişir
```

Kod: `apps/api/src/modules/assistant/tools/propose-tools.ts` (araçlar), `read-tools.ts` (`search_parties`), `registry.ts` (sürüme göre araç listesi), `apps/api/src/modules/ai/prompts/chat.v2.ts`, `apps/api/src/modules/operations/operations.service.ts` (`create`'in kaynak mesajı, `revise`). Girdiler: `packages/shared/src/assistant-tools.ts`. Migration: `packages/db/migrations/0007_operation_source_message.sql`.

### Kararlar

1. **Öneri aracı stoğa yazmaz (mimari değişmez 1 ve 2).** Araç, ekrandaki fiş formunun kullandığı doğrulama ve kayıt adımlarını kullanır (`OperationsService.create`; #79'dan beri sohbette `proposeFromChat`, aynı adımlar ve tekrar kuralı, dokuzuncu bölüm); işlem `PENDING_CONFIRMATION` ve `source: CHAT` ile açılır. Stok, hareket, ortalama maliyet ve outbox değişmez; denetim kaydına yalnızca `operation.created` (kaynak `CHAT`) yazılır. Onay ucu asistan modülünden çağrılmaz; kayıt defterinde onaylayan ya da uygulayan araç yoktur ve eklenemez.
2. **Ekrandaki kurallar araçta da geçerli.** Aracın girdisi önce 3. haftanın işlem şemasına (`createOperationSchema`) çevrilip aynı şemayla doğrulanır: transferde iki depo farklı, sayımda bir ürün bir kez, sıfır miktar yok. Sonra aynı servis ürünü, birimi, depoyu, cariyi ve depo yetkisini denetler. Kural iki yerde yazılmadığı için asistan ekranın yapamayacağı bir işlemi açamaz.
3. **Kimlikler araçlardan, şirket oturumdan (mimari değişmez 5).** Ürün `search_products`'tan, depo `list_warehouses`'tan, cari yeni `search_parties` okuma aracından gelir. Girdilerde şirket ya da kullanıcı alanı yoktur; şemalar `strictObject` olduğu için fazladan bir `organization_id` reddedilir. Başka şirketin ürün kimliği verilse bile kalem "Ürün bulunamadı." olur.
4. **Miktar kullanıcının birimiyle.** Model "2 koli" için `quantity: "2"`, `unit: "koli"` verir ve kendisi çevirmez. Ana birime çevrim SQL'de, ekrandakiyle aynı yerde yapılır (ADR-003). Miktar metindir ve ondalık ayırıcı noktadır; "2,5" yazılırsa şema hata verir, model düzeltir.
5. **Hata modele işe yarar biçimde döner.** Kalem hatasında genel mesaj ("İşlemin bazı kalemleri geçersiz.") yerine hangi kalemin neden geçersiz olduğu yazılır. Bulunamayan birimde ürünün birimleri de söylenir: "Kalem 1: Ürünün bu birimi yok. Ürünün birimleri: metre (ana birim), koli (1 koli = 100 metre)." Model buna göre kullanıcıya doğru birimi sorar.
6. **Kart bilgisi modele de gider.** Araç sonucu önizleme ucuyla aynı hesaptır: girilen miktar, ana birim karşılığı, depo ve stok önce → sonra. Rakamlar SQL'den gelir, metin olarak verilir (21 Kasım'dan beri binlik ayırıcısız, bkz. karar 7). `next_step` alanı modele stoğun henüz değişmediğini hatırlatır.
   - **Stok yetmeyen kalem.** Kalem `sufficient: false` olur. Onay `409 INSUFFICIENT_STOCK` ile reddedilir ve stok hiçbir zaman eksiye düşmez (veritabanında `CHECK`).
   - **Önizlemenin eksi değeri.** Önizleme bu kalemde "sonra" için eksi bir değer hesaplar. Yerel denemede model bunu olduğu gibi aktardı: "Onaylanırsa stok −5 adet olur." Bu yanlıştı.
   - **Araç artık ne veriyor.** Yetmeyen kalemde "önce → sonra" yerine eldeki ve gereken miktarı (`available`, `required`) ve bir açıklamayı (`problem`) veriyor; eksi değer modele hiç gitmiyor. `next_step` da modele önerinin bu hâliyle onaylanamayacağını ve kullanıcıya ne soracağını söylüyor: miktarı düşürmek, başka depodan transfer ya da iptal.
7. **İşlem mesaja bağlı (karar, 8 Kasım).** Ajan döngüsü cevaplanan kullanıcı mesajının kimliğini araç bağlamına koyar (`ToolContext.messageId`); öneri aracı işlemi `operations.source_message_id` ile bu mesaja bağlar. Sohbet yeniden açılınca kart bu bağla bulunacak (#75). Seçenek olarak işlem kimliğini araç sonucundan okumak da vardı; migration gerektirmezdi, ama bağ model geçmişinin JSON biçimine dayanırdı ve işlemden sohbete geri gidilemezdi. Kolon kuralları: [veritabani.md](veritabani.md#stok-defteri-tabloları), karar 15.
8. **"Düzenle" sohbetle (karar, 8 Kasım).** Kullanıcı "3 koli olsun" derse model aynı aracı önerinin `operation_id`'siyle çağırır; `OperationsService.revise` işlemi kilitler, kalemleri yeniden doğrulayıp baştan yazar ve sürümü artırır. Eski sürümün onayı `409 OPERATION_VERSION_MISMATCH` alır. Yalnızca öneriyi sohbette açan kullanıcı, yalnızca onay bekleyen ve aynı türdeki işlemi düzenleyebilir ([stok-islemleri.md](stok-islemleri.md#sürüm)). Ayrı bir düzenleme formu yazılmadı.
9. **Prompt sürümü araç listesini de taşır.** `ChatPrompt`'ta metnin yanında `tools` listesi var. `chat-v1` 4. haftanın dört okuma aracıyla, aynı sırayla kalır; `chat-v2` bunlara `search_parties` ve beş öneri aracını ekler. Süren bir sohbetin araç listesi değişirse geri gönderilen düşünme blokları geçersiz olur ve önbellek bozulur (ADR-001). Bu yüzden 4. haftada başlamış bir sohbet v1 ile ve öneri araçları olmadan sürer; yeni sohbetler v2 ile başlar. Kayıt defteri, sürümün listesinde olmayan bir aracı model çağırsa bile "bilinmeyen araç" olarak reddeder. Yeni araç eklemek yeni bir prompt sürümü demektir: ters kaydın sohbet aracı (`propose_reversal`, #78) `chat-v4` ile gelecek (`chat-v3` 6. haftada değerlendirme bulgularıyla açıldı, [degerlendirme.md](degerlendirme.md)).
10. **`chat-v2`'nin kuralları.** Öneri kuralları (önce ara; birden çok yakın aday ya da eksik depo veya miktar varsa araç çağırmadan tek bir soru sor; işlem yapıldı ya da onaylandı deme, kullanıcıya kartta Onayla'ya basmasını söyle; düzeltmede aynı `operation_id`). 4. hafta kapı denemesinin gözlemleri: Markdown kullanma; çalışana toplamı "görebildiğin depolarda" diye ver; hitap hep "sen". Metin sabittir, tarih ya da şirket adı içermez.

### Araçlar (chat-v2'de eklenenler)

| Araç | Girdi | İşlem |
| --- | --- | --- |
| `search_parties` (read) | `query`, isteğe bağlı `type` (SUPPLIER, CUSTOMER) | En fazla 5 aktif cari: `party_id`, `name`, `type` (Tedarikçi / Müşteri) |
| `propose_stock_in` | `warehouse_id`, isteğe bağlı `party_id` ve `note`, `lines` (`product_id`, `quantity`, isteğe bağlı `unit` ve `unit_cost`) | Giriş (`STOCK_IN`) |
| `propose_stock_out` | `warehouse_id`, isteğe bağlı `party_id` ve `note`, `lines` | Çıkış (`STOCK_OUT`) |
| `propose_transfer` | `source_warehouse_id`, `target_warehouse_id`, isteğe bağlı `note`, `lines` | Transfer (`TRANSFER`) |
| `propose_count` | `warehouse_id`, isteğe bağlı `note`, `lines` (`product_id`, `counted_quantity`, isteğe bağlı `unit`) | Sayım (`COUNT`); fark onay anında hesaplanır |
| `propose_waste` | `warehouse_id`, isteğe bağlı `note` (neden), `lines` | Fire (`WASTE`) |

Öneri araçlarının hepsinde isteğe bağlı `operation_id` vardır: verilirse yeni işlem açılmaz, o öneri düzenlenir. Bir öneride en fazla 20 kalem olabilir.

### Testler

| Test | Ortam | Ne doğrular |
| --- | --- | --- |
| `apps/api/test/assistant-tools.spec.ts` | CI (sahte servisler) | Kayıt defterinin sırası (önce okuma, sonra öneri); her prompt sürümünün araçları kayıt defterinde, `chat-v1` aynı dört araç; öneri araçları `propose` sınıfında, hiçbir sürümde onaylayan araç yok; şemalarda şirket ya da kullanıcı alanı yok; sürümün listesinde olmayan araç reddediliyor; girdinin işlem isteğine çevrilmesi (çıkış, transfer, giriş maliyeti, sayım, fire); kaynak `CHAT` ve cevaplanan mesaj; düzenlemede sürüm artışı; ekran kuralları (aynı depo, iki kez sayım, sıfır miktar); fazladan `organization_id`, virgüllü miktar, kalemsiz öneri; kalem hatasının açıklaması ve ürünün birimleri; çalışanın yetkisiz deposu; `search_parties` |
| `apps/api/test/agent-loop.spec.ts` | CI (sahte model) | `chat-v1` sohbeti 4. haftadaki istekleri gönderir (aynı sistem promptu, aynı dört araç); yeni sohbet `chat-v2` ve on araçla başlar; `chat-v1` sohbetinde öneri aracı çağrılırsa çalışmaz; öneri aracı işlemi cevaplanan mesaja bağlar |
| `apps/api/test/ai-rules.spec.ts` | CI | Güncel sürüm `chat-v2`, `chat-v1` silinmedi; her sürümün promptu kendi araçlarını anar; `chat-v2`'nin kuralları (onay kullanıcının, Markdown yok, "görebildiğin depolarda", "sen"); metinde tarih ya da şirket adı yok |
| `apps/api/test-db/propose-tools.db.spec.ts` | Gerçek veritabanı (`pnpm db:test`) | Öneri onay bekleyen işlem açar (kaynak `CHAT`, `source_message_id`); stok, hareket ve outbox değişmez; stok yalnızca kartın onayıyla bir kez değişir (aynı anahtarla tekrar); düzenleme kalemleri değiştirir ve sürümü artırır, eski sürümün onayı 409, yenisi bir kez uygulanır; düzenlenemeyenler (başkasının, onaylanmış, başka tür, ekrandan açılmış); çalışanın yetkisiz deposu; başka şirketin ürünü; bulunamayan birim; yetmeyen stok; `search_parties` (Türkçe harf, tür, başka şirket); `source_message_id` kısıtları (başka şirketin mesajı, ekran işlemi, mesaj silinince bağın boşalması) |

### Savunmada sorulabilecek sorular

- **"Asistan stoğu değiştirebilir mi?"** Hayır. Asistanın araçlarından hiçbiri stoğa yazmaz; öneri araçları işlemi yalnızca onay bekleyen olarak açar. Stok yalnızca kullanıcının karttaki Onayla düğmesiyle, onay ucunda değişir. O uç asistan modülünden çağrılmaz, onaylayan bir araç da kayıt defterine eklenemez. Gerçek veritabanı testi öneriden sonra stok, hareket ve outbox sayılarının değişmediğini doğruluyor.
- **"Model yanlış ürünle öneri açarsa?"** Kullanıcı kartta ürünü, miktarı ve stoğun önceki ve sonraki hâlini görür; onaylamazsa stok değişmez. Düzeltmek isterse sohbette söyler, asistan aynı öneriyi düzenler. Belirsiz ürünlerde prompt modele öneri açmadan önce sormasını söylüyor.
- **"Kullanıcı öneriyi değiştirdikten sonra eski kartı onaylarsa?"** Düzenleme sürümü artırır. Eski kart eski sürümü gönderir ve `409 OPERATION_VERSION_MISMATCH` alır; stok değişmez. Testte 2 kolilik ilk hâlin onayı reddedildi, 1 kolilik yeni hâl bir kez uygulandı.
- **"4. haftada başlamış bir sohbette yeni araçlar ne oluyor?"** O sohbet v1 promptu ve v1'in dört aracıyla devam ediyor. Araç listesi sohbetin ortasında değişirse modelin geri gönderilen düşünme blokları geçersiz olur; bu yüzden yeni araçlar yalnızca yeni sohbetlerde var. Kullanıcı stok işlemi için yeni bir sohbet açar.
- **"Çalışan yetkisi olmayan bir depoda öneri açabilir mi?"** Hayır. Öneri aracı ekrandaki fiş formuyla aynı servisi kullanır; depo yetkisi işlem açılırken ve onayda kilit altında yeniden denetlenir. Testte çalışan Ostim'e transfer önerisi açamadı.

## Sohbette işlem kartı: akış, geçmiş ve süre aşımı (#75)

Mobil ve web kartının (#76, #77) dayandığı API. Kart, işlemin güncel hâlini (durum, sürüm, önce → sonra, son onay anı) her zaman `GET /v1/operations/{id}/preview`'dan okur. Akışta ve geçmişte yalnızca işlemin kimliği gider. Böylece başka cihazdan onaylanan, iptal edilen ya da süresi dolan öneri her ekranda doğru görünür.

```text
POST .../messages (SSE)
  message_started → tool_status (propose_stock_out, started) → tool_status (succeeded)
  → operation_card { operationId, version }                 ← istemci kartı cevap metninden önce gösterir
  → text_delta … → done

GET .../messages
  [ user "Merkezden 2 koli priz çıkışı yap"  operationIds: [] ]
  [ assistant "Öneri hazır; kartı …"          operationIds: [id] ]   ← kart turun cevabının altında
```

Kod: `assistant/agent-loop.ts` (kart olayı), `assistant/tools/registry.ts` (`operationOf`, `ToolOutcome.operation`), `assistant/conversations.service.ts` (`attachOperationCards`, tekrar gönderimde kartlar), `operations/operations.repository.ts` ve `operations.service.ts` (süre aşımı, `listBySourceMessages`), `packages/shared` (`operation_card`, `operationIds`, `expiresAt`, `CHAT_PROPOSAL_TTL_MINUTES`), `packages/api-client/src/chat-turn.ts` (turun kartları).

### Kararlar

1. **Olay adı mimari belgedeki gibi `operation_card`.** Olay, öneri aracı başarılı olunca, aracın "succeeded" durum satırından hemen sonra gönderilir; cevabın metni ondan sonra gelir. Başarısız öneride (kalem hatası, yetki) olay yoktur. Kayıt defteri, öneri aracının sonucundan işlemin kimliğini ve sürümünü `operationOf` ile alır; bu bilgi modele gönderilen metne eklenmez. Olayı tanımayan eski istemci onu atlar (#58), yani yeni olay eski uygulamayı bozmaz.
2. **Kart turun cevabının altında.** `GET .../messages` her mesajda `operationIds` döner. Bir kullanıcı mesajının cevabında önerilen işlemler o turun son asistan metninin altına konur; tur cevapsız kaldıysa (öneriden sonra model hatası) kullanıcının mesajının altına. Sıra, işlemlerin açılış sırasıdır. Bağ #74'teki `operations.source_message_id`'dir; işlemler operations modülünün servisinden okunur (modül sınırı).
3. **Düzenlenen öneri aynı kart, yeni yer.** Sohbette düzenlenen öneri aynı işlemdir: akışta aynı `operationId` yeni sürümle gelir, istemci kartı çoğaltmaz. Düzenleme işlemin bağını düzenlemeyi isteyen mesaja taşır. Kart, önerinin son hâlini üreten turun altında durur; canlı akışta ve geçmiş yeniden yüklendiğinde aynı yerdedir. İlk mesaj ve her düzenleme denetim kaydında (`operation.created`, `operation.revised`) kalır.
4. **Tekrar gönderimde aynı kart.** Aynı `clientMessageId` ile gelen mesaj için model çağrılmaz, yeni işlem açılmaz. Turun kartları kayıttan, kayıtlı cevaptan önce yeniden gönderilir.
5. **Süre aşımı: yalnızca sohbet önerisi, 30 dakika (karar, 8 Kasım).** Sohbetten açılan öneri, son değişikliğinden (açılış ya da düzenleme) 30 dakika sonra onaylanamaz. Önerideki "önce → sonra" bilgisi zamanla eskir; kullanıcı yarım saat sonra eski bir kartı onaylamasın. Ekrandan açılan fişler 3. haftadaki gibi süresiz bekler; içe aktarmanın açılış işlemi de öyle.
6. **Süre veritabanının saatiyle ve tek ifadeyle.** "Süresi doldu mu" sorusunun tek tanımı repository'deki SQL ifadesidir: kaynak `CHAT`, durum onay bekliyor ve `updated_at < now() − 30 dakika`. Saat veritabanınındır; uygulama sunucusunun saati kaymış olabilir. Düzenleme `updated_at`'i de veritabanının saatiyle yazar.
7. **Okumada görünür, yazmada kalıcı.** Süre aşımını işleyecek zamanlanmış bir iş yok (worker 7. haftada). Bu yüzden:
   - **Okuma:** İşlem, önizleme ve liste süresi dolmuş öneriyi `EXPIRED` gösterir; önizleme stok etkisini hesaplamaz. Bekleyenler listesinde görünmez, `EXPIRED` listesinde görünür. Okuma veritabanına yazmaz.
   - **Yazma:** Onay, sohbetteki düzenleme ya da iptal geldiğinde işlem satırı kilitlenir, süre kilit altında denetlenir. Süre dolmuşsa işlem kalıcı olarak `EXPIRED` yazılır, denetim kaydına `operation.expired` (kişi boş: süre aşımını kimse yapmaz) eklenir ve `409 OPERATION_EXPIRED` döner.
   - Hata transaction'ın içinden fırlatılsaydı `EXPIRED` geçişi de geri alınırdı. Geçiş yazılıp transaction tamamlanır, 409 ondan sonra döner.
8. **Son onay anı istemciye gider.** İşlem ve önizleme `expiresAt` verir: sohbet önerisinde son değişiklik + 30 dakika, diğerlerinde boş. Kart bunu gösterebilir; asıl kontrol onayda, kilit altındadır.

### Hata kodu

| Durum | Kod | Ne zaman |
| --- | --- | --- |
| 409 | `OPERATION_EXPIRED` | Sohbet önerisinin süresi doldu; onay, düzenleme ya da iptal geldiğinde. İşlem kalıcı olarak `EXPIRED` olur, stok değişmez. Sonraki deneme `409 OPERATION_NOT_PENDING` alır |

### Testler

| Test | Ortam | Ne doğrular |
| --- | --- | --- |
| `apps/api/test/agent-loop.spec.ts` | CI (sahte model) | Kart olayı araç bitince ve metinden önce gelir; başarısız öneride kart yok; kart bilgisi modele gitmez |
| `apps/api/test/conversations-rules.spec.ts` | CI | Kart turun cevabının altında, cevapsız turda kullanıcının mesajının altında, öneri sırasıyla; kartsız mesajda boş liste |
| `packages/api-client/test/chat-turn.spec.ts` | CI | Kart tura öneri sırasıyla eklenir; düzenlenen öneri kartı çoğaltmaz, sürümü güncellenir; `done` ve model hatası kartları korur |
| `apps/api/test-db/operation-cards.db.spec.ts` | Gerçek veritabanı (`pnpm db:test`, sahte model) | Olay sırası; geçmişte kart; tekrar gönderimde model çağrılmadan aynı kart, yeni işlem yok; düzenlemede aynı kart yeni sürümle ve yeni turun altında; süresi dolan öneri işlemde, önizlemede ve listede `EXPIRED`, okuma yazmaz; onayı 409, kalıcı `EXPIRED`, denetimde kişi boş, stok değişmez, ikinci deneme `OPERATION_NOT_PENDING`; süresi dolan öneri düzenlenemez ve iptal edilmez; 29. dakikada onay; ekran işleminin süresi dolmaz |

### Savunmada sorulabilecek sorular

- **"Kullanıcı yarım saat önceki bir kartı onaylarsa?"** Onay işlem satırını kilitler ve süreyi veritabanının saatiyle kilit altında denetler. Süre dolmuşsa işlem kalıcı olarak `EXPIRED` olur, `409 OPERATION_EXPIRED` döner ve stok değişmez. Kart da süresi dolmuş öneriyi "Süresi doldu" gösterir.
- **"Zamanlanmış bir iş yokken süre nasıl doluyor?"** Durum okumada aynı SQL ifadesiyle hesaplanıyor; ekranlar süresi dolmuş öneriyi hemen `EXPIRED` görüyor. Kalıcı geçiş, işlemi değiştirmeye çalışan ilk istekte, kilit altında yazılıyor. Worker 7. haftada geldiğinde bekleyenleri toplu da işaretleyebilir; kural değişmez.
- **"Sohbet yeniden açılınca kart nereden geliyor?"** İşlem, öneriyi isteyen mesaja `source_message_id` ile bağlı. Mesajlar ucu her turun kartlarını cevabın altında döndürüyor; kart da güncel hâlini önizleme ucundan okuyor.

## 5. hafta kapı denemesi: onay stoğu tam bir kez değiştirir (#79)

Kapı: sohbette önerilen işlem kartla onaylanınca stok tam bir kez değişir. Çift dokunma, ağ hatasında tekrar, iki cihazdan onay, onay ile iptalin ya da düzenlemenin yarışı ve süresi dolmuş öneri bunu bozmamalı. Kapı iki yoldan sınandı: gerçek veritabanında otomatik test (sahte model) ve telefonda gerçek modelle deneme ([eval/kapi-denemesi-hafta-5.md](../eval/kapi-denemesi-hafta-5.md)).

### Kararlar

1. **Aynı mesajdan aynı öneri ikinci kez açılmaz (karar, 19 Kasım).** Telefon denemesinin 6. adımında ("Merkezde 1 vavien anahtar kırık geldi, fire yaz") model `propose_waste`'i art arda dört turda, dördünde de aynı girdiyle çağırdı. Dört ayrı öneri ve dört kart açıldı; kullanıcı dördünü de onayladı ve stok 25'ten 21'e düştü. Her kart yalnızca bir kez uygulandı, yani kartın kuralı tuttu; ama kullanıcının tek isteği stoğu dört kez düşürdü. Aynı gün 22.06'daki bir denemede de aynı mesajdan üç fire önerisi açılmıştı. Düzeltme sunucuda, modelden bağımsız:
   - Yeni öneri `OperationsService.proposeFromChat` ile açılır. Aynı mesajdan, aynı türde ve aynı kalemlerle (ürün, depo, hedef depo, miktar, birim, birim maliyet) onay bekleyen ve süresi dolmamış bir öneri varsa yenisi açılmaz, o döner. Miktarlar sayıya çevrilmeden karşılaştırılır: "1" ile "1.000" aynıdır (ADR-003).
   - Model bunu araç sonucundan öğrenir: `next_step` "Bu mesajda aynı kalemlerle açılmış bir öneri zaten var; yeni öneri açılmadı" diye başlar ve değişiklik için `operation_id`'yi kullanmasını söyler. Kart olayı aynı kimlikle gelir; istemci kartı kimliğe göre güncellediği için ekranda tek kart kalır.
   - Aynı mesajın öneri istekleri bir kilitle sıraya girer: transaction boyunca mesaj kimliğinden üretilen anahtarla PostgreSQL'in "advisory" kilidi tutulur. Model aynı turda iki çağrıyı paralel yaparsa ikincisi birincinin açtığı öneriyi bulur. Mesaj satırı kilitlenmez; o tablo asistan modülünün.
   - Kalemleri farklı öneriler ayrı açılır (ör. bir mesajda iki ayrı depoya giriş). Bu yüzden kural "mesaj başına bir öneri" değil, "aynı öneri bir kez".
   - Seçenek olarak yalnızca prompta "her istek için tek öneri" kuralı yazmak vardı. Prompt modeli yönlendirir ama garanti vermez; ayrıca yeni bir prompt sürümü (`chat-v3`) gerektirirdi. Sunucu kuralı her prompt sürümünde ve her modelde geçerli.
2. **Fire nedeni nota yazılmıyor (açık bulgu, 19 Kasım).** Sohbetten açılan 22 önerinin hiçbirinde not yok. Fire denemesinde kullanıcı "kırık geldi" dedi, aracın açıklaması da "nedeni nota yaz" diyor; kayıtlı araç girdilerinde `note` alanı yine de hiç yok. Aynı şekilde isteğe bağlı olan `party_id` 11 çıkış önerisinin 4'ünde dolu, yani isteğe bağlı alanlar genel olarak çalışıyor. Modelin son cevabı ("fire nedeni 'kırık geldi' olarak görünmeyebilir") notu eklemeye çalıştığını gösteriyor; öneriyi dört kez tekrarlamasının nedeni de büyük olasılıkla bu. Kök neden henüz bilinmiyor; gerçek modelle bir ölçüm gerekir (betiği kullanıcı çalıştırır). Stoğu ve kapıyı etkilemiyor; `chat-v3` (#78) ile birlikte ele alınacak.
   - **Güncelleme (21 Kasım, #86): kök neden araç şemasındaki alan sırası.** Değerlendirme kümesinin dört fire mesajında ve telefon denemelerinin (19–20 Kasım) bütün `propose_waste` çağrılarında `note` alanı hiç yok; sunucu notu araçtan kayda kadar taşıyor. Dört yapılandırmanın hiçbiri (Haiku low ve medium, Sonnet low) not yazamadı, bazıları aracı sınıra kadar tekrar çağırdı. Bir girişte aynı şey `party_id` için görüldü. Strict modda model nesneyi şemadaki alan sırasıyla yazar; isteğe bağlı `note` ve `party_id` zorunlu `lines`'tan önce geliyordu, model kalemleri yazınca nesne kapanıyordu. Düzeltme `chat-v3`'te: şemalarda zorunlu alanlar önce, isteğe bağlılar sonra (`ChatPrompt.requiredFieldsFirst`); `chat-v1` ve `chat-v2`'nin tanımları değişmez. Sunucuda "notsuz fire açılmaz" kuralı da düşünüldü, ama `chat-v2` şemasıyla model notu hiç gönderemediği için süren sohbetlerde fire önerisi hiç açılamazdı; yapılmadı. Ölçüm: [degerlendirme.md](degerlendirme.md).
3. **Model önerilerin şu anki durumunu her mesajda öğrenir (karar, 20 Kasım).** Telefon denemesinin 9. adımında kullanıcı yeni bir çıkış istedi; model "1 adetlik kart zaten hazırlandı ve onay bekliyor" deyip öneri açmadı. Oysa 7. ve 8. adımın kartları onaylanmıştı. Model bir önerinin durumunu yalnızca öneriyi açtığı andaki araç sonucundan bilir ("Onay bekliyor"). Kullanıcı kartı sohbetin dışında, kartın düğmesiyle onaylar ya da iptal eder ve bu sohbete yazılmaz.
   - Düzeltme: yeni kullanıcı mesajı kaydedilirken sohbetteki önerilerin (en yeni 10) kimliği, türü ve şu anki durumu bir not olarak mesaja eklenir: "[Sunucu notu, kullanıcı yazmadı] Bu sohbette açtığın önerilerin şu anki durumu … - <id>: Çıkış, Uygulandı". Not, önceki araç sonuçlarındaki durumun eskimiş olabileceğini ve onay beklemeyen bir öneri yerine yeni öneri açılacağını da söyler. Sohbette öneri yoksa not eklenmez; 4. haftanın sohbetleri değişmez.
   - Not, kullanıcı mesajının ikinci metin bloğu olarak **saklanır**. Sonraki turlarda model geçmişi bire bir aynı görür: önbellek ve geri gönderilen düşünme blokları bozulmaz. Not yalnızca o anda modele eklenip saklanmasaydı, sonraki mesajda geçmiş değişmiş olurdu.
   - Ekranda yalnızca kullanıcının yazdığı (ilk metin bloğu) görünür; not mobil ve web'de gösterilmez.
   - Sistem promptu ve araç listesi değişmedi; sürüm `chat-v2` olarak kaldı. Notun metni sabit bir şablondur ve her çağrının gördüğü hâli mesajla birlikte veritabanında durur.
   - Seçenekler: (a) önerinin durumunu okuyan yeni bir araç; modelin onu çağırmayı hatırlaması gerekirdi ve yeni araç `chat-v3` demekti. (b) Prompta "araç sonuçlarındaki durum eskiyebilir" kuralı; model yine güncel durumu bilmezdi. Not, bilgiyi modelin önüne her mesajda koyar.
   - Sınır: kullanıcı mesajına "[Sunucu notu…]" gibi bir metin yazarak modeli yanıltabilir. Etkisi yalnızca asistanın cevabıdır: stok yine yalnızca kartın onayıyla değişir ve onay sunucuda kilit altında denetlenir. Başarısız olup tekrar gönderilen mesajın notu ilk gönderimdeki durumdur.

### Testler

| Test | Ortam | Ne doğrular |
| --- | --- | --- |
| `apps/api/test-db/proposal-gate.db.spec.ts` | Gerçek veritabanı (`pnpm db:test`, sahte model) | Öneriler gerçek sohbet akışından açılır; onay ve iptal kartın yaptığı gibi HTTP'den gider. Aynı anahtarla tekrar (aynı cevap, stok bir kez); aynı anda çift dokunma (aynı anahtar); iki cihazdan aynı anda (farklı anahtar: biri 200, öteki `OPERATION_ALREADY_APPLIED`); onay ile iptalin yarışı; sohbette düzenleme ile eski kartın onayının yarışı; süresi dolmuş öneriye iki onay (hiçbiri uygulanmaz, süre aşımı bir kez yazılır); model aynı öneriyi bir turda tekrar tekrar ve paralel çağırınca tek öneri, tek kart; aynı turda aynı öneri hem yeniden açılır hem düzenlenirse yine tek öneri; aynı mesajdan aynı öneri aynı anda iki kez (biri açar, öteki onu alır; farklı kalemli öneri ayrı açılır). Her senaryoda hareket, denetim ve outbox sayıları ile "stok = hareketlerin toplamı" |
| `apps/api/test/assistant-tools.spec.ts` | CI (sahte servisler) | Aynı mesajda aynı öneri ikinci kez istenince aynı `operation_id` ve "yeni öneri açılmadı" uyarısı |
| `apps/api/test/conversations-rules.spec.ts` | CI | Durum notu: öneri yoksa not yok; her öneri kimliği, türü ve şu anki durumuyla; en fazla 10, en yenileri; not ekranda görünmez |
| `apps/api/test-db/proposal-gate.db.spec.ts` (9. adım) | Gerçek veritabanı | Kart HTTP'den onaylandıktan sonra aynı sohbetteki yeni mesajda modele giden istek önce kullanıcının yazdığını, sonra "Uygulandı" diyen notu taşır; mesajlar ucu kullanıcı mesajını yalnızca yazıldığı gibi döndürür |

Yarışlar 3. haftanın yöntemiyle kurulur (`raceWhileLocked`): test satırı ya da kilidi kendi transaction'ında tutar, iki isteğin de beklediğini `pg_stat_activity`'de görünce bırakır.

### Telefon denemesi

Protokol ve adım adım gözlemler: [eval/kapi-denemesi-hafta-5.md](../eval/kapi-denemesi-hafta-5.md). 19–20 Kasım 2026'da Android development build ile, Render'daki API'ye karşı, çalışan hesabıyla yapıldı.

- **Kapı geçti.** Onaylanan her kart stoğu tam bir kez değiştirdi. Çift dokunma, bağlantı kesikken onay ve tekrar, iki cihazdan onay dahil her onaylanan önerinin kalem başına tek hareketi ve tek `operation.applied` kaydı var. İptal edilen ve süresi dolan önerilerin hiç hareketi yok.
- **İlk geçişte 12 adımın 10'u doğruydu.** Yanlış olan iki adım (6: aynı öneri dört kez; 9: model onaylanmış kartları bekliyor sandı) modelin davranışından çıktı. İkisi de sunucuda düzeltildi (karar 1 ve 3) ve düzeltmeden sonraki tekrarlarda doğruydu.
- **Belirsiz kalan:** Yeni sürüm yayına çıktıktan 18 saniye sonraki bir denemede (6b) yine iki kart açıldı. Modelin o çağrı düzeni testle kuruldu ve yeni kodda tek öneri kaldı. İsteği yayın geçişi sırasında eski sunucunun mu, yenisinin mi cevapladığı kesinleştirilemedi; yayın kesinleştikten sonraki denemede tek kart açıldı.
- **Açık bulgular:** fire nedeni nota yazılmıyor (karar 2). Günlük kullanım sınırı önbellek okumasını tam saydığı için deneme ilk gün 16 mesajda durdu ve ertesi sabah sürdü.
- **Ölçüm** (`ai_runs`, 26 mesaj): mesaj başına ortalama 2,9 model çağrısı, modelin toplam süresi medyan 5,5 sn, p90 10,8 sn; mesaj başına ortalama 30.000 token ve 0,0011 USD. Model hatası yok.

### Savunmada sorulabilecek sorular

- **"Model aynı öneriyi iki kez açarsa kullanıcı iki kez onaylayabilir mi?"** Artık açamaz. Aynı mesajdan aynı kalemlerle ikinci öneri istenirse sunucu yenisini açmaz, mevcut öneriyi döndürür; ekranda tek kart kalır. Kural prompta değil sunucuya yazıldı, çünkü telefon denemesinde model tam olarak bunu yaptı ve prompt garanti vermez.
- **"Aynı anda iki çağrı gelirse ikisi de 'yok' görüp iki öneri açmaz mı?"** Açmaz. Aynı mesajın öneri istekleri bir kilitle sıraya girer; ikinci istek kilidi aldığında birincinin açtığı öneriyi görür. Test bu yarışı kilidi kendisi tutarak kuruyor ve iki isteğin de beklediğini gördükten sonra bırakıyor.
- **"Kullanıcı bir mesajda gerçekten iki ayrı işlem isterse?"** Kalemleri farklıysa (başka depo, başka ürün ya da miktar) iki öneri açılır. Engellenen yalnızca birebir aynı önerinin tekrarı.
- **"Kartı onayladığını asistan nereden biliyor?"** Kart sohbetin dışında onaylanır; model bunu kendisi göremez. Bu yüzden her yeni mesaja sunucu, sohbetteki önerilerin şu anki durumunu bir not olarak ekliyor. Not mesajla birlikte saklanıyor; geçmiş değişmediği için önbellek bozulmuyor. Ekranda görünmüyor. Telefon denemesinde model bu bilgi olmadan onaylanmış kartları hâlâ bekliyor sandı.
