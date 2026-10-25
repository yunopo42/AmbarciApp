import { productImportSchema } from '@ambarci/shared';
import type { AuthUser, ProductImportInput, ProductImportResult, ProductImportRow } from '@ambarci/shared';
import { Body, Controller, Inject, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ProductInputDto } from '../catalog/catalog.dto.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { CurrentOrganization, OrganizationScoped } from '../organizations/organization.decorators.js';
import { ProductImportService } from './product-import.service.js';

// Swagger için sınıf karşılıkları; alanlar packages/shared/src/product-import.ts ile aynı kalmak zorunda.

export class ProductImportRowDto implements Omit<ProductImportRow, 'product'> {
  @ApiProperty({ example: 2, description: 'Dosyadaki satır numarası; hatalar bu numarayla döner' })
  row!: number;

  @ApiProperty({ type: ProductInputDto })
  product!: ProductInputDto;

  @ApiPropertyOptional({ example: '120', description: 'Başlangıç stoku (ana birimde); 0 yok sayılır' })
  openingQuantity?: string;

  @ApiPropertyOptional({ example: '10', description: 'Başlangıç stokunun ana birim başına maliyeti' })
  openingUnitCost?: string;
}

export class ProductImportDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Başlangıç stoku varsa zorunlu: açılış işleminin deposu' })
  warehouseId?: string;

  @ApiProperty({ type: [ProductImportRowDto], minItems: 1, maxItems: 1000 })
  rows!: ProductImportRowDto[];
}

export class ProductImportResultDto implements ProductImportResult {
  @ApiProperty({ example: 120 })
  created!: number;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Başlangıç stoku için açılan, onay bekleyen açılış işlemleri (100 kalemde bir yenisi)',
  })
  openingOperationIds!: string[];
}

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductImportController {
  constructor(@Inject(ProductImportService) private readonly productImport: ProductImportService) {}

  @Post('import')
  @OrganizationScoped({ roles: ['ADMIN'] })
  @ApiOperation({
    summary:
      'Ürünleri toplu ekler (Excel/CSV, en fazla 1.000 satır, yalnızca yönetici); ya hepsi ya hiçbiri. Başlangıç stoku onay bekleyen açılış işlemi olarak açılır',
  })
  @ApiBody({ type: ProductImportDto })
  @ApiCreatedResponse({ type: ProductImportResultDto })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorDto,
    description: 'SKU ya da barkod şirkette kullanılıyor (details: satır, alan, mesaj) ya da depo geçersiz',
  })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Bir kod bu arada başka bir üründe kullanılmış' })
  import(
    @CurrentUser() user: AuthUser,
    @CurrentOrganization() organization: OrganizationContext,
    @Body(new ZodValidationPipe(productImportSchema)) body: ProductImportInput,
  ): Promise<ProductImportResultDto> {
    return this.productImport.import(organization.id, { kind: 'user', userId: user.id, role: organization.role }, body);
  }
}
