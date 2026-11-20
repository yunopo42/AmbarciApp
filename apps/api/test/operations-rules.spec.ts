import { randomUUID } from 'node:crypto';

import { createOperationSchema, isZeroQuantity } from '@ambarci/shared';
import type { OperationItem } from '@ambarci/shared';
import { describe, expect, it } from 'vitest';

import { stockKeysOf } from '../src/modules/inventory/apply-stock.service.js';
import type { ApplyLine } from '../src/modules/inventory/apply-stock.service.js';
import { canTransition } from '../src/modules/operations/operation-state.js';
import { reversalDenial, reversalItemsOf, reversalStepsOf } from '../src/modules/operations/operations.service.js';

// Veritabanı gerektirmeyen kurallar: durum makinesi, kilit sırası ve işlem şeması. Stok transaction'ının kendisi
// gerçek veritabanında sınanır (test-db/operations.db.spec.ts).

describe('İşlem durum makinesi', () => {
  it('onay bekleyen işlem uygulanabilir, iptal edilebilir, süresi dolabilir', () => {
    expect(canTransition('PENDING_CONFIRMATION', 'APPLIED')).toBe(true);
    expect(canTransition('PENDING_CONFIRMATION', 'CANCELLED')).toBe(true);
    expect(canTransition('PENDING_CONFIRMATION', 'EXPIRED')).toBe(true);
  });

  it('uygulanmış işlem ikinci kez uygulanamaz ve iptal edilemez; yalnızca ters kayıtla geri alınır', () => {
    expect(canTransition('APPLIED', 'APPLIED')).toBe(false);
    expect(canTransition('APPLIED', 'CANCELLED')).toBe(false);
    expect(canTransition('APPLIED', 'REVERSED')).toBe(true);
  });

  it('son durumlardan çıkış yok', () => {
    for (const from of ['REVERSED', 'CANCELLED', 'EXPIRED', 'FAILED'] as const) {
      expect(canTransition(from, 'APPLIED')).toBe(false);
      expect(canTransition(from, 'PENDING_CONFIRMATION')).toBe(false);
    }
  });
});

describe('Kilit sırası', () => {
  const line = (productId: string, warehouseId: string, targetWarehouseId: string | null = null): ApplyLine => ({
    lineNo: 1,
    productId,
    warehouseId,
    targetWarehouseId,
    baseQuantity: '1',
    baseUnitCost: null,
    unitFactor: '1',
  });

  it('stok satırları ürün, sonra depo kimliğine göre artan sırada ve tekrarsız', () => {
    const keys = stockKeysOf('STOCK_OUT', [
      line('bbbbbbbb-0000-4000-8000-000000000000', '22222222-0000-4000-8000-000000000000'),
      line('aaaaaaaa-0000-4000-8000-000000000000', '33333333-0000-4000-8000-000000000000'),
      line('aaaaaaaa-0000-4000-8000-000000000000', '11111111-0000-4000-8000-000000000000'),
      line('BBBBBBBB-0000-4000-8000-000000000000', '22222222-0000-4000-8000-000000000000'),
    ]);
    expect(keys).toEqual([
      { productId: 'aaaaaaaa-0000-4000-8000-000000000000', warehouseId: '11111111-0000-4000-8000-000000000000' },
      { productId: 'aaaaaaaa-0000-4000-8000-000000000000', warehouseId: '33333333-0000-4000-8000-000000000000' },
      { productId: 'bbbbbbbb-0000-4000-8000-000000000000', warehouseId: '22222222-0000-4000-8000-000000000000' },
    ]);
  });

  it('ters sırada kalem içeren iki işlem aynı kilit sırasını üretir (deadlock olmaz)', () => {
    const a = randomUUID();
    const b = randomUUID();
    const warehouse = randomUUID();
    const first = stockKeysOf('STOCK_OUT', [line(a, warehouse), line(b, warehouse)]);
    const second = stockKeysOf('STOCK_OUT', [line(b, warehouse), line(a, warehouse)]);
    expect(first).toEqual(second);
  });

  it('transferde hedef deponun satırı da kilitlenir', () => {
    const product = randomUUID();
    const keys = stockKeysOf('TRANSFER', [line(product, '11111111-0000-4000-8000-000000000000', '22222222-0000-4000-8000-000000000000')]);
    expect(keys.map((key) => key.warehouseId)).toEqual([
      '11111111-0000-4000-8000-000000000000',
      '22222222-0000-4000-8000-000000000000',
    ]);
  });
});

describe('İşlem şeması', () => {
  const item = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    productId: randomUUID(),
    warehouseId: randomUUID(),
    quantity: '3',
    ...overrides,
  });
  const issues = (body: unknown): string[] => {
    const result = createOperationSchema.safeParse(body);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
  };

  it('miktar metin; en fazla 3 ondalık hane, ayırıcı nokta', () => {
    expect(issues({ type: 'STOCK_IN', items: [item({ quantity: '12.5' })] })).toEqual([]);
    expect(issues({ type: 'STOCK_IN', items: [item({ quantity: '12,5' })] })).toEqual(['items.0.quantity']);
    expect(issues({ type: 'STOCK_IN', items: [item({ quantity: '1.0005' })] })).toEqual(['items.0.quantity']);
    expect(issues({ type: 'STOCK_IN', items: [item({ quantity: '-1' })] })).toEqual(['items.0.quantity']);
    expect(issues({ type: 'STOCK_IN', items: [item({ quantity: 12 })] })).toEqual(['items.0.quantity']);
  });

  it('sıfır miktar yalnızca sayımda geçerli', () => {
    expect(issues({ type: 'STOCK_OUT', items: [item({ quantity: '0.000' })] })).toEqual(['items.0.quantity']);
    expect(issues({ type: 'COUNT', items: [item({ quantity: '0' })] })).toEqual([]);
    expect(isZeroQuantity('0.000')).toBe(true);
    expect(isZeroQuantity('0.001')).toBe(false);
  });

  it('transferde farklı bir hedef depo zorunlu; diğer türlerde hedef depo girilmez', () => {
    const warehouseId = randomUUID();
    expect(issues({ type: 'TRANSFER', items: [item()] })).toEqual(['items.0.targetWarehouseId']);
    expect(issues({ type: 'TRANSFER', items: [item({ warehouseId, targetWarehouseId: warehouseId })] })).toEqual([
      'items.0.targetWarehouseId',
    ]);
    expect(issues({ type: 'TRANSFER', items: [item({ targetWarehouseId: randomUUID() })] })).toEqual([]);
    expect(issues({ type: 'STOCK_OUT', items: [item({ targetWarehouseId: randomUUID() })] })).toEqual([
      'items.0.targetWarehouseId',
    ]);
  });

  it('birim maliyet yalnızca giriş ve açılışta; cari yalnızca giriş ve çıkışta', () => {
    expect(issues({ type: 'OPENING', items: [item({ unitCost: '28.50' })] })).toEqual([]);
    expect(issues({ type: 'STOCK_OUT', items: [item({ unitCost: '28.50' })] })).toEqual(['items.0.unitCost']);
    expect(issues({ type: 'WASTE', partyId: randomUUID(), items: [item()] })).toEqual(['partyId']);
  });

  it('aynı ürün aynı depoda bir sayımda iki kez sayılamaz', () => {
    const productId = randomUUID();
    const warehouseId = randomUUID();
    const counted = item({ productId, warehouseId });
    expect(issues({ type: 'COUNT', items: [counted, counted] })).toEqual(['items.1.productId']);
  });

  it('ters kayıt bu uç noktadan açılamaz; en az bir kalem gerekir', () => {
    expect(issues({ type: 'REVERSAL', items: [item()] })).toEqual(['type']);
    expect(issues({ type: 'STOCK_IN', items: [] })).toEqual(['items']);
  });
});

// Ters kayıt (#78): geri alma kuralı ve geri alınan hareketlerden ters kaydın kalemleri ve adımları.
describe('Ters kayıt kuralları', () => {
  const creator = randomUUID();
  const applied = { type: 'STOCK_OUT' as const, status: 'APPLIED' as const, createdBy: creator, withinReversalWindow: true };
  const employee = { kind: 'user' as const, userId: creator, role: 'EMPLOYEE' as const };
  const admin = { kind: 'user' as const, userId: randomUUID(), role: 'ADMIN' as const };
  const codeOf = (record: Parameters<typeof reversalDenial>[1], actor: Parameters<typeof reversalDenial>[0] = employee): string | null =>
    reversalDenial(actor, record)?.code ?? null;

  it('açan çalışan 15 dakika içinde geri alır; süre geçince ya da başkasının işleminde yalnızca yönetici', () => {
    expect(codeOf(applied)).toBeNull();
    expect(codeOf({ ...applied, withinReversalWindow: false })).toBe('REVERSAL_WINDOW_PASSED');
    expect(codeOf({ ...applied, createdBy: randomUUID() })).toBe('REVERSAL_FORBIDDEN');
    expect(codeOf({ ...applied, createdBy: null })).toBe('REVERSAL_FORBIDDEN');
    expect(codeOf({ ...applied, withinReversalWindow: false, createdBy: randomUUID() }, admin)).toBeNull();
  });

  it('açılışı yalnızca yönetici; ters kayıt, geri alınmış ve uygulanmamış işlem kimse tarafından geri alınamaz', () => {
    expect(codeOf({ ...applied, type: 'OPENING' })).toBe('REVERSAL_FORBIDDEN');
    expect(codeOf({ ...applied, type: 'OPENING' }, admin)).toBeNull();
    expect(codeOf({ ...applied, type: 'REVERSAL' }, admin)).toBe('OPERATION_NOT_REVERSIBLE');
    expect(codeOf({ ...applied, status: 'REVERSED' }, admin)).toBe('OPERATION_ALREADY_REVERSED');
    expect(codeOf({ ...applied, status: 'PENDING_CONFIRMATION' }, admin)).toBe('OPERATION_NOT_REVERSIBLE');
    expect(codeOf({ ...applied, status: 'CANCELLED' }, admin)).toBe('OPERATION_NOT_REVERSIBLE');
  });

  const [product, main, branch] = [randomUUID(), randomUUID(), randomUUID()];
  const line = (lineNo: number, extra: Partial<OperationItem> = {}): OperationItem => ({
    lineNo,
    productId: product,
    warehouseId: main,
    targetWarehouseId: null,
    quantity: '12',
    unit: 'koli',
    unitCost: null,
    ...extra,
  });

  it('ters kaydın kalemleri ana birimde ve hareketin büyüklüğü kadar; stok değiştirmeyen kalem atlanır', () => {
    const items = [line(1), line(2), line(3, { targetWarehouseId: branch })];
    const movements = [
      { lineNo: 1, warehouseId: main, quantityChange: '-144.000' },
      // 2. kalem: farkı çıkmayan sayım, hareketi yok.
      { lineNo: 3, warehouseId: main, quantityChange: '-5.000' },
      { lineNo: 3, warehouseId: branch, quantityChange: '5.000' },
    ];
    expect(reversalItemsOf(items, movements)).toEqual([
      { lineNo: 1, productId: product, warehouseId: main, targetWarehouseId: null, quantity: '144.000', unit: null, unitCost: null },
      { lineNo: 3, productId: product, warehouseId: main, targetWarehouseId: branch, quantity: '5.000', unit: null, unitCost: null },
    ]);
  });

  it('adımlar hareketlerin tersten sırası; kaynak ve hedef taraf, işaret ve maliyet hareketten', () => {
    const movements = [
      { lineNo: 1, warehouseId: main, productId: product, quantityChange: '40.000', unitCost: '50.0000' },
      { lineNo: 2, warehouseId: main, productId: product, quantityChange: '-5.000', unitCost: '8.0000' },
      { lineNo: 2, warehouseId: branch, productId: product, quantityChange: '5.000', unitCost: '8.0000' },
    ];
    const items = [line(1), line(2, { targetWarehouseId: branch })];
    expect(reversalStepsOf(movements, items)).toEqual([
      { lineNo: 2, side: 'target', warehouseId: branch, productId: product, originalChange: '5.000', unitCost: '8.0000' },
      { lineNo: 2, side: 'source', warehouseId: main, productId: product, originalChange: '-5.000', unitCost: '8.0000' },
      { lineNo: 1, side: 'source', warehouseId: main, productId: product, originalChange: '40.000', unitCost: '50.0000' },
    ]);
  });
});
