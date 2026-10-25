-- Asistanın ürün araması (search_products) için benzerlik araması: pg_trgm ve Türkçe harf dönüşümü.
--
-- pg_trgm metni üçlü harf gruplarına (trigram) böler ve iki metnin ortak gruplarından 0–1 arası bir benzerlik
-- skoru hesaplar. Böylece "kabllo" ya da sesli komuttaki küçük tanıma hataları da "kablo"yu bulur; ILIKE ancak
-- metin birebir geçiyorsa bulur. btree_gin, şirket kimliğini (uuid) trigram ile aynı GIN indeksine koymayı sağlar:
-- arama her zaman tek şirketin ürünlerinde yapılır (0006'daki indeksler).
--
-- Supabase eklentileri public yerine extensions şemasına kurar; extensions şeması postgres kullanıcısının
-- arama yolunda (search_path) var.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA extensions;--> statement-breakpoint

-- Aramadaki Türkçe harf dönüşümü: I, İ ve ı "i" olur, sonra metin küçük harfe çevrilir. apps/api/src/common/search.ts
-- içindeki foldForSearch ile aynı dönüşümdür; ikisinin aynı sonucu verdiği test ediliyor. Böylece "YANGIN",
-- "yangın" ve İngilizce klavyeyle yazılan "yangin" aynı biçime iner.
--
-- İndeks ifadesinde kullanılacağı için IMMUTABLE (aynı girdiye her zaman aynı çıktı). Sorgu indeksin işine yarasın
-- diye sorgudaki ifade indeksteki ifadeyle aynı yazılmalı: private.fold_search(kolon).
-- search_path boş: içerideki adlar pg_catalog'dan gelir, başka şemadaki aynı adlı fonksiyon araya giremez.
-- private şemasında durur; Data API yayınlamaz, istemciler çağıramaz.
CREATE FUNCTION private.fold_search(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT pg_catalog.lower(pg_catalog.translate(value, 'İIı', 'iii'))
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.fold_search(text) FROM PUBLIC;
