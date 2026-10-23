import { randomUUID } from 'node:crypto';

import type { Member, OrganizationMembership, OrganizationRole, Warehouse } from '@ambarci/shared';

import type { WarehousesRepository } from '../../src/modules/inventory/warehouses.repository.js';
import type {
  AcceptInvitationResult,
  GrantAccessResult,
  OrganizationsRepository,
} from '../../src/modules/organizations/organizations.repository.js';

// Veritabanı olmadan çalışan CI testleri için repository'lerin bellek içi sürümleri. Gerçek repository'lerin
// sözleşmesini taklit eder; kilit, kısıt ve RLS davranışı gerçek veritabanı testlerinde (test-db/) sınanır.

interface MembershipRow {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  isActive: boolean;
}

interface InvitationRow {
  organizationId: string;
  code: string;
  role: OrganizationRole;
  expiresAt: Date;
  usedAt: Date | null;
}

interface WarehouseRow extends Warehouse {
  organizationId: string;
}

export class InMemoryStore {
  readonly organizations = new Map<string, string>();
  readonly memberships: MembershipRow[] = [];
  readonly invitations: InvitationRow[] = [];
  readonly warehouses: WarehouseRow[] = [];
  /** organizationId:membershipId:warehouseId */
  readonly access = new Set<string>();

  addOrganization(name: string): string {
    const id = randomUUID();
    this.organizations.set(id, name);
    return id;
  }

  addMember(organizationId: string, userId: string, role: OrganizationRole, isActive = true): string {
    const id = randomUUID();
    this.memberships.push({ id, organizationId, userId, role, isActive });
    return id;
  }

  addWarehouse(organizationId: string, name: string): string {
    const id = randomUUID();
    this.warehouses.push({ id, organizationId, name, type: 'WAREHOUSE', isActive: true });
    return id;
  }

  addInvitation(row: InvitationRow): void {
    this.invitations.push(row);
  }
}

type OrganizationsRepositoryContract = Pick<OrganizationsRepository, keyof OrganizationsRepository>;
type WarehousesRepositoryContract = Pick<WarehousesRepository, keyof WarehousesRepository>;

export function inMemoryOrganizationsRepository(store: InMemoryStore): OrganizationsRepositoryContract {
  const membershipOf = (userId: string, organizationId: string): MembershipRow | undefined =>
    store.memberships.find((row) => row.userId === userId && row.organizationId === organizationId);

  return {
    async findActiveMembership(userId, organizationId) {
      const row = membershipOf(userId, organizationId);
      return row?.isActive ? { id: row.id, role: row.role } : null;
    },
    async createWithAdmin(name, userId): Promise<OrganizationMembership> {
      const id = store.addOrganization(name);
      store.addMember(id, userId, 'ADMIN');
      return { id, name, role: 'ADMIN' };
    },
    async listMemberships(userId) {
      return store.memberships
        .filter((row) => row.userId === userId && row.isActive)
        .map((row) => ({ id: row.organizationId, name: store.organizations.get(row.organizationId) ?? '', role: row.role }));
    },
    async createInvitation(input) {
      store.addInvitation({ ...input, usedAt: null });
    },
    async acceptInvitation(code, userId, now): Promise<AcceptInvitationResult> {
      const invitation = store.invitations.find((row) => row.code === code);
      if (!invitation) {
        return { kind: 'not_found' };
      }
      if (invitation.usedAt) {
        return { kind: 'used' };
      }
      if (invitation.expiresAt <= now) {
        return { kind: 'expired' };
      }
      if (membershipOf(userId, invitation.organizationId)) {
        return { kind: 'already_member' };
      }
      store.addMember(invitation.organizationId, userId, invitation.role);
      invitation.usedAt = now;
      const name = store.organizations.get(invitation.organizationId) ?? '';
      return { kind: 'accepted', organization: { id: invitation.organizationId, name, role: invitation.role } };
    },
    async listMembers(organizationId): Promise<Member[]> {
      return store.memberships
        .filter((row) => row.organizationId === organizationId)
        .map((row) => ({
          id: row.id,
          userId: row.userId,
          email: null,
          role: row.role,
          isActive: row.isActive,
          warehouseIds: store.warehouses
            .filter((warehouse) => store.access.has(`${organizationId}:${row.id}:${warehouse.id}`))
            .map((warehouse) => warehouse.id),
        }));
    },
    async grantWarehouseAccess(organizationId, membershipId, warehouseId): Promise<GrantAccessResult> {
      // Gerçek veritabanında bunu bileşik yabancı anahtarlar sağlar.
      if (!store.memberships.some((row) => row.id === membershipId && row.organizationId === organizationId)) {
        return 'member_not_found';
      }
      if (!store.warehouses.some((row) => row.id === warehouseId && row.organizationId === organizationId)) {
        return 'warehouse_not_found';
      }
      store.access.add(`${organizationId}:${membershipId}:${warehouseId}`);
      return 'granted';
    },
    async revokeWarehouseAccess(organizationId, membershipId, warehouseId) {
      return store.access.delete(`${organizationId}:${membershipId}:${warehouseId}`);
    },
    async hasWarehouseAccess(organizationId, membershipId, warehouseId) {
      return store.access.has(`${organizationId}:${membershipId}:${warehouseId}`);
    },
    async findOperationAccess(_executor, organizationId, userId, warehouseIds) {
      const row = membershipOf(userId, organizationId);
      if (!row?.isActive) {
        return null;
      }
      return {
        role: row.role,
        deniedWarehouseIds: warehouseIds.filter((id) => !store.access.has(`${organizationId}:${row.id}:${id}`)),
      };
    },
  };
}

export function inMemoryWarehousesRepository(store: InMemoryStore): WarehousesRepositoryContract {
  const toWarehouse = ({ id, name, type, isActive }: WarehouseRow): Warehouse => ({ id, name, type, isActive });
  return {
    async listByOrganization(organizationId) {
      return store.warehouses.filter((row) => row.organizationId === organizationId).map(toWarehouse);
    },
    async findById(organizationId, warehouseId) {
      const row = store.warehouses.find((item) => item.organizationId === organizationId && item.id === warehouseId);
      return row ? toWarehouse(row) : null;
    },
    async findStatuses(_executor, organizationId, warehouseIds) {
      return store.warehouses
        .filter((row) => row.organizationId === organizationId && warehouseIds.includes(row.id))
        .map((row) => ({ id: row.id, isActive: row.isActive }));
    },
  };
}
