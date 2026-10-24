import type { Party, PartyList, PartyType, Product, ProductList, ProductUnit } from '@ambarci/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Swagger için sınıf karşılıkları; alanlar packages/shared/src/catalog.ts içindeki şemalarla aynı kalmak zorunda.
// Gövde doğrulaması ZodValidationPipe ile ortak şemadan yapılır.

const PARTY_TYPES: PartyType[] = ['SUPPLIER', 'CUSTOMER'];

export class ProductUnitInputDto {
  @ApiProperty({ example: 'koli', maxLength: 40, description: 'Ana birim dışında bir birim' })
  unit!: string;

  @ApiProperty({ example: '12', description: 'Bu birimin kaç ana birim ettiği; metin, en fazla 6 ondalık' })
  factor!: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: '2000000000053' })
  barcode?: string | null;
}

export class ProductInputDto {
  @ApiProperty({ example: 'PRZ-TOP-B', maxLength: 40, description: 'Şirket içinde benzersiz ürün kodu' })
  sku!: string;

  @ApiProperty({ example: 'Topraklı priz, beyaz', maxLength: 200 })
  name!: string;

  @ApiProperty({ example: 'adet', maxLength: 40, description: 'Hareketi olan ürünün ana birimi değiştirilemez' })
  baseUnit!: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: '2000000000053' })
  barcode?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '50', description: 'Kritik stok eşiği (ana birimde)' })
  minStock?: string | null;

  @ApiPropertyOptional({ type: [ProductUnitInputDto], maxItems: 10, description: 'Liste tamamen değiştirilir' })
  units?: ProductUnitInputDto[];

  @ApiPropertyOptional({ type: [String], maxItems: 30, example: ['priz', 'topraklı priz'] })
  aliases?: string[];

  @ApiPropertyOptional({ default: true, description: 'Ürün silinmez; pasife almak için false' })
  isActive?: boolean;
}

export class ProductUnitDto implements ProductUnit {
  @ApiProperty({ example: 'koli' })
  unit!: string;

  @ApiProperty({ example: '12.000000' })
  factor!: string;

  @ApiProperty({ nullable: true, type: String })
  barcode!: string | null;
}

export class ProductDto implements Product {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'PRZ-TOP-B' })
  sku!: string;

  @ApiProperty({ example: 'Topraklı priz, beyaz' })
  name!: string;

  @ApiProperty({ example: 'adet' })
  baseUnit!: string;

  @ApiProperty({ nullable: true, type: String })
  barcode!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '50.000' })
  minStock!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: [ProductUnitDto] })
  units!: ProductUnitDto[];

  @ApiProperty({ type: [String] })
  aliases!: string[];
}

export class ProductListDto implements ProductList {
  @ApiProperty({ type: [ProductDto] })
  items!: ProductDto[];

  @ApiProperty({ description: 'Süzgece uyan toplam kayıt' })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

export class PartyInputDto {
  @ApiProperty({ example: 'Anadolu Kablo Toptan', maxLength: 200 })
  name!: string;

  @ApiProperty({ enum: PARTY_TYPES })
  type!: PartyType;

  @ApiPropertyOptional({ nullable: true, type: String, example: '9990000011', description: 'VKN 10, TCKN 11 hane' })
  taxId?: string | null;

  @ApiPropertyOptional({ default: true, description: 'Cari silinmez; pasife almak için false' })
  isActive?: boolean;
}

export class PartyDto implements Party {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Anadolu Kablo Toptan' })
  name!: string;

  @ApiProperty({ enum: PARTY_TYPES })
  type!: PartyType;

  @ApiProperty({ nullable: true, type: String })
  taxId!: string | null;

  @ApiProperty()
  isActive!: boolean;
}

export class PartyListDto implements PartyList {
  @ApiProperty({ type: [PartyDto] })
  items!: PartyDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}
