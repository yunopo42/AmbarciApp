// Deneme için kurgusal ABC Elektrik kataloğu ve sahte araç sonuçları.
// Gerçek uygulamada bu veriler veritabanından gelir; burada yalnızca bellekte durur
// ve hiçbir araç bir şey yazmaz.

export type WarehouseType = 'DEPO' | 'SUBE' | 'ARAC';

export interface Warehouse {
  id: string;
  name: string;
  type: WarehouseType;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  unit: 'adet' | 'metre';
  aliases: string[];
}

export const WAREHOUSES: Warehouse[] = [
  { id: 'wh-merkez', name: 'Merkez Depo', type: 'DEPO' },
  { id: 'wh-sube', name: 'Şube Depo (Kadıköy)', type: 'SUBE' },
  { id: 'wh-arac1', name: 'Araç 1 (34 ABC 101)', type: 'ARAC' },
];

export const PRODUCTS: Product[] = [
  { id: 'p-01', sku: 'ABC-1001', name: 'NYM Kablo 3x2,5 mm²', unit: 'metre', aliases: ['nym 3x2,5', 'antigron kablo 3x2,5'] },
  { id: 'p-02', sku: 'ABC-1002', name: 'NYM Kablo 3x1,5 mm²', unit: 'metre', aliases: ['nym 3x1,5', 'antigron kablo 3x1,5'] },
  { id: 'p-03', sku: 'ABC-1003', name: 'TTR Kablo 2x1,5 mm²', unit: 'metre', aliases: ['ttr 2x1,5', 'kordon 2x1,5'] },
  { id: 'p-04', sku: 'ABC-1004', name: 'TTR Kablo 3x2,5 mm²', unit: 'metre', aliases: ['ttr 3x2,5'] },
  { id: 'p-05', sku: 'ABC-2001', name: 'Otomatik Sigorta C16 16A', unit: 'adet', aliases: ['16 amper sigorta', '16a otomatik sigorta'] },
  { id: 'p-06', sku: 'ABC-2002', name: 'Otomatik Sigorta C25 25A', unit: 'adet', aliases: ['25 amper sigorta', '25a otomatik sigorta'] },
  { id: 'p-07', sku: 'ABC-2003', name: 'Kaçak Akım Rölesi 40A 30mA', unit: 'adet', aliases: ['kaçak akım', 'kar 40a'] },
  { id: 'p-08', sku: 'ABC-3001', name: 'Topraklı Priz Beyaz', unit: 'adet', aliases: ['beyaz priz', 'topraklı priz beyaz'] },
  { id: 'p-09', sku: 'ABC-3002', name: 'Topraklı Priz Krem', unit: 'adet', aliases: ['krem priz', 'topraklı priz krem'] },
  { id: 'p-10', sku: 'ABC-4001', name: 'LED Ampul 9W E27', unit: 'adet', aliases: ['9 watt led ampul', '9w ampul'] },
  { id: 'p-11', sku: 'ABC-4002', name: 'LED Ampul 12W E27', unit: 'adet', aliases: ['12 watt led ampul', '12w ampul'] },
  { id: 'p-12', sku: 'ABC-3003', name: 'Anahtar Tekli Beyaz', unit: 'adet', aliases: ['tekli anahtar', 'lamba anahtarı'] },
  { id: 'p-13', sku: 'ABC-5001', name: 'Kablo Kanalı 40x16 (2 m)', unit: 'adet', aliases: ['kanal 40x16', 'kablo kanalı'] },
  { id: 'p-14', sku: 'ABC-5002', name: 'Buat 100x100', unit: 'adet', aliases: ["100'lük buat", 'buat 100'] },
  { id: 'p-15', sku: 'ABC-5003', name: 'Spiral Boru 16 mm', unit: 'metre', aliases: ["16'lık spiral", 'spiral 16'] },
  { id: 'p-16', sku: 'ABC-2004', name: "Sigorta Kutusu 12'li", unit: 'adet', aliases: ["12'li sigorta kutusu", 'sigorta panosu 12'] },
  { id: 'p-17', sku: 'ABC-5004', name: 'Klemens 2,5 mm²', unit: 'adet', aliases: ['klemens 2,5'] },
  { id: 'p-18', sku: 'ABC-5005', name: 'Elektrik Bandı 19 mm', unit: 'adet', aliases: ['izole bant', 'elektrik bandı'] },
];

// Ürün → depo → miktar (ana birimde). Çıkış ve transfer mesajlarındaki miktarlar bu stokları aşmaz.
const STOCK: Record<string, Record<string, number>> = {
  'p-01': { 'wh-merkez': 850, 'wh-sube': 200, 'wh-arac1': 60 },
  'p-02': { 'wh-merkez': 600, 'wh-sube': 150, 'wh-arac1': 40 },
  'p-03': { 'wh-merkez': 900, 'wh-sube': 300, 'wh-arac1': 50 },
  'p-04': { 'wh-merkez': 500, 'wh-sube': 120, 'wh-arac1': 25 },
  'p-05': { 'wh-merkez': 80, 'wh-sube': 35, 'wh-arac1': 24 },
  'p-06': { 'wh-merkez': 60, 'wh-sube': 30, 'wh-arac1': 12 },
  'p-07': { 'wh-merkez': 6, 'wh-sube': 2, 'wh-arac1': 1 },
  'p-08': { 'wh-merkez': 120, 'wh-sube': 45, 'wh-arac1': 10 },
  'p-09': { 'wh-merkez': 70, 'wh-sube': 40, 'wh-arac1': 0 },
  'p-10': { 'wh-merkez': 200, 'wh-sube': 60, 'wh-arac1': 18 },
  'p-11': { 'wh-merkez': 150, 'wh-sube': 30, 'wh-arac1': 14 },
  'p-12': { 'wh-merkez': 90, 'wh-sube': 25, 'wh-arac1': 8 },
  'p-13': { 'wh-merkez': 140, 'wh-sube': 20, 'wh-arac1': 12 },
  'p-14': { 'wh-merkez': 75, 'wh-sube': 20, 'wh-arac1': 6 },
  'p-15': { 'wh-merkez': 400, 'wh-sube': 100, 'wh-arac1': 30 },
  'p-16': { 'wh-merkez': 15, 'wh-sube': 4, 'wh-arac1': 0 },
  'p-17': { 'wh-merkez': 300, 'wh-sube': 80, 'wh-arac1': 40 },
  'p-18': { 'wh-merkez': 60, 'wh-sube': 20, 'wh-arac1': 8 },
};

const TURKISH_FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };

// Türkçe küçük harfe çevirip aksanları kaldırır: "Kaçak Akım" → "kacak akim".
export function foldTurkish(text: string): string {
  return text.toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g, (ch) => TURKISH_FOLD[ch] ?? ch);
}

// pg_trgm'deki gibi: her kelimenin başına iki, sonuna bir boşluk eklenip üçlülere bölünür.
function trigrams(text: string): Set<string> {
  const result = new Set<string>();
  const words = foldTurkish(text).replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  for (const word of words) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) result.add(padded.slice(i, i + 3));
  }
  return result;
}

function similarity(a: Set<string>, b: Set<string>): number {
  let common = 0;
  for (const gram of a) if (b.has(gram)) common++;
  const union = a.size + b.size - common;
  return union === 0 ? 0 : common / union;
}

export interface SearchCandidate {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  score: number;
}

// Ürün adı, stok kodu ve alternatif adlar içinde en yüksek benzerliği alır; en iyi 5 aday döner.
export function searchProducts(query: string): SearchCandidate[] {
  const queryGrams = trigrams(query);
  return PRODUCTS.map((product) => {
    const targets = [product.name, product.sku, ...product.aliases];
    const best = Math.max(...targets.map((target) => similarity(queryGrams, trigrams(target))));
    return { product_id: product.id, sku: product.sku, name: product.name, unit: product.unit, score: Math.round(best * 100) / 100 };
  })
    .filter((candidate) => candidate.score >= 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export interface ToolOutcome {
  content: unknown;
  isError: boolean;
}

interface ProposalItem {
  product_id: string;
  quantity: number;
}

function fail(message: string): ToolOutcome {
  return { content: { error: message }, isError: true };
}

function findWarehouse(id: unknown): Warehouse | undefined {
  return WAREHOUSES.find((warehouse) => warehouse.id === id);
}

function findProduct(id: unknown): Product | undefined {
  return PRODUCTS.find((product) => product.id === id);
}

function readItems(value: unknown): ProposalItem[] | string {
  if (!Array.isArray(value) || value.length === 0) return 'En az bir kalem gerekli.';
  const items: ProposalItem[] = [];
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return 'Kalem biçimi geçersiz.';
    const { product_id, quantity } = raw as Record<string, unknown>;
    if (!findProduct(product_id)) return `Ürün bulunamadı: ${String(product_id)}`;
    if (typeof quantity !== 'number' || !(quantity > 0)) return `Miktar sıfırdan büyük olmalı: ${String(quantity)}`;
    items.push({ product_id: product_id as string, quantity });
  }
  return items;
}

function describeItems(items: ProposalItem[]): string[] {
  return items.map((item) => {
    const product = findProduct(item.product_id);
    return `${item.quantity} ${product?.unit ?? ''} ${product?.name ?? item.product_id}`.trim();
  });
}

// Çıkış ve transferde kaynak depoda yeterli stok yoksa öneri yine açılır ama uyarı eklenir;
// asıl kontrolü onay transaction'ı yapar.
function stockWarnings(warehouseId: string, items: ProposalItem[]): string[] {
  return items
    .filter((item) => (STOCK[item.product_id]?.[warehouseId] ?? 0) < item.quantity)
    .map((item) => `${findProduct(item.product_id)?.name ?? item.product_id}: depoda ${STOCK[item.product_id]?.[warehouseId] ?? 0} var, ${item.quantity} isteniyor.`);
}

export interface ToolContext {
  nextOperationId: () => string;
}

export function runTool(name: string, input: Record<string, unknown>, context: ToolContext): ToolOutcome {
  switch (name) {
    case 'search_products': {
      if (typeof input.query !== 'string' || !input.query.trim()) return fail('Sorgu boş olamaz.');
      return { content: { query: input.query, results: searchProducts(input.query) }, isError: false };
    }
    case 'get_stock': {
      const product = findProduct(input.product_id);
      if (!product) return fail(`Ürün bulunamadı: ${String(input.product_id)}`);
      const warehouses = input.warehouse_id === undefined ? WAREHOUSES : WAREHOUSES.filter((w) => w.id === input.warehouse_id);
      if (warehouses.length === 0) return fail(`Depo bulunamadı: ${String(input.warehouse_id)}`);
      return {
        content: {
          product_id: product.id,
          name: product.name,
          unit: product.unit,
          stock: warehouses.map((w) => ({ warehouse_id: w.id, warehouse_name: w.name, quantity: STOCK[product.id]?.[w.id] ?? 0 })),
        },
        isError: false,
      };
    }
    case 'list_warehouses':
      return { content: { warehouses: WAREHOUSES.map((w) => ({ warehouse_id: w.id, name: w.name, type: w.type })) }, isError: false };
    case 'propose_stock_in':
    case 'propose_stock_out': {
      const warehouse = findWarehouse(input.warehouse_id);
      if (!warehouse) return fail(`Depo bulunamadı: ${String(input.warehouse_id)}`);
      const items = readItems(input.items);
      if (typeof items === 'string') return fail(items);
      const warnings = name === 'propose_stock_out' ? stockWarnings(warehouse.id, items) : [];
      return proposal(context, name === 'propose_stock_in' ? 'IN' : 'OUT', [`Depo: ${warehouse.name}`, ...describeItems(items)], warnings);
    }
    case 'propose_transfer': {
      const from = findWarehouse(input.from_warehouse_id);
      const to = findWarehouse(input.to_warehouse_id);
      if (!from || !to) return fail('Kaynak veya hedef depo bulunamadı.');
      if (from.id === to.id) return fail('Kaynak ve hedef depo aynı olamaz.');
      const items = readItems(input.items);
      if (typeof items === 'string') return fail(items);
      return proposal(context, 'TRANSFER', [`${from.name} → ${to.name}`, ...describeItems(items)], stockWarnings(from.id, items));
    }
    default:
      return fail(`Tanımsız araç: ${name}`);
  }
}

function proposal(context: ToolContext, type: string, summary: string[], warnings: string[]): ToolOutcome {
  return {
    content: {
      operation_id: context.nextOperationId(),
      type,
      status: 'PENDING_CONFIRMATION',
      summary,
      warnings,
      message: 'Öneri kullanıcıya onay kartı olarak gösterildi. Stok, kullanıcı kartta onaylayana kadar değişmez.',
    },
    isError: false,
  };
}
