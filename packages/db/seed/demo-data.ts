// Demo ve testlerde kullanılan kurgusal şirket verisi. Şirket, cari ve araç adları uydurmadır.
// Miktar ve katsayılar NUMERIC kolonlara gittiği için metin olarak yazılır (JS number kullanılmaz).
// Barkodlar mağaza içi kullanıma ayrılmış 200 önekli, geçerli kontrol haneli EAN-13 kodlarıdır.
// Başlangıç stokları burada yok: stok yalnızca hareket kaydıyla değişir ve hareket tabloları 3. haftada gelir.

export interface DemoProduct {
  sku: string;
  name: string;
  baseUnit: string;
  barcode: string;
  minStock: string;
  /** Ana birim dışındaki birim ve ana birime çevrim katsayısı (1 koli = 50 adet ise "50"). */
  unit: { name: string; factor: string };
  /** Sahada kullanılan diğer adlar. */
  aliases: string[];
}

export interface DemoCompany {
  /** Sabit kimlik: seed tekrar çalıştığında aynı şirketi günceller. */
  id: string;
  name: string;
  warehouses: { name: string; type: 'WAREHOUSE' | 'BRANCH' | 'VEHICLE' }[];
  parties: { name: string; type: 'SUPPLIER' | 'CUSTOMER'; taxId: string }[];
  products: DemoProduct[];
}

export const ABC_ELEKTRIK_ID = '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e01';
export const KUZEY_TESISAT_ID = '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e02';

/** Ana demo şirketi: elektrik malzemesi satan ve taahhüt işi yapan küçük bir firma. */
export const abcElektrik: DemoCompany = {
  id: ABC_ELEKTRIK_ID,
  name: 'ABC Elektrik',
  warehouses: [
    { name: 'Merkez Depo', type: 'WAREHOUSE' },
    { name: 'Ostim Depo', type: 'WAREHOUSE' },
    { name: 'Servis Aracı 1', type: 'VEHICLE' },
  ],
  // VKN'ler kurgusaldır (999 önekli).
  parties: [
    { name: 'Anadolu Kablo Toptan', type: 'SUPPLIER', taxId: '9990000011' },
    { name: 'Başkent Aydınlatma', type: 'SUPPLIER', taxId: '9990000022' },
    { name: 'Yıldız Yapı İnşaat', type: 'CUSTOMER', taxId: '9990000033' },
  ],
  products: [
    {
      sku: 'KBL-NYM-325',
      name: 'NYM kablo 3x2,5 mm²',
      baseUnit: 'metre',
      barcode: '2000000000015',
      minStock: '200',
      unit: { name: 'makara', factor: '100' },
      aliases: ['3x2,5 kablo', 'nym 2,5'],
    },
    {
      sku: 'KBL-NYM-315',
      name: 'NYM kablo 3x1,5 mm²',
      baseUnit: 'metre',
      barcode: '2000000000022',
      minStock: '200',
      unit: { name: 'makara', factor: '100' },
      aliases: ['3x1,5 kablo', 'nym 1,5'],
    },
    {
      sku: 'KBL-TTR-215',
      name: 'TTR kablo 2x1,5 mm²',
      baseUnit: 'metre',
      barcode: '2000000000039',
      minStock: '100',
      unit: { name: 'makara', factor: '100' },
      aliases: ['ttr kablo', 'fiş kablosu'],
    },
    {
      sku: 'KBL-NHX-325',
      name: 'NHXMH halojen free kablo 3x2,5 mm²',
      baseUnit: 'metre',
      barcode: '2000000000046',
      minStock: '100',
      unit: { name: 'makara', factor: '100' },
      aliases: ['halojen free kablo', 'yangın kablosu'],
    },
    {
      sku: 'PRZ-TOP-B',
      name: 'Topraklı priz, beyaz',
      baseUnit: 'adet',
      barcode: '2000000000053',
      minStock: '50',
      unit: { name: 'koli', factor: '50' },
      aliases: ['priz', 'topraklı priz'],
    },
    {
      sku: 'PRZ-UCL-15',
      name: 'Üçlü grup priz, 1,5 m kablolu',
      baseUnit: 'adet',
      barcode: '2000000000060',
      minStock: '20',
      unit: { name: 'koli', factor: '20' },
      aliases: ['üçlü priz', 'grup priz', 'uzatma'],
    },
    {
      sku: 'ANH-ADI-B',
      name: 'Adi anahtar, beyaz',
      baseUnit: 'adet',
      barcode: '2000000000077',
      minStock: '50',
      unit: { name: 'koli', factor: '50' },
      aliases: ['anahtar', 'lamba anahtarı'],
    },
    {
      sku: 'ANH-VAV-B',
      name: 'Vavien anahtar, beyaz',
      baseUnit: 'adet',
      barcode: '2000000000084',
      minStock: '30',
      unit: { name: 'koli', factor: '50' },
      aliases: ['vavien'],
    },
    {
      sku: 'SGR-C16',
      name: 'Otomatik sigorta C16 1 kutup',
      baseUnit: 'adet',
      barcode: '2000000000091',
      minStock: '24',
      unit: { name: 'kutu', factor: '12' },
      aliases: ['otomat', '16 amper sigorta'],
    },
    {
      sku: 'SGR-C25',
      name: 'Otomatik sigorta C25 1 kutup',
      baseUnit: 'adet',
      barcode: '2000000000107',
      minStock: '12',
      unit: { name: 'kutu', factor: '12' },
      aliases: ['25 amper sigorta'],
    },
    {
      sku: 'KAR-40-30',
      name: 'Kaçak akım rölesi 2 kutup 40 A 30 mA',
      baseUnit: 'adet',
      barcode: '2000000000114',
      minStock: '6',
      unit: { name: 'kutu', factor: '6' },
      aliases: ['kaçak akım', 'kaçak akım rölesi'],
    },
    {
      sku: 'LED-PNL-6060',
      name: 'LED panel 60x60 40 W',
      baseUnit: 'adet',
      barcode: '2000000000121',
      minStock: '8',
      unit: { name: 'koli', factor: '4' },
      aliases: ['panel led', '60x60 panel'],
    },
    {
      sku: 'LED-AMP-9',
      name: 'LED ampul 9 W E27',
      baseUnit: 'adet',
      barcode: '2000000000138',
      minStock: '100',
      unit: { name: 'koli', factor: '100' },
      aliases: ['led ampul', 'ampul'],
    },
    {
      sku: 'PRJ-LED-50',
      name: 'LED projektör 50 W',
      baseUnit: 'adet',
      barcode: '2000000000145',
      minStock: '5',
      unit: { name: 'koli', factor: '10' },
      aliases: ['projektör'],
    },
    {
      sku: 'BUA-SVA',
      name: 'Sıva altı buat',
      baseUnit: 'adet',
      barcode: '2000000000152',
      minStock: '100',
      unit: { name: 'paket', factor: '100' },
      aliases: ['buat', 'buat kutusu'],
    },
    {
      sku: 'KNL-2516',
      name: 'Kablo kanalı 25x16 mm, 2 m boy',
      baseUnit: 'adet',
      barcode: '2000000000169',
      minStock: '40',
      unit: { name: 'paket', factor: '20' },
      aliases: ['kablo kanalı', 'kanal'],
    },
    {
      sku: 'SPR-16',
      name: 'Spiral boru 16 mm',
      baseUnit: 'metre',
      barcode: '2000000000176',
      minStock: '200',
      unit: { name: 'top', factor: '100' },
      aliases: ['spiral', 'spiral boru'],
    },
    {
      sku: 'KLM-6',
      name: "Klemens 6 mm², 12'li",
      baseUnit: 'adet',
      barcode: '2000000000183',
      minStock: '20',
      unit: { name: 'paket', factor: '10' },
      aliases: ['klemens'],
    },
  ],
};

/**
 * İkinci şirket: izolasyonu elle göstermek için (ABC Elektrik kullanıcısı bu şirketin verisini görmemeli).
 * Bilerek ABC Elektrik ile aynı depo adını ve benzer ürün adlarını kullanır.
 */
export const kuzeyTesisat: DemoCompany = {
  id: KUZEY_TESISAT_ID,
  name: 'Kuzey Tesisat',
  warehouses: [{ name: 'Merkez Depo', type: 'WAREHOUSE' }],
  parties: [{ name: 'Ege Boru Toptan', type: 'SUPPLIER', taxId: '9990000044' }],
  products: [
    {
      sku: 'PPR-B-20',
      name: 'PPRC boru 20 mm, 4 m',
      baseUnit: 'adet',
      barcode: '2000000000190',
      minStock: '20',
      unit: { name: 'bağ', factor: '25' },
      aliases: ['pprc boru', 'boru'],
    },
    {
      sku: 'VNA-KR-12',
      name: 'Küresel vana 1/2"',
      baseUnit: 'adet',
      barcode: '2000000000206',
      minStock: '10',
      unit: { name: 'kutu', factor: '20' },
      aliases: ['vana', 'küresel vana'],
    },
    {
      sku: 'DRS-20-90',
      name: 'PPRC dirsek 20 mm 90°',
      baseUnit: 'adet',
      barcode: '2000000000213',
      minStock: '50',
      unit: { name: 'paket', factor: '50' },
      aliases: ['dirsek'],
    },
  ],
};

export const demoCompanies: DemoCompany[] = [abcElektrik, kuzeyTesisat];
