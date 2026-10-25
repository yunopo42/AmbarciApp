import type { Database } from '@ambarci/db';
import { hasOpeningStock, OPENING_OPERATION_MAX_LINES } from '@ambarci/shared';
import type { ProductImportInput, ProductImportResult, ProductImportRow, ProductImportRowError } from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { postgresErrorOf } from '../../common/postgres-error.js';
import { DATABASE } from '../../database/database.module.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { OperationsService } from '../operations/operations.service.js';
import type { OperationActor } from '../operations/operations.service.js';

/**
 * Excel/CSV'den ürün içe aktarma (ADR-004). Dosya tarayıcıda okunur; buraya satırlar gelir ve tek tek eklemedekiyle
 * aynı ürün şemasıyla doğrulanmış olarak ulaşır (ZodValidationPipe). Ürünler catalog modülünün, başlangıç stoku için
 * açılış işlemi operations modülünün servisiyle yazılır; ikisi aynı transaction'da: ya hepsi ya hiçbiri.
 */
@Injectable()
export class ProductImportService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(OperationsService) private readonly operations: OperationsService,
  ) {}

  async import(organizationId: string, actor: OperationActor, input: ProductImportInput): Promise<ProductImportResult> {
    // Dosya içindeki tekrarlar şemada; şirkette zaten kullanılan SKU ve barkodlar burada, satır numarasıyla.
    const conflicts = await this.findConflicts(organizationId, input.rows);
    if (conflicts.length > 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'IMPORT_ROWS_INVALID',
        'Dosyadaki bazı satırlar kaydedilemez; hiçbir satır kaydedilmedi.',
        conflicts,
      );
    }

    // Açılış stoğunu yalnızca yönetici girer ve depoda yetki gerekir; transaction açılmadan denetlenir.
    if (input.warehouseId && input.rows.some(hasOpeningStock)) {
      await this.operations.assertCreateAccess(this.db, organizationId, actor, 'OPENING', [input.warehouseId]);
    }

    try {
      return await this.db.transaction(async (tx) => {
        const created = await this.catalog.insertProducts(
          tx,
          organizationId,
          input.rows.map((row) => row.product),
        );
        const openingOperationIds = input.warehouseId
          ? await this.openOpeningStock(tx, organizationId, actor, input.warehouseId, input.rows, created)
          : [];
        return { created: created.length, openingOperationIds };
      });
    } catch (error) {
      // Önceden bakılan kod, bu arada başka bir istekte kullanılmış olabilir; kısıt reddeder ve hepsi geri alınır.
      if (postgresErrorOf(error).code === '23505') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'IMPORT_CODES_TAKEN',
          'Dosyadaki bir SKU ya da barkod bu arada başka bir üründe kullanılmış; hiçbir satır kaydedilmedi. Dosyayı yeniden yükleyin.',
        );
      }
      if (error instanceof ApiException && error.code === 'OPERATION_LINES_INVALID') {
        // Ürünler yeni ve aktif; açılış işleminin kalemi ancak depo yüzünden reddedilir (yok, pasif ya da başka şirketin).
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'IMPORT_WAREHOUSE_INVALID',
          'Başlangıç stoku için seçilen depo bulunamadı ya da pasif; hiçbir satır kaydedilmedi.',
        );
      }
      throw error;
    }
  }

  /**
   * Başlangıç stoku için onay bekleyen açılış işlemleri. Stok burada değişmez; yalnızca onayla değişir (mimari
   * değişmez 2). Bir işlem en fazla 100 kalem alır: onay transaction'ı kısa kalsın diye fazlası yeni işleme geçer.
   */
  private async openOpeningStock(
    tx: Parameters<OperationsService['createWithin']>[0],
    organizationId: string,
    actor: OperationActor,
    warehouseId: string,
    rows: ProductImportRow[],
    created: { id: string; sku: string }[],
  ): Promise<string[]> {
    const idOf = new Map(created.map((product) => [product.sku, product.id]));
    const items = rows.filter(hasOpeningStock).map((row) => {
      const productId = idOf.get(row.product.sku);
      if (!productId || row.openingQuantity === undefined) {
        throw new Error(`İçe aktarılan ürün bulunamadı (satır ${row.row}).`);
      }
      return { productId, warehouseId, quantity: row.openingQuantity, unitCost: row.openingUnitCost };
    });
    const operationIds: string[] = [];
    for (let start = 0; start < items.length; start += OPENING_OPERATION_MAX_LINES) {
      const operation = await this.operations.createWithin(
        tx,
        organizationId,
        actor,
        {
          type: 'OPENING',
          note: 'Ürün içe aktarma: başlangıç stoku',
          items: items.slice(start, start + OPENING_OPERATION_MAX_LINES),
        },
        'IMPORT',
      );
      operationIds.push(operation.id);
    }
    return operationIds;
  }

  /** Dosyadaki SKU ve barkodlardan şirkette başka bir üründe kullanılanlar, satır ve alan bilgisiyle. */
  private async findConflicts(organizationId: string, rows: ProductImportRow[]): Promise<ProductImportRowError[]> {
    const barcodeFields = (row: ProductImportRow): { field: string; code: string }[] =>
      [
        { field: 'product.barcode', code: row.product.barcode },
        ...row.product.units.map((unit, index) => ({ field: `product.units.${index}.barcode`, code: unit.barcode })),
      ].flatMap(({ field, code }) => (code ? [{ field, code }] : []));

    const taken = await this.catalog.findTakenCodes(this.db, organizationId, {
      skus: rows.map((row) => row.product.sku),
      barcodes: rows.flatMap((row) => barcodeFields(row).map(({ code }) => code)),
    });
    return rows.flatMap((row) => [
      ...(taken.skus.has(row.product.sku)
        ? [{ row: row.row, field: 'product.sku', message: 'Bu SKU şirkette başka bir üründe kullanılıyor.' }]
        : []),
      ...barcodeFields(row)
        .filter(({ code }) => taken.barcodes.has(code))
        .map(({ field }) => ({ row: row.row, field, message: 'Bu barkod şirkette başka bir üründe kullanılıyor.' })),
    ]);
  }
}
