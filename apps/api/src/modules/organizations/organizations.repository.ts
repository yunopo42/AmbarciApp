import { invitations, organizations, organizationUsers, userWarehouseAccess } from '@ambarci/db';
import type { Database, DbExecutor } from '@ambarci/db';
import type { Member, OrganizationMembership, OrganizationRole } from '@ambarci/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { authUsers } from 'drizzle-orm/supabase';

import { postgresErrorOf } from '../../common/postgres-error.js';
import { DATABASE } from '../../database/database.module.js';

export type AcceptInvitationResult =
  | { kind: 'accepted'; organization: OrganizationMembership }
  | { kind: 'not_found' | 'used' | 'expired' | 'already_member' };

export type GrantAccessResult = 'granted' | 'member_not_found' | 'warehouse_not_found';

/**
 * Şirket, üyelik, davet ve depo yetkisi sorguları. Şirkete ait her sorgu organization_id ile sınırlanır;
 * şirket kimliği her zaman OrganizationGuard'ın doğruladığı bağlamdan gelir, istemci gövdesinden alınmaz.
 */
@Injectable()
export class OrganizationsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findActiveMembership(
    userId: string,
    organizationId: string,
  ): Promise<{ id: string; role: OrganizationRole } | null> {
    const [row] = await this.db
      .select({ id: organizationUsers.id, role: organizationUsers.role })
      .from(organizationUsers)
      .where(
        and(
          eq(organizationUsers.userId, userId),
          eq(organizationUsers.organizationId, organizationId),
          eq(organizationUsers.isActive, true),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Şirketi ve kurucusunun yönetici üyeliğini tek transaction'da oluşturur. */
  async createWithAdmin(name: string, userId: string): Promise<OrganizationMembership> {
    return this.db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({ name })
        .returning({ id: organizations.id, name: organizations.name });
      if (!organization) {
        throw new Error('Şirket oluşturulamadı.');
      }
      await tx.insert(organizationUsers).values({ organizationId: organization.id, userId, role: 'ADMIN' });
      return { ...organization, role: 'ADMIN', warehouseIds: [] };
    });
  }

  /** Kullanıcının aktif üyelikleri ve her şirkette işlem yetkisi olan depoları (çalışan için). */
  async listMemberships(userId: string): Promise<OrganizationMembership[]> {
    return this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        role: organizationUsers.role,
        warehouseIds: sql<string[]>`coalesce(
          array_agg(${userWarehouseAccess.warehouseId}) filter (where ${userWarehouseAccess.warehouseId} is not null),
          '{}'
        )`,
      })
      .from(organizationUsers)
      .innerJoin(organizations, eq(organizations.id, organizationUsers.organizationId))
      .leftJoin(
        userWarehouseAccess,
        and(
          eq(userWarehouseAccess.organizationId, organizationUsers.organizationId),
          eq(userWarehouseAccess.organizationUserId, organizationUsers.id),
        ),
      )
      .where(and(eq(organizationUsers.userId, userId), eq(organizationUsers.isActive, true)))
      .groupBy(organizations.id, organizationUsers.id)
      .orderBy(asc(organizations.name));
  }

  async createInvitation(input: {
    organizationId: string;
    code: string;
    role: OrganizationRole;
    expiresAt: Date;
    createdBy: string;
  }): Promise<void> {
    await this.db.insert(invitations).values(input);
  }

  /**
   * Davet kodunu kullanır. Davet satırı FOR UPDATE ile kilitlenir: aynı kod aynı anda iki kez gönderilirse
   * ikinci istek ilkinin bitmesini bekler ve kodu kullanılmış bulur. Kod yalnızca bir kez üyelik açar.
   */
  async acceptInvitation(code: string, userId: string, now: Date): Promise<AcceptInvitationResult> {
    return this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.code, code))
        .limit(1)
        .for('update');
      if (!invitation) {
        return { kind: 'not_found' };
      }
      if (invitation.usedAt) {
        return { kind: 'used' };
      }
      if (invitation.expiresAt <= now) {
        return { kind: 'expired' };
      }

      const [existing] = await tx
        .select({ id: organizationUsers.id })
        .from(organizationUsers)
        .where(
          and(eq(organizationUsers.organizationId, invitation.organizationId), eq(organizationUsers.userId, userId)),
        )
        .limit(1);
      if (existing) {
        // Kod harcanmaz; başka biri kullanabilir.
        return { kind: 'already_member' };
      }

      await tx
        .insert(organizationUsers)
        .values({ organizationId: invitation.organizationId, userId, role: invitation.role });
      await tx.update(invitations).set({ usedAt: now, usedBy: userId }).where(eq(invitations.id, invitation.id));

      const [organization] = await tx
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, invitation.organizationId));
      if (!organization) {
        throw new Error('Davetin şirketi bulunamadı.');
      }
      // Yeni üyenin henüz depo yetkisi yok; yönetici Üyeler ekranından verir.
      return { kind: 'accepted', organization: { ...organization, role: invitation.role, warehouseIds: [] } };
    });
  }

  /** Üyeler, e-postaları (Supabase Auth) ve depo yetkileri. */
  async listMembers(organizationId: string): Promise<Member[]> {
    const rows = await this.db
      .select({
        id: organizationUsers.id,
        userId: organizationUsers.userId,
        email: authUsers.email,
        role: organizationUsers.role,
        isActive: organizationUsers.isActive,
        warehouseIds: sql<string[]>`coalesce(
          array_agg(${userWarehouseAccess.warehouseId}) filter (where ${userWarehouseAccess.warehouseId} is not null),
          '{}'
        )`,
      })
      .from(organizationUsers)
      .leftJoin(authUsers, eq(authUsers.id, organizationUsers.userId))
      .leftJoin(
        userWarehouseAccess,
        and(
          eq(userWarehouseAccess.organizationId, organizationUsers.organizationId),
          eq(userWarehouseAccess.organizationUserId, organizationUsers.id),
        ),
      )
      .where(eq(organizationUsers.organizationId, organizationId))
      .groupBy(organizationUsers.id, authUsers.email)
      .orderBy(asc(authUsers.email));
    return rows.map((row) => ({ ...row, email: row.email ?? null }));
  }

  /**
   * Üyeye depo yetkisi verir (zaten varsa değişiklik yok). Üye ve depo aynı şirkette olmak zorundadır;
   * bunu bileşik yabancı anahtarlar veritabanında garanti eder.
   */
  async grantWarehouseAccess(
    organizationId: string,
    membershipId: string,
    warehouseId: string,
  ): Promise<GrantAccessResult> {
    try {
      await this.db
        .insert(userWarehouseAccess)
        .values({ organizationId, organizationUserId: membershipId, warehouseId })
        .onConflictDoNothing();
      return 'granted';
    } catch (error) {
      const { code, constraint } = postgresErrorOf(error);
      if (code === '23503' && constraint === 'user_warehouse_access_member_fk') {
        return 'member_not_found';
      }
      if (code === '23503' && constraint === 'user_warehouse_access_warehouse_fk') {
        return 'warehouse_not_found';
      }
      throw error;
    }
  }

  /** Yetkiyi kaldırır; kaldırılacak yetki yoksa false döner. */
  async revokeWarehouseAccess(organizationId: string, membershipId: string, warehouseId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(userWarehouseAccess)
      .where(
        and(
          eq(userWarehouseAccess.organizationId, organizationId),
          eq(userWarehouseAccess.organizationUserId, membershipId),
          eq(userWarehouseAccess.warehouseId, warehouseId),
        ),
      )
      .returning({ warehouseId: userWarehouseAccess.warehouseId });
    return deleted.length > 0;
  }

  /** Üyenin yetkili olduğu depolar (user_warehouse_access). */
  async listWarehouseAccess(organizationId: string, membershipId: string): Promise<string[]> {
    const rows = await this.db
      .select({ warehouseId: userWarehouseAccess.warehouseId })
      .from(userWarehouseAccess)
      .where(
        and(eq(userWarehouseAccess.organizationId, organizationId), eq(userWarehouseAccess.organizationUserId, membershipId)),
      );
    return rows.map((row) => row.warehouseId);
  }

  async hasWarehouseAccess(organizationId: string, membershipId: string, warehouseId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ warehouseId: userWarehouseAccess.warehouseId })
      .from(userWarehouseAccess)
      .where(
        and(
          eq(userWarehouseAccess.organizationId, organizationId),
          eq(userWarehouseAccess.organizationUserId, membershipId),
          eq(userWarehouseAccess.warehouseId, warehouseId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Stok işlemi yetkisi tek sorguda: kullanıcının şirketteki aktif üyeliğinin rolü ve verilen depolardan
   * yetkisi olmayanlar. Üyelik yoksa ya da pasifse null döner. executor, onay sırasında açık transaction'dır;
   * böylece yetki kilit altında yeniden okunur.
   */
  async findOperationAccess(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
    warehouseIds: string[],
  ): Promise<OperationAccess | null> {
    const requested = sql.join(
      warehouseIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const [row] = await executor.execute<{ role: OrganizationRole; denied: string[] }>(sql`
      select ou.role,
             array(
               select w.id
               from unnest(array[${requested}]::uuid[]) as w(id)
               where not exists (
                 select 1 from ${userWarehouseAccess} a
                 where a.organization_id = ou.organization_id
                   and a.organization_user_id = ou.id
                   and a.warehouse_id = w.id
               )
             ) as denied
      from ${organizationUsers} ou
      where ou.organization_id = ${organizationId} and ou.user_id = ${userId} and ou.is_active
      limit 1`);
    return row ? { role: row.role, deniedWarehouseIds: row.denied } : null;
  }
}

export interface OperationAccess {
  role: OrganizationRole;
  /** Kullanıcının user_warehouse_access'te kaydı olmayan depolar. Yöneticiler için dikkate alınmaz. */
  deniedWarehouseIds: string[];
}
