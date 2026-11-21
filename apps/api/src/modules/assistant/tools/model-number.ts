// Araç sonuçlarında modele giden miktar ve tutarların yazımı (#86). Sayıya çevrilmez (ADR-003); yalnızca metin
// biçimlenir.
//
// Binlik ayırıcı yok, ondalık ayırıcı nokta: "1412.500" → "1412.5", "2000.000" → "2000", "-12.500" → "−12.5".
// Modelin araçlara gönderdiği miktar da bu biçimdedir ("12.5"); model sonucu aynı kuralla okur.
//
// Neden Türkçe yazım (formatDecimal, "1.412,5") değil: değerlendirme kümesinde model "2.000 adet"i "2 adet" okudu ve
// kullanıcıya "sistem 100 koliyi 2 adet hesapladı, çevrim yanlış tanımlanmış" dedi (D45, iki ayrı koşuda). Ham
// veritabanı metni ("120.000") de verilmez: sondaki sıfırlar atılır, o da yüz yirmi bin okunmaz. Kullanıcıya Türkçe
// yazımla yazmasını prompt söyler (chat-v3).
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

export function modelNumber(value: string, { signed = false }: { signed?: boolean } = {}): string {
  const match = DECIMAL.exec(value);
  if (!match) {
    return value;
  }
  const whole = (match[2] ?? '0').replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const number = fraction ? `${whole}.${fraction}` : whole;
  const isZero = whole === '0' && !fraction;
  if (match[1] && !isZero) {
    return `−${number}`;
  }
  return signed && !isZero ? `+${number}` : number;
}
