// API'den gelen ondalık değerler ("12.500000") metindir ve sayıya çevrilmez (ADR-003): JS number'a çevrilen bir miktar
// yuvarlanabilir. Buradaki fonksiyonlar yalnızca metni biçimlendirir.

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function splitDecimal(value: string): { sign: string; whole: string; fraction: string } | null {
  const match = DECIMAL.exec(value);
  if (!match) {
    return null;
  }
  return { sign: match[1] ?? '', whole: match[2] ?? '0', fraction: (match[3] ?? '').replace(/0+$/, '') };
}

/**
 * Ekranda gösterim: "1412.500" → "1.412,5", "12.000000" → "12", "-36.000" → "−36". Binlik ayırıcı nokta, ondalık
 * ayırıcı virgül. `signed` verilirse artı değerin önüne "+" konur (hareketlerde giriş/çıkış yönü).
 */
export function formatDecimal(value: string, { signed = false }: { signed?: boolean } = {}): string {
  const parts = splitDecimal(value);
  if (!parts) {
    return value;
  }
  const whole = parts.whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const number = parts.fraction ? `${whole},${parts.fraction}` : whole;
  const isZero = /^0+$/.test(parts.whole) && !parts.fraction;
  if (parts.sign && !isZero) {
    return `−${number}`;
  }
  return signed && !isZero ? `+${number}` : number;
}

/** Form alanına yazılacak hâl: "12.500000" → "12,5" (binlik ayırıcı yok; kullanıcı düzenleyecek). */
export function decimalToInput(value: string | null): string {
  if (value === null) {
    return '';
  }
  const parts = splitDecimal(value);
  if (!parts) {
    return value;
  }
  return `${parts.sign}${parts.fraction ? `${parts.whole},${parts.fraction}` : parts.whole}`;
}

/**
 * Form alanından API'ye: "12,5" → "12.5". Türkçe klavyede ondalık ayırıcı virgüldür; tek virgül noktaya çevrilir.
 * Biçim kontrolünü paylaşılan Zod şeması yapar.
 */
export function inputToDecimal(value: string): string {
  const trimmed = value.trim();
  return /^\d+,\d+$/.test(trimmed) ? trimmed.replace(',', '.') : trimmed;
}
