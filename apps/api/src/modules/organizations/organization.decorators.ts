import { ORGANIZATION_HEADER } from '@ambarci/shared';
import type { OrganizationRole } from '@ambarci/shared';
import { applyDecorators, createParamDecorator, SetMetadata, UseGuards } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ApiBadRequestResponse, ApiForbiddenResponse, ApiHeader } from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import type { OrganizationContext, OrganizationRequest } from './organization-context.js';
import { OrganizationGuard, RolesGuard, ROLES_KEY, WarehouseAccessGuard, WAREHOUSE_PARAM_KEY } from './organization.guards.js';

interface OrganizationScopeOptions {
  /** Yalnızca bu rollere açık. Verilmezse şirketin her aktif üyesine açık. */
  roles?: OrganizationRole[];
  /** Bu yol parametresindeki depoda işlem yetkisi aranır (ör. 'warehouseId'). */
  warehouseParam?: string;
}

/**
 * Uç noktayı aktif şirkete bağlar: X-Organization-Id başlığı zorunlu, üyelik veritabanından doğrulanır,
 * ardından rol ve depo yetkisi denetlenir. Guard'lar bu sırayla çalışır.
 */
export function OrganizationScoped(options: OrganizationScopeOptions = {}): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(ROLES_KEY, options.roles ?? []),
    SetMetadata(WAREHOUSE_PARAM_KEY, options.warehouseParam),
    UseGuards(OrganizationGuard, RolesGuard, WarehouseAccessGuard),
    ApiHeader({ name: ORGANIZATION_HEADER, required: true, description: 'Aktif şirketin kimliği' }),
    ApiBadRequestResponse({ type: ApiErrorDto, description: 'Şirket seçilmemiş ya da kimlik geçersiz' }),
    ApiForbiddenResponse({ type: ApiErrorDto, description: 'Şirkete, role ya da depoya erişim yok' }),
  );
}

/** OrganizationGuard'ın doğruladığı aktif şirket. */
export const CurrentOrganization = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrganizationContext => {
    const organization = context.switchToHttp().getRequest<OrganizationRequest>().organization;
    if (!organization) {
      throw new Error('CurrentOrganization yalnızca @OrganizationScoped() uç noktalarda kullanılabilir.');
    }
    return organization;
  },
);
