// Denemede modele verilen sistem promptu ve strict JSON şemalı araç tanımları.
// Yalnızca okuma ve öneri araçları vardır; stok yazan veya onaylayan araç (confirm_*, apply_*) tanımlanmaz.

export const PROMPT_VERSION = 'arac-denemesi-v1';

export const SYSTEM_PROMPT = `Sen ABC Elektrik'in saha stok asistanısın. Saha çalışanları sana kısa, günlük dille yazar.

Kurallar:
- Stoğu sen değiştiremezsin. Giriş, çıkış ve transfer için yalnızca propose_stock_in, propose_stock_out ve propose_transfer araçlarıyla öneri hazırlarsın; stok, kullanıcı öneri kartında Onayla'ya basınca değişir.
- Ürün ve depo kimliklerini tahmin etme. Ürünü search_products ile, depoyu list_warehouses ile bul. "Araç" ya da "araç deposu" servis aracındaki depodur.
- Stok miktarını yalnızca get_stock sonucundan söyle.
- Öneri aracını yalnızca ürün, depo ve miktar kesin olduğunda çağır. Birden fazla yakın aday varsa, depo ya da miktar belli değilse öneri aracı çağırma; adayları kısa bir listeyle göster ve tek bir soru sor.
- Miktarı ürünün ana biriminde gir (search_products sonucundaki unit).
- Cevapların kısa ve Türkçe olsun.`;

export interface ToolDefinition {
  name: string;
  description: string;
  strict: true;
  input_schema: Record<string, unknown>;
}

const itemsSchema = {
  type: 'array',
  description: 'İşlem kalemleri. Her ürün bir kez yazılır.',
  items: {
    type: 'object',
    properties: {
      product_id: { type: 'string', description: 'search_products sonucundaki product_id.' },
      quantity: { type: 'number', description: 'Ürünün ana biriminde miktar; sıfırdan büyük.' },
    },
    required: ['product_id', 'quantity'],
    additionalProperties: false,
  },
};

const noteSchema = { type: 'string', description: 'Kullanıcının belirttiği açıklama (ör. şantiye adı). Yoksa gönderme.' };

export const TOOLS: ToolDefinition[] = [
  {
    name: 'search_products',
    description:
      'Katalogda ürün arar; ad, stok kodu ve alternatif adlarda benzerlik araması yapar. En iyi 5 adayı 0–1 arası benzerlik skoruyla döndürür. Kullanıcının söylediği ürün adını ölçü ve özellikleriyle birlikte sorgu olarak ver.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: "Aranacak ürün adı, ör. 'NYM kablo 3x2,5'." } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_stock',
    description: 'Bir ürünün depolardaki güncel stoğunu ana birimde döndürür. warehouse_id verilmezse kullanıcının erişebildiği tüm depolar döner.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'search_products sonucundaki product_id.' },
        warehouse_id: { type: 'string', description: 'list_warehouses sonucundaki warehouse_id. İsteğe bağlı.' },
      },
      required: ['product_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_warehouses',
    description: 'Kullanıcının erişebildiği depoları (merkez depo, şube, araç) kimlik ve türüyle listeler.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'propose_stock_in',
    description:
      'Depoya stok girişi önerisi hazırlar. Stok değişmez; öneri kullanıcıya onay kartı olarak gösterilir. Yalnızca ürün, depo ve miktar kesinse çağır.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        warehouse_id: { type: 'string', description: 'Girişin yapılacağı depo.' },
        items: itemsSchema,
        party_name: { type: 'string', description: 'Malın geldiği tedarikçi (cari) adı, kullanıcı söylediyse.' },
        note: noteSchema,
      },
      required: ['warehouse_id', 'items'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_stock_out',
    description:
      'Depodan stok çıkışı (kullanım, şantiyeye gönderim) önerisi hazırlar. Stok değişmez; öneri kullanıcıya onay kartı olarak gösterilir. Yalnızca ürün, depo ve miktar kesinse çağır.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        warehouse_id: { type: 'string', description: 'Çıkışın yapılacağı depo.' },
        items: itemsSchema,
        note: noteSchema,
      },
      required: ['warehouse_id', 'items'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_transfer',
    description:
      'İki depo arasında transfer önerisi hazırlar. Stok değişmez; öneri kullanıcıya onay kartı olarak gösterilir. Yalnızca ürün, iki depo ve miktar kesinse çağır.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        from_warehouse_id: { type: 'string', description: 'Malın çıktığı depo.' },
        to_warehouse_id: { type: 'string', description: 'Malın girdiği depo.' },
        items: itemsSchema,
        note: noteSchema,
      },
      required: ['from_warehouse_id', 'to_warehouse_id', 'items'],
      additionalProperties: false,
    },
  },
];
