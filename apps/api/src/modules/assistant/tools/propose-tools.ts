import {
  createOperationSchema,
  formatDecimal,
  OPERATION_STATUS_LABELS,
  OPERATION_TYPE_LABELS,
  proposeCountToolInputSchema,
  proposeStockInToolInputSchema,
  proposeStockOutToolInputSchema,
  proposeTransferToolInputSchema,
  proposeWasteToolInputSchema,
} from '@ambarci/shared';
import type { CreatableOperationType, CreateOperationInput, OperationPreview, OperationPreviewLine } from '@ambarci/shared';
import { HttpStatus } from '@nestjs/common';
import type { z } from 'zod';

import { ApiException } from '../../../common/api-exception.js';
import type { CatalogService } from '../../catalog/catalog.service.js';
import type { LineError, OperationActor, OperationsService } from '../../operations/operations.service.js';
import { defineTool } from './registry.js';
import type { RegisteredTool, ToolContext } from './registry.js';

// Asistanın öneri araçları (5. hafta, #74). Hiçbiri stoğa yazmaz (mimari değişmez 1): işlemi 3. haftanın
// OperationsService.create yoluyla onay bekleyen (PENDING_CONFIRMATION, kaynak CHAT) olarak açar ya da aynı sohbette
// açılmış öneriyi düzenler. Stok yalnızca kullanıcı kartta "Onayla"ya basınca, onay uç noktasında değişir; o uç asistan
// modülünden çağrılmaz (mimari değişmez 2).
//
// Ürün, birim, depo, cari ve depo yetkisi ekrandaki işlem formuyla aynı kurallarla denetlenir: araç girdisi işlem
// şemasına (createOperationSchema) çevrilir ve aynı servisten geçer. Şirket ve kullanıcı oturumdan gelir (değişmez 5).

const EVERY_ROLE = ['ADMIN', 'EMPLOYEE'] as const;

/** Modele dönen son adım: öneri kartta onay bekler, model onaylandı demez. */
const NEXT_STEP =
  "Öneri onay bekliyor; stok henüz değişmedi. Kullanıcıya kartı kontrol edip Onayla'ya basmasını söyle.";

/**
 * Stok yetmeyen kalemde son adım. Onay INSUFFICIENT_STOCK ile reddedilir ve stok eksiye düşmez (veritabanında
 * CHECK). #74 denemesinde model "onaylanırsa stok −5 adet olur" demişti; eksi değer modele artık hiç verilmez.
 */
const NEXT_STEP_INSUFFICIENT =
  'Stok yetmeyen kalem var: öneri bu hâliyle onaylanamaz, onay reddedilir ve stok eksiye düşmez. Stok henüz değişmedi. Kullanıcıya eldeki miktarı söyle; miktarı düşürmek, başka depodan transfer etmek ya da öneriyi kartta iptal etmek isteyip istemediğini sor.';

export interface ProposeToolServices {
  operations: OperationsService;
  catalog: CatalogService;
}

interface ProposalSpec<TInput extends { operation_id?: string | undefined }> {
  name: string;
  type: CreatableOperationType;
  description: string;
  statusLabel: string;
  input: z.ZodType<TInput>;
  /** Araç girdisinden işlem isteği (POST /v1/operations ile aynı biçim). */
  toOperation(input: TInput): CreateOperationInput;
}

/** Araç kayıt defterindeki sırayla (sıra modele giden araç listesini belirler ve sabit kalmalı). */
export function createProposeTools(services: ProposeToolServices): RegisteredTool[] {
  const tool = <TInput extends { operation_id?: string | undefined }>(spec: ProposalSpec<TInput>): RegisteredTool =>
    proposalTool(services, spec);

  return [
    tool({
      name: 'propose_stock_in',
      type: 'STOCK_IN',
      statusLabel: 'Giriş önerisi hazırlanıyor',
      description:
        "Depoya mal girişi (alış, teslim alma) için onay bekleyen bir öneri hazırlar. Stoğu değiştirmez: kullanıcı kartta Onayla'ya basınca stok değişir. Ürünü search_products, depoyu list_warehouses, tedarikçiyi search_parties ile bul. Düzeltme istenirse aynı aracı önerinin operation_id değeriyle yeniden çağır.",
      input: proposeStockInToolInputSchema,
      toOperation: (input) => ({
        type: 'STOCK_IN',
        partyId: input.party_id,
        note: input.note,
        items: input.lines.map((line) => ({
          productId: line.product_id,
          warehouseId: input.warehouse_id,
          quantity: line.quantity,
          unit: line.unit,
          unitCost: line.unit_cost,
        })),
      }),
    }),
    tool({
      name: 'propose_stock_out',
      type: 'STOCK_OUT',
      statusLabel: 'Çıkış önerisi hazırlanıyor',
      description:
        "Depodan mal çıkışı (satış, şantiyeye sevk) için onay bekleyen bir öneri hazırlar. Stoğu değiştirmez: kullanıcı kartta Onayla'ya basınca stok değişir. Ürünü search_products, depoyu list_warehouses, müşteriyi ya da şantiyeyi search_parties ile bul. Düzeltme istenirse aynı aracı önerinin operation_id değeriyle yeniden çağır.",
      input: proposeStockOutToolInputSchema,
      toOperation: (input) => ({
        type: 'STOCK_OUT',
        partyId: input.party_id,
        note: input.note,
        items: input.lines.map((line) => ({
          productId: line.product_id,
          warehouseId: input.warehouse_id,
          quantity: line.quantity,
          unit: line.unit,
        })),
      }),
    }),
    tool({
      name: 'propose_transfer',
      type: 'TRANSFER',
      statusLabel: 'Transfer önerisi hazırlanıyor',
      description:
        "İki depo arasında (servis aracı dahil) mal transferi için onay bekleyen bir öneri hazırlar. Stoğu değiştirmez: kullanıcı kartta Onayla'ya basınca stok değişir. Ürünü search_products, depoları list_warehouses ile bul. Düzeltme istenirse aynı aracı önerinin operation_id değeriyle yeniden çağır.",
      input: proposeTransferToolInputSchema,
      toOperation: (input) => ({
        type: 'TRANSFER',
        note: input.note,
        items: input.lines.map((line) => ({
          productId: line.product_id,
          warehouseId: input.source_warehouse_id,
          targetWarehouseId: input.target_warehouse_id,
          quantity: line.quantity,
          unit: line.unit,
        })),
      }),
    }),
    tool({
      name: 'propose_count',
      type: 'COUNT',
      statusLabel: 'Sayım önerisi hazırlanıyor',
      description:
        "Sayım sonucu için onay bekleyen bir öneri hazırlar: rafta sayılan miktar yazılır, sistemdeki miktarla farkı (sayım fazlası ya da noksanı) onay anında hesaplanır. Stoğu değiştirmez: kullanıcı kartta Onayla'ya basınca stok sayılan miktara eşitlenir. Düzeltme istenirse aynı aracı önerinin operation_id değeriyle yeniden çağır.",
      input: proposeCountToolInputSchema,
      toOperation: (input) => ({
        type: 'COUNT',
        note: input.note,
        items: input.lines.map((line) => ({
          productId: line.product_id,
          warehouseId: input.warehouse_id,
          quantity: line.counted_quantity,
          unit: line.unit,
        })),
      }),
    }),
    tool({
      name: 'propose_waste',
      type: 'WASTE',
      statusLabel: 'Fire önerisi hazırlanıyor',
      description:
        "Fire (kırık, bozuk, kayıp mal) için onay bekleyen bir öneri hazırlar; nedeni nota yaz. Stoğu değiştirmez: kullanıcı kartta Onayla'ya basınca stok düşer. Düzeltme istenirse aynı aracı önerinin operation_id değeriyle yeniden çağır.",
      input: proposeWasteToolInputSchema,
      toOperation: (input) => ({
        type: 'WASTE',
        note: input.note,
        items: input.lines.map((line) => ({
          productId: line.product_id,
          warehouseId: input.warehouse_id,
          quantity: line.quantity,
          unit: line.unit,
        })),
      }),
    }),
  ];
}

function proposalTool<TInput extends { operation_id?: string | undefined }>(
  { operations, catalog }: ProposeToolServices,
  spec: ProposalSpec<TInput>,
): RegisteredTool {
  return defineTool({
    name: spec.name,
    description: spec.description,
    statusLabel: spec.statusLabel,
    toolClass: 'propose',
    allowedRoles: EVERY_ROLE,
    input: spec.input,
    async run(input, context) {
      const request = toOperationRequest(spec.toOperation(input));
      const organizationId = context.organization.id;
      const actor: Extract<OperationActor, { kind: 'user' }> = {
        kind: 'user',
        userId: context.userId,
        role: context.organization.role,
      };
      try {
        const operation = input.operation_id
          ? await operations.revise(organizationId, actor, input.operation_id.toLowerCase(), request)
          : await operations.create(organizationId, actor, request, 'CHAT', { sourceMessageId: sourceMessageOf(context) });
        return summarize(await operations.preview(organizationId, actor, operation.id));
      } catch (error) {
        throw await explainForModel(catalog, organizationId, request, error);
      }
    },
  });
}

/** Ekrandaki işlem formuyla aynı kurallar (ör. transferde iki depo farklı, sayımda ürün bir kez). */
function toOperationRequest(candidate: CreateOperationInput): CreateOperationInput {
  const parsed = createOperationSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const [first, index] = issue.path;
      return first === 'items' && typeof index === 'number' ? `Kalem ${index + 1}: ${issue.message}` : issue.message;
    });
    throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', `Öneri geçersiz: ${issues.join('; ')}`);
  }
  return parsed.data;
}

function sourceMessageOf(context: ToolContext): string | null {
  return context.messageId ?? null;
}

/**
 * Servisin hatası modele gider. Kalem hatalarında genel mesaj ("İşlemin bazı kalemleri geçersiz.") modele yetmez:
 * hangi kalemin neden geçersiz olduğu yazılır; bulunamayan birimde ürünün birimleri de söylenir ki model kullanıcıya
 * doğru birimi sorsun ya da düzeltsin.
 */
async function explainForModel(
  catalog: CatalogService,
  organizationId: string,
  request: CreateOperationInput,
  error: unknown,
): Promise<unknown> {
  if (!(error instanceof ApiException) || error.code !== 'OPERATION_LINES_INVALID' || !Array.isArray(error.details)) {
    return error;
  }
  const details = await Promise.all(
    (error.details as LineError[]).map(async (lineError) => {
      const text = `Kalem ${lineError.lineNo}: ${lineError.message}`;
      const productId = request.items[lineError.lineNo - 1]?.productId;
      if (lineError.code !== 'UNIT_NOT_FOUND' || !productId) {
        return text;
      }
      const product = await catalog.findProduct(organizationId, productId.toLowerCase());
      if (!product) {
        return text;
      }
      const units = [
        `${product.baseUnit} (ana birim)`,
        ...product.units.map((unit) => `${unit.unit} (1 ${unit.unit} = ${formatDecimal(unit.factor)} ${product.baseUnit})`),
      ];
      return `${text} Ürünün birimleri: ${units.join(', ')}.`;
    }),
  );
  return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, error.code, `${error.message} ${details.join(' ')}`, error.details);
}

/** Miktar birimiyle, Türkçe yazımla (ADR-003: sayıya çevrilmez). */
function amount(value: string, unit: string): string {
  return `${formatDecimal(value)} ${unit}`;
}

function stockChange(effect: OperationPreviewLine['stock'], unit: string): string | null {
  return effect ? `${amount(effect.before, unit)} → ${amount(effect.after, unit)}` : null;
}

/**
 * Stok yetmeyen kalemde "önce → sonra" yerine eldeki ve gereken miktar: sonraki değer eksi çıkardı, ama stok hiçbir
 * zaman eksiye düşmez; onay reddedilir.
 */
function shortage(line: OperationPreviewLine): Record<string, string> {
  const available = amount(line.stock?.before ?? '0', line.baseUnit);
  const required = amount(line.baseQuantity, line.baseUnit);
  return {
    available,
    required,
    // Depo adına ek getirilmez ("Servis Aracı 1'da" yanlış olurdu); ad parantez içinde.
    problem: `Stok yetmiyor (${line.warehouse.name}): ${available} var, ${required} gerekiyor. Bu kalem bu hâliyle onaylanamaz.`,
  };
}

/**
 * Modele dönen özet: kartta görünecek bilgiler (önizleme ucuyla aynı hesap, SQL'de). İç kimlik yalnızca
 * operation_id'dir (düzenleme için); ürün ve depo adlarıyla verilir.
 */
function summarize(preview: OperationPreview): Record<string, unknown> {
  const lines = preview.lines.map((line) => {
    const entered = amount(line.quantity, line.unit ?? line.baseUnit);
    // Yalnızca stoğu azalan depo yetmeyebilir (çıkış, fire, transferin çıkış deposu); giriş ve sayım her zaman yeter.
    const sufficient = (line.stock?.sufficient ?? true) && (line.targetStock?.sufficient ?? true);
    return {
      product: line.productName,
      sku: line.sku,
      [preview.type === 'COUNT' ? 'counted_quantity' : 'quantity']: entered,
      ...(line.unit ? { base_quantity: amount(line.baseQuantity, line.baseUnit) } : {}),
      ...(line.unitCost ? { unit_cost: `${formatDecimal(line.unitCost)} TL / ${line.unit ?? line.baseUnit}` } : {}),
      warehouse: line.warehouse.name,
      ...(sufficient ? { stock_change: stockChange(line.stock, line.baseUnit) } : shortage(line)),
      ...(line.targetWarehouse
        ? {
            target_warehouse: line.targetWarehouse.name,
            ...(sufficient ? { target_stock_change: stockChange(line.targetStock, line.baseUnit) } : {}),
          }
        : {}),
      sufficient,
    };
  });
  const insufficient = lines.some((line) => !line.sufficient);
  return {
    operation_id: preview.operationId,
    version: preview.version,
    type: OPERATION_TYPE_LABELS[preview.type],
    status: OPERATION_STATUS_LABELS[preview.status],
    party: preview.partyName,
    note: preview.note,
    lines,
    insufficient_stock: insufficient,
    next_step: insufficient ? NEXT_STEP_INSUFFICIENT : NEXT_STEP,
  };
}
