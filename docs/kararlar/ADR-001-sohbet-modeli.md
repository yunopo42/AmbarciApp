# ADR-001: Sohbet modeli olarak Haiku 5.5 (`effort: low`)

| Alan | Değer |
| --- | --- |
| Durum | Kabul edildi |
| Tarih | 2026-10-20 (taslak ve kabul) |
| İlgili | Issue #13, `eval/arac-cagirma-denemesi.md` |

## Bağlam

Teknik araştırma raporunda (`docs/teknik-arastirma.md`, "Model seçimi") sohbet ajanı ve araç seçimi için
Claude Haiku 4.5 seçildi; gerekçe hız ve maliyetti. Raporun yazıldığı sırada Haiku 5.5 yoktu. Haiku 5.5,
Haiku 4.5'in yerine gelen model. Haiku 4.5'in 1 $ / 5 $ olan fiyatına karşılık, istem 100K tokenın altındayken
0,10 $ / 0,50 $ (milyon token başına; `claude-api` skill'i, tablo tarihi 2026-10-06). Ayrıca 1M bağlam
penceresi var ve ilk kez `effort` düzeyi destekleyen Haiku modeli.

4. haftadaki asistan altyapısından önce iki model, 20 etiketli Türkçe saha mesajında ve aynı strict araç
tanımlarıyla denendi (okuma ve `propose_*` araçları, onay aracı yok). Ölçülen sonuçlar:

| Ölçüm (20 mesaj) | Haiku 4.5 | Haiku 5.5 (medium) | Haiku 5.5 (low) |
| --- | --- | --- | --- |
| Doğru araç / doğru parametre | 20 / 20, 20 / 20 | 20 / 20, 20 / 20 | 20 / 20, 20 / 20 |
| Belirsiz mesajda öneri aracı çağrısı | 0 | 0 | 0 |
| Kullanıcı söylemeden `note` yazılan öneri | 6 / 11 | 0 / 11 | 0 / 11 |
| Süre / mesaj, medyan | 6,70 sn | 5,04 sn | 4,13 sn |
| Maliyet / mesaj (önbelleksiz) | 0,01116 $ | 0,00102 $ | 0,00100 $ |

Doğruluk bu kümede ayırt edici olmadı: üç yapılandırma da tavana vurdu. Farklar süre, maliyet, araç
tanımındaki talimata uyum ve Türkçe cevap kalitesinde çıktı (ayrıntılar deneme belgesinde).

## Seçenekler

1. **Haiku 4.5 ile devam.** Mevcut karar, yığın tablosu değişmez. Mesaj başına yaklaşık 11 kat pahalı ve daha
   yavaş; boş `note` alanını uydurdu, cevaplarında dil hataları var. `claude-api` skill'ine göre önbelleğe
   alınabilecek en kısa istem 4.096 token; bizim sistem promptu ve araç tanımlarımız bunun altında kaldığı için
   raporda varsayılan önbellek indirimi büyük olasılıkla bu modelde gerçekleşmez.
2. **Haiku 5.5, `effort: medium` (varsayılan).** Doğruluk aynı; low'dan medyanda yaklaşık 0,9 sn daha yavaş,
   maliyet aynı. Uzun ve zor mesajlarda daha güvenli olabilir, bu denemede fark görülmedi.
3. **Haiku 5.5, `effort: low`.** Bu denemedeki en hızlı yapılandırma, maliyet medium ile aynı. Anthropic sohbet
   ve kısa araç işleri için `low` düzeyini öneriyor.

Sonnet 5.5 bu kararın kapsamında değil. Raporda zor sohbet durumları için yedek model olarak geçiyor ve o
rolü sürüyor; bu denemede ölçülmedi.

## Karar

Sohbet ajanı için **seçenek 3** seçildi: `claude-haiku-5-5`, `output_config.effort: "low"`, adaptive thinking
açık (varsayılan; `thinking: {type: "disabled"}` kullanılmaz). Belge okuma modeli (Sonnet 5.5) değişmez.

Model adı gibi effort da ortam değişkeninde tutulur: `CLAUDE_CHAT_MODEL=claude-haiku-5-5` ve
`CLAUDE_CHAT_EFFORT=low`. 6. haftadaki 100 mesajlık değerlendirmede `low` ile `medium` yeniden kıyaslanır;
`low` zor mesajlarda geride kalırsa düzey kod değişmeden env'den yükseltilir.

## Sonuçlar

Olumlu:

- Bu denemede mesaj başına maliyet yaklaşık 11 kat düştü (0,01116 $ → 0,00100 $), medyan mesaj süresi
  6,70 sn'den 4,13 sn'ye indi.
- Model, araç tanımındaki "yoksa gönderme" talimatına uydu; öneri kartlarına ve denetim kaydına uydurma not
  düşmedi.
- Önbelleğe alınabilecek en kısa istem 512 token olduğu için sistem promptu ve araç tanımları önbelleğe
  alınabilir (maliyet etkisi henüz ölçülmedi).

`AIProvider` Claude adaptörünü (4. hafta) etkileyen API farkları (`claude-api` skill'i, Haiku 5.5'e geçiş bölümü):

- Cevap `thinking` bloklarıyla başlayabilir. İçerik konumla değil türle okunmalı; düşünme blokları (metni boş
  olsa da) araç sonuçlarıyla birlikte değiştirilmeden geri gönderilmeli.
- `temperature`, `top_p`, `top_k` gönderilmez (varsayılan dışı değer 400 döner); assistant prefill yoktur.
- Konuşma geçmişi yalnızca sona eklenerek büyümeli. Daha önce gönderilmiş `system`, `tools` veya mesajlar
  değiştirilip düşünme blokları geri gönderilirse istek 400 alabilir (31 Ağustos 2026'dan sonra açılan
  hesaplarda varsayılan olarak denetlenir). Sohbet ortasında talimat gerekirse mesajlara `role: "system"`
  eklenir.
- `stop_reason: "refusal"` işlenmeli; Haiku 5.5'te sunucu tarafı yedek model yoktur.
- `max_tokens`, düşünmeye pay bırakacak kadar büyük tutulmalı (denemede 4.096 yetti).
- Tokenizer farklı olduğundan iki modelin token sayıları doğrudan kıyaslanmaz. `ai_runs` kayıtlarına model ve
  prompt sürümünün yanında effort düzeyi de yazılmalı.

Riskler:

- `low` düzeyinde model uzun sistem promptlarında bir aramayı ya da kontrolü atlayabilir (skill'deki
  davranış notu). Bu, 6. hafta değerlendirmesinde ölçülecek.
- Haiku 5.5 güvenlik sınıflandırıcıları çalıştırıyor; Haiku 4.5'te olmayan red cevapları gelebilir. Saha stok
  mesajlarında beklenmiyor, ama adaptör red durumunu kullanıcıya anlaşılır bir hatayla göstermeli.
- Deneme yalnızca 20 kolay ve tek turlu mesajla yapıldı; çok turlu konuşma ve ses tanıma hataları denenmedi.

Uygulama:

- [x] `.env.example` güncellendi: `CLAUDE_CHAT_MODEL=claude-haiku-5-5` ve `CLAUDE_CHAT_EFFORT=low`.
  Yerel `.env` ve Render ortam değişkenleri elle güncellenir.
- [x] `ambarci-standartlari` skill'indeki yığın tablosu ve `docs/teknik-arastirma.md` dosyasındaki model
  seçimi ve işlem başı maliyet bölümleri güncellendi.
