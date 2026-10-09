---
name: ambarci-standartlari
description: Ambarcı (yapay zekâ destekli saha stok asistanı) bitirme projesinin mimari ve kod standartları. Bu repoda kod yazarken, yeni modül/ekran/endpoint/tablo/araç eklerken, mimari karar alırken, test yazarken, commit mesajı önerirken veya haftalık rapor hazırlarken MUTLAKA kullan.
---

# Ambarcı proje standartları

Ambarcı; saha çalışanlarının mobil uygulamadaki Claude asistanıyla konuşarak stok işlemi yaptığı, yöneticilerin web panelinden yönettiği çok kiracılı bir stok sistemidir. Bu bir **bitirme projesidir** (Senior Design Project, danışman: Ali Osman Çıbıkdiken). Öğrenci her commit'i kendisi atar ve kodun önemli kısmını öğrenerek yazar. Bu skill, mimarinin raporlardan sapmamasını ve kodun tutarlı bir standartta kalmasını sağlar.

Ayrıntılı mimari, veri modeli ve araç listesi için: `references/mimari-ve-veri-modeli.md`
Haftalık rapor şablonu için: `references/haftalik-rapor-sablonu.md`

## 1. Her işten önce

1. `docs/plan.md` (veya ilgili GitHub milestone) içinden **bu haftanın kapsamını** kontrol et. Kapsam dışı bir özellik istenirse yapma; "yol haritası" olarak not et ve kullanıcıya söyle.
2. Değiştireceğin dosya **öğrenme modu** listesindeyse (bölüm 5) kod yazma, açıkla.
3. Mimari değişmezlerden (bölüm 2) birini bozacak bir istek gelirse dur, nedenini açıkla ve alternatif öner.

## 2. Mimari değişmezler (asla bozulmaz)

1. **LLM stok yazamaz.** Claude yalnızca okuma araçlarını ve `propose_*` öneri araçlarını çağırır. Öneri araçları yalnızca `PENDING_CONFIRMATION` durumunda bir `operations` kaydı oluşturur.
2. **Onay LLM'den geçmez.** Stok yalnızca `POST /v1/operations/{id}/confirm` uç noktasıyla değişir. Bu uç nokta asistan modülünden çağrılmaz; `confirm_*` veya `apply_*` adlı bir araç **eklenmez**.
3. **Tek transaction.** Stok uygulama sırası:
   - operasyonu `FOR UPDATE` ile kilitle;
   - durum, sürüm, süre ve yetkiyi yeniden kontrol et;
   - `inventory` satırlarını **ürün kimliğine göre artan sırada** kilitle;
   - stok yeterliliğini kontrol et;
   - hareketleri, stoğu, hareketli ortalama maliyeti, operasyon durumunu, `audit_logs` ve `outbox_events` kayıtlarını aynı transaction'da yaz.

   Çok kalemli işlemde tek bir kalem başarısız olursa her şey geri alınır.
4. **Veritabanı son savunma hattıdır.** `inventory.quantity` için `CHECK (quantity >= 0)` kısıtı bulunur. Miktarlar `NUMERIC(14,3)`, çevrim katsayıları `NUMERIC(14,6)` olarak tutulur. Para ve miktarda asla `float` veya JS `number` ile aritmetik yapılmaz; ondalık kütüphanesi ya da SQL kullanılır.
5. **Çok kiracılılık.** Şirkete ait her tabloda `organization_id NOT NULL` bulunur. Her sorgu repository katmanından ve `organization_id` filtresiyle geçer. Araçlar şirket ve kullanıcı kimliğini **oturumdan** alır, model girdisinden asla almaz.
6. **Idempotency.** Mesajlar `(conversation_id, client_message_id)`, onaylar `Idempotency-Key`, hareketler `(operation_id, kalem)` üzerinden tekilleştirilir. Aynı onay iki kez stok değiştiremez.
7. **Silme yok, ters kayıt var.** Onaylanmış bir işlem silinmez veya güncellenmez. Geri alma, `reversed_operation_id` ile bağlı yeni bir operasyondur (`APPLIED → REVERSED`, yalnızca bir kez). Hareketi olan ürün silinmez, pasife alınır.
8. **Yan etkiler outbox'tan.** Push, kritik stok kontrolü ve entegrasyonlar `outbox_events` tablosunu okuyan worker'da çalışır. Stok kodu doğrudan bildirim göndermez.
9. **Port ve adaptörler.** Dış servisler yalnızca arayüz üzerinden çağrılır: `AIProvider`, `ChannelAdapter`, `SpeechToTextProvider`, `StorageProvider`, `PushProvider`. Claude SDK'sı yalnızca `apps/api/src/modules/ai/adapters/` altında import edilir.
10. **Ajan sınırları.** Mesaj başına en fazla 5 araç turu, kullanıcı ve şirket başına günlük token bütçesi uygulanır. Her model çağrısı `ai_runs` tablosuna yazılır: model, prompt sürümü, token ve önbellek sayıları, süre.
11. **Belge okuma.** Claude'un belgeden çıkardığı kalemler onaysız stoğa girmez. Şemada her kalem için `okunamadi` bayrağı bulunur; model tahmin yapmaz, alanı boş bırakır.
12. **Gizli anahtarlar.** Claude ve veritabanı anahtarları yalnızca backend ortam değişkenlerinde tutulur. Mobil veya web paketine AI anahtarı girmez.

## 3. Teknoloji yığını (sabit)

| Katman | Kullanılır | Kullanılmaz (ADR olmadan) |
| --- | --- | --- |
| Mobil | Expo, Expo Router, NativeWind, `expo/fetch` (SSE) | Bare React Native, Redux |
| Web | Next.js App Router, Tailwind, shadcn/ui, TanStack Table | Başka UI kütüphanesi |
| Sunucu durumu | TanStack Query + OpenAPI'den üretilen istemci (`packages/api-client`) | Elle yazılmış fetch çağrıları, tRPC |
| Doğrulama | Zod (`packages/shared`) | Yup, class-validator dışı ikinci sistem |
| Backend | NestJS, REST `/v1`, `@nestjs/swagger`, SSE | GraphQL, WebSocket |
| Veri | PostgreSQL (Supabase), Drizzle ORM, drizzle-kit migration | Prisma, TypeORM, ham `pg` sorgusunun dağınık kullanımı |
| Kuyruk | pg-boss + `outbox_events` | Redis, BullMQ |
| LLM | `@anthropic-ai/sdk`; sohbet Haiku 4.5, belge Sonnet 5.5 (model adları env'de) | LangChain ve benzeri çerçeveler |
| Test | Vitest, Supertest, Playwright | Jest |

Yeni bağımlılık veya yığın değişikliği gerekiyorsa önce `docs/kararlar/ADR-XXX-konu.md` taslağı yaz: bağlam, seçenekler, karar, sonuçlar. Kullanıcı onaylamadan ekleme.

## 4. Kod standartları

- **Dil:** Kod tanımlayıcıları, dosya adları ve tablo adları İngilizce yazılır. Kullanıcıya görünen metinler, asistan cevapları, hata mesajları ve yorumlar Türkçe yazılır. Sektör terimleri korunur: irsaliye, cari, sayım fazlası/noksanı, fire.
- **TypeScript:** `strict: true` kullanılır. `any` yasaktır (zorunluysa `unknown` + daraltma). Dışa açık fonksiyonlarda açık dönüş tipi yazılır.
- **Şemalar:** İstek/cevap ve araç girdileri `packages/shared` içindeki Zod şemalarından türetilir. Aynı şema iki yerde yazılmaz.
- **API:** Her uç nokta `/v1` altındadır, Swagger dekoratörleri taşır ve hataları tek biçimde döner: `{ error: { code, message, details? } }`. API değişince `pnpm gen:api` çalıştırılır.
- **Modül sınırları:** Bir NestJS modülü başka modülün tablosuna doğrudan erişmez; o modülün servisini kullanır.
- **Araç kayıt defteri:** Yeni asistan aracı yalnızca `assistant/tools/` altına eklenir ve şu alanları taşır: ad, açıklama, strict JSON şeması, sınıf (`read` | `propose`), yetki kuralı. `propose` araçları stok tablolarına yazmaz.
- **Prompt'lar:** Kod içine gömülmez; `apps/api/src/modules/ai/prompts/` altında sürüm numarasıyla tutulur. Prompt değişikliği `ai_runs.prompt_version` değerini artırır.
- **Log:** pino ile yapılandırılmış log tutulur. Kişisel veri (telefon, e-posta) ve tam mesaj içeriği loglanmaz.
- **Testler:** Envanter, operasyon, onay, geri alma ve araç doğrulama kodu testsiz birleştirilmez. En az şu senaryolar bulunur: yetersiz stok, çift onay, eşzamanlı çıkış, başka şirketin verisi, geri almanın stoğu eksiye düşürmesi. Claude testlerde mock `AIProvider` ile değiştirilir.
- **Mobil:** Görüntü küçültme cihazda yapılır (uzun kenar en fazla ~2000 px). Sunucuda CPU yoğun görüntü işleme yapılmaz.

## 5. Öğrenme modu: bu dosyalara kod yazma

Aşağıdaki parçaları öğrenci kendisi yazar, çünkü savunmada sorulacak çekirdek bunlardır. Bu dosyalarda **kod yazma ve kod bloğu verme**. Bunun yerine kavramı, adımları ve dikkat edilecek hataları anlat. Yalnızca öğrenci hata ayıklama yardımı isterse, hatanın yerini ve nedenini göster.

- `apps/api/src/modules/inventory/**/apply*.ts`: stok uygulama transaction'ı ve kilitleme
- `apps/api/src/modules/operations/**`: durum makinesi, onay, geri alma
- `apps/api/src/modules/assistant/agent-loop*.ts` ve `assistant/tools/registry*.ts`: ajan döngüsü ve araç kayıt defteri
- `apps/api/src/modules/catalog/**/match*.ts`: araç çıktısı doğrulama ve katalog eşleştirme
- `packages/db/schema/**` ve `packages/db/migrations/**`: veritabanı şeması
- `apps/mobile/**/chat/**/stream*.ts`: mobil sohbet SSE akışı

Diğer parçalar ajan desteğiyle yazılabilir; öğrenci inceler. Bunlar web paneli ekranları, CRUD uçları, seed verisi, mock'lar, CI/EAS/deploy yapılandırması ve doküman taslaklarıdır. Kullanıcı açıkça "üretim modu" derse bu kısıt kalkar.

## 6. Git ve GitHub

- **Commit atma, push etme, PR açma, tag atma.** Bunları öğrenci yapar. İş bitince yalnızca commit mesajı öner.
- Commit biçimi (Conventional Commits, Türkçe açıklama): `feat(inventory): depolar arası transfer transaction'ı`, `fix(assistant): araç tur sınırı aşımında hata mesajı`, `test(operations): çift onay senaryosu`, `docs(rapor): 3. hafta raporu`.
- Branch adı: `<tür>/<issue-no>-<kısa-ad>`, örnek: `feat/14-sayim-fisi`. Her iş bir issue'ya bağlanır.
- Hafta sonunda etiket: `hafta-N`.

## 7. Kapsam

**MVP'de:** şirket/davet/rol, ürün-birim-alternatif ad-depo (araç dahil)-cari yönetimi, giriş/çıkış/transfer/sayım/fire, hareketli ortalama maliyet, asistan (okuma + öneri araçları), işlem kartı ve onay, ters kayıtla geri alma, irsaliye fotoğrafından kalem okuma, cihazda ses tanıma, barkod, kritik stok bildirimi, denetim kaydı, değerlendirme betiği (`pnpm eval`).

**MVP dışı:** fatura/e-irsaliye kesimi, lot/seri/SKT, varyant, üretim, ödeme/abonelik, çevrimdışı mod, WhatsApp kanalı, ERP entegrasyonu. Bunlar istenirse yapılmaz; `docs/yol-haritasi.md` dosyasına not düşülür.

Hosting: Vercel (web), Render Free (API ve worker tek süreçte), Supabase Free, EAS Free. Ücretli servise geçiş öğrenci kararıdır.

## 8. İş bitmeden kontrol listesi

- [ ] Bölüm 2'deki değişmezlerin hiçbiri bozulmadı
- [ ] Yeni tablo/kolon varsa `organization_id`, uygun indeks ve migration var
- [ ] Zod şeması `packages/shared` içinde; API değiştiyse istemci yeniden üretildi
- [ ] Çekirdek modüle dokunulduysa test eklendi ve `pnpm test` geçiyor
- [ ] `pnpm lint` ve `pnpm typecheck` temiz
- [ ] Öğrenme modu dosyasına kod yazılmadı
- [ ] Kullanıcıya önerilen commit mesajı ve bu değişikliğin haftalık rapora girecek 1–2 cümlelik özeti verildi

## 9. Haftalık rapor

Rapor istendiğinde `references/haftalik-rapor-sablonu.md` biçimini birebir kullan. Dosya `docs/raporlar/hafta-XX.md` olarak kaydedilir. "Tamamlanan görevler" bölümündeki bilgiyi git geçmişinden ve kapanan issue'lardan çıkar. Yapılmamış bir işi yapılmış gibi yazma; ölçülmemiş bir sonucu rakamla yazma.
