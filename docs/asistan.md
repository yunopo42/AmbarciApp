# Asistan altyapısı

Bu belge 4. haftada kurulan asistan altyapısını anlatır ve işler birleştikçe büyür. İlgili işler: #54 (sohbet, mesaj ve `ai_runs` tabloları; tablolar [veritabani.md](veritabani.md#asistan-tabloları)), #55 (model çağrısı, bu belgenin ilk bölümü), #56 (ajan döngüsü ve okuma araçları, ikinci bölüm), #57 (sohbet uçları ve SSE akışı, üçüncü bölüm), #60 (kapı denemesi ve ölçüm). Model seçimi: [ADR-001](kararlar/ADR-001-sohbet-modeli.md).

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
6. **Önbellek.** İki işaret var: sistem bloğundaki işaret araç tanımlarını ve sistem promptunu (API bunları bu sırayla işler), üst düzeydeki işaret geçmişin sonuna kadarını önbelleğe alır. Bir sorunun ikinci model çağrısı (araç turundan sonra) aynı ön eki önbellekten okur. Haiku 5.5'te önbelleğe alınabilen en kısa istem 512 token. Önbelleğin gerçek etkisi kapı denemesinde `cache_read_input_tokens` ile ölçülecek (#60).
7. **Her çağrı `ai_runs`'a yazılır (mimari değişmez 10).** Başarılı çağrı; modelin reddettiği çağrı (tokenları faturalanır); sağlayıcı hatası (sıfır token, hata koduyla, süresiyle). Yalnızca anahtar tanımlı değilken kayıt yazılmaz, çünkü istek hiç gönderilmemiştir. Kayıt, modelin cevabından bağımsız yazılır: model çağrıldıysa maliyet oluşmuştur.
8. **Maliyet SQL'de (ADR-003).** `cost_usd = round((giriş × giriş fiyatı + önbelleğe yazma × yazma fiyatı + önbellekten okuma × okuma fiyatı + çıkış × çıkış fiyatı) / 1.000.000, 8)`. Fiyatlar `pricing.ts`'te metin olarak durur ve JS'te hesaba girmez. Haiku 5.5: giriş 0,10 $, çıkış 0,50 $, önbelleğe yazma 0,125 $, önbellekten okuma 0,01 $ (milyon token başına; claude-api skill'i, 2026-10-06). İstem 100K tokenı aşarsa uzun istem fiyatı (0,50 $ / 2,50 $) uygulanır; hangi fiyatın seçileceği token sayılarından (tam sayı) bulunur. Kayıt, çağrı anındaki fiyatla kalır.
9. **Model reddederse ya da cevap yarım kalırsa.** `stop_reason: "refusal"` → `422 AI_REFUSED` ve kullanıcıya sorusunu farklı sorması söylenir; Haiku 5.5'te sunucu tarafında yedek model yoktur. Araç çağrısı yazılırken çıktı sınırına takılan cevap (`max_tokens`) çalıştırılmaz: yarım kalmış girdi geçerli görünebilir → `502 AI_RESPONSE_TRUNCATED`. İki durumda da çağrı önce kaydedilir; reddedilen ya da yarım içerik geçmişe eklenmez.
10. **Günlük token bütçesi.** Bugünkü (Türkiye saatiyle gece yarısından beri) giriş, çıkış ve önbellek tokenlarının toplamı; kullanıcı başına 500.000, şirket başına 2.000.000 (ortam değişkeniyle değişir). 2. hafta denemesinde bir mesaj önbelleksiz ~9.000 token tuttu: kullanıcı başına ~55, şirket başına ~220 mesaj. Sınır `ai_runs`'tan tek sorguyla okunur (`(organization_id, created_at)` indeksi). Kontrol her kullanıcı mesajının başında bir kez yapılır, her araç turunda değil: bir cevabın araç turlarının ortasında kesilmemesi için. Bu yüzden sınır en fazla bir cevabın çağrıları kadar aşılabilir. Önce şirketin sınırına bakılır: şirketin sınırı dolduysa kullanıcıya kendi sınırı dolmuş gibi görünmesin.
11. **Anahtar yoksa API yine açılır.** `ANTHROPIC_API_KEY` boşsa asistan kapalıdır ve sohbet isteği `503 AI_NOT_CONFIGURED` alır; API'nin geri kalanı çalışır. Böylece Render'a anahtar eklenmeden birleşen bir sürüm yayını durdurmaz. Buna karşılık yanlış yazılmış bir effort ya da fiyatı bilinmeyen bir model açılışta hata verir: maliyeti yazılamayacak bir çağrı yapılmamalı.

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

### Bağımlılık notu

`@anthropic-ai/sdk` 1.3.0 eklendi (25 Ekim'de onaylandı). SDK `@opentelemetry/api` paketini getiriyor. `drizzle-orm` bu paketi isteğe bağlı eş bağımlılık olarak kullanır: paket API'nin bağımlılık ağacına girince pnpm `apps/api` için drizzle'ın ikinci bir kopyasını kurdu ve iki paketin (`apps/api`, `packages/db`) sorgu tipleri birbirini tutmadı. `@opentelemetry/api` `packages/db`'ye de açıkça eklenince iki paket aynı tek kopyayı kullanıyor. Lockfile'da hiçbir paketin sürümü değişmedi; yalnızca drizzle, Next.js, supabase-js ve Vitest'in isteğe bağlı eşi çözümlendi. OpenTelemetry'nin yalnızca arayüzü kurulu, izleme açık değil; çalışma anında etkisi yok.

### Testler

| Test | Ortam | Ne doğrular |
| --- | --- | --- |
| `apps/api/test/ai-claude-adapter.spec.ts` | CI (SDK'ya sahte fetch) | SDK'nın gönderdiği gövde: örnekleme parametresi yok, adaptive thinking, effort, `max_tokens`, önbellek işaretleri, strict araçlar, geçmiş ve düşünme blokları birebir; akışın sonuca çevrilmesi (bloklar, metin parçaları, araç çağrısı, token sayıları); 429, 529, 500, 401, 400, bağlantı hatası ve iptalin hata kodları |
| `apps/api/test/ai-rules.spec.ts` | CI | Ortam değişkenleri (varsayılanlar, boş değerler, geçersiz effort, bilinmeyen model), uzun istem fiyatı, prompt sürümleri, sahte sağlayıcı |
| `apps/api/test-db/ai.db.spec.ts` | Gerçek veritabanı (`pnpm db:test`) | Maliyetin dört token türüyle SQL'de hesaplanması (546,5 / 1.000.000 $), uzun istem fiyatı, reddin ve yarım cevabın kaydedilip hataya çevrilmesi, sağlayıcı hatasının sıfır tokenla kaydı, anahtar yokken kayıt yazılmaması; günlük bütçe: dünkü ve başka şirketteki kullanım sayılmaz, kullanıcı sınırı, aynı şirketteki başka kullanıcı, şirket sınırı |

### Savunmada sorulabilecek sorular

- **"Model değişirse ne olur?"** Asistan modeli `AIProvider` arayüzüyle çağırır. Başka bir model için yalnızca ortam değişkeni ve `pricing.ts`'teki fiyat değişir; başka bir sağlayıcı için yeni bir adaptör yazılır, asistan kodu değişmez.
- **"Maliyeti nasıl biliyorsunuz?"** Her model çağrısının token sayıları API'nin cevabından `ai_runs`'a yazılır ve maliyet o anki fiyatla SQL'de hesaplanır. Mesaj başına maliyet, o mesaja bağlı satırların toplamıdır.
- **"Bir kullanıcı API anahtarınızı tüketebilir mi?"** Kullanıcı ve şirket başına günlük token bütçesi var; sınır `ai_runs`'tan okunur ve aşılınca istek modele gitmeden reddedilir. Ayrıca Anthropic konsolunda aylık harcama sınırı tanımlı (2. hafta).
- **"Model reddederse kullanıcı ne görür?"** "Asistan bu isteğe cevap veremedi" mesajını; reddedilen içerik sohbet geçmişine eklenmez, çağrı yine maliyetiyle kaydedilir.
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
3. **Kayıt defteri.** Her aracın adı, açıklaması, durum etiketi ("Ürün aranıyor"), sınıfı (`read` / `propose`), yetki kuralı (izin verilen roller) ve girdi şeması var. Modele giden strict JSON şeması `packages/shared`'daki Zod şemasından üretilir; aynı şema sunucuda girdiyi yeniden doğrular. Strict modun desteklemediği kurallar (uzunluk, sayı sınırı, desen) modele giden şemadan çıkarılır ve yalnızca Zod'da kalır. Kayıt defteri `confirm_` ya da `apply_` ile başlayan bir aracı reddeder (mimari değişmez 2); bu hafta `propose` aracı yok (5. hafta).
4. **Hata konuşmayı kesmez.** Bilinmeyen araç, yetkisiz rol, şemaya uymayan girdi ve aracın hatası modele `is_error: true` sonucuyla döner; model buna göre soru sorar ya da başka bir yol dener. Servisin Türkçe hatası ("Ürün bulunamadı.") modele aynen gider. Beklenmeyen hatanın ayrıntısı yalnızca loga yazılır, modele genel bir mesaj gider.
5. **Kimlik oturumdan (mimari değişmez 5).** Araçlar şirketi, rolü ve kullanıcıyı `ToolContext`'ten alır; hiçbir aracın girdisinde şirket ya da kullanıcı alanı yok. Şemalar `strictObject`: model fazladan bir `organization_id` yazsa bile girdi reddedilir.
6. **Araçlar ekranların okuma servislerini kullanır.** `get_stock` ve `list_recent_movements`, mobil ürün detayının kullandığı `StockService`'i çağırır. Depo yetkisi ekranlardakiyle aynıdır: çalışan yalnızca yetkili olduğu depoları görür, toplam da onların toplamıdır; yetkisiz bir depoyu açıkça sorarsa "yetkisi yok" cevabını alır. Başka şirketin ürünü "bulunamadı" görünür. Rakamlar veritabanından gelir, toplamı SQL hesaplar (2. hafta denemesinde model toplamı kendisi hesaplamıştı).
7. **Miktarlar Türkçe yazımla.** Veritabanı "1412.500" döner; Türkçede bu "1.412,5" yazılır, "120.000" ise yüz yirmi bin diye okunur. Model bunu kullanıcıya olduğu gibi aktarabilirdi. Araçlar miktarı ortak paketteki `formatDecimal` ile, metin olarak verir (JS'te hesap yok, ADR-003). Tarihler Türkiye saatiyle ("05.11.2026 14:32"): model saat dilimi çevirmez.
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
- **"Miktarları neden metin olarak veriyorsunuz?"** Ondalık sayı JS'te tam tutulamaz ve veritabanının "120.000" biçimi Türkçede yüz yirmi bin diye okunur. Miktar Türkçe yazımla metin olarak verilir, toplamı SQL hesaplar.

## Sohbet uçları ve cevabın akışı (SSE, #57)

| Uç nokta | Ne yapar |
| --- | --- |
| `POST /v1/conversations` | Yeni sohbet açar (başlık ilk mesajdan konur) |
| `GET /v1/conversations?page=&pageSize=` | Kullanıcının aktif şirketteki sohbetleri, en son konuşulan önce |
| `GET /v1/conversations/{id}/messages` | Ekranda gösterilen mesajlar: kullanıcının yazdıkları ve asistanın metin cevapları; araç sonuçları ve düşünme blokları gönderilmez |
| `POST /v1/conversations/{id}/messages` | Gövde `{ clientMessageId, text }`; cevap `text/event-stream` olarak akar |

Kod: `apps/api/src/modules/assistant/` (`conversations.controller.ts`, `conversations.service.ts`, `conversations.repository.ts`, `sse-stream.ts`). Şemalar: `packages/shared/src/conversations.ts`.

**Akışın olayları** (`chatStreamEventSchema`): her olay `event: <tür>` ve JSON `data:` satırıdır.

```text
event: message_started   {"messageId": "...", "clientMessageId": "..."}   mesaj kaydedildi
event: tool_status       {"tool": "search_products", "label": "Ürün aranıyor", "status": "started"}
event: tool_status       {... "status": "succeeded"}
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

Bu yüzden akış boyunca 15 saniyede bir `: ping` yorum satırı gönderilir: model ya da araç uzun sürdüğünde aradaki vekil sunucular ve mobil ağlar bağlantıyı boşta sanıp kesmesin. Bir cevap normalde bundan kısa sürer (2. hafta denemesinde akışsız istekle mesaj başına medyan 4,13 saniye); ping çoğu cevapta hiç gönderilmez. Render'ın akışı tamponlamadan ilettiği (ilk metin parçasının cevap bitmeden geldiği) gerçek bir istekle ölçülecek: bu ölçüm gerçek model çağrısı ve Render'da `ANTHROPIC_API_KEY` gerektirdiği için kapı denemesinde (#60) yapılacak. **Ölçülmedi.**

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
