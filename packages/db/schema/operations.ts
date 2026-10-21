import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';

import { parties, products, productUnits } from './catalog.ts';
import { actionSource, createdAtOnly, operationStatus, operationType, timestamps } from './common.ts';
import { organizations } from './organizations.ts';
import { memberCanRead } from './rls.ts';
import { warehouses } from './warehouses.ts';

/**
 * İşlem (stok fişi): giriş, çıkış, transfer, sayım, fire, açılış veya ters kayıt. Ekrandan ya da asistandan
 * gelen her işlem önce PENDING_CONFIRMATION durumunda açılır; stok yalnızca onay uç noktasının
 * transaction'ında değişir. Onaylanmış işlem silinmez; geri alma, bu işleme bağlı yeni bir REVERSAL işlemidir.
 */
export const operations = pgTable(
  'operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    type: operationType('type').notNull(),
    status: operationStatus('status').notNull().default('PENDING_CONFIRMATION'),
    source: actionSource('source').notNull(),
    // Öneri düzenlendikçe artar. Onay isteği gördüğü sürümü gönderir; eski sürümün onayı reddedilir.
    version: integer('version').notNull().default(1),
    // İşlemin carisi: girişte tedarikçi, çıkışta müşteri. İsteğe bağlı.
    partyId: uuid('party_id'),
    note: text('note'),
    // Yalnızca ters kayıtta: geri alınan işlem.
    reversedOperationId: uuid('reversed_operation_id'),
    // Başarılı onay isteğinin Idempotency-Key başlığı. Aynı anahtarla tekrar gelen istek aynı cevabı alır,
    // stok yeniden değişmez.
    applyIdempotencyKey: text('apply_idempotency_key'),
    // Hesap silinince (KVKK) işlem kalır, yalnızca kişi bağlantısı boşalır.
    createdBy: uuid('created_by').references(() => authUsers.id, { onDelete: 'set null' }),
    appliedBy: uuid('applied_by').references(() => authUsers.id, { onDelete: 'set null' }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Bileşik yabancı anahtarların hedefi: kalemler ve ters kayıt aynı şirketin işlemine bağlanabilsin.
    unique('operations_org_id_key').on(t.organizationId, t.id),
    // Aynı anahtar iki farklı işlemin onayında kullanılamaz.
    unique('operations_org_idempotency_key').on(t.organizationId, t.applyIdempotencyKey),
    // Bir işlem en fazla bir kez geri alınır: ikinci ters kayıt burada reddedilir.
    unique('operations_org_reversed_operation_key').on(t.organizationId, t.reversedOperationId),
    foreignKey({
      name: 'operations_party_fk',
      columns: [t.organizationId, t.partyId],
      foreignColumns: [parties.organizationId, parties.id],
    }),
    foreignKey({
      name: 'operations_reversed_operation_fk',
      columns: [t.organizationId, t.reversedOperationId],
      foreignColumns: [t.organizationId, t.id],
    }),
    // Onay kuyruğu ve "onay bekleyen işlemler": şirket + durum, tarihe göre.
    index('operations_org_status_created_idx').on(t.organizationId, t.status, t.createdAt),
    index('operations_org_party_idx').on(t.organizationId, t.partyId),
    // Hesap silinince bu alanlar boşaltılır; indeks olmadan tablo baştan sona taranır.
    index('operations_created_by_idx').on(t.createdBy),
    index('operations_applied_by_idx').on(t.appliedBy),
    check('operations_version_positive', sql`${t.version} >= 1`),
    check('operations_note_length', sql`char_length(${t.note}) <= 500`),
    check('operations_idempotency_key_length', sql`char_length(${t.applyIdempotencyKey}) between 1 and 200`),
    // Ters kayıt türü ile geri alınan işlem bağlantısı birlikte bulunur; işlem kendini geri alamaz.
    check('operations_reversal_link', sql`(${t.type} = 'REVERSAL') = (${t.reversedOperationId} is not null)`),
    check('operations_not_self_reversal', sql`${t.reversedOperationId} <> ${t.id}`),
    // Uygulanmış (ve sonradan geri alınmış) işlemin uygulanma zamanı vardır; diğerlerinin yoktur.
    check('operations_applied_at', sql`(${t.status} in ('APPLIED', 'REVERSED')) = (${t.appliedAt} is not null)`),
    memberCanRead('operations', t.organizationId),
  ],
).enableRLS();

/**
 * İşlemin kalemleri. Miktar kullanıcının girdiği birimdedir (birim boşsa ürünün ana birimi). Ana birime çevrim
 * onay transaction'ında yapılır ve harekete yazılır. Uygulanmış işlemin kalemi silinemez: hareketler
 * kaleme yabancı anahtarla bağlıdır.
 */
export const operationItems = pgTable(
  'operation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    // Kalem sırası (1, 2, 3…). Hareketler ve sayım sonuçları işleme bu numarayla bağlanır.
    lineNo: smallint('line_no').notNull(),
    productId: uuid('product_id').notNull(),
    // Girişte malın girdiği, çıkış/fire/sayımda ilgili depo; transferde malın çıktığı depo.
    warehouseId: uuid('warehouse_id').notNull(),
    // Yalnızca transferde: malın gittiği depo.
    targetWarehouseId: uuid('target_warehouse_id'),
    // Girilen birimde miktar. Sayımda sayılan miktardır ve 0 olabilir; diğer türlerde "0'dan büyük" kuralı
    // API'de, ayrıca hareket tablosundaki CHECK kısıtındadır.
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    // Girilen birim (koli, makara). Boşsa ürünün ana birimi.
    unit: text('unit'),
    // Yalnızca giriş ve açılışta: girilen birim başına maliyet (ör. koli fiyatı). Onayda ana birime çevrilir;
    // boşsa giriş mevcut ortalama maliyetle yapılır (ADR-003).
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }),
    ...createdAtOnly,
  },
  (t) => [
    // Hareket ve sayım kayıtlarının hedefi; işlemin yabancı anahtarını da kapsar.
    unique('operation_items_org_operation_line_key').on(t.organizationId, t.operationId, t.lineNo),
    foreignKey({
      name: 'operation_items_operation_fk',
      columns: [t.organizationId, t.operationId],
      foreignColumns: [operations.organizationId, operations.id],
    }),
    foreignKey({
      name: 'operation_items_product_fk',
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    // Girilen birim, kalemdeki ürünün birimi olmak zorunda (birim boşsa kontrol edilmez).
    foreignKey({
      name: 'operation_items_unit_fk',
      columns: [t.organizationId, t.productId, t.unit],
      foreignColumns: [productUnits.organizationId, productUnits.productId, productUnits.unit],
    }),
    foreignKey({
      name: 'operation_items_warehouse_fk',
      columns: [t.organizationId, t.warehouseId],
      foreignColumns: [warehouses.organizationId, warehouses.id],
    }),
    foreignKey({
      name: 'operation_items_target_warehouse_fk',
      columns: [t.organizationId, t.targetWarehouseId],
      foreignColumns: [warehouses.organizationId, warehouses.id],
    }),
    // (şirket, ürün, birim) indeksi hem ürün hem birim anahtarını karşılar.
    index('operation_items_org_product_unit_idx').on(t.organizationId, t.productId, t.unit),
    index('operation_items_org_warehouse_idx').on(t.organizationId, t.warehouseId),
    index('operation_items_org_target_warehouse_idx').on(t.organizationId, t.targetWarehouseId),
    check('operation_items_line_no_positive', sql`${t.lineNo} >= 1`),
    check('operation_items_quantity_non_negative', sql`${t.quantity} >= 0`),
    check('operation_items_unit_cost_non_negative', sql`${t.unitCost} >= 0`),
    check('operation_items_transfer_target_differs', sql`${t.targetWarehouseId} <> ${t.warehouseId}`),
    memberCanRead('operation_items', t.organizationId),
  ],
).enableRLS();
