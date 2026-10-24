// API'den gelen ondalık değerler ("12.500000") metindir ve sayıya çevrilmez (ADR-003): JS number'a çevrilen bir miktar
// yuvarlanabilir. Buradaki fonksiyonlar yalnızca metni biçimlendirir.

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

function splitDecimal(value: string): { whole: string; fraction: string } | null {
  const match = DECIMAL.exec(value);
  if (!match) {
    return null;
  }
  return { whole: match[1] ?? '0', fraction: (match[2] ?? '').replace(/0+$/, '') };
}

/** Ekranda gösterim: "1412.500" → "1.412,5", "12.000000" → "12". Binlik ayırıcı nokta, ondalık ayırıcı virgül. */
export function formatDecimal(value: string): string {
  const parts = splitDecimal(value);
  if (!parts) {
    return value;
  }
  const whole = parts.whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return parts.fraction ? `${whole},${parts.fraction}` : whole;
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
  return parts.fraction ? `${parts.whole},${parts.fraction}` : parts.whole;
}

/**
 * Form alanından API'ye: "12,5" → "12.5". Türkçe klavyede ondalık ayırıcı virgüldür; tek virgül noktaya çevrilir.
 * Biçim kontrolünü paylaşılan Zod şeması yapar.
 */
export function inputToDecimal(value: string): string {
  const trimmed = value.trim();
  return /^\d+,\d+$/.test(trimmed) ? trimmed.replace(',', '.') : trimmed;
}
