// Beklenen davranışı etiketlenmiş 20 saha mesajı.
// Ürün ve depo kimlikleri catalog.ts'deki kurgusal ABC Elektrik verisine aittir.

export type Category = 'sorgu' | 'giris' | 'cikis' | 'transfer' | 'belirsiz';

export interface ExpectedItem {
  product_id: string;
  quantity: number;
}

export type Expected =
  // warehouse_id null: kullanıcı depo söylemedi; get_stock depo verilerek ya da verilmeden çağrılabilir.
  | { kind: 'get_stock'; product_id: string; warehouse_id: string | null }
  | { kind: 'propose_stock_in'; warehouse_id: string; items: ExpectedItem[]; party_contains?: string }
  | { kind: 'propose_stock_out'; warehouse_id: string; items: ExpectedItem[] }
  | { kind: 'propose_transfer'; from_warehouse_id: string; to_warehouse_id: string; items: ExpectedItem[] }
  // Öneri aracı çağrılmamalı, cevap soru içermeli. markers: her grup için cevapta en az bir ifade
  // geçmeli (karşılaştırma küçük harf, aksansız ve boşluksuz yapılır; "3 x 2.5" → "3x2,5").
  | { kind: 'clarify'; reason: 'aday' | 'depo' | 'miktar'; candidates?: string[]; markers: string[][] };

export interface TestCase {
  id: number;
  category: Category;
  text: string;
  // Beklenen ilk araç: list_warehouses dışındaki ilk çağrı search_products olmalı ve
  // sorgusu bu ifadelerden en az birini içermeli.
  firstQueryTerms: string[];
  expected: Expected;
}

const WAREHOUSE_MARKERS = ['depo', 'merkez', 'sube', 'arac'];

export const TEST_CASES: TestCase[] = [
  // Stok sorgusu
  {
    id: 1,
    category: 'sorgu',
    text: 'Merkez depoda NYM 3x2,5 kablodan kaç metre kaldı?',
    firstQueryTerms: ['nym'],
    expected: { kind: 'get_stock', product_id: 'p-01', warehouse_id: 'wh-merkez' },
  },
  {
    id: 2,
    category: 'sorgu',
    text: '16 amperlik otomatik sigortadan elimizde ne kadar var?',
    firstQueryTerms: ['sigorta'],
    expected: { kind: 'get_stock', product_id: 'p-05', warehouse_id: null },
  },
  {
    id: 3,
    category: 'sorgu',
    text: 'Araçta 9 watt LED ampul kaç tane var?',
    firstQueryTerms: ['ampul', 'led'],
    expected: { kind: 'get_stock', product_id: 'p-10', warehouse_id: 'wh-arac1' },
  },
  {
    id: 4,
    category: 'sorgu',
    text: 'Şube depoda beyaz topraklı prizden kaç adet var?',
    firstQueryTerms: ['priz'],
    expected: { kind: 'get_stock', product_id: 'p-08', warehouse_id: 'wh-sube' },
  },

  // Giriş
  {
    id: 5,
    category: 'giris',
    text: 'Merkez depoya 100 metre NYM 3x2,5 kablo girişi yap.',
    firstQueryTerms: ['nym'],
    expected: { kind: 'propose_stock_in', warehouse_id: 'wh-merkez', items: [{ product_id: 'p-01', quantity: 100 }] },
  },
  {
    id: 6,
    category: 'giris',
    text: "Yılmaz Elektrik'ten 250 metre 2x1,5 TTR kablo geldi, merkez depoya al.",
    firstQueryTerms: ['ttr'],
    expected: {
      kind: 'propose_stock_in',
      warehouse_id: 'wh-merkez',
      items: [{ product_id: 'p-03', quantity: 250 }],
      party_contains: 'yilmaz',
    },
  },
  {
    id: 7,
    category: 'giris',
    text: 'Şube depoya 40 adet 12 watt LED ampul girişi yap.',
    firstQueryTerms: ['ampul', 'led'],
    expected: { kind: 'propose_stock_in', warehouse_id: 'wh-sube', items: [{ product_id: 'p-11', quantity: 40 }] },
  },
  {
    id: 8,
    category: 'giris',
    text: "Merkez depoya 30 tane 100'lük buat ve 50 metre 16'lık spiral boru girdi.",
    firstQueryTerms: ['buat', 'spiral'],
    expected: {
      kind: 'propose_stock_in',
      warehouse_id: 'wh-merkez',
      items: [
        { product_id: 'p-14', quantity: 30 },
        { product_id: 'p-15', quantity: 50 },
      ],
    },
  },

  // Çıkış
  {
    id: 9,
    category: 'cikis',
    text: 'Araç deposundan 20 adet 16 amper otomatik sigorta çıkışı yap.',
    firstQueryTerms: ['sigorta'],
    expected: { kind: 'propose_stock_out', warehouse_id: 'wh-arac1', items: [{ product_id: 'p-05', quantity: 20 }] },
  },
  {
    id: 10,
    category: 'cikis',
    text: 'Merkez depodan 2 tane kaçak akım rölesi çıkışı yap, Ataşehir şantiyesine gitti.',
    firstQueryTerms: ['kacak', 'role'],
    expected: { kind: 'propose_stock_out', warehouse_id: 'wh-merkez', items: [{ product_id: 'p-07', quantity: 2 }] },
  },
  {
    id: 11,
    category: 'cikis',
    text: 'Şube depodan 15 adet krem topraklı priz düş.',
    firstQueryTerms: ['priz'],
    expected: { kind: 'propose_stock_out', warehouse_id: 'wh-sube', items: [{ product_id: 'p-09', quantity: 15 }] },
  },
  {
    id: 12,
    category: 'cikis',
    text: 'Araçtan 3 elektrik bandı ve 10 metre 3x2,5 TTR kablo kullandım.',
    firstQueryTerms: ['bant', 'band', 'ttr'],
    expected: {
      kind: 'propose_stock_out',
      warehouse_id: 'wh-arac1',
      items: [
        { product_id: 'p-18', quantity: 3 },
        { product_id: 'p-04', quantity: 10 },
      ],
    },
  },

  // Transfer
  {
    id: 13,
    category: 'transfer',
    text: 'Merkez depodan şube deposuna 50 adet beyaz topraklı priz transfer et.',
    firstQueryTerms: ['priz'],
    expected: {
      kind: 'propose_transfer',
      from_warehouse_id: 'wh-merkez',
      to_warehouse_id: 'wh-sube',
      items: [{ product_id: 'p-08', quantity: 50 }],
    },
  },
  {
    id: 14,
    category: 'transfer',
    text: 'Şubeden araca 10 tane 25 amper sigorta aktar.',
    firstQueryTerms: ['sigorta'],
    expected: {
      kind: 'propose_transfer',
      from_warehouse_id: 'wh-sube',
      to_warehouse_id: 'wh-arac1',
      items: [{ product_id: 'p-06', quantity: 10 }],
    },
  },
  {
    id: 15,
    category: 'transfer',
    text: 'Araçtaki 5 kablo kanalını merkez depoya geri bıraktım.',
    firstQueryTerms: ['kanal'],
    expected: {
      kind: 'propose_transfer',
      from_warehouse_id: 'wh-arac1',
      to_warehouse_id: 'wh-merkez',
      items: [{ product_id: 'p-13', quantity: 5 }],
    },
  },

  // Belirsiz: birden fazla yakın aday, eksik depo, eksik miktar
  {
    id: 16,
    category: 'belirsiz',
    text: 'Merkez depoya 100 metre NYM kablo girişi yap.',
    firstQueryTerms: ['nym'],
    expected: {
      kind: 'clarify',
      reason: 'aday',
      candidates: ['p-01', 'p-02'],
      markers: [
        ['3x2,5', '2,5mm'],
        ['3x1,5', '1,5mm'],
      ],
    },
  },
  {
    id: 17,
    category: 'belirsiz',
    text: 'Araçtan 10 adet LED ampul çıkışı yap.',
    firstQueryTerms: ['ampul', 'led'],
    expected: {
      kind: 'clarify',
      reason: 'aday',
      candidates: ['p-10', 'p-11'],
      markers: [
        ['9w', '9watt'],
        ['12w', '12watt'],
      ],
    },
  },
  {
    id: 18,
    category: 'belirsiz',
    text: 'Merkez depodan araca 30 metre TTR kablo aktar.',
    firstQueryTerms: ['ttr'],
    expected: {
      kind: 'clarify',
      reason: 'aday',
      candidates: ['p-03', 'p-04'],
      markers: [['2x1,5'], ['3x2,5']],
    },
  },
  {
    id: 19,
    category: 'belirsiz',
    text: '25 adet 16 amper otomatik sigorta çıkışı yap.',
    firstQueryTerms: ['sigorta'],
    expected: { kind: 'clarify', reason: 'depo', markers: [WAREHOUSE_MARKERS] },
  },
  {
    id: 20,
    category: 'belirsiz',
    text: 'Şube depoya beyaz topraklı priz girişi yap.',
    firstQueryTerms: ['priz'],
    expected: { kind: 'clarify', reason: 'miktar', markers: [['kac', 'miktar', 'adet']] },
  },
];
