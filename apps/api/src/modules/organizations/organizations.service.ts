import type { DbExecutor } from '@ambarci/db';
import type { Invitation, Member, OrganizationMembership, OrganizationRole } from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

import { ApiException } from '../../common/api-exception.js';
import { OrganizationsRepository } from './organizations.repository.js';

// Davet kodu: karıştırılabilecek karakterler (0/O, 1/I/L) çıkarılmış 31 harf ve rakam; 10 karakter ~50 bit.
// Kullanıcı kodu elle girebilir; büyük/küçük harf ve tire/boşluk farkı yok sayılır.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export function generateInvitationCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeInvitationCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

@Injectable()
export class OrganizationsService {
  constructor(@Inject(OrganizationsRepository) private readonly repository: OrganizationsRepository) {}

  findActiveMembership(userId: string, organizationId: string): Promise<{ id: string; role: OrganizationRole } | null> {
    return this.repository.findActiveMembership(userId, organizationId);
  }

  createOrganization(name: string, userId: string): Promise<OrganizationMembership> {
    return this.repository.createWithAdmin(name, userId);
  }

  listMyOrganizations(userId: string): Promise<OrganizationMembership[]> {
    return this.repository.listMemberships(userId);
  }

  async createInvitation(input: {
    organizationId: string;
    role: OrganizationRole;
    expiresInDays: number;
    createdBy: string;
    now?: Date;
  }): Promise<Invitation> {
    const expiresAt = new Date((input.now ?? new Date()).getTime() + input.expiresInDays * DAY_MS);
    const code = generateInvitationCode();
    await this.repository.createInvitation({
      organizationId: input.organizationId,
      code,
      role: input.role,
      expiresAt,
      createdBy: input.createdBy,
    });
    return { code, role: input.role, expiresAt: expiresAt.toISOString() };
  }

  async acceptInvitation(code: string, userId: string, now = new Date()): Promise<OrganizationMembership> {
    const result = await this.repository.acceptInvitation(normalizeInvitationCode(code), userId, now);
    switch (result.kind) {
      case 'accepted':
        return result.organization;
      case 'not_found':
        throw new ApiException(HttpStatus.NOT_FOUND, 'INVITATION_NOT_FOUND', 'Davet kodu bulunamadı.');
      case 'used':
        throw new ApiException(HttpStatus.CONFLICT, 'INVITATION_USED', 'Bu davet kodu daha önce kullanılmış.');
      case 'expired':
        throw new ApiException(HttpStatus.GONE, 'INVITATION_EXPIRED', 'Davet kodunun süresi dolmuş.');
      case 'already_member':
        throw new ApiException(HttpStatus.CONFLICT, 'ALREADY_MEMBER', 'Bu şirkete zaten üyesiniz.');
    }
  }

  listMembers(organizationId: string): Promise<Member[]> {
    return this.repository.listMembers(organizationId);
  }

  async grantWarehouseAccess(organizationId: string, membershipId: string, warehouseId: string): Promise<void> {
    const result = await this.repository.grantWarehouseAccess(organizationId, membershipId, warehouseId);
    if (result === 'member_not_found') {
      throw new ApiException(HttpStatus.NOT_FOUND, 'MEMBER_NOT_FOUND', 'Üye bulunamadı.');
    }
    if (result === 'warehouse_not_found') {
      throw new ApiException(HttpStatus.NOT_FOUND, 'WAREHOUSE_NOT_FOUND', 'Depo bulunamadı.');
    }
  }

  async revokeWarehouseAccess(organizationId: string, membershipId: string, warehouseId: string): Promise<void> {
    const revoked = await this.repository.revokeWarehouseAccess(organizationId, membershipId, warehouseId);
    if (!revoked) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'ACCESS_NOT_FOUND', 'Bu üyenin bu depoda yetkisi yok.');
    }
  }

  /**
   * Üyenin görebileceği depolar: yönetici için null (süzme yok, bütün depolar), çalışan için yetkili olduğu depolar.
   * Ürünün hareket geçmişi çalışana yalnızca bu depolardan gösterilir.
   */
  async visibleWarehouseIds(organization: { id: string; role: OrganizationRole; membershipId: string }): Promise<string[] | null> {
    if (organization.role === 'ADMIN') {
      return null;
    }
    return this.repository.listWarehouseAccess(organization.id, organization.membershipId);
  }

  hasWarehouseAccess(organizationId: string, membershipId: string, warehouseId: string): Promise<boolean> {
    return this.repository.hasWarehouseAccess(organizationId, membershipId, warehouseId);
  }

  /**
   * Kullanıcı bu depolarda stok işlemi açıp onaylayabilir mi? Üyelik artık aktif değilse 403, çalışanın
   * yetkisi olmayan depo varsa 403 WAREHOUSE_FORBIDDEN (hangi depolar olduğu details'te). Yöneticiler tüm
   * depolarda yetkilidir. Rolü döner; çağıran rol kuralı (ör. açılış yalnızca yönetici) uygular.
   */
  async assertOperationAccess(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
    warehouseIds: string[],
  ): Promise<OrganizationRole> {
    const access = await this.repository.findOperationAccess(executor, organizationId, userId, warehouseIds);
    if (!access) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'ORGANIZATION_FORBIDDEN', 'Bu şirkete erişiminiz yok.');
    }
    if (access.role !== 'ADMIN' && access.deniedWarehouseIds.length > 0) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'WAREHOUSE_FORBIDDEN', 'Bu depoda işlem yetkiniz yok.', {
        warehouseIds: access.deniedWarehouseIds,
      });
    }
    return access.role;
  }
}
