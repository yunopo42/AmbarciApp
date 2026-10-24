import { describe, expect, it } from 'vitest';

import { stockEffectsOf } from '../src/modules/inventory/stock-preview.js';

// Önizlemenin, onayın uygulama sırasını izlediği (veritabanı gerekmez). Hesabın kendisi SQL'de; gerçek
// veritabanındaki sonuçlar test-db/stock.db.spec.ts'te sınanır.

const line = (lineNo: number, overrides: Record<string, unknown> = {}) => ({
  lineNo,
  productId: 'p',
  warehouseId: 'merkez',
  targetWarehouseId: null,
  baseQuantity: '10',
  ...overrides,
});

describe('Önizlemenin stok etkileri', () => {
  it('giriş artırır, çıkış ve fire azaltır, sayım eşitler', () => {
    expect(stockEffectsOf('STOCK_IN', [line(1)])).toEqual([
      expect.objectContaining({ kind: 'change', direction: 1, side: 'source', quantity: '10' }),
    ]);
    expect(stockEffectsOf('STOCK_OUT', [line(1)])[0]).toMatchObject({ kind: 'change', direction: -1 });
    expect(stockEffectsOf('WASTE', [line(1)])[0]).toMatchObject({ kind: 'change', direction: -1 });
    expect(stockEffectsOf('COUNT', [line(1)])[0]).toMatchObject({ kind: 'count' });
  });

  it('transfer önce kaynaktan çıkar sonra hedefe girer; kalemler sırasını korur', () => {
    const effects = stockEffectsOf('TRANSFER', [
      line(1, { targetWarehouseId: 'ostim' }),
      line(2, { warehouseId: 'ostim', targetWarehouseId: 'arac' }),
    ]);
    expect(effects.map(({ seq, side, warehouseId, direction }) => [seq, side, warehouseId, direction])).toEqual([
      [2, 'source', 'merkez', -1],
      [3, 'target', 'ostim', 1],
      [4, 'source', 'ostim', -1],
      [5, 'target', 'arac', 1],
    ]);
  });

  it('hedefi olmayan transfer kalemi programlama hatasıdır', () => {
    expect(() => stockEffectsOf('TRANSFER', [line(1)])).toThrow();
  });
});
