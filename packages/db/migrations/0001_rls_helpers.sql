-- RLS yardımcı fonksiyonları ve istemci rollerinin (anon, authenticated) yetkileri.
--
-- İstemciler (web, mobil) veriyi API üzerinden okur ve yazar; API veritabanına tablo sahibi olan
-- postgres kullanıcısıyla bağlanır ve RLS'den etkilenmez. Supabase'in Data API'si ise anon anahtarı
-- ve kullanıcı oturumuyla tablolara doğrudan erişebilir. Bu dosya o yolu kapatır:
--   * anon (oturum açmamış istemci) hiçbir tabloya erişemez;
--   * authenticated (oturum açmış kullanıcı) yalnızca okuyabilir, hangi satırları okuyacağını
--     RLS politikaları (0002) belirler; yazma yetkisi yoktur. Stok ve diğer veriler yalnızca API'den değişir.

-- Yardımcı fonksiyonlar Data API'nin yayınlamadığı ayrı bir şemada durur; istemci bunları RPC ile çağıramaz.
CREATE SCHEMA IF NOT EXISTS private;--> statement-breakpoint
REVOKE ALL ON SCHEMA private FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA private TO authenticated;--> statement-breakpoint

-- Oturumdaki kullanıcının aktif üyesi olduğu şirketler.
-- SECURITY DEFINER: fonksiyon sahibinin (postgres) yetkisiyle çalışır. organization_users tablosunun kendi
-- politikası da bu fonksiyonu kullandığı için, aksi halde politika kendini sonsuz döngüyle çağırırdı.
-- search_path boş: fonksiyon içindeki her ad şemasıyla yazılır, başka şemadaki aynı adlı nesne araya giremez.
CREATE FUNCTION private.user_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ou.organization_id
  FROM public.organization_users AS ou
  WHERE ou.user_id = (SELECT auth.uid())
    AND ou.is_active
$$;--> statement-breakpoint

-- Oturumdaki kullanıcının yönetici (ADMIN) olduğu şirketler.
CREATE FUNCTION private.admin_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ou.organization_id
  FROM public.organization_users AS ou
  WHERE ou.user_id = (SELECT auth.uid())
    AND ou.is_active
    AND ou.role = 'ADMIN'
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.user_organization_ids() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.admin_organization_ids() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.user_organization_ids() TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.admin_organization_ids() TO authenticated;--> statement-breakpoint

-- Supabase varsayılan olarak public şemasındaki tablolarda anon ve authenticated rollerine tüm yetkileri verir.
-- RLS satırları süzer; yetkileri geri almak ikinci bir kilit: politika yanlış yazılsa bile yazma mümkün olmaz.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;--> statement-breakpoint

-- Sonraki migration'larla eklenecek tablolar da aynı kuralla başlasın.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;
