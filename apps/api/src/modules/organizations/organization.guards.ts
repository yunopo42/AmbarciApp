import { ORGANIZATION_HEADER } from '@ambarci/shared';
import type { OrganizationRole } from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiException } from '../../common/api-exception.js';
import type { OrganizationContext, OrganizationRequest } from './organization-context.js';
import { OrganizationsService } from './organizations.service.js';

export const ROLES_KEY = 'organizations:roles';
export const WAREHOUSE_PARAM_KEY = 'organizations:warehouseParam';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function organizationOf(context: ExecutionContext): OrganizationContext {
  const organization = context.switchToHttp().getRequest<OrganizationRequest>().organization;
  if (!organization) {
    // Guard sırası yanlış kurulmuşsa programlama hatasıdır; 500 olarak loglanır.
    throw new Error("Şirket bağlamı yok: OrganizationGuard bu guard'dan önce çalışmalı.");
  }
  return organization;
}

/**
 * Aktif şirketi X-Organization-Id başlığından alır ve kullanıcının o şirkette aktif üyeliği olduğunu
 * veritabanından doğrular. Şirket hiç yoksa da aynı 403 döner; başka şirketlerin varlığı sızmaz.
 */
@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(@Inject(OrganizationsService) private readonly organizations: OrganizationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OrganizationRequest>();
    const header = request.headers[ORGANIZATION_HEADER];
    const organizationId = Array.isArray(header) ? header[0] : header;
    if (!organizationId) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'ORGANIZATION_REQUIRED', 'Aktif şirket seçilmemiş.');
    }
    if (!UUID_PATTERN.test(organizationId)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'ORGANIZATION_INVALID', 'Şirket kimliği geçersiz.');
    }
    const user = request.user;
    if (!user) {
      throw new Error("Kullanıcı yok: AuthGuard OrganizationGuard'dan önce çalışmalı.");
    }

    const membership = await this.organizations.findActiveMembership(user.id, organizationId);
    if (!membership) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'ORGANIZATION_FORBIDDEN', 'Bu şirkete erişiminiz yok.');
    }
    request.organization = { id: organizationId, role: membership.role, membershipId: membership.id };
    return true;
  }
}

/** @OrganizationScoped({ roles }) ile istenen role sahip olmayan üyeyi durdurur. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<OrganizationRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }
    if (!roles.includes(organizationOf(context).role)) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'ROLE_FORBIDDEN', 'Bu işlem için yönetici yetkisi gerekiyor.');
    }
    return true;
  }
}

/**
 * Yol parametresindeki depoda işlem yetkisini denetler. Yöneticiler tüm depolarda yetkilidir;
 * çalışan yalnızca user_warehouse_access'te kayıtlı depolarda işlem yapabilir.
 */
@Injectable()
export class WarehouseAccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const param = this.reflector.getAllAndOverride<string | undefined>(WAREHOUSE_PARAM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!param) {
      return true;
    }
    const organization = organizationOf(context);
    if (organization.role === 'ADMIN') {
      return true;
    }
    const warehouseId = context.switchToHttp().getRequest<OrganizationRequest>().params[param];
    const allowed =
      typeof warehouseId === 'string' &&
      UUID_PATTERN.test(warehouseId) &&
      (await this.organizations.hasWarehouseAccess(organization.id, organization.membershipId, warehouseId));
    if (!allowed) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'WAREHOUSE_FORBIDDEN', 'Bu depoda işlem yetkiniz yok.');
    }
    return true;
  }
}
