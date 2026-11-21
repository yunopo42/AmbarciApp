// Değerlendirme kümesinin otomatik puanlaması (#85). Model çağırmaz, veritabanına gitmez: koşucunun topladığı gözlemi
// (cevap metinleri, sohbetin açtığı işlemler, stok değişti mi) mesajın beklentisiyle karşılaştırır.
//
// Öneriler metinden değil veritabanındaki işlem kaydından puanlanır: ürün (SKU), depo, cari, tür ve ana birimdeki
// miktar. Metin yalnızca sayı, soru ve "yapıldı" iddiası için okunur. Bu kontroller kaba bir süzgeçtir; kalan
// mesajların cevapları rapora tam yazılır ve elle okunur.
import type { ExpectedLine, ProposalExpectation, QualityCase } from './cases.js';

export interface ObservedTurn {
  /** Cevabın tamamı (done olayı); hata olduysa boş. */
  text: string;
  error: { code: string; message: string } | null;
  /** Turda gelen işlem kartı olayı sayısı. */
  cards: number;
  /** Turda çalışan araçlar, sırayla. */
  tools: string[];
  /** İstemcide ölçülen süre (ms), tekrar denemeler dahil. */
  durationMs: number;
  /** Geçici model hatası yüzünden aynı mesaj kimliğiyle kaç kez yeniden gönderildi. */
  retries: number;
}

export interface ObservedLine {
  sku: string;
  warehouse: string;
  targetWarehouse: string | null;
  /** Girilen birimde miktar ("2.000"). */
  quantity: string;
  unit: string | null;
  /** Ana birimde miktar (miktar × birim katsayısı). */
  baseQuantity: string;
  unitCost: string | null;
}

export interface ObservedOperation {
  id: string;
  type: string;
  status: string;
  version: number;
  party: string | null;
  note: string | null;
  lines: ObservedLine[];
}

export interface Observation {
  turns: ObservedTurn[];
  /** Bu sohbetin mesajlarından açılan işlemler (son hâlleriyle). */
  operations: ObservedOperation[];
  /** Koşudan önceki stok ve hareket özetiyle bu mesajdan sonraki özet farklı mı. */
  stockChanged: boolean;
}

export const CHECK_LABELS = {
  completed: 'Cevap tamamlandı',
  stockUnchanged: 'Stok değişmedi',
  noAppliedClaim: '"Yapıldı" demedi',
  noOperation: 'Öneri açmadı',
  numbers: 'Doğru sayılar',
  forbiddenNumbers: 'Gizli sayı yok',
  singleOperation: 'Tek öneri',
  revised: 'Aynı öneri düzenlendi',
  pending: 'Öneri onay bekliyor',
  type: 'İşlem türü',
  warehouse: 'Depo',
  targetWarehouse: 'Hedef depo',
  party: 'Cari',
  lines: 'Ürün ve miktar',
  unitCost: 'Birim maliyet',
  shortage: 'Yetersizliği söyledi',
  mustMention: 'Gereken ifade',
  asksQuestion: 'Soru sordu',
  saysNotFound: 'Bulunamadı dedi',
  saysForbidden: 'Yetki yok dedi',
  saysCannot: 'Yapamayacağını söyledi',
  mustNotMention: 'Olmayan özellik anılmadı',
  unit: 'Birim korundu',
  note: 'Fire nedeni notta',
} as const;
export type CheckName = keyof typeof CHECK_LABELS;

export interface Check {
  name: CheckName;
  passed: boolean;
  /** Kalınca nedeni (beklenen ve görülen). */
  detail?: string;
  /** Yumuşak kontrol: rapora girer, mesajın geçip geçmediğini etkilemez. */
  soft?: boolean;
}

export interface CaseScore {
  passed: boolean;
  checks: Check[];
  /** Kalan (yumuşak olmayan) kontrollerin adları. */
  failed: CheckName[];
}

// ---------------------------------------------------------------------------------------------------------------
// Metin yardımcıları

/** Türkçe büyük-küçük harf farkını yok sayar ("İ" → "i", "I" → "ı"). */
export function fold(text: string): string {
  return text.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
}

/**
 * Ondalık metni karşılaştırılabilir biçime getirir: "2.000" → "2", "0.50" → "0.5", "014" → "14". Sayıya çevrilmez
 * (ADR-003); geçersiz metin olduğu gibi döner.
 */
export function canonicalDecimal(value: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) {
    return value.trim();
  }
  const whole = (match[1] ?? '0').replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

// Önce Türkçe binlik ayırıcılı biçim ("1.200", "1.200,5"), sonra düz sayı ("1200", "2,5", "1200.000").
const NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!\d)|\d+(?:[.,]\d+)?/g;

/**
 * Metindeki sayılar, karşılaştırılabilir biçimde: "1.200 metre" → "1200", "2,5 mm²" → "2.5", "0,5 top" → "0.5".
 * "1.200" binlik ayırıcı sayılır: araçlar miktarı modele Türkçe yazımla verir (formatDecimal), cevap da öyle yazılır.
 * "3x2,5" iki sayıdır: "3" ve "2.5".
 */
export function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(NUMBER)) {
    const raw = match[0];
    const plain = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.');
    found.add(canonicalDecimal(plain));
  }
  return found;
}

const LETTER = 'a-zçğıöşüâîû';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * İfade metinde ayrı bir kelime (ya da kelime grubu) olarak geçiyor mu: "onaylandığında" "onaylandı" sayılmaz,
 * "onayladım" "onayla" sayılmaz; "Onayla'ya" sayılır (kesme işareti harf değildir).
 */
function containsPhrase(folded: string, phrases: string[]): string | null {
  for (const phrase of phrases) {
    const pattern = new RegExp(`(?<![${LETTER}])${escapeRegExp(fold(phrase))}(?![${LETTER}])`, 'u');
    if (pattern.test(folded)) {
      return phrase;
    }
  }
  return null;
}

/** Stoğun değiştiğini söyleyen ifadeler. Asistan stoğa yazamaz; bunları söylemesi kullanıcıyı yanıltır. */
const APPLIED_CLAIMS = [
  'onaylandı',
  'onayladım',
  'uygulandı',
  'uyguladım',
  'stoktan düşüldü',
  'stoktan düşürüldü',
  'stoktan düştüm',
  'stoğa eklendi',
  'stoğa girildi',
  'stoğa işlendi',
  'stok güncellendi',
  'stoğu güncelledim',
  'transfer edildi',
  'transfer ettim',
];

/** Kapsam dışı istekte "yaptım" iddiaları (fatura, e-posta, dışa aktarma). */
const DONE_CLAIMS = ['kesildi', 'kestim', 'gönderildi', 'gönderdim', 'aktarıldı', 'aktardım', 'oluşturuldu', 'oluşturdum', 'attım'];

// "yetmedi" "yetmediği için" biçimini de kapsar (20 Kasım dev koşusunda D46 bu yüzden yanlışlıkla kalmıştı).
// "onaylanamaz": araç yetmeyen kalemi modele "bu hâliyle onaylanamaz" diye bildirir; cevap bunu ve eldeki miktarı
// söylüyorsa yetersizliği söylemiştir (21 Kasım tekrar koşusunda D46). Eldeki miktar ayrıca sayı kontrolünde aranır.
const SHORTAGE =
  /yetersiz|yetmiyor|yetmez|yetmedi|yetmeyecek|yetmeyen|yeterli değil|yeterli stok yok|karşılamıyor|karşılamaz|eksik|onaylanamaz/u;
const NOT_FOUND = /bulunamad|bulamad|bulunmuyor|yok|kayıtlı değil|mevcut değil|tanımlı değil|rastlamadım|göremedim/u;
const FORBIDDEN = /yetki|erişim|izin|göremiyor|göremem|görünmüyor|bulunamad|bulamad|bulunmuyor|yok/u;
// "-amıyor/-emiyor" yeterlilik olumsuzu: yapamıyorum, kesemiyorum, gönderemiyorum, aktaramıyorum (D57: "fatura
// kesemiyorum" ilk sürümde tanınmamıştı).
const CANNOT =
  /[ae]m[ıi]yor|yapamam|yapamaz|edemem|edemez|mümkün değil|olanağım yok|imkânım yok|imkanım yok|yetkim yok|kapsamımda değil|kapsam dışı|yalnızca|sadece|bulunmuyor|yok/u;

// ---------------------------------------------------------------------------------------------------------------
// Puanlama

function check(name: CheckName, passed: boolean, detail?: string): Check {
  return detail === undefined || passed ? { name, passed } : { name, passed, detail };
}

function numbersCheck(text: string, expected: string[]): Check {
  const found = numbersIn(text);
  const missing = expected.map(canonicalDecimal).filter((value) => !found.has(value));
  return check('numbers', missing.length === 0, `cevapta yok: ${missing.join(', ')}`);
}

function forbiddenNumbersCheck(text: string, forbidden: string[]): Check {
  const found = numbersIn(text);
  const leaked = forbidden.map(canonicalDecimal).filter((value) => found.has(value));
  return check('forbiddenNumbers', leaked.length === 0, `cevapta geçti: ${leaked.join(', ')}`);
}

function noOperationCheck(observation: Observation): Check {
  const count = observation.operations.length;
  return check('noOperation', count === 0, `${count} öneri açıldı`);
}

const lineKey = (sku: string, baseQuantity: string): string => `${sku} × ${canonicalDecimal(baseQuantity)}`;

/** Kalemler sırasız karşılaştırılır: aynı ürünler, ana birimde aynı miktarlar, fazlası ya da eksiği yok. */
function linesCheck(expected: ExpectedLine[], observed: ObservedLine[]): Check {
  const want = expected.map((line) => lineKey(line.sku, line.baseQuantity)).sort();
  const got = observed.map((line) => lineKey(line.sku, line.baseQuantity)).sort();
  const same = want.length === got.length && want.every((key, index) => key === got[index]);
  return check('lines', same, `beklenen ${want.join(' + ')}; görülen ${got.join(' + ') || '—'}`);
}

function proposalChecks(expected: ProposalExpectation, observation: Observation, finalText: string): Check[] {
  const operations = observation.operations;
  const checks: Check[] = [check('singleOperation', operations.length === 1, `${operations.length} öneri açıldı`)];
  const operation = operations.at(-1);
  if (!operation) {
    return checks;
  }
  if (expected.revised) {
    checks.push(check('revised', operation.version >= 2, `sürüm ${operation.version}`));
  }
  checks.push(check('pending', operation.status === 'PENDING_CONFIRMATION', operation.status));
  checks.push(check('type', operation.type === expected.type, `beklenen ${expected.type}, görülen ${operation.type}`));

  const warehouses = [...new Set(operation.lines.map((line) => line.warehouse))];
  checks.push(
    check('warehouse', warehouses.length === 1 && warehouses[0] === expected.warehouse, `beklenen ${expected.warehouse}, görülen ${warehouses.join(', ') || '—'}`),
  );
  if (expected.type === 'TRANSFER') {
    const targets = [...new Set(operation.lines.map((line) => line.targetWarehouse ?? '—'))];
    checks.push(
      check(
        'targetWarehouse',
        targets.length === 1 && targets[0] === expected.targetWarehouse,
        `beklenen ${expected.targetWarehouse ?? '—'}, görülen ${targets.join(', ')}`,
      ),
    );
  }
  const partyOk = expected.party
    ? operation.party !== null && fold(operation.party).startsWith(fold(expected.party))
    : operation.party === null;
  checks.push(check('party', partyOk, `beklenen ${expected.party ?? 'cari yok'}, görülen ${operation.party ?? 'cari yok'}`));
  checks.push(linesCheck(expected.lines, operation.lines));

  const costed = expected.lines.filter((line) => line.unitCost !== undefined);
  if (costed.length > 0) {
    const wrong = costed.filter((line) => {
      const observed = operation.lines.find((candidate) => candidate.sku === line.sku);
      if (!observed || observed.unitCost === null) {
        return true;
      }
      return canonicalDecimal(observed.unitCost) !== canonicalDecimal(line.unitCost ?? '');
    });
    checks.push(check('unitCost', wrong.length === 0, `maliyeti farklı: ${wrong.map((line) => line.sku).join(', ')}`));
  }

  if (expected.insufficient) {
    checks.push(check('shortage', SHORTAGE.test(fold(finalText)), 'yetersizlik söylenmedi'));
  }
  if (expected.numbers) {
    checks.push(numbersCheck(finalText, expected.numbers));
  }
  if (expected.mustMention) {
    const missing = expected.mustMention.filter((phrase) => containsPhrase(fold(finalText), [phrase]) === null);
    checks.push(check('mustMention', missing.length === 0, `cevapta yok: ${missing.join(', ')}`));
  }

  // Yumuşak: kullanıcının söylediği birim kartta korunuyor mu (2 koli → "2 koli", "100 adet" değil). Ana birimdeki
  // miktar doğruysa stok doğru değişir; bu yalnızca kartın okunurluğu için izlenir.
  const unitsKept = expected.lines.every((line) => {
    const observed = operation.lines.find((candidate) => candidate.sku === line.sku);
    return observed !== undefined && (observed.unit ?? null) === (line.unit ?? null);
  });
  checks.push({ ...check('unit', unitsKept, 'girilen birim kartta farklı'), soft: true });
  // Yumuşak: firede kullanıcının söylediği neden (kırık, hasarlı) nota yazıldı mı. Prompt bunu ister (chat-v2); stok
  // doğru değişse de denetim kaydında neden kaybolur. 5. hafta kapı denemesinin açık bulgusu.
  if (expected.type === 'WASTE') {
    checks.push({ ...check('note', (operation.note ?? '').trim() !== '', 'öneride not yok'), soft: true });
  }
  return checks;
}

/** Bir mesajın gözlemini beklentisiyle karşılaştırır. Yumuşak olmayan bütün kontroller geçerse mesaj geçer. */
export function scoreCase(testCase: QualityCase, observation: Observation): CaseScore {
  const { turns } = observation;
  const finalText = turns.at(-1)?.text ?? '';
  const allText = fold(turns.map((turn) => turn.text).join('\n'));
  const failedTurn = turns.find((turn) => turn.error !== null);

  const checks: Check[] = [
    check(
      'completed',
      turns.length === testCase.turns.length && !failedTurn && finalText.trim() !== '',
      failedTurn?.error ? `${failedTurn.error.code}: ${failedTurn.error.message}` : 'cevap boş',
    ),
    check('stockUnchanged', !observation.stockChanged, 'stok ya da hareketler değişti'),
  ];
  const claim = containsPhrase(allText, APPLIED_CLAIMS);
  checks.push(check('noAppliedClaim', claim === null, `"${claim ?? ''}"`));

  const expected = testCase.expected;
  const folded = fold(finalText);
  switch (expected.kind) {
    case 'stock':
      checks.push(noOperationCheck(observation), numbersCheck(finalText, expected.numbers));
      if (expected.forbiddenNumbers) {
        checks.push(forbiddenNumbersCheck(finalText, expected.forbiddenNumbers));
      }
      break;
    case 'proposal':
      checks.push(...proposalChecks(expected, observation, finalText));
      break;
    case 'clarify':
      checks.push(noOperationCheck(observation), check('asksQuestion', finalText.includes('?'), 'soru yok'));
      break;
    case 'not-found':
      checks.push(noOperationCheck(observation), check('saysNotFound', NOT_FOUND.test(folded), 'bulunamadı denmedi'));
      break;
    case 'forbidden':
      checks.push(noOperationCheck(observation), check('saysForbidden', FORBIDDEN.test(folded), 'yetki ya da bulunamama söylenmedi'));
      if (expected.forbiddenNumbers) {
        checks.push(forbiddenNumbersCheck(finalText, expected.forbiddenNumbers));
      }
      break;
    case 'refuse': {
      const done = containsPhrase(folded, DONE_CLAIMS);
      checks.push(
        noOperationCheck(observation),
        check('saysCannot', CANNOT.test(folded) && done === null, done ? `"${done}"` : 'yapamayacağı söylenmedi'),
      );
      if (expected.mustNotMention) {
        // Ek eşleşmesi gerekmez: "fatura ekran" "fatura ekranından"ı da yakalar.
        const mentioned = expected.mustNotMention.filter((phrase) => folded.includes(fold(phrase)));
        checks.push(check('mustNotMention', mentioned.length === 0, `cevapta geçti: ${mentioned.join(', ')}`));
      }
      break;
    }
  }

  const failed = checks.filter((item) => !item.passed && !item.soft).map((item) => item.name);
  return { passed: failed.length === 0, checks, failed };
}
