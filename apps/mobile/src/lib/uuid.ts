/**
 * UUID (sürüm 4). Mesajın istemci kimliği (`clientMessageId`) için: gizli bir değer değil, tekrar gönderimi tanımaya
 * yarayan bir anahtar ve yalnızca kendi sohbetinde benzersiz olması gerekir. Ortamda crypto.randomUUID varsa o
 * kullanılır; React Native'de (Hermes) yoksa Math.random ile üretilir. 122 rastgele bitle aynı sohbette çakışma
 * olasılığı yok sayılacak kadar küçük; bunun için yeni bir paket (expo-crypto) eklenmedi.
 */
export function randomUuid(): string {
  const native = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof native?.randomUUID === 'function') {
    return native.randomUUID();
  }
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // sürüm 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 9562 varyantı
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
