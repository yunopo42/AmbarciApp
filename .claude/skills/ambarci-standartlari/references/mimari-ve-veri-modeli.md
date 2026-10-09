# Ambarcı — mimari ve veri modeli referansı

Bu dosya 1. hafta teknik araştırma raporunun kod yazarken gereken özetidir. Raporla çelişki olursa rapor geçerlidir; çelişkiyi kullanıcıya bildir.

## Depo yapısı

```text
apps/mobile          Expo uygulaması (Expo Router) — saha: sohbet, stok, işlemlerim
apps/web             Next.js paneli — yönetim ekranları + sohbet yan paneli
apps/api             NestJS (API + worker aynı süreçte, Render Free)
packages/shared      Zod şemaları, ortak tipler, sabitler
packages/api-client  OpenAPI'den üretilen istemci + TanStack Query hook'ları
packages/db          Drizzle şeması ve migration'lar
eval/                Etiketli veri kümeleri ve değerlendirme betiği
docs/                plan.md, yol-haritasi.md, kararlar/ (ADR), raporlar/
.github/workflows    CI
```

## Backend modülleri

| Modül | Sorumluluk |
| --- | --- |
| `auth` | Supabase JWT doğrulama (JWKS), aktif şirket ve rol bağlamı |
| `organizations` | Şirket, üyelik, davet, çalışan ve depo yetkileri, şirket ayarları |
| `catalog` | Ürünler, birimler, alternatif adlar, barkod, cari (`parties`), Excel içe aktarma, benzerlik araması |
| `inventory` | Depolar, stok, hareketler, stok uygulama transaction'ı, hareketli ortalama maliyet |
| `operations` | Öneri, durum makinesi, onay, süre aşımı, ters kayıt |
| `assistant` | Sohbet, mesaj, ajan döngüsü, araç kayıt defteri, SSE akışı |
| `ai` | `AIProvider`, Claude adaptörü, prompt sürümleri, `ai_runs` |
| `documents` | Yükleme URL'i, belge çıkarımı, kalemler, tekrar kontrolü |
| `notifications` | Cihaz token'ları, push |
| `events` | Outbox, pg-boss işleri, tüketiciler |
| `audit` | Denetim kayıtları |

Modüller birbirinin tablolarına değil, servislerine erişir.

## Operasyon durum makinesi

```
RECEIVED → NEEDS_CLARIFICATION → PENDING_CONFIRMATION → APPLIED → REVERSED
                                          ├→ CANCELLED
                                          ├→ EXPIRED (30 dk)
                                          └→ FAILED
```

Geçişler tek bir fonksiyondan yapılır. İzin verilmeyen geçiş hata fırlatır. Kullanıcı öneriyi düzenlerse sürüm artar ve eski onaylar geçersiz olur.

Hareket türleri: `IN`, `OUT`, `TRANSFER_OUT`, `TRANSFER_IN`, `COUNT_SURPLUS`, `COUNT_SHORTAGE`, `WASTE`, `REVERSAL`.

## Asistan araçları

| Sınıf | Araç | Not |
| --- | --- | --- |
| read | `search_products(query)` | `pg_trgm` + `btree_gin` ile `(organization_id, metin)` GIN indeksi; en iyi 5 aday ve skor döner |
| read | `get_stock(product_id, warehouse_id?)` | Rakam her zaman veritabanından gelir |
| read | `list_warehouses`, `list_recent_movements`, `list_my_pending_operations` | |
| propose | `propose_stock_in`, `propose_stock_out`, `propose_transfer` | Strict şema; stok tablosuna yazmaz |
| propose | `propose_count`, `propose_waste` | Sayım farkı ve fire |
| propose | `propose_reversal(operation_id)` | Çalışan kendi işlemini 15 dk içinde geri alabilir, sonrasında yalnızca yönetici |

Belirsiz durumda (birden fazla yakın aday, eksik depo veya miktar) öneri aracı çağrılmaz; aday listesiyle soru sorulur.

## Veri modeli (ana tablolar)

| Tablo | Temel alanlar | Kural |
| --- | --- | --- |
| `organizations` | ad, ayarlar (onay eşiği, AI limiti) | Kök kiracı |
| `organization_users` | organization_id, user_id, rol (ADMIN/EMPLOYEE), aktif | (şirket, kullanıcı) benzersiz |
| `user_warehouse_access` | organization_user_id, warehouse_id | Depo bazında yetki |
| `invitations` | kod, rol, son kullanma | Tek kullanımlık |
| `warehouses` | ad, tür (depo/şube/araç), aktif | |
| `products` | SKU, barkod, ad, temel birim, min. stok, aktif | (şirket, SKU) benzersiz |
| `product_units` | birim, katsayı NUMERIC(14,6), barkod | Çevrim yalnızca çarpma, tek noktada yuvarlama |
| `product_aliases` | metin, kaynak (elle/öğrenilmiş) | (organization_id, metin) GIN indeksi |
| `parties` | ad, tür (tedarikçi/müşteri), VKN/TCKN | Borç-alacak yok |
| `inventory` | warehouse_id, product_id, miktar NUMERIC(14,3), ort. maliyet | (şirket, depo, ürün) benzersiz; miktar ≥ 0 |
| `inventory_movements` | tür, miktar (ana birim), girilen birim, birim maliyet, cari, operation_id | (operation_id, kalem) benzersiz |
| `stock_counts` | sistem / sayılan / fark | Onayla sayım hareketi |
| `conversations` | user, kanal (`app`, ileride `whatsapp`) | |
| `messages` | rol, içerik JSON, client_message_id | (sohbet, client_message_id) benzersiz |
| `operations` | kaynak mesaj/belge, tür, kalemler, sürüm, durum, reversed_operation_id | Bir kez geri alınır |
| `documents` / `document_items` | tür, belge no, tedarikçi, dosya yolu; kalem, miktar, okunamadi | (şirket, tedarikçi, belge no) benzersiz |
| `ai_runs` | model, prompt sürümü, araç çağrıları, token/önbellek, süre | Maliyet ve değerlendirme kaynağı |
| `push_tokens` | user, token, platform | |
| `outbox_events` | tür, yük, işlenme | Stokla aynı transaction |
| `audit_logs` | aktör, eylem, nesne, kaynak (sohbet/ekran/belge) | Yalnızca ekleme |

## Mesaj akışı

1. İstemci `POST /v1/conversations/{id}/messages` (SSE açık kalır).
2. API JWT'yi doğrular, şirket ve yetkileri yükler, mesajı yazar.
3. Asistan Claude'u çağırır, metni akıtır, araçları kullanıcının yetkisiyle çalıştırır.
4. Öneri aracı `operations` kaydı açar; akışa `operation_card` olayı eklenir.
5. Kullanıcı Onayla'ya basar: `POST /v1/operations/{id}/confirm` + `Idempotency-Key`.
6. Transaction stoğu, hareketleri ve outbox olayını yazar; worker bildirim ve kontrolleri yapar.

## Türkiye uyumu

- Arayüz terimleri: stok kartı, ana birim/hareket birimi, depo fişi, sevk, sayım fazlası/noksanı, fire, cari.
- Maliyet: hareketli ağırlıklı ortalama. Bu bir yönetim raporudur, resmi defter değildir; VUK uyumu iddia edilmez.
- e-irsaliye kesilmez. Gelen e-irsaliye XML okuma yalnızca zaman kalırsa yapılır.
