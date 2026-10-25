import { pgEnum, timestamp } from 'drizzle-orm/pg-core';

// Zamanlar saat dilimli tutulur (timestamptz); sunucu ve istemci farklı bölgelerde olsa da kayma olmaz.
// Ortak kolonlar tablolara yayılarak (...timestamps) kullanılır.
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Uygulama üzerinden yapılan güncellemelerde Drizzle tarafından yenilenir.
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Yalnızca eklenen, güncellenmeyen kayıtlar için.
export const createdAtOnly = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

// Sabit değer listeleri. Yeni değer eklemek bir migration gerektirir; bu, listenin
// kod ile veritabanı arasında sessizce ayrışmasını önler.
export const organizationRole = pgEnum('organization_role', ['ADMIN', 'EMPLOYEE']);
export const warehouseType = pgEnum('warehouse_type', ['WAREHOUSE', 'BRANCH', 'VEHICLE']);
export const partyType = pgEnum('party_type', ['SUPPLIER', 'CUSTOMER']);
export const aliasSource = pgEnum('alias_source', ['MANUAL', 'LEARNED']);

// İşlem (stok fişi) türü. OPENING: açılış stoğu; REVERSAL: onaylanmış bir işlemi geri alan ters kayıt.
export const operationType = pgEnum('operation_type', [
  'STOCK_IN',
  'STOCK_OUT',
  'TRANSFER',
  'COUNT',
  'WASTE',
  'OPENING',
  'REVERSAL',
]);

// İşlemin durum makinesi (mimari referans). Geçişler API'de tek bir fonksiyondan yapılır.
export const operationStatus = pgEnum('operation_status', [
  'RECEIVED',
  'NEEDS_CLARIFICATION',
  'PENDING_CONFIRMATION',
  'APPLIED',
  'REVERSED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
]);

// Kaydın nereden geldiği: ekran (web/mobil form), sohbet (asistan), belge (irsaliye), içe aktarma, sistem (seed).
export const actionSource = pgEnum('action_source', ['SCREEN', 'CHAT', 'DOCUMENT', 'IMPORT', 'SYSTEM']);

// Sohbetin kanalı. Şimdilik yalnızca uygulama (mobil ve web); WhatsApp MVP dışında.
export const conversationChannel = pgEnum('conversation_channel', ['APP']);

// Mesajın sahibi. USER: kullanıcının yazdığı (ya da sesle söylediği) mesaj; ASSISTANT: modelin cevabı (metin, düşünme
// ve araç çağrısı blokları); TOOL: araç sonuçları. Claude API araç sonuçlarını "user" rolüyle alır; ayrı tutulması
// arayüzün yalnızca kullanıcı ve asistan mesajlarını göstermesini ve tekrar kontrolünün yalnızca USER'da olmasını sağlar.
export const messageRole = pgEnum('message_role', ['USER', 'ASSISTANT', 'TOOL']);

// Kullanıcı mesajının cevap durumu (yalnızca USER mesajında). Aynı client_message_id tekrar gelirse API buna bakar:
// sürüyorsa 409, tamamlandıysa kayıtlı cevap; model ikinci kez çağrılmaz.
export const messageStatus = pgEnum('message_status', ['IN_PROGRESS', 'COMPLETED', 'FAILED']);

// Stok hareketinin türü. Her türün işareti inventory_movements'taki CHECK kısıtıyla bağlıdır.
export const movementType = pgEnum('movement_type', [
  'IN',
  'OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'COUNT_SURPLUS',
  'COUNT_SHORTAGE',
  'WASTE',
  'REVERSAL',
]);
