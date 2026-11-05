# Asistan altyapısı

Bu belge 4. haftada kurulan asistan altyapısını anlatır ve işler birleştikçe büyür. İlgili işler: #54 (sohbet, mesaj ve `ai_runs` tabloları; tablolar [veritabani.md](veritabani.md#asistan-tabloları)), #55 (model çağrısı, bu belgenin ilk bölümü), #56 (ajan döngüsü ve okuma araçları), #57 (sohbet uçları ve SSE akışı), #60 (kapı denemesi ve ölçüm). Model seçimi: [ADR-001](kararlar/ADR-001-sohbet-modeli.md).

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
