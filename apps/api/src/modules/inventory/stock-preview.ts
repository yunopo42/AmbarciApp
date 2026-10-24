import type { OperationType } from '@ambarci/shared';

/** Önizlenecek kalem: ana birime çevrilmiş hâli. */
export interface PreviewLine {
  lineNo: number;
  productId: string;
  warehouseId: string;
  targetWarehouseId: string | null;
  /** Ana birimde; sayımda sayılan miktar. */
  baseQuantity: string;
}

/**
 * Bir kalemin bir depodaki stoğa etkisi. Transfer kaleminin iki etkisi vardır (kaynak ve hedef); diğerlerinin bir.
 * Miktar metin kalır, işaret ayrı tutulur: çarpma ve toplama SQL'de yapılır (ADR-003).
 */
export type StockEffectInput = {
  /** Uygulama sırası. Onay kalemleri sırayla uygular; transferde önce kaynaktan çıkar, sonra hedefe girer. */
  seq: number;
  lineNo: number;
  side: 'source' | 'target';
  warehouseId: string;
  productId: string;
  /** change: stok miktar kadar artar (+1) ya da azalır (−1); count: stok sayılan miktara eşitlenir. */
  kind: 'change' | 'count';
  direction: 1 | -1;
  quantity: string;
};

/** İşlemin kalemlerini, onay transaction'ının uygulayacağı sırayla stok etkilerine çevirir. */
export function stockEffectsOf(type: OperationType, lines: PreviewLine[]): StockEffectInput[] {
  return lines.flatMap((line): StockEffectInput[] => {
    const base = {
      seq: line.lineNo * 2,
      lineNo: line.lineNo,
      side: 'source' as const,
      warehouseId: line.warehouseId,
      productId: line.productId,
      quantity: line.baseQuantity,
    };
    switch (type) {
      case 'STOCK_IN':
      case 'OPENING':
        return [{ ...base, kind: 'change', direction: 1 }];
      case 'STOCK_OUT':
      case 'WASTE':
        return [{ ...base, kind: 'change', direction: -1 }];
      case 'COUNT':
        return [{ ...base, kind: 'count', direction: 1 }];
      case 'TRANSFER':
        if (!line.targetWarehouseId) {
          throw new Error(`Transfer kaleminde hedef depo yok (kalem ${line.lineNo}).`);
        }
        return [
          { ...base, kind: 'change', direction: -1 },
          { ...base, seq: base.seq + 1, side: 'target', warehouseId: line.targetWarehouseId, kind: 'change', direction: 1 },
        ];
      case 'REVERSAL':
        throw new Error('Ters kayıt 5. haftada eklenecek.');
    }
  });
}
