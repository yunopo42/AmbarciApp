import { productInputSchema, productListQuerySchema } from '@ambarci/shared';
import type { ProductInput, ProductListQuery } from '@ambarci/shared';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { CurrentOrganization, OrganizationScoped } from '../organizations/organization.decorators.js';
import { ProductDto, ProductInputDto, ProductListDto } from './catalog.dto.js';
import { ProductsService } from './products.service.js';

/** Ürün (stok kartı), ek birimleri ve sahadaki adları. Okuma her üyeye, değiştirme yalnızca yöneticiye açık. */
@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(@Inject(ProductsService) private readonly products: ProductsService) {}

  @Get()
  @OrganizationScoped()
  @ApiOperation({ summary: 'Ürünler; ad, SKU, barkod ya da alternatif adda arama ve sayfalama' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive', 'all'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'En fazla 100' })
  @ApiOkResponse({ type: ProductListDto })
  list(
    @CurrentOrganization() organization: OrganizationContext,
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery,
  ): Promise<ProductListDto> {
    return this.products.list(organization.id, query);
  }

  @Get(':productId')
  @OrganizationScoped()
  @ApiOperation({ summary: 'Ürün, birimleri ve alternatif adları' })
  @ApiOkResponse({ type: ProductDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductDto> {
    return this.products.get(organization.id, productId);
  }

  @Post()
  @OrganizationScoped({ roles: ['ADMIN'] })
  @ApiOperation({ summary: 'Ürün ekler (yalnızca yönetici)' })
  @ApiBody({ type: ProductInputDto })
  @ApiCreatedResponse({ type: ProductDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'SKU ya da barkod başka üründe kullanılıyor' })
  create(
    @CurrentOrganization() organization: OrganizationContext,
    @Body(new ZodValidationPipe(productInputSchema)) body: ProductInput,
  ): Promise<ProductDto> {
    return this.products.create(organization.id, body);
  }

  @Put(':productId')
  @OrganizationScoped({ roles: ['ADMIN'] })
  @ApiOperation({ summary: 'Ürünü, birimlerini ve adlarını günceller ya da pasife alır (yalnızca yönetici; silinmez)' })
  @ApiBody({ type: ProductInputDto })
  @ApiOkResponse({ type: ProductDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'SKU/barkod kullanılıyor, kullanılmış birim silinmek isteniyor ya da hareketi olan ürünün ana birimi değişiyor',
  })
  update(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body(new ZodValidationPipe(productInputSchema)) body: ProductInput,
  ): Promise<ProductDto> {
    return this.products.update(organization.id, productId, body);
  }
}
