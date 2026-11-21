import type { Database, DbExecutor } from '@ambarci/db';
import { CHAT_PROPOSAL_TTL_MINUTES, isZeroQuantity, REVERSAL_WINDOW_MINUTES } from '@ambarci/shared';
import type {
  ActionSource,
  ConfirmOperationInput,
  ConfirmOperationResult,
  CreateOperationInput,
  Movement,
  Operation,
  OperationItem,
  OperationList,
  OperationListQuery,
  OperationPreview,
  OperationType,
  OrganizationRole,
  StockEffect,
} from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { postgresErrorOf } from '../../common/postgres-error.js';
import { DATABASE } from '../../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { ApplyStockService } from '../inventory/apply-stock.service.js';
import type { ApplyLine, ReversalStep } from '../inventory/apply-stock.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { canTransition } from './operation-state.js';
import { OperationsRepository, toOperation } from './operations.repository.js';
import type { MessageOperation, OperationRecord } from './operations.repository.js';

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

/**
 * Transaction'ın "süresi doldu" sonucu. Hata transaction'ın içinden fırlatılsaydı EXPIRED geçişi de geri alınırdı;
 * geçiş yazılıp transaction tamamlanır, 409 ondan sonra döner.
 */
const EXPIRED_NOW = Symbol('expired');

/** İşlem açılırken isteğe bağlı bilgiler. */
export interface CreateOperationOptions {
  /** Yalnızca sohbetten (source: CHAT) açılan öneride: cevaplanan kullanıcı mesajı (#74). */
  sourceMessageId?: string | null;
}

/** Katalogla doğrulanmış içerik: kayda girecek cari, not ve kalemler. */
type OperationContent = { partyId: string | null; note: string | null; items: Omit<OperationItem, 'lineNo'>[] };

/** Sohbetten yeni öneri isteğinin sonucu (#79). */
export interface ChatProposal {
  operation: Operation;
  /** true: aynı mesajda aynı türde ve aynı kalemlerle onay bekleyen öneri vardı; yenisi açılmadı, o döndü. */
  reused: boolean;
}

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
    options: CreateOperationOptions = {},
  ): Promise<Operation> {
    // Yetki transaction'dan önce: yetkisiz istek veritabanında transaction açtırmaz.
    await this.assertCreateAccess(this.db, organizationId, actor, input.type, warehousesOf(linesOf(input.items)));
    return this.db.transaction((tx) => this.createWithin(tx, organizationId, actor, input, source, options));
  }

  /** Kullanıcı bu depolarda bu türde işlem açabilir mi; açılış stoğunu yalnızca yönetici girer. */
  async assertCreateAccess(
    executor: DbExecutor,
    organizationId: string,
    actor: OperationActor,
    type: OperationType,
    warehouseIds: string[],
  ): Promise<void> {
    if (actor.kind === 'user') {
      const lines = warehouseIds.map((warehouseId) => ({ warehouseId: warehouseId.toLowerCase(), targetWarehouseId: null }));
      await this.assertAccess(executor, organizationId, actor.userId, type, lines);
    }
  }

  /**
   * create'in açık bir transaction içinde çalışan hâli. Ürün içe aktarma, açılış işlemini ürünlerle aynı
   * transaction'da açar: doğrulama okumaları da bu transaction'dan yapılır, yoksa henüz kaydedilmemiş yeni ürünler
   * görünmezdi. Bir adım hata verirse çağıranın transaction'ı bütünüyle geri alınır. Yetkiyi çağıran önceden
   * denetler (assertCreateAccess).
   */
  async createWithin(
    executor: DbExecutor,
    organizationId: string,
    actor: OperationActor,
    input: CreateOperationInput,
    source: ActionSource,
    options: CreateOperationOptions = {},
  ): Promise<Operation> {
    const content = await this.validateContent(executor, organizationId, input);
    return this.insertValidated(executor, organizationId, actor, input.type, source, content, options);
  }

  /**
   * Sohbetten yeni öneri (#74; tekrar koruması #79). Model aynı isteği birden fazla kez gönderebilir: telefondaki kapı
   * denemesinde tek "fire yaz" mesajından dört ayrı fire önerisi açıldı ve dördü de onaylanabildi. Bu yüzden aynı
   * mesajdan, aynı türde ve aynı kalemlerle (ürün, depo, hedef depo, miktar, birim, birim maliyet) onay bekleyen bir
   * öneri varsa yenisi açılmaz, o döner. Kalemleri farklı öneriler (ör. aynı mesajda iki ayrı depoya giriş) ayrı ayrı
   * açılır. Aynı mesajın öneri istekleri bir kilitle sıraya girer: modelin aynı turdaki paralel iki çağrısı da tek
   * öneri açar.
   */
  async proposeFromChat(
    organizationId: string,
    actor: Extract<OperationActor, { kind: 'user' }>,
    input: CreateOperationInput,
    sourceMessageId: string,
  ): Promise<ChatProposal> {
    await this.assertCreateAccess(this.db, organizationId, actor, input.type, warehousesOf(linesOf(input.items)));
    return this.db.transaction(async (tx) => {
      await this.repository.lockChatProposals(tx, sourceMessageId);
      const content = await this.validateContent(tx, organizationId, input);
      const open = await this.repository.listOpenChatProposals(tx, organizationId, sourceMessageId, input.type);
      const same = open.find((operation) => sameItems(operation.items, content.items));
      if (same) {
        return { operation: same, reused: true };
      }
      const operation = await this.insertValidated(tx, organizationId, actor, input.type, 'CHAT', content, {
        sourceMessageId,
      });
      return { operation, reused: false };
    });
  }

  /** Doğrulanmış içerikle işlemi ekler ve açılışın denetim kaydını yazar (create ve proposeFromChat ortak adımı). */
  private async insertValidated(
    executor: DbExecutor,
    organizationId: string,
    actor: OperationActor,
    type: CreateOperationInput['type'],
    source: ActionSource,
    content: OperationContent,
    options: CreateOperationOptions,
  ): Promise<Operation> {
    const operation = await this.repository.insert(executor, {
      organizationId,
      type,
      source,
      createdBy: actorId(actor),
      sourceMessageId: options.sourceMessageId ?? null,
      ...content,
    });
    await this.audit.record(executor, {
      organizationId,
      actorId: actorId(actor),
      action: 'operation.created',
      entityType: 'operation',
      entityId: operation.id,
      source,
      details: { type: operation.type, lineCount: operation.items.length },
    });
    return operation;
  }

  /**
   * Sohbetten açılmış, onay bekleyen öneriyi düzenler (kartın "Düzenle"si sohbetle yapılır, #74). Kalemler ve cari
   * baştan yazılır, sürüm bir artar; stok değişmez. Kullanıcı eski sürümü onaylamaya çalışırsa onay
   * OPERATION_VERSION_MISMATCH ile reddedilir. Yalnızca öneriyi açan kullanıcı ve yalnızca aynı tür: tür değişecekse
   * öneri iptal edilip yenisi açılır. İşlem satırı kilitlenir; aynı anda gelen onay ya da iptal sırayla karar verir.
   */
  async revise(
    organizationId: string,
    actor: Extract<OperationActor, { kind: 'user' }>,
    operationId: string,
    input: CreateOperationInput,
    options: CreateOperationOptions = {},
  ): Promise<Operation> {
    await this.assertCreateAccess(this.db, organizationId, actor, input.type, warehousesOf(linesOf(input.items)));
    const outcome = await this.db.transaction(async (tx): Promise<Operation | typeof EXPIRED_NOW> => {
      const record = await this.repository.lockForUpdate(tx, organizationId, operationId);
      if (!record) {
        throw operationNotFound();
      }
      if (record.source !== 'CHAT' || record.createdBy !== actor.userId) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'OPERATION_FORBIDDEN',
          'Yalnızca sohbette kendi açtığın öneri düzenlenebilir.',
        );
      }
      // Süresi dolmuş öneri düzenlenerek yeniden canlandırılmaz: yeni öneri açılır.
      if (record.expired) {
        await this.expire(tx, organizationId, record);
        return EXPIRED_NOW;
      }
      if (record.status !== 'PENDING_CONFIRMATION') {
        throw new ApiException(HttpStatus.CONFLICT, 'OPERATION_NOT_PENDING', 'Bu işlem onay beklemiyor; düzenlenemez.', {
          status: record.status,
        });
      }
      if (record.type !== input.type) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'OPERATION_TYPE_MISMATCH',
          'Önerinin türü değiştirilemez; bu öneri iptal edilip yeni bir öneri açılmalı.',
          { type: record.type },
        );
      }
      const content = await this.validateContent(tx, organizationId, input);
      // Kart, önerinin son hâlini üreten turun altında durur (#75): bağ düzenlemeyi isteyen mesaja taşınır. İlk mesaj
      // ve her düzenleme denetim kaydında kalır.
      const revised = await this.repository.revise(tx, organizationId, operationId, {
        ...content,
        ...(options.sourceMessageId ? { sourceMessageId: options.sourceMessageId } : {}),
      });
      if (!revised) {
        throw new Error('Kilitli işlem düzenlenemedi.');
      }
      await this.audit.record(tx, {
        organizationId,
        actorId: actor.userId,
        action: 'operation.revised',
        entityType: 'operation',
        entityId: operationId,
        source: record.source,
        details: { type: revised.type, version: revised.version, lineCount: revised.items.length },
      });
      return revised;
    });
    if (outcome === EXPIRED_NOW) {
      throw proposalExpired();
    }
    return outcome;
  }

  /**
   * Geri alma isteği (#78, mimari değişmez 7): uygulanmış işlem için ters kalemli, onay bekleyen bir REVERSAL açar.
   * Stok burada değişmez; ters kayıt da onay ucundan geçer (Idempotency-Key, kilit sırası, önizleme, yetersiz stok
   * aynı koddan gelir). İşlemin onay bekleyen ters kaydı varsa yenisi açılmaz, o döner.
   *
   * Kurallar: yalnızca uygulanmış işlem; ters kayıt geri alınmaz; işlemi açan kullanıcı uygulandıktan sonraki 15 dakika
   * içinde, yönetici her zaman; açılışı yalnızca yönetici. Kurallar burada ve onayda, işlem kilitliyken denetlenir.
   *
   * Kilitler: istek geri alınacak işlemi kilitler; ters kaydı yalnızca süresi dolmuşsa (EXPIRED yazmak için). Onay
   * ters kaydı, sonra geri alınan işlemi kilitler; ama süresi dolmuş ters kaydın onayı ikinci kilide gelmeden döner.
   * Böylece ikisi birbirinin tuttuğu kilidi beklemez.
   */
  async requestReversal(
    organizationId: string,
    actor: Extract<OperationActor, { kind: 'user' }>,
    operationId: string,
  ): Promise<{ operation: Operation; created: boolean }> {
    return this.db.transaction(async (tx) => {
      // Aynı işlem için aynı anda gelen iki istek burada sıraya girer; ikincisi birincinin açtığı ters kaydı bulur.
      const original = await this.repository.lockForUpdate(tx, organizationId, operationId);
      if (!original) {
        throw operationNotFound();
      }
      const items = await this.repository.listItems(tx, organizationId, operationId);
      // Açılacak işlem bir ters kayıttır: depo yetkisi onun depolarında aranır. Açılışın "yalnızca yönetici" kuralını
      // geri alma kuralı ayrıca ve kendi mesajıyla uygular (reversalDenial).
      await this.assertAccess(tx, organizationId, actor.userId, 'REVERSAL', items);
      const denial = reversalDenial(actor, original);
      if (denial) {
        throw denial;
      }

      let active = await this.repository.findActiveReversal(tx, organizationId, operationId);
      if (active?.expired) {
        // Süresi dolmuş (sohbetten açılmış) ters kayıt: kalıcı olarak EXPIRED olur, yerine yenisi açılır.
        const locked = await this.repository.lockForUpdate(tx, organizationId, active.id);
        if (locked?.expired) {
          await this.expire(tx, organizationId, locked);
        }
        active = await this.repository.findActiveReversal(tx, organizationId, operationId);
      }
      if (active?.status === 'PENDING_CONFIRMATION') {
        return { operation: toOperation(active, await this.repository.listItems(tx, organizationId, active.id)), created: false };
      }
      if (active) {
        // Uygulanmış ters kaydı olan işlem REVERSED olurdu (yukarıda reddedilirdi); buraya gelinirse veri tutarsızdır.
        throw alreadyReversed();
      }

      const reversalLines = reversalItemsOf(items, await this.inventory.listMovements(tx, organizationId, operationId));
      if (reversalLines.length === 0) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'NOTHING_TO_REVERSE',
          'Bu işlem stoğu değiştirmediği için geri alınacak bir şey yok.',
        );
      }
      const operation = await this.repository.insertReversal(tx, {
        organizationId,
        source: 'SCREEN',
        createdBy: actor.userId,
        reversedOperationId: operationId,
        items: reversalLines,
      });
      await this.audit.record(tx, {
        organizationId,
        actorId: actor.userId,
        action: 'operation.created',
        entityType: 'operation',
        entityId: operation.id,
        source: 'SCREEN',
        details: { type: 'REVERSAL', reversedOperationId: operationId, lineCount: operation.items.length },
      });
      return { operation, created: true };
    });
  }

  /**
   * Süresi dolmuş sohbet önerisini kalıcı olarak EXPIRED yapar ve denetim kaydını yazar (çağıran işlemi kilitlemiştir).
   * Süre aşımını kimse "yapmaz": kayıttaki kişi boştur, sistemin kararıdır.
   */
  private async expire(tx: DbExecutor, organizationId: string, record: OperationRecord): Promise<void> {
    const expired = await this.repository.markExpired(tx, organizationId, record.id);
    if (!expired) {
      throw new Error('Kilitli işlem süresi dolmuş olarak işaretlenemedi.');
    }
    await this.audit.record(tx, {
      organizationId,
      actorId: null,
      action: 'operation.expired',
      entityType: 'operation',
      entityId: record.id,
      source: record.source,
      details: { type: record.type, version: record.version },
    });
  }

  /**
   * İşlemin içeriğini (kalemler ve cari) katalogla doğrular: ürün, birim, depo ve cari bu şirkette var ve aktif mi.
   * İşlem açılırken ve öneri düzenlenirken aynı kurallar geçerlidir.
   */
  private async validateContent(
    executor: DbExecutor,
    organizationId: string,
    input: CreateOperationInput,
  ): Promise<OperationContent> {
    const lines = linesOf(input.items);
    const resolved = await this.resolveLines(executor, organizationId, input.type, lines);
    const warehouseErrors = await this.checkWarehouses(executor, organizationId, lines);
    const errors = [...resolved.errors, ...warehouseErrors].sort((a, b) => a.lineNo - b.lineNo);
    if (errors.length > 0) {
      throw linesInvalid(errors);
    }
    const partyId = input.partyId?.toLowerCase() ?? null;
    if (partyId && !(await this.catalog.isActiveParty(executor, organizationId, partyId))) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'PARTY_NOT_FOUND', 'Cari bulunamadı ya da pasif.');
    }
    return {
      partyId,
      note: input.note || null,
      items: resolved.lines.map(({ productId, warehouseId, targetWarehouseId, quantity, unit, unitCost }) => ({
        productId,
        warehouseId,
        targetWarehouseId,
        quantity,
        unit,
        unitCost,
      })),
    };
  }

  /**
   * İşlemler, en yeni önce; varsayılan yalnızca onay bekleyenler (ekrandan açılıp bırakılan fiş, içe aktarmanın
   * açılış işlemi). Çalışan yalnızca bütün depolarında yetkili olduğu işlemleri görür; açılış stoğunu yalnızca
   * yönetici girdiği için açılış işlemlerini de görmez. Böylece listedeki her işlemin özeti açılabilir.
   */
  /**
   * İşlem listesi ve onay kuyruğu (#87). Çalışan yalnızca bütün depolarında yetkili olduğu işlemleri görür ve açılış
   * işlemlerini görmez (onaylayamayacağı işlem kuyruğunda durmasın). Depo adları inventory, açan kişinin e-postası
   * organizations modülünün servisinden okunur (modül sınırı).
   */
  async list(organization: OrganizationContext, query: OperationListQuery): Promise<OperationList> {
    const warehouseIds = await this.organizations.visibleWarehouseIds(organization);
    const { items, total } = await this.repository.listSummaries(this.db, organization.id, {
      status: query.status,
      warehouseIds,
      excludeTypes: organization.role === 'ADMIN' ? [] : ['OPENING'],
      type: query.type,
      source: query.source,
      warehouseId: query.warehouseId?.toLowerCase(),
      page: query.page,
      pageSize: query.pageSize,
    });
    const ids = [...new Set(items.flatMap((item) => item.warehouseIds))];
    const creatorIds = items.flatMap((item) => (item.createdBy ? [item.createdBy] : []));
    const [statuses, emailOf] = await Promise.all([
      ids.length > 0 ? this.inventory.findWarehouseStatuses(this.db, organization.id, ids) : Promise.resolve([]),
      this.organizations.memberEmails(organization.id, creatorIds),
    ]);
    const nameOf = new Map(statuses.map((warehouse) => [warehouse.id, warehouse.name]));
    return {
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        status: item.status,
        source: item.source,
        version: item.version,
        createdBy: item.createdBy ? { userId: item.createdBy, email: emailOf.get(item.createdBy) ?? null } : null,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        lineCount: item.lineCount,
        warehouses: item.warehouseIds.map((id) => ({ id, name: nameOf.get(id) ?? '' })),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(organizationId: string, operationId: string): Promise<Operation> {
    const operation = await this.repository.findById(this.db, organizationId, operationId);
    if (!operation) {
      throw operationNotFound();
    }
    return operation;
  }

  /**
   * Onay ekranının özeti: kalemler ürün ve depo adlarıyla, ana birim karşılıkları ve (onay bekleyen işlemde)
   * stoğun önce → sonra hâli. Çevrim ve stok hesabı SQL'de; stok kilitlenmez ve değişmez. Özet, işlemi
   * onaylayabilecek kullanıcıya gösterilir: depo yetkisi işlem açılırken ve onaydakiyle aynı kuralla denetlenir.
   */
  async preview(organizationId: string, actor: OperationActor, operationId: string): Promise<OperationPreview> {
    const record = await this.repository.findRecord(this.db, organizationId, operationId);
    if (!record) {
      throw operationNotFound();
    }
    const operation = toOperation(record, await this.repository.listItems(this.db, organizationId, operationId));
    if (actor.kind === 'user') {
      await this.assertAccess(this.db, organizationId, actor.userId, operation.type, operation.items);
    }
    const [conversions, warehouses, partyName] = await Promise.all([
      this.catalog.convertToBaseUnits(this.db, organizationId, operation.items),
      this.inventory.findWarehouseStatuses(this.db, organizationId, warehousesOf(operation.items)),
      operation.partyId ? this.catalog.findPartyName(this.db, organizationId, operation.partyId) : Promise.resolve(null),
    ]);
    const warehouseNames = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]));
    const warehouseRef = (id: string): { id: string; name: string } => {
      const name = warehouseNames.get(id);
      if (name === undefined) {
        throw new Error(`İşlemin deposu bulunamadı (${id}).`);
      }
      return { id, name };
    };

    const lines = operation.items.map((item, index) => {
      const conversion = conversions[index];
      if (!conversion || conversion.lineNo !== item.lineNo || conversion.sku === null || conversion.productName === null) {
        throw new Error(`İşlem kaleminin ürünü bulunamadı (kalem ${item.lineNo}).`);
      }
      return { item, conversion, sku: conversion.sku, productName: conversion.productName };
    });
    // Onaylanmış ya da iptal edilmiş işlemde "önce → sonra" anlamsızdır: stok o işlemden sonra da değişmiştir. Süresi
    // dolmuş öneri de (durumu EXPIRED görünür) onaylanamayacağı için hesaplanmaz. Ters kaydın etkisi kalemlerinden
    // değil, geri aldığı işlemin hareketlerinden hesaplanır (onaydaki gibi).
    let effects: Map<string, StockEffect> | null = null;
    if (operation.status === 'PENDING_CONFIRMATION') {
      effects =
        operation.type === 'REVERSAL' && operation.reversedOperationId
          ? await this.inventory.previewReversal(
              this.db,
              organizationId,
              reversalStepsOf(
                await this.inventory.listMovements(this.db, organizationId, operation.reversedOperationId),
                operation.items,
              ),
            )
          : await this.inventory.previewStock(
              this.db,
              organizationId,
              operation.type,
              lines.map(({ item, conversion }) => ({
                lineNo: item.lineNo,
                productId: item.productId,
                warehouseId: item.warehouseId,
                targetWarehouseId: item.targetWarehouseId,
                baseQuantity: conversion.baseQuantity,
              })),
            );
    }

    // Geri alma (#78): işlemin etkin ters kaydı ve isteyen kullanıcının şimdi geri alıp alamayacağı.
    const active = operation.type === 'REVERSAL' ? null : await this.repository.findActiveReversal(this.db, organizationId, operationId);
    const reversal = active && !active.expired ? { operationId: active.id, status: active.status } : null;
    const canReverse = actor.kind === 'user' && reversal === null && reversalDenial(actor, record) === null;
    const reversibleUntil =
      canReverse && actor.kind === 'user' && actor.role !== 'ADMIN' && record.appliedAt
        ? new Date(record.appliedAt.getTime() + REVERSAL_WINDOW_MINUTES * 60_000).toISOString()
        : null;

    return {
      operationId: operation.id,
      type: operation.type,
      status: operation.status,
      version: operation.version,
      partyId: operation.partyId,
      partyName,
      note: operation.note,
      createdAt: operation.createdAt,
      expiresAt: operation.expiresAt,
      reversedOperationId: operation.reversedOperationId,
      reversal,
      canReverse,
      reversibleUntil,
      lines: lines.map(({ item, conversion, sku, productName }) => ({
        lineNo: item.lineNo,
        productId: item.productId,
        sku,
        productName,
        baseUnit: conversion.baseUnit ?? '',
        quantity: item.quantity,
        unit: item.unit,
        baseQuantity: conversion.baseQuantity,
        unitCost: item.unitCost,
        warehouse: warehouseRef(item.warehouseId),
        targetWarehouse: item.targetWarehouseId ? warehouseRef(item.targetWarehouseId) : null,
        stock: effects?.get(`${item.lineNo}:source`) ?? null,
        targetStock: item.targetWarehouseId ? (effects?.get(`${item.lineNo}:target`) ?? null) : null,
      })),
    };
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
    const outcome = await this.db.transaction(async (tx): Promise<ConfirmOperationResult | typeof EXPIRED_NOW> => {
      // 1. Aynı işlem için aynı anda gelen ikinci onay burada bekler.
      const record = await this.repository.lockForUpdate(tx, organizationId, operationId);
      if (!record) {
        throw operationNotFound();
      }

      // 2. Durum, süre, tekrar ve sürüm.
      if (record.status === 'APPLIED') {
        if (record.applyIdempotencyKey === idempotencyKey) {
          // Aynı istek tekrar geldi (ağ koptu, kullanıcı iki kez bastı): stok yeniden değişmez, ilk cevap döner.
          return this.replay(tx, organizationId, operationId);
        }
        throw new ApiException(HttpStatus.CONFLICT, 'OPERATION_ALREADY_APPLIED', 'Bu işlem zaten onaylanmış.');
      }
      // Sohbet önerisinin süresi kilit altında, veritabanının saatiyle denetlenir (mimari değişmez 3: süre).
      if (record.expired) {
        await this.expire(tx, organizationId, record);
        return EXPIRED_NOW;
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

      // 4. Stok: kilitler, yeterlilik, hareketler, maliyet. Ters kayıt geri aldığı işlemin hareketlerinden çalışır.
      const movements =
        record.type === 'REVERSAL'
          ? await this.applyReversal(tx, organizationId, actor, record, items)
          : await this.applyLines(tx, organizationId, record, items);

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
    if (outcome === EXPIRED_NOW) {
      throw proposalExpired();
    }
    return outcome;
  }

  /**
   * Onay bekleyen işlemi iptal eder. Yalnızca işlemi açan kişi ya da yönetici. Zaten iptalse aynı cevap döner. Süresi
   * dolmuş sohbet önerisi iptal edilmez, kalıcı olarak EXPIRED olur (409 OPERATION_EXPIRED): ikisinde de stok değişmez.
   */
  async cancel(organizationId: string, actor: OperationActor, operationId: string): Promise<Operation> {
    const outcome = await this.db.transaction(async (tx): Promise<Operation | typeof EXPIRED_NOW> => {
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
      if (record.expired) {
        await this.expire(tx, organizationId, record);
        return EXPIRED_NOW;
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
    if (outcome === EXPIRED_NOW) {
      throw proposalExpired();
    }
    return outcome;
  }

  /** Mesajların açtığı işlemler: sohbet geçmişindeki kartlar (#75). Mesajların sahipliğini çağıran denetler. */
  listBySourceMessages(organizationId: string, messageIds: string[]): Promise<MessageOperation[]> {
    return this.repository.listBySourceMessages(this.db, organizationId, messageIds);
  }

  /** Bu Idempotency-Key ile uygulanmış işlem (açılış betiği tekrar çalıştırıldığında ikinci kez açmamak için). */
  findIdByIdempotencyKey(organizationId: string, key: string): Promise<string | null> {
    return this.repository.findIdByIdempotencyKey(this.db, organizationId, key);
  }

  /** Onayın stok adımı (ters kayıt dışındaki türler): kalemler ana birime çevrilir ve sırayla uygulanır. */
  private async applyLines(
    tx: DbExecutor,
    organizationId: string,
    record: OperationRecord,
    items: OperationItem[],
  ): Promise<Movement[]> {
    const resolved = await this.resolveLines(tx, organizationId, record.type, items);
    if (resolved.errors.length > 0) {
      throw linesInvalid(resolved.errors);
    }
    return this.applyStock.apply(tx, { organizationId, operationId: record.id, type: record.type, lines: resolved.lines });
  }

  /**
   * Ters kaydın onayındaki stok adımı (#78), onay transaction'ının içinde:
   *   1. geri alınan işlemi kilitle (ters kayıt zaten kilitli);
   *   2. işlem hâlâ uygulanmış mı, onaylayan geri alabilir mi (15 dakika, açılış): kilit altında yeniden;
   *   3. işlemin hareketlerini tersten, aynı birim maliyetle uygula (stok satırı kilitleri onaydaki sırayla);
   *   4. işlemi APPLIED → REVERSED yap ve denetim kaydını yaz.
   * Ters kaydın kendi APPLIED geçişi, denetim ve outbox kaydı onayın ortak adımlarındadır.
   */
  private async applyReversal(
    tx: DbExecutor,
    organizationId: string,
    actor: OperationActor,
    record: OperationRecord,
    items: OperationItem[],
  ): Promise<Movement[]> {
    if (!record.reversedOperationId) {
      throw new Error('Ters kaydın geri aldığı işlem yok.');
    }
    const original = await this.repository.lockForUpdate(tx, organizationId, record.reversedOperationId);
    if (!original) {
      throw operationNotFound();
    }
    const denial = reversalDenial(actor, original);
    if (denial) {
      throw denial;
    }
    const steps = reversalStepsOf(await this.inventory.listMovements(tx, organizationId, original.id), items);
    const movements = await this.applyStock.reverse(tx, { organizationId, operationId: record.id, steps });

    const reversed = await this.repository.markReversed(tx, organizationId, original.id);
    if (!reversed) {
      throw new Error('Kilitli işlem geri alındı olarak işaretlenemedi.');
    }
    await this.audit.record(tx, {
      organizationId,
      actorId: actorId(actor),
      action: 'operation.reversed',
      entityType: 'operation',
      entityId: original.id,
      source: record.source,
      details: { type: original.type, reversalOperationId: record.id },
    });
    return movements;
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
  private async checkWarehouses(executor: DbExecutor, organizationId: string, lines: LineInput[]): Promise<LineError[]> {
    const statuses = await this.inventory.findWarehouseStatuses(executor, organizationId, warehousesOf(lines));
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

/** İstekteki kalemler, kalem numarasıyla ve küçük harfli kimliklerle. */
function linesOf(items: CreateOperationInput['items']): LineInput[] {
  return items.map((item, index) => ({
    lineNo: index + 1,
    productId: item.productId.toLowerCase(),
    warehouseId: item.warehouseId.toLowerCase(),
    targetWarehouseId: item.targetWarehouseId?.toLowerCase() ?? null,
    quantity: item.quantity,
    unit: item.unit ?? null,
    unitCost: item.unitCost ?? null,
  }));
}

/**
 * Kayıtlı kalemler istenenlerle sırasıyla aynı mı: ürün, depo, hedef depo, birim, miktar ve birim maliyet (#79).
 * Ana birim adıyla verilen birim doğrulamada boşa çevrildiği için "adet" ile birimsiz istek aynı sayılır.
 */
function sameItems(saved: OperationItem[], requested: Omit<OperationItem, 'lineNo'>[]): boolean {
  return (
    saved.length === requested.length &&
    saved.every((item, index) => {
      const other = requested[index];
      return (
        other !== undefined &&
        item.productId === other.productId &&
        item.warehouseId === other.warehouseId &&
        item.targetWarehouseId === other.targetWarehouseId &&
        item.unit === other.unit &&
        sameDecimal(item.quantity, other.quantity) &&
        sameDecimal(item.unitCost, other.unitCost)
      );
    })
  );
}

/**
 * Veritabanı miktarı "1.000", istek "1" diye yazar; ikisi aynı miktardır. Sayıya çevrilmez (ADR-003): kesirdeki
 * sondaki sıfırlar ve tam kısmın baştaki sıfırları atılıp metinler karşılaştırılır.
 */
function sameDecimal(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : canonicalDecimal(a) === canonicalDecimal(b);
}

function canonicalDecimal(value: string): string {
  const [whole = '', fraction = ''] = value.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const digits = fraction.replace(/0+$/, '');
  return digits ? `${integer}.${digits}` : integer;
}

/**
 * Geri alma kuralı (#78); geri alınabiliyorsa null, yoksa nedenini anlatan hata. İstekte, onayda (kilit altında) ve
 * önizlemede ("Geri al" düğmesi) aynı fonksiyon kullanılır. Süre veritabanının saatiyle okunmuş alandan gelir.
 */
export function reversalDenial(
  actor: OperationActor,
  record: Pick<OperationRecord, 'type' | 'status' | 'createdBy' | 'withinReversalWindow'>,
): ApiException | null {
  if (record.type === 'REVERSAL') {
    return new ApiException(HttpStatus.CONFLICT, 'OPERATION_NOT_REVERSIBLE', 'Ters kayıt geri alınamaz.');
  }
  if (record.status === 'REVERSED') {
    return alreadyReversed();
  }
  if (record.status !== 'APPLIED') {
    return new ApiException(HttpStatus.CONFLICT, 'OPERATION_NOT_REVERSIBLE', 'Yalnızca uygulanmış işlem geri alınabilir.', {
      status: record.status,
    });
  }
  if (actor.kind === 'system' || actor.role === 'ADMIN') {
    return null;
  }
  if (record.type === 'OPENING') {
    return new ApiException(HttpStatus.FORBIDDEN, 'REVERSAL_FORBIDDEN', 'Açılış stoğunu yalnızca yönetici geri alabilir.');
  }
  if (record.createdBy !== actor.userId) {
    return new ApiException(
      HttpStatus.FORBIDDEN,
      'REVERSAL_FORBIDDEN',
      'İşlemi yalnızca açan kişi geri alabilir; yönetici her işlemi geri alabilir.',
    );
  }
  if (!record.withinReversalWindow) {
    return new ApiException(
      HttpStatus.FORBIDDEN,
      'REVERSAL_WINDOW_PASSED',
      `İşlem uygulanalı ${REVERSAL_WINDOW_MINUTES} dakikadan fazla oldu; artık yalnızca yönetici geri alabilir.`,
    );
  }
  return null;
}

function alreadyReversed(): ApiException {
  return new ApiException(HttpStatus.CONFLICT, 'OPERATION_ALREADY_REVERSED', 'Bu işlem zaten geri alınmış.');
}

/** Hareket miktarının işaretsiz hâli ("-5.000" → "5.000"); sayıya çevrilmez (ADR-003). */
function magnitude(quantityChange: string): string {
  return quantityChange.replace(/^[-+]/, '');
}

/**
 * Ters kaydın kalemleri (#78): geri alınan işlemin stok değiştiren her kalemi için, aynı kalem numarasıyla ve ana
 * birimde, o kalemin kaynak deposundaki hareketin büyüklüğü. Sayımda bu, sayılan miktar değil sayım farkıdır; farkı
 * çıkmayan sayım kalemi stoğu değiştirmediği için atlanır.
 */
export function reversalItemsOf(items: OperationItem[], movements: Pick<Movement, 'lineNo' | 'warehouseId' | 'quantityChange'>[]): OperationItem[] {
  return items.flatMap((item): OperationItem[] => {
    const own = movements.filter((movement) => movement.lineNo === item.lineNo);
    const source = own.find((movement) => movement.warehouseId === item.warehouseId) ?? own[0];
    if (!source) {
      return [];
    }
    return [
      {
        lineNo: item.lineNo,
        productId: item.productId,
        warehouseId: item.warehouseId,
        targetWarehouseId: item.targetWarehouseId,
        quantity: magnitude(source.quantityChange),
        unit: null,
        unitCost: null,
      },
    ];
  });
}

/**
 * Ters kaydın uygulama adımları: geri alınan hareketler tersten (son yazılan önce geri alınır). Aynı stok satırına
 * birden çok hareket düştüyse ortalama maliyet, hareketler sırayla geri sarılır gibi eski değerine döner. Her adım,
 * ters kaydın aynı numaralı kalemine ve kaynak ya da hedef tarafına bağlanır.
 */
export function reversalStepsOf(
  movements: Pick<Movement, 'lineNo' | 'warehouseId' | 'productId' | 'quantityChange' | 'unitCost'>[],
  reversalItems: Pick<OperationItem, 'lineNo' | 'warehouseId'>[],
): ReversalStep[] {
  return [...movements].reverse().map((movement) => {
    const item = reversalItems.find((candidate) => candidate.lineNo === movement.lineNo);
    if (!item) {
      throw new Error(`Ters kayıtta ${movement.lineNo}. kalem yok.`);
    }
    return {
      lineNo: movement.lineNo,
      side: movement.warehouseId === item.warehouseId ? 'source' : 'target',
      warehouseId: movement.warehouseId,
      productId: movement.productId,
      originalChange: movement.quantityChange,
      unitCost: movement.unitCost,
    };
  });
}

function actorId(actor: OperationActor): string | null {
  return actor.kind === 'user' ? actor.userId : null;
}

function warehousesOf(lines: Pick<LineInput, 'warehouseId' | 'targetWarehouseId'>[]): string[] {
  const ids = lines.flatMap((line) => (line.targetWarehouseId ? [line.warehouseId, line.targetWarehouseId] : [line.warehouseId]));
  return [...new Set(ids)];
}

function proposalExpired(): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'OPERATION_EXPIRED',
    `Önerinin süresi doldu (${CHAT_PROPOSAL_TTL_MINUTES} dakika); stok değişmedi. Yeni bir öneri açılmalı.`,
  );
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
