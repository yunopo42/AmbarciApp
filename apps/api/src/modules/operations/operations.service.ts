import type { Database, DbExecutor } from '@ambarci/db';
import { isZeroQuantity } from '@ambarci/shared';
import type {
  ActionSource,
  ConfirmOperationInput,
  ConfirmOperationResult,
  CreateOperationInput,
  Operation,
  OperationItem,
  OperationType,
  OrganizationRole,
} from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { postgresErrorOf } from '../../common/postgres-error.js';
import { DATABASE } from '../../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { ApplyStockService } from '../inventory/apply-stock.service.js';
import type { ApplyLine } from '../inventory/apply-stock.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { canTransition } from './operation-state.js';
import { OperationsRepository, toOperation } from './operations.repository.js';
import type { OperationRecord } from './operations.repository.js';

/**
 * İşlemi kim yapıyor: oturumdaki kullanıcı (rolü, OrganizationGuard'ın doğruladığı) ya da sistem (açılış stoğu
 * betiği). Şirket ve kullanıcı kimliği her zaman oturumdan gelir, istek gövdesinden alınmaz.
 */
export type OperationActor = { kind: 'user'; userId: string; role: OrganizationRole } | { kind: 'system' };

/** Kalem doğrulama hatası; 422 OPERATION_LINES_INVALID cevabının details listesine girer. */
export interface LineError {
  lineNo: number;
  field: 'productId' | 'unit' | 'quantity' | 'warehouseId' | 'targetWarehouseId';
  code: string;
  message: string;
}

/** Kalemin girildiği hâli (işlem açılırken ya da kayıtlı kalemden). */
type LineInput = OperationItem;

/** Doğrulanmış ve ana birime çevrilmiş kalem: hem kayda (girilen hâli) hem stok uygulamasına (ana birim) yeter. */
type ResolvedLine = LineInput & ApplyLine;

@Injectable()
export class OperationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OperationsRepository) private readonly repository: OperationsRepository,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(ApplyStockService) private readonly applyStock: ApplyStockService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /**
   * İşlemi onay bekleyen (PENDING_CONFIRMATION) olarak açar. Stok değişmez; stok yalnızca confirm ile değişir.
   * Kalemler burada doğrulanır (ürün, birim, depo, yetki) ki kullanıcı onay ekranına geçerli bir işlemle gelsin.
   */
  async create(
    organizationId: string,
    actor: OperationActor,
    input: CreateOperationInput,
    source: ActionSource = 'SCREEN',
  ): Promise<Operation> {
    const lines: LineInput[] = input.items.map((item, index) => ({
      lineNo: index + 1,
      productId: item.productId.toLowerCase(),
      warehouseId: item.warehouseId.toLowerCase(),
      targetWarehouseId: item.targetWarehouseId?.toLowerCase() ?? null,
      quantity: item.quantity,
      unit: item.unit ?? null,
      unitCost: item.unitCost ?? null,
    }));

    if (actor.kind === 'user') {
      await this.assertAccess(this.db, organizationId, actor.userId, input.type, lines);
    }
    const [resolved, warehouseErrors] = await Promise.all([
      this.resolveLines(this.db, organizationId, input.type, lines),
      this.checkWarehouses(organizationId, lines),
    ]);
    const errors = [...resolved.errors, ...warehouseErrors].sort((a, b) => a.lineNo - b.lineNo);
    if (errors.length > 0) {
      throw linesInvalid(errors);
    }
    const partyId = input.partyId?.toLowerCase() ?? null;
    if (partyId && !(await this.catalog.isActiveParty(this.db, organizationId, partyId))) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'PARTY_NOT_FOUND', 'Cari bulunamadı ya da pasif.');
    }

    return this.db.transaction(async (tx) => {
      const operation = await this.repository.insert(tx, {
        organizationId,
        type: input.type,
        source,
        partyId,
        note: input.note || null,
        createdBy: actorId(actor),
        items: resolved.lines.map(({ productId, warehouseId, targetWarehouseId, quantity, unit, unitCost }) => ({
          productId,
          warehouseId,
          targetWarehouseId,
          quantity,
          unit,
          unitCost,
        })),
      });
      await this.audit.record(tx, {
        organizationId,
        actorId: actorId(actor),
        action: 'operation.created',
        entityType: 'operation',
        entityId: operation.id,
        source,
        details: { type: operation.type, lineCount: operation.items.length },
      });
      return operation;
    });
  }

  async get(organizationId: string, operationId: string): Promise<Operation> {
    const operation = await this.repository.findById(this.db, organizationId, operationId);
    if (!operation) {
      throw operationNotFound();
    }
    return operation;
  }

  /**
   * Onay: stoğu değiştiren tek yol (mimari değişmez 2 ve 3). Hepsi tek transaction'da, şu sırayla:
   *   1. işlem satırını FOR UPDATE ile kilitle;
   *   2. durum, sürüm ve tekrar (Idempotency-Key) kontrolü;
   *   3. yetkiyi ve kalemleri kilit altında yeniden oku, ana birime çevir;
   *   4. stok satırlarını ürün kimliği sırasıyla kilitle, yeterliliği kontrol et, hareketleri ve maliyeti yaz;
   *   5. işlemi APPLIED yap; denetim ve outbox kaydını yaz.
   * Herhangi bir adımda hata olursa transaction'ın tamamı geri alınır.
   */
  async confirm(
    organizationId: string,
    actor: OperationActor,
    operationId: string,
    input: ConfirmOperationInput,
    idempotencyKey: string,
  ): Promise<ConfirmOperationResult> {
    return this.db.transaction(async (tx) => {
      // 1. Aynı işlem için aynı anda gelen ikinci onay burada bekler.
      const record = await this.repository.lockForUpdate(tx, organizationId, operationId);
      if (!record) {
        throw operationNotFound();
      }

      // 2. Durum, tekrar ve sürüm.
      if (record.status === 'APPLIED') {
        if (record.applyIdempotencyKey === idempotencyKey) {
          // Aynı istek tekrar geldi (ağ koptu, kullanıcı iki kez bastı): stok yeniden değişmez, ilk cevap döner.
          return this.replay(tx, organizationId, operationId);
        }
        throw new ApiException(HttpStatus.CONFLICT, 'OPERATION_ALREADY_APPLIED', 'Bu işlem zaten onaylanmış.');
      }
      if (!canTransition(record.status, 'APPLIED')) {
        throw new ApiException(HttpStatus.CONFLICT, 'OPERATION_NOT_PENDING', 'Bu işlem onay beklemiyor.', {
          status: record.status,
        });
      }
      if (record.version !== input.version) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'OPERATION_VERSION_MISMATCH',
          'İşlem siz görüntüledikten sonra değişmiş; güncel hâlini görüp yeniden onaylayın.',
          { currentVersion: record.version },
        );
      }

      // 3. Kalemler ve yetki, kilit altında yeniden.
      const items = await this.repository.listItems(tx, organizationId, operationId);
      if (actor.kind === 'user') {
        await this.assertAccess(tx, organizationId, actor.userId, record.type, items);
      }
      const resolved = await this.resolveLines(tx, organizationId, record.type, items);
      if (resolved.errors.length > 0) {
        throw linesInvalid(resolved.errors);
      }

      // 4. Stok: kilitler, yeterlilik, hareketler, maliyet.
      const movements = await this.applyStock.apply(tx, {
        organizationId,
        operationId,
        type: record.type,
        lines: resolved.lines,
      });

      // 5. Durum, denetim ve outbox.
      const applied = await this.markApplied(tx, organizationId, operationId, actorId(actor), idempotencyKey);
      await this.audit.record(tx, {
        organizationId,
        actorId: actorId(actor),
        action: 'operation.applied',
        entityType: 'operation',
        entityId: operationId,
        source: record.source,
        details: { type: record.type, version: record.version, movementCount: movements.length },
      });
      await this.outbox.enqueue(tx, {
        organizationId,
        eventType: 'operation.applied',
        // Worker (kritik stok kontrolü, bildirim) güncel miktarı kendisi okur; olay yalnızca neyin değiştiğini söyler.
        payload: {
          operationId,
          type: record.type,
          stock: movements.map(({ warehouseId, productId }) => ({ warehouseId, productId })),
        },
      });
      return { operation: toOperation(applied, items), movements };
    });
  }

  /** Onay bekleyen işlemi iptal eder. Yalnızca işlemi açan kişi ya da yönetici. Zaten iptalse aynı cevap döner. */
  async cancel(organizationId: string, actor: OperationActor, operationId: string): Promise<Operation> {
    return this.db.transaction(async (tx) => {
      const record = await this.repository.lockForUpdate(tx, organizationId, operationId);
      if (!record) {
        throw operationNotFound();
      }
      if (actor.kind === 'user' && actor.role !== 'ADMIN' && record.createdBy !== actor.userId) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'OPERATION_FORBIDDEN',
          'İşlemi yalnızca açan kişi ya da yönetici iptal edebilir.',
        );
      }
      const items = await this.repository.listItems(tx, organizationId, operationId);
      if (record.status === 'CANCELLED') {
        return toOperation(record, items);
      }
      if (!canTransition(record.status, 'CANCELLED')) {
        throw new ApiException(HttpStatus.CONFLICT, 'OPERATION_NOT_PENDING', 'Bu işlem onay beklemiyor.', {
          status: record.status,
        });
      }
      const cancelled = await this.repository.markCancelled(tx, organizationId, operationId);
      if (!cancelled) {
        throw new Error('Kilitli işlem iptal edilemedi.');
      }
      await this.audit.record(tx, {
        organizationId,
        actorId: actorId(actor),
        action: 'operation.cancelled',
        entityType: 'operation',
        entityId: operationId,
        source: record.source,
      });
      return toOperation(cancelled, items);
    });
  }

  /** Bu Idempotency-Key ile uygulanmış işlem (açılış betiği tekrar çalıştırıldığında ikinci kez açmamak için). */
  findIdByIdempotencyKey(organizationId: string, key: string): Promise<string | null> {
    return this.repository.findIdByIdempotencyKey(this.db, organizationId, key);
  }

  private async replay(tx: DbExecutor, organizationId: string, operationId: string): Promise<ConfirmOperationResult> {
    const operation = await this.repository.findById(tx, organizationId, operationId);
    if (!operation) {
      throw operationNotFound();
    }
    return { operation, movements: await this.applyStock.listMovements(tx, organizationId, operationId) };
  }

  private async markApplied(
    tx: DbExecutor,
    organizationId: string,
    operationId: string,
    appliedBy: string | null,
    idempotencyKey: string,
  ): Promise<OperationRecord> {
    try {
      const applied = await this.repository.markApplied(tx, organizationId, operationId, { appliedBy, idempotencyKey });
      if (!applied) {
        throw new Error('Kilitli işlem uygulandı olarak işaretlenemedi.');
      }
      return applied;
    } catch (error) {
      const { code, constraint } = postgresErrorOf(error);
      if (code === '23505' && constraint === 'operations_org_idempotency_key') {
        // Transaction geri alınır: stok değişikliği de kalmaz.
        throw new ApiException(
          HttpStatus.CONFLICT,
          'IDEMPOTENCY_KEY_REUSED',
          'Bu Idempotency-Key başka bir işlemin onayında kullanılmış.',
        );
      }
      throw error;
    }
  }

  /** Kullanıcının işlemdeki bütün depolarda yetkisi var mı; açılış stoğunu yalnızca yönetici girer. */
  private async assertAccess(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
    type: OperationType,
    lines: Pick<LineInput, 'warehouseId' | 'targetWarehouseId'>[],
  ): Promise<void> {
    const role = await this.organizations.assertOperationAccess(executor, organizationId, userId, warehousesOf(lines));
    if (type === 'OPENING' && role !== 'ADMIN') {
      throw new ApiException(HttpStatus.FORBIDDEN, 'ROLE_FORBIDDEN', 'Açılış stoğunu yalnızca yönetici girebilir.');
    }
  }

  /**
   * Kalemleri katalogla doğrular ve ana birime çevirir (çevrim SQL'de, catalog modülünde). Ana birimin adı
   * birim olarak verildiyse birim boş kaydedilir: product_units yalnızca ek birimleri tutar.
   */
  private async resolveLines(
    executor: DbExecutor,
    organizationId: string,
    type: OperationType,
    lines: LineInput[],
  ): Promise<{ lines: ResolvedLine[]; errors: LineError[] }> {
    const conversions = await this.catalog.convertToBaseUnits(executor, organizationId, lines);
    const errors: LineError[] = [];
    const resolved: ResolvedLine[] = [];
    lines.forEach((line, index) => {
      const conversion = conversions[index];
      if (!conversion || conversion.lineNo !== line.lineNo) {
        throw new Error('Birim çevrimi kalem sırasıyla dönmedi.');
      }
      if (!conversion.productFound) {
        errors.push({ lineNo: line.lineNo, field: 'productId', code: 'PRODUCT_NOT_FOUND', message: 'Ürün bulunamadı.' });
        return;
      }
      if (!conversion.productActive) {
        errors.push({ lineNo: line.lineNo, field: 'productId', code: 'PRODUCT_INACTIVE', message: 'Ürün pasif.' });
        return;
      }
      if (!conversion.unitFound) {
        errors.push({ lineNo: line.lineNo, field: 'unit', code: 'UNIT_NOT_FOUND', message: 'Ürünün bu birimi yok.' });
        return;
      }
      if (type !== 'COUNT' && isZeroQuantity(conversion.baseQuantity)) {
        errors.push({
          lineNo: line.lineNo,
          field: 'quantity',
          code: 'QUANTITY_TOO_SMALL',
          message: 'Miktar ana birime çevrilince sıfır oluyor.',
        });
        return;
      }
      resolved.push({
        ...line,
        unit: line.unit === conversion.baseUnit ? null : line.unit,
        baseQuantity: conversion.baseQuantity,
        baseUnitCost: conversion.baseUnitCost,
        unitFactor: conversion.unitFactor,
      });
    });
    return { lines: resolved, errors };
  }

  /** Depolar bu şirkette var ve aktif mi (işlem açılırken). Onayda aynı kontrol stok kilidiyle birlikte yapılır. */
  private async checkWarehouses(organizationId: string, lines: LineInput[]): Promise<LineError[]> {
    const statuses = await this.inventory.findWarehouseStatuses(this.db, organizationId, warehousesOf(lines));
    const statusOf = new Map(statuses.map((status) => [status.id, status.isActive]));
    const errors: LineError[] = [];
    for (const line of lines) {
      const fields = [['warehouseId', line.warehouseId] as const, ['targetWarehouseId', line.targetWarehouseId] as const];
      for (const [field, warehouseId] of fields) {
        if (!warehouseId) {
          continue;
        }
        const active = statusOf.get(warehouseId);
        if (active === undefined) {
          errors.push({ lineNo: line.lineNo, field, code: 'WAREHOUSE_NOT_FOUND', message: 'Depo bulunamadı.' });
        } else if (!active) {
          errors.push({ lineNo: line.lineNo, field, code: 'WAREHOUSE_INACTIVE', message: 'Depo pasif.' });
        }
      }
    }
    return errors;
  }
}

function actorId(actor: OperationActor): string | null {
  return actor.kind === 'user' ? actor.userId : null;
}

function warehousesOf(lines: Pick<LineInput, 'warehouseId' | 'targetWarehouseId'>[]): string[] {
  const ids = lines.flatMap((line) => (line.targetWarehouseId ? [line.warehouseId, line.targetWarehouseId] : [line.warehouseId]));
  return [...new Set(ids)];
}

function operationNotFound(): ApiException {
  // Başka şirketin işlemi de aynı cevabı alır: varlığı sızmaz.
  return new ApiException(HttpStatus.NOT_FOUND, 'OPERATION_NOT_FOUND', 'İşlem bulunamadı.');
}

function linesInvalid(errors: LineError[]): ApiException {
  return new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'OPERATION_LINES_INVALID',
    'İşlemin bazı kalemleri geçersiz.',
    errors,
  );
}
