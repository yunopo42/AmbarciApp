-- outbox_events istemcilere tamamen kapalıdır.
--
-- 0001'deki varsayılan yetkiler yeni tablolarda anon'un bütün yetkilerini ve authenticated'ın yazma
-- yetkilerini zaten geri alır; authenticated'da yalnızca SELECT kalır. outbox_events'te okuma politikası
-- olmadığı için RLS her satırı süzer ve sonuç boş döner. Okuma yetkisini de geri almak ikinci kilittir:
-- ileride yanlışlıkla bir politika eklense bile istemci bu tabloyu okuyamaz, istek yetki hatasıyla reddedilir.
-- Olayları yalnızca API'nin içindeki worker okur (tablo sahibi postgres kullanıcısıyla).
REVOKE ALL ON TABLE "outbox_events" FROM anon, authenticated;
