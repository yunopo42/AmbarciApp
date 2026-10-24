import type {
  MovementType,
  ProductMovement,
  ProductMovementList,
  ProductStock,
  ProductWarehouseStock,
  StockLevel,
  WarehouseStock,
} from '@ambarci/shared';
import { ApiProperty } from '@nestjs/swagger';

import { WarehouseDto } from '../inventory/warehouses.controller.js';
import { MOVEMENT_TYPES, WarehouseRefDto } from '../operations/operations.dto.js';

// Swagger için sınıf karşılıkları; alanlar packages/shared/src/stock.ts içindeki şemalarla aynı kalmak zorunda.

export class StockLevelDto implements StockLevel {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'PRZ-TOP-B' })
  sku!: string;

  @ApiProperty({ example: 'Topraklı priz, beyaz' })
  name!: string;

  @ApiProperty({ example: 'adet' })
  baseUnit!: string;

  @ApiProperty({ nullable: true, type: String, example: '50.000' })
  minStock!: string | null;

  @ApiProperty({ example: '120.000', description: 'Ana birimde; depoda hareketi olmayan ürün için 0' })
  quantity!: string;

  @ApiProperty({ example: '10.0000', description: 'Ana birim başına hareketli ortalama maliyet' })
  averageCost!: string;

  @ApiProperty({ description: 'Kritik stok eşiği tanımlı ve miktar eşiğin altında' })
  belowMinimum!: boolean;
}

export class WarehouseStockDto implements WarehouseStock {
  @ApiProperty({ type: WarehouseDto })
  warehouse!: WarehouseDto;

  @ApiProperty({ type: [StockLevelDto] })
  items!: StockLevelDto[];

  @ApiProperty({ description: 'Süzgece uyan toplam ürün' })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

export class ProductMovementDto implements ProductMovement {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  operationId!: string;

  @ApiProperty({ example: 1 })
  lineNo!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: WarehouseRefDto })
  warehouse!: WarehouseRefDto;

  @ApiProperty({ enum: MOVEMENT_TYPES })
  type!: MovementType;

  @ApiProperty({ example: '-36.000', description: 'Ana birimde, işaretli: giriş +, çıkış −' })
  quantityChange!: string;

  @ApiProperty({ example: '10.0000' })
  unitCost!: string;

  @ApiProperty({ example: '84.000' })
  quantityAfter!: string;

  @ApiProperty({ example: '10.0000' })
  averageCostAfter!: string;
}

export class ProductMovementListDto implements ProductMovementList {
  @ApiProperty({ type: [ProductMovementDto] })
  items!: ProductMovementDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

export class ProductWarehouseStockDto implements ProductWarehouseStock {
  @ApiProperty({ type: WarehouseDto })
  warehouse!: WarehouseDto;

  @ApiProperty({ example: '120.000', description: 'Ana birimde; depoda hareketi olmayan ürün için 0' })
  quantity!: string;

  @ApiProperty({ example: '10.0000' })
  averageCost!: string;

  @ApiProperty({ description: 'Kritik stok eşiği tanımlı ve miktar eşiğin altında' })
  belowMinimum!: boolean;
}

export class ProductStockDto implements ProductStock {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'adet' })
  baseUnit!: string;

  @ApiProperty({ nullable: true, type: String, example: '50.000' })
  minStock!: string | null;

  @ApiProperty({ example: '140.000', description: 'Listelenen depoların toplamı' })
  total!: string;

  @ApiProperty({ type: [ProductWarehouseStockDto] })
  warehouses!: ProductWarehouseStockDto[];
}
