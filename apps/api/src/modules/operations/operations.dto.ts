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
  OperationStatus,
  OperationType,
} from '@ambarci/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Swagger için sınıf karşılıkları; alanlar packages/shared/src/operations.ts içindeki şemalarla aynı kalmak
// zorunda. Gövde doğrulaması ZodValidationPipe ile ortak şemadan yapılır.

const OPERATION_TYPES: OperationType[] = ['STOCK_IN', 'STOCK_OUT', 'TRANSFER', 'COUNT', 'WASTE', 'OPENING', 'REVERSAL'];
const CREATABLE_TYPES: CreatableOperationType[] = ['STOCK_IN', 'STOCK_OUT', 'TRANSFER', 'COUNT', 'WASTE', 'OPENING'];
const STATUSES: OperationStatus[] = [
  'RECEIVED',
  'NEEDS_CLARIFICATION',
  'PENDING_CONFIRMATION',
  'APPLIED',
  'REVERSED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
];
const SOURCES: ActionSource[] = ['SCREEN', 'CHAT', 'DOCUMENT', 'IMPORT', 'SYSTEM'];
const MOVEMENT_TYPES: MovementType[] = [
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
