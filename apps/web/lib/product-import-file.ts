import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';

import { inputToDecimal } from '@/lib/format';

// İçe aktarma dosyasının tarayıcıda okunması (ADR-004): .xlsx (read-excel-file) ve .csv (papaparse). API dosya biçimi
// bilmez; buradan çıkan satırlar paylaşılan şemayla doğrulanıp JSON olarak gider. Bu modül değişirse API değişmez.

/** Tarayıcıda okunacak en büyük dosya. Yalnızca kullanıcı deneyimi içindir; asıl sınır API'deki satır sınırı. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Şablonun sütunları; dosyada sıra önemli değil, başlıklar büyük/küçük harf farkı gözetmeden eşleşir. */
export const IMPORT_COLUMNS = [
  { key: 'sku', title: 'SKU', required: true },
  { key: 'name', title: 'Ürün adı', required: true },
  { key: 'baseUnit', title: 'Ana birim', required: true },
  { key: 'barcode', title: 'Barkod', required: false },
  { key: 'minStock', title: 'Kritik stok', required: false },
  { key: 'unit', title: 'Ek birim', required: false },
  { key: 'factor', title: 'Ek birim katsayısı', required: false },
  { key: 'unitBarcode', title: 'Ek birim barkodu', required: false },
  { key: 'aliases', title: 'Alternatif adlar', required: false },
  { key: 'openingQuantity', title: 'Başlangıç stoku', required: false },
  { key: 'openingUnitCost', title: 'Birim maliyet', required: false },
] as const;

type ColumnKey = (typeof IMPORT_COLUMNS)[number]['key'];

/** Kullanıcıya gösterilecek dosya hatası (biçim, boyut, eksik sütun). */
export class ImportFileError extends Error {}

/** Dosyadan okunan, henüz doğrulanmamış satır; şekli API'nin beklediği satırla aynı. */
export interface ImportCandidate {
  row: number;
  product: {
    sku: string;
    name: string;
    baseUnit: string;
    barcode: string | null;
    minStock: string | null;
    units: { unit: string; factor: string; barcode: string | null }[];
    aliases: string[];
  };
  openingQuantity?: string;
  openingUnitCost?: string;
}

/** Dosyayı okuyup satırlara çevirir. Satır numaraları dosyadakiyle aynıdır (başlık 1. satır). */
export async function readImportFile(file: File): Promise<ImportCandidate[]> {
  return tableToCandidates(await readTable(file));
}

async function readTable(file: File): Promise<string[][]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportFileError("Dosya 5 MB'tan büyük. Ürünleri birkaç dosyaya bölün.");
  }
  const name = file.name.toLocaleLowerCase('tr-TR');
  if (name.endsWith('.xlsx')) {
    // Sayılar hücredeki metin olarak kalır (parseNumber): "12.5" JS sayısına çevrilmez (ADR-003).
    const data = await readSheet(file, { parseNumber: (value: string) => value, trim: true });
    return data.map((row) => row.map(cellText));
  }
  if (name.endsWith('.csv')) {
    const text = decodeCsv(await file.arrayBuffer());
    // Boş satırlar atlanmaz ki satır numaraları dosyadakiyle aynı kalsın; boş satır aşağıda yok sayılır.
    const parsed = Papa.parse<string[]>(text, { delimiter: delimiterOf(text), skipEmptyLines: false });
    return parsed.data.map((row) => row.map((cell) => cell.trim()));
  }
  if (name.endsWith('.xls')) {
    throw new ImportFileError("Eski .xls biçimi okunamıyor. Dosyayı Excel'de \"Farklı kaydet → Excel Çalışma Kitabı (.xlsx)\" ile kaydedin.");
  }
  throw new ImportFileError('Yalnızca .xlsx ve .csv dosyaları okunur.');
}

/**
 * CSV'nin kodlaması: önce katı UTF-8; geçersiz bayt varsa Türkçe Excel'in "CSV olarak kaydet" çıktısı sayılır
 * (Windows-1254). UTF-8 sanılarak okunursa ç, ğ, ı, İ, ş bozulurdu. Baştaki BOM çözücü tarafından atılır.
 */
function decodeCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1254').decode(buffer);
  }
}

/**
 * CSV ayracı başlık satırından bulunur: başlıklarda virgül ya da noktalı virgül geçmez. papaparse'ın tahminine
 * bırakılmaz; ürün adlarındaki ("3x2,5") ve ondalıklardaki virgüller, Türkçe Excel'in `;` ayraçlı dosyasında
 * virgülü seçtirebiliyor.
 */
function delimiterOf(text: string): string {
  const header = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const [best] = [';', ',', '\t']
    .map((delimiter) => ({ delimiter, count: header.split(delimiter).length - 1 }))
    .sort((a, b) => b.count - a.count);
  return best && best.count > 0 ? best.delimiter : ',';
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
}

const COLUMN_OF_TITLE = new Map<string, ColumnKey>(IMPORT_COLUMNS.map((column) => [normalizeTitle(column.title), column.key]));

function tableToCandidates(table: string[][]): ImportCandidate[] {
  const headerIndex = table.findIndex((cells) => cells.some((cell) => cell !== ''));
  const header = table[headerIndex];
  if (headerIndex < 0 || !header) {
    throw new ImportFileError('Dosya boş.');
  }
  const indexOf = new Map<ColumnKey, number>();
  header.forEach((cell, index) => {
    const key = COLUMN_OF_TITLE.get(normalizeTitle(cell));
    if (key && !indexOf.has(key)) {
      indexOf.set(key, index);
    }
  });
  const missing = IMPORT_COLUMNS.filter((column) => column.required && !indexOf.has(column.key)).map((column) => column.title);
  if (missing.length > 0) {
    throw new ImportFileError(`Şu sütunlar bulunamadı: ${missing.join(', ')}. Şablondaki başlıkları kullanın.`);
  }

  const candidates: ImportCandidate[] = [];
  table.forEach((cells, index) => {
    if (index <= headerIndex || !cells.some((cell) => cell !== '')) {
      return;
    }
    const value = (key: ColumnKey): string => {
      const column = indexOf.get(key);
      return column === undefined ? '' : (cells[column] ?? '').trim();
    };
    const unit = value('unit');
    const factor = value('factor');
    const unitBarcode = value('unitBarcode');
    const openingQuantity = value('openingQuantity');
    const openingUnitCost = value('openingUnitCost');
    candidates.push({
      row: index + 1,
      product: {
        sku: value('sku'),
        name: value('name'),
        baseUnit: value('baseUnit'),
        barcode: value('barcode') || null,
        minStock: value('minStock') ? inputToDecimal(value('minStock')) : null,
        // Ek birimin bir alanı bile doluysa birim yazılır; eksik alanı şema bildirir.
        units: unit || factor || unitBarcode ? [{ unit, factor: inputToDecimal(factor), barcode: unitBarcode || null }] : [],
        // Ürün adlarında virgül geçtiği için ("3x2,5") alternatif adlar dikey çizgiyle ayrılır.
        aliases: value('aliases')
          .split('|')
          .map((alias) => alias.trim())
          .filter(Boolean),
      },
      ...(openingQuantity ? { openingQuantity: inputToDecimal(openingQuantity) } : {}),
      ...(openingUnitCost ? { openingUnitCost: inputToDecimal(openingUnitCost) } : {}),
    });
  });
  return candidates;
}

/**
 * İndirilecek şablon: `;` ayraçlı, UTF-8 BOM'lu CSV. Türkçe Excel bu dosyayı sütunlara ayrılmış ve Türkçe harfleri
 * doğru açar; .xlsx yazan ayrı bir kütüphane gerekmez.
 */
export function templateCsv(): string {
  const rows = [
    IMPORT_COLUMNS.map((column) => column.title),
    ['PRZ-TOP-B', 'Topraklı priz, beyaz', 'adet', '2000000000053', '50', 'koli', '12', '', 'priz|topraklı priz', '120', '10'],
    ['KBL-NYM-325', 'NYM kablo 3x2,5', 'metre', '', '100', 'makara', '100', '', 'nym kablo|yangın kablosu', '', ''],
  ];
  return `﻿${rows.map((row) => row.join(';')).join('\r\n')}\r\n`;
}

const FIELD_COLUMNS: [RegExp, ColumnKey][] = [
  [/^product\.units\.\d+\.factor$/, 'factor'],
  [/^product\.units\.\d+\.barcode$/, 'unitBarcode'],
  [/^product\.units/, 'unit'],
  [/^product\.aliases/, 'aliases'],
];

/** Hata mesajındaki alan yolunun ("product.units.0.factor") sütun adı ("Ek birim katsayısı"). */
export function columnTitleOf(field: string): string {
  const key =
    FIELD_COLUMNS.find(([pattern]) => pattern.test(field))?.[1] ??
    IMPORT_COLUMNS.find((column) => field === `product.${column.key}` || field === column.key)?.key;
  return IMPORT_COLUMNS.find((column) => column.key === key)?.title ?? field;
}
