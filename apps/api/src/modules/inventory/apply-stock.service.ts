import type { DbExecutor } from '@ambarci/db';
import type { Movement, OperationType } from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { StockLedgerRepository } from './stock-ledger.repository.js';
import type { MovementTarget, StockKey } from './stock-ledger.repository.js';

/** Onaylanan işlemin ana birime çevrilmiş kalemi. */
export interface ApplyLine {
  lineNo: number;
  productId: string;
  warehouseId: string;
  targetWarehouseId: string | null;
  /** Ana birimde miktar; sayımda sayılan miktar (0 olabilir). */
  baseQuantity: string;
  /** Ana birim başına maliyet; yalnızca giriş ve açılışta, girilmediyse null. */
  baseUnitCost: string | null;
  unitFactor: string;
}

export interface ApplyInput {
  organizationId: string;
  operationId: string;
  type: OperationType;
  lines: ApplyLine[];
}

/** Yetersiz stok hatasının kalem bazında ayrıntısı. */
export interface StockShortage {
  lineNo: number;
  productId: string;
  warehouseId: string;
  requested: string;
  available: string;
}

/**
 * İşlemin stoğa etkisini uygular. Onay transaction'ının stok kısmıdır; işlemin kilitlenmesi, durum, sürüm ve
 * yetki kontrolü, denetim ve outbox kaydı OperationsService'tedir. Hepsi aynı transaction'da çalışır.
 */
@Injectable()
export class ApplyStockService {
  constructor(@Inject(StockLedgerRepository) private readonly ledger: StockLedgerRepository) {}

  /**
   * Stok satırlarını kilitler, kalemleri sırayla uygular ve yazılan hareketleri döner. executor açık bir
   * transaction'dır. Burada fırlatılan her hata transaction'ın tamamını geri aldırır: kalemlerden biri bile
   * uygulanamazsa hiçbir hareket, stok ya da maliyet değişikliği kalmaz.
   */
  async apply(executor: DbExecutor, input: ApplyInput): Promise<Movement[]> {
    const { organizationId, operationId } = input;

    // 1. Etkilenecek stok satırlarını aç (yoksa) ve kilitle. Kilit sırası: ürün, sonra depo kimliği.
    const keys = stockKeysOf(input.type, input.lines);
    await this.ledger.ensureRows(executor, organizationId, keys);
    const rows = await this.ledger.lockRows(executor, organizationId, keys);
    const inactive = [...new Set(rows.filter((row) => !row.warehouseActive).map((row) => row.warehouseId))];
    if (inactive.length > 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'WAREHOUSE_INACTIVE',
        'Pasif bir depoda stok işlemi yapılamaz.',
        { warehouseIds: inactive },
      );
    }

    // 2. Kalemleri sırayla uygula. Yetersiz stoklu kalemler toplanır; hepsi tek hatada bildirilir.
    const movements: Movement[] = [];
    const shortages: StockShortage[] = [];
    for (const line of input.lines) {
      const at = (warehouseId: string): MovementTarget => ({
        organizationId,
        operationId,
        lineNo: line.lineNo,
        warehouseId,
        productId: line.productId,
        unitFactor: line.unitFactor,
      });
      const source = at(line.warehouseId);

      switch (input.type) {
        case 'STOCK_IN':
        case 'OPENING': {
          const into = await this.ledger.increase(executor, source, {
            type: 'IN',
            quantity: line.baseQuantity,
            unitCost: line.baseUnitCost,
          });
          movements.push(into);
          break;
        }
        case 'STOCK_OUT':
        case 'WASTE': {
          const type = input.type === 'WASTE' ? 'WASTE' : 'OUT';
          const out = await this.ledger.decrease(executor, source, { type, quantity: line.baseQuantity });
          if (out) {
            movements.push(out);
          } else {
            shortages.push(await this.shortageOf(executor, organizationId, line));
          }
          break;
        }
        case 'TRANSFER': {
          if (!line.targetWarehouseId) {
            throw new Error(`Transfer kaleminde hedef depo yok (kalem ${line.lineNo}).`);
          }
          const out = await this.ledger.decrease(executor, source, { type: 'TRANSFER_OUT', quantity: line.baseQuantity });
          if (!out) {
            shortages.push(await this.shortageOf(executor, organizationId, line));
            break;
          }
          // Mal, çıktığı deponun ortalama maliyetiyle girer (out.unitCost = kaynak deponun ortalaması).
          const into = await this.ledger.increase(executor, at(line.targetWarehouseId), {
            type: 'TRANSFER_IN',
            quantity: line.baseQuantity,
            unitCost: out.unitCost,
          });
          movements.push(out, into);
          break;
        }
        case 'COUNT': {
          // Sistemdeki miktar kilitli satırdan, şimdi okunur; fark veritabanında hesaplanır.
          const count = await this.ledger.recordCount(executor, source, line.baseQuantity);
          if (count.direction > 0) {
            // Sayım fazlası mevcut ortalamayla girer; ortalama değişmez.
            movements.push(
              await this.ledger.increase(executor, source, {
                type: 'COUNT_SURPLUS',
                quantity: count.magnitude,
                unitCost: null,
              }),
            );
          } else if (count.direction < 0) {
            const out = await this.ledger.decrease(executor, source, {
              type: 'COUNT_SHORTAGE',
              quantity: count.magnitude,
            });
            if (!out) {
              // Noksan en fazla sistemdeki miktar kadar olabilir; buraya gelinirse programlama hatasıdır.
              throw new Error(`Sayım noksanı stoktan büyük (kalem ${line.lineNo}).`);
            }
            movements.push(out);
          }
          break;
        }
        case 'REVERSAL':
          throw new Error('Ters kayıt 5. haftada eklenecek.');
      }
    }

    if (shortages.length > 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'INSUFFICIENT_STOCK',
        'Stok yetersiz; işlem uygulanmadı.',
        shortages,
      );
    }
    return movements;
  }

  /** Aynı onayın tekrarında aynı cevabı vermek için işlemin daha önce yazılmış hareketleri. */
  listMovements(executor: DbExecutor, organizationId: string, operationId: string): Promise<Movement[]> {
    return this.ledger.listByOperation(executor, organizationId, operationId);
  }

  private async shortageOf(executor: DbExecutor, organizationId: string, line: ApplyLine): Promise<StockShortage> {
    const available = await this.ledger.currentQuantity(executor, organizationId, line);
    return {
      lineNo: line.lineNo,
      productId: line.productId,
      warehouseId: line.warehouseId,
      requested: line.baseQuantity,
      available,
    };
  }
}

/**
 * İşlemin değiştireceği stok satırları: tekrarsız ve ürün, sonra depo kimliğine göre artan sırada. Bu sıra
 * hem satır açma hem kilitleme sırasıdır. UUID'ler küçük harfe çevrilir; küçük harfli UUID metninin sıralaması
 * PostgreSQL'in uuid sıralamasıyla aynıdır.
 */
export function stockKeysOf(type: OperationType, lines: ApplyLine[]): StockKey[] {
  const keys = new Map<string, StockKey>();
  const add = (warehouseId: string, productId: string): void => {
    const key = { warehouseId: warehouseId.toLowerCase(), productId: productId.toLowerCase() };
    keys.set(`${key.productId}:${key.warehouseId}`, key);
  };
  for (const line of lines) {
    add(line.warehouseId, line.productId);
    if (type === 'TRANSFER' && line.targetWarehouseId) {
      add(line.targetWarehouseId, line.productId);
    }
  }
  return [...keys.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, key]) => key);
}
