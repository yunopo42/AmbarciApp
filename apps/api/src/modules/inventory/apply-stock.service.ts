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

/**
 * Ters kaydın bir adımı (#78): geri alınan işlemin bir hareketinin tersi. Transfer kaleminin iki adımı vardır (çıkan
 * ve giren depo); diğerlerinin bir. Miktar ve maliyet hareketten olduğu gibi gelir, hesap SQL'de yapılır.
 */
export interface ReversalStep {
  /** Ters kaydın kalem numarası (geri alınan işleminkiyle aynı). */
  lineNo: number;
  /** Kalemin kaynak deposu mu, transferde hedef deposu mu (önizleme bu ikisini ayrı gösterir). */
  side: 'source' | 'target';
  warehouseId: string;
  productId: string;
  /** Geri alınan hareketin işaretli değişimi (ör. girişte "40.000", çıkışta "-5.000"); ters kayıt tersini yazar. */
  originalChange: string;
  /** Geri alınan hareketin birim maliyeti: ters kayıt stok değerini bu maliyetle geri çevirir. */
  unitCost: string;
}

export interface ReverseInput {
  organizationId: string;
  /** Ters kaydın kimliği: hareketler ona yazılır. */
  operationId: string;
  /** Uygulama sırasıyla: geri alınan hareketlerin tersten sırası. */
  steps: ReversalStep[];
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
          // Ters kaydın kalemleri hareket türünü taşımaz; reverse() geri alınan işlemin hareketlerinden çalışır.
          throw new Error('Ters kayıt reverse() ile uygulanır.');
      }
    }

    if (shortages.length > 0) {
      throw insufficientStock(shortages);
    }
    return movements;
  }

  /**
   * Ters kaydı uygular (#78): geri alınan işlemin her hareketinin tersini, aynı birim maliyetle yazar. Stok değeri tam
   * geri çevrilir:
   *   - hareket stoğu azaltmıştı (çıkış, fire, transfer çıkışı, sayım noksanı) → mal o hareketin maliyetiyle geri
   *     girer, ortalama ağırlıklı değişir (increase);
   *   - hareket stoğu artırmıştı (giriş, transfer girişi, sayım fazlası) → mal o maliyetle çıkar ve değerden düşülür
   *     (decreaseAtCost).
   * Kilit sırası onaydakiyle aynıdır (ürün, sonra depo). Stoğu yetmeyen adım varsa hepsi tek hatada bildirilir ve
   * transaction geri alınır: ters kayıt stoğu eksiye düşüremez.
   */
  async reverse(executor: DbExecutor, input: ReverseInput): Promise<Movement[]> {
    const { organizationId, operationId } = input;
    const keys = sortedKeys(input.steps.map(({ warehouseId, productId }) => ({ warehouseId, productId })));
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

    const movements: Movement[] = [];
    const shortages: StockShortage[] = [];
    for (const step of input.steps) {
      const target: MovementTarget = {
        organizationId,
        operationId,
        lineNo: step.lineNo,
        warehouseId: step.warehouseId,
        productId: step.productId,
        // Ters kaydın kalemleri ana birimdedir (miktar hareketlerden gelir).
        unitFactor: '1',
      };
      // İşaret metinden okunur; miktar sayıya çevrilmez (ADR-003).
      const wasDecrease = step.originalChange.startsWith('-');
      const quantity = step.originalChange.replace(/^[-+]/, '');
      if (wasDecrease) {
        movements.push(await this.ledger.increase(executor, target, { type: 'REVERSAL', quantity, unitCost: step.unitCost }));
        continue;
      }
      const out = await this.ledger.decreaseAtCost(executor, target, { type: 'REVERSAL', quantity, unitCost: step.unitCost });
      if (out) {
        movements.push(out);
      } else {
        shortages.push({
          lineNo: step.lineNo,
          productId: step.productId,
          warehouseId: step.warehouseId,
          requested: quantity,
          available: await this.ledger.currentQuantity(executor, organizationId, step),
        });
      }
    }

    if (shortages.length > 0) {
      throw insufficientStock(shortages);
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
  return sortedKeys(
    lines.flatMap((line) =>
      type === 'TRANSFER' && line.targetWarehouseId
        ? [line, { warehouseId: line.targetWarehouseId, productId: line.productId }]
        : [line],
    ),
  );
}

/** Stok satırları tekrarsız ve ürün, sonra depo kimliğine göre artan sırada (onay ve ters kayıt aynı sırayı kullanır). */
export function sortedKeys(pairs: StockKey[]): StockKey[] {
  const keys = new Map<string, StockKey>();
  for (const pair of pairs) {
    const key = { warehouseId: pair.warehouseId.toLowerCase(), productId: pair.productId.toLowerCase() };
    keys.set(`${key.productId}:${key.warehouseId}`, key);
  }
  return [...keys.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, key]) => key);
}

function insufficientStock(shortages: StockShortage[]): ApiException {
  return new ApiException(HttpStatus.CONFLICT, 'INSUFFICIENT_STOCK', 'Stok yetersiz; işlem uygulanmadı.', shortages);
}
