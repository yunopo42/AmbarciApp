import type {
  ActionSource,
  ConfirmOperationInput,
  ConfirmOperationResult,
  CreatableOperationType,
  Movement,
  MovementType,
  Operation,
  OperationItem,
  OperationItemInput,
  OperationList,
  OperationPreview,
  OperationPreviewLine,
  OperationStatus,
  OperationSummary,
  OperationType,
  StockEffect,
} from '@ambarci/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Swagger için sınıf karşılıkları; alanlar packages/shared/src/operations.ts içindeki şemalarla aynı kalmak
// zorunda. Gövde doğrulaması ZodValidationPipe ile ortak şemadan yapılır.

const OPERATION_TYPES: OperationType[] = ['STOCK_IN', 'STOCK_OUT', 'TRANSFER', 'COUNT', 'WASTE', 'OPENING', 'REVERSAL'];
const CREATABLE_TYPES: CreatableOperationType[] = ['STOCK_IN', 'STOCK_OUT', 'TRANSFER', 'COUNT', 'WASTE', 'OPENING'];
export const STATUSES: OperationStatus[] = [
  'RECEIVED',
  'NEEDS_CLARIFICATION',
  'PENDING_CONFIRMATION',
  'APPLIED',
  'REVERSED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
];
export const SOURCES: ActionSource[] = ['SCREEN', 'CHAT', 'DOCUMENT', 'IMPORT', 'SYSTEM'];
export const MOVEMENT_TYPES: MovementType[] = [
  'IN',
  'OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'COUNT_SURPLUS',
  'COUNT_SHORTAGE',
  'WASTE',
  'REVERSAL',
];

const QUANTITY = 'Metin olarak ondalık sayı, ayırıcı nokta (ör. "12.5"); en fazla 3 ondalık hane';

export class OperationItemInputDto implements OperationItemInput {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ format: 'uuid', description: 'Girişte malın girdiği; çıkış, fire ve sayımda ilgili; transferde çıktığı depo' })
  warehouseId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Yalnızca transferde: malın gittiği depo' })
  targetWarehouseId?: string;

  @ApiProperty({ example: '3', description: `${QUANTITY}. Sayımda sayılan miktar (0 olabilir)` })
  quantity!: string;

  @ApiPropertyOptional({ example: 'koli', description: 'Girilen birim; verilmezse ürünün ana birimi' })
  unit?: string;

  @ApiPropertyOptional({ example: '120.00', description: 'Yalnızca giriş ve açılışta: girilen birim başına maliyet' })
  unitCost?: string;
}

export class CreateOperationDto {
  @ApiProperty({ enum: CREATABLE_TYPES })
  type!: CreatableOperationType;

  @ApiPropertyOptional({ format: 'uuid', description: 'Cari: girişte tedarikçi, çıkışta müşteri' })
  partyId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  note?: string;

  @ApiProperty({ type: [OperationItemInputDto], minItems: 1, maxItems: 100 })
  items!: OperationItemInputDto[];
}

export class ConfirmOperationDto implements ConfirmOperationInput {
  @ApiProperty({ minimum: 1, description: 'Kullanıcının gördüğü sürüm; işlem bu arada düzenlendiyse onay reddedilir' })
  version!: number;
}

export class OperationItemDto implements OperationItem {
  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  warehouseId!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  targetWarehouseId!: string | null;

  @ApiProperty({ example: '3.000', description: 'Girilen birimde' })
  quantity!: string;

  @ApiProperty({ example: 'koli', nullable: true, type: String, description: 'Boşsa ürünün ana birimi' })
  unit!: string | null;

  @ApiProperty({ example: '120.0000', nullable: true, type: String })
  unitCost!: string | null;
}

export class OperationDto implements Operation {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: OPERATION_TYPES })
  type!: OperationType;

  @ApiProperty({ enum: STATUSES })
  status!: OperationStatus;

  @ApiProperty({ enum: SOURCES })
  source!: ActionSource;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  partyId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  note!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  createdBy!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  appliedBy!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  appliedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: [OperationItemDto] })
  items!: OperationItemDto[];
}

export class MovementDto implements Movement {
  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ format: 'uuid' })
  warehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ enum: MOVEMENT_TYPES })
  type!: MovementType;

  @ApiProperty({ example: '-36.000', description: 'Ana birimde, işaretli: giriş +, çıkış −' })
  quantityChange!: string;

  @ApiProperty({ example: '10.0000', description: 'Ana birim başına maliyet' })
  unitCost!: string;

  @ApiProperty({ example: '84.000', description: 'Hareketten sonraki stok' })
  quantityAfter!: string;

  @ApiProperty({ example: '10.0000', description: 'Hareketten sonraki hareketli ortalama maliyet' })
  averageCostAfter!: string;
}

export class ConfirmOperationResultDto implements ConfirmOperationResult {
  @ApiProperty({ type: OperationDto })
  operation!: OperationDto;

  @ApiProperty({ type: [MovementDto] })
  movements!: MovementDto[];
}

/** Depo kimliği ve adı (onay ekranı ve hareket geçmişi). */
export class WarehouseRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Merkez Depo' })
  name!: string;
}

export class StockEffectDto implements StockEffect {
  @ApiProperty({ example: '120.000', description: 'Onaydan önce, ana birimde' })
  before!: string;

  @ApiProperty({ example: '84.000', description: 'İşlem onaylanırsa, ana birimde' })
  after!: string;

  @ApiProperty({ description: 'Stok bu kalemi karşılıyor mu (sonraki miktar eksiye düşmüyor)' })
  sufficient!: boolean;
}

export class OperationPreviewLineDto implements OperationPreviewLine {
  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'PRZ-TOP-B' })
  sku!: string;

  @ApiProperty({ example: 'Topraklı priz, beyaz' })
  productName!: string;

  @ApiProperty({ example: 'adet' })
  baseUnit!: string;

  @ApiProperty({ example: '3', description: 'Girilen birimde' })
  quantity!: string;

  @ApiProperty({ nullable: true, type: String, example: 'koli', description: 'Boşsa ana birim' })
  unit!: string | null;

  @ApiProperty({ example: '36.000', description: 'Ana birimde; sayımda sayılan miktar' })
  baseQuantity!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Girilen birim başına maliyet (giriş ve açılış)' })
  unitCost!: string | null;

  @ApiProperty({ type: WarehouseRefDto })
  warehouse!: WarehouseRefDto;

  @ApiProperty({ type: WarehouseRefDto, nullable: true, description: 'Yalnızca transferde' })
  targetWarehouse!: WarehouseRefDto | null;

  @ApiProperty({ type: StockEffectDto, nullable: true, description: 'Yalnızca onay bekleyen işlemde hesaplanır' })
  stock!: StockEffectDto | null;

  @ApiProperty({ type: StockEffectDto, nullable: true, description: 'Transferde hedef deponun stoğu' })
  targetStock!: StockEffectDto | null;
}

export class OperationPreviewDto implements OperationPreview {
  @ApiProperty({ format: 'uuid' })
  operationId!: string;

  @ApiProperty({ enum: OPERATION_TYPES })
  type!: OperationType;

  @ApiProperty({ enum: STATUSES })
  status!: OperationStatus;

  @ApiProperty({ example: 1, description: 'Onay isteği bu sürümü gönderir' })
  version!: number;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  partyId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  partyName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  note!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: [OperationPreviewLineDto] })
  lines!: OperationPreviewLineDto[];
}

export class OperationSummaryDto implements OperationSummary {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: OPERATION_TYPES })
  type!: OperationType;

  @ApiProperty({ enum: STATUSES })
  status!: OperationStatus;

  @ApiProperty({ enum: SOURCES })
  source!: ActionSource;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: 2 })
  lineCount!: number;

  @ApiProperty({ type: [WarehouseRefDto], description: 'İşlemin dokunduğu depolar (transferde hedef dahil)' })
  warehouses!: WarehouseRefDto[];
}

export class OperationListDto implements OperationList {
  @ApiProperty({ type: [OperationSummaryDto] })
  items!: OperationSummaryDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}
