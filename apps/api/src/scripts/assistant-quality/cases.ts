// Asistanın değerlendirme kümesi (#85): eval/assistant/cases.json dosyasının şeması, okunması ve özeti (hash).
// Dosyayı insan yazar ve gözden geçirir; buradaki şema yanlış yazılmış bir beklentiyi koşudan önce yakalar.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/** Depo kökü. Dosya hem src/ hem dist/ altında aynı derinlikte durur (apps/api/{src,dist}/scripts/assistant-quality). */
export const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

export const casesFile = path.join(repoRoot, 'eval', 'assistant', 'cases.json');

export const CASE_SETS = ['dev', 'test'] as const;
export type CaseSet = (typeof CASE_SETS)[number];

/** Kategoriler ve rapordaki Türkçe adları; sıra raporun sırasıdır. */
export const CATEGORY_LABELS = {
  'stock-query': 'Stok sorgusu',
  typo: 'Yazım hatası',
  alias: 'Alternatif ad',
  unit: 'Birim çevirme',
  'in-out': 'Giriş-çıkış',
  transfer: 'Transfer',
  count: 'Sayım',
  waste: 'Fire',
  revision: 'Düzenleme',
  insufficient: 'Yetersiz stok',
  ambiguous: 'Belirsiz istek',
  'not-found': 'Bulunamayan ürün',
  'forbidden-warehouse': 'Yetkisiz depo',
  'out-of-scope': 'Kapsam dışı',
  'tool-injection': 'Araç sonucundaki talimat',
} as const;
export type CaseCategory = keyof typeof CATEGORY_LABELS;
const categories = Object.keys(CATEGORY_LABELS) as [CaseCategory, ...CaseCategory[]];

/** Pozitif ondalık, nokta ayırıcıyla ("2", "0.5", "14.20"). Miktar ve tutar metin olarak tutulur (ADR-003). */
const decimal = z.string().regex(/^\d+(\.\d+)?$/, 'Ondalık metin bekleniyor (ör. "2" ya da "0.5").');

/** Asistanın önerebildiği işlem türleri (açılış ve ters kayıt sohbetten önerilmez). */
export const PROPOSAL_TYPES = ['STOCK_IN', 'STOCK_OUT', 'TRANSFER', 'COUNT', 'WASTE'] as const;

const expectedLineSchema = z.strictObject({
  sku: z.string().min(1),
  /** Kullanıcının söylediği birimde miktar. */
  quantity: decimal,
  /** Kullanıcının söylediği ek birim (koli, makara); ana birimse yazılmaz. */
  unit: z.string().min(1).optional(),
  /** Ana birimde miktar: puanlama bunu karşılaştırır (2 koli = 100 adet). */
  baseQuantity: decimal,
  /** Yalnızca girişte, söylenen birim başına maliyet. */
  unitCost: decimal.optional(),
});
export type ExpectedLine = z.infer<typeof expectedLineSchema>;

const stockExpectation = z.strictObject({
  kind: z.literal('stock'),
  /** Cevapta geçmesi gereken sayılar (ana birimde). */
  numbers: z.array(decimal).min(1),
  /** Cevapta geçmemesi gereken sayılar (ör. yetkisiz deponun da katıldığı toplam). */
  forbiddenNumbers: z.array(decimal).optional(),
});

const proposalExpectation = z.strictObject({
  kind: z.literal('proposal'),
  type: z.enum(PROPOSAL_TYPES),
  /** Kalemlerin deposu; transferde malın çıktığı depo. */
  warehouse: z.string().min(1),
  targetWarehouse: z.string().min(1).optional(),
  /** Cari adının başı (adı uzun carilerde ilk kısım yeter). Yazılmazsa öneride cari olmamalı. */
  party: z.string().min(1).optional(),
  lines: z.array(expectedLineSchema).min(1),
  /** İkinci mesajda öneri düzenlenmeli: yeni öneri açılmaz, aynı önerinin sürümü artar. */
  revised: z.boolean().optional(),
  /** Stok yetmiyor: öneri yine açılır (kart onaya izin vermez), cevap eldeki miktarı söyler. */
  insufficient: z.boolean().optional(),
  numbers: z.array(decimal).optional(),
  /** Cevapta geçmesi gereken ifadeler (ör. "Onayla"). */
  mustMention: z.array(z.string().min(1)).optional(),
});
export type ProposalExpectation = z.infer<typeof proposalExpectation>;

const expectedSchema = z.discriminatedUnion('kind', [
  stockExpectation,
  proposalExpectation,
  /** Eksik ya da çok anlamlı istek: öneri açmadan soru sorar. */
  z.strictObject({ kind: z.literal('clarify') }),
  /** Katalogda olmayan ürün: bulunamadığını söyler, uydurmaz. */
  z.strictObject({ kind: z.literal('not-found') }),
  /** Çalışanın yetkisi olmayan depo: stok göstermez, öneri açmaz. */
  z.strictObject({
    kind: z.literal('forbidden'),
    /** O deponun stoğu: cevapta geçmemeli. */
    forbiddenNumbers: z.array(decimal).optional(),
  }),
  /** Uygulamanın yapmadığı iş: yapamayacağını söyler, yapmış gibi davranmaz. */
  z.strictObject({
    kind: z.literal('refuse'),
    /** Uygulamada olmayan özellikler (ör. "fatura ekranı"): kullanıcı oraya yönlendirilmemeli. Ek dahil eşleşir. */
    mustNotMention: z.array(z.string().min(1)).optional(),
  }),
]);
export type Expectation = z.infer<typeof expectedSchema>;
export type ExpectationKind = Expectation['kind'];

export const caseSchema = z.strictObject({
  id: z.string().regex(/^[DT]\d{2}$/, 'Kimlik D01–D99 (dev) ya da T01–T99 (test) biçiminde olmalı.'),
  set: z.enum(CASE_SETS),
  category: z.enum(categories),
  /** "voice": cihazdaki ses tanımanın ürettiği biçimde (küçük harf, noktalamasız) yazılmış metin. */
  channel: z.enum(['text', 'voice']),
  /** "employee" yalnızca Merkez Depo ve Ostim Depo'ya yetkili; "admin" bütün depolarda. */
  account: z.enum(['admin', 'employee']),
  /** Aynı sohbette sırayla gönderilen mesajlar. */
  turns: z.array(z.string().trim().min(1).max(2000)).min(1).max(3),
  expected: expectedSchema,
  note: z.string().optional(),
});
export type QualityCase = z.infer<typeof caseSchema>;

const casesFileSchema = z.strictObject({
  version: z.literal(1),
  description: z.string(),
  cases: z.array(caseSchema).min(1),
});

/** Dosyayı okur ve şemayla doğrular; kimlik tekrarı ve kimlik-küme uyuşmazlığı da hata verir. */
export function loadCases(file: string = casesFile): QualityCase[] {
  const parsed = casesFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const seen = new Set<string>();
  for (const testCase of parsed.cases) {
    if (seen.has(testCase.id)) {
      throw new Error(`Değerlendirme kümesinde aynı kimlik iki kez var: ${testCase.id}`);
    }
    seen.add(testCase.id);
    if ((testCase.id.startsWith('D') ? 'dev' : 'test') !== testCase.set) {
      throw new Error(`${testCase.id}: kimliğin harfi kümeyle uyuşmuyor (D → dev, T → test).`);
    }
  }
  return parsed.cases;
}

export type SetSelection = CaseSet | 'all';

/** Koşulacak mesajlar: küme ve isteğe bağlı kimlik listesi. Bilinmeyen kimlik hata verir (yazım hatası sessizce atlanmasın). */
export function selectCases(cases: QualityCase[], set: SetSelection, only: string[] = []): QualityCase[] {
  const unknown = only.filter((id) => !cases.some((testCase) => testCase.id === id));
  if (unknown.length > 0) {
    throw new Error(`Değerlendirme kümesinde olmayan kimlik: ${unknown.join(', ')}`);
  }
  return cases.filter((testCase) => (set === 'all' || testCase.set === set) && (only.length === 0 || only.includes(testCase.id)));
}

/**
 * Seçilen mesajların özeti (SHA-256, ilk 16 hane). Test kümesi donduğunda bu değer belgeye yazılır; sonraki koşunun
 * raporundaki özet farklıysa küme değişmiş demektir ve sonuçlar karşılaştırılamaz.
 */
export function casesHash(cases: QualityCase[]): string {
  return createHash('sha256').update(JSON.stringify(cases)).digest('hex').slice(0, 16);
}

/**
 * Dondurulmuş test kümesi (#86). Prompt ve model yalnızca geliştirme kümesinde seçilir; test kümesi bu tarihten sonra
 * değişmez ve seçilen yapılandırmayla bir kez ölçülür. Birim testi özeti denetler: test mesajlarından biri değişirse
 * CI kırılır.
 */
export const FROZEN_TEST_SET = { hash: 'c0269f6e9e160719', frozenAt: '2026-11-21', cases: 40 } as const;

/** Beklentinin tek satırlık özeti: gözden geçirme tablosu ve rapor için. */
export function describeExpectation(expected: Expectation): string {
  switch (expected.kind) {
    case 'stock':
      return `stok: ${expected.numbers.join(', ')}${expected.forbiddenNumbers ? ` (geçmemeli: ${expected.forbiddenNumbers.join(', ')})` : ''}`;
    case 'proposal': {
      const route = expected.targetWarehouse ? `${expected.warehouse} → ${expected.targetWarehouse}` : expected.warehouse;
      const lines = expected.lines
        .map((line) => {
          const said = line.unit ? `${line.quantity} ${line.unit} (${line.baseQuantity})` : line.baseQuantity;
          return `${line.sku} ${said}${line.unitCost ? ` @${line.unitCost}` : ''}`;
        })
        .join(' + ');
      const flags = [
        expected.party ? `cari: ${expected.party}` : null,
        expected.revised ? 'düzenleme' : null,
        expected.insufficient ? `yetersiz (${expected.numbers?.join(', ') ?? ''})` : null,
        expected.mustMention ? `geçmeli: ${expected.mustMention.join(', ')}` : null,
      ].filter((flag): flag is string => flag !== null);
      return `${expected.type} ${route}: ${lines}${flags.length > 0 ? ` [${flags.join('; ')}]` : ''}`;
    }
    case 'clarify':
      return 'soru sorar, öneri açmaz';
    case 'not-found':
      return 'bulunamadı der';
    case 'forbidden':
      return `yetki yok der, öneri açmaz${expected.forbiddenNumbers ? ` (geçmemeli: ${expected.forbiddenNumbers.join(', ')})` : ''}`;
    case 'refuse':
      return `yapamayacağını söyler${expected.mustNotMention ? ` (geçmemeli: ${expected.mustNotMention.join(', ')})` : ''}`;
  }
}
