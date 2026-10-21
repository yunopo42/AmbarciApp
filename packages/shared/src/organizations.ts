import { z } from 'zod';

/** Aktif şirketin gönderildiği başlık. API bu değere güvenmez; kullanıcının üyeliğiyle doğrular. */
export const ORGANIZATION_HEADER = 'x-organization-id';

export const organizationRoleSchema = z.enum(['ADMIN', 'EMPLOYEE']);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

/** POST /v1/organizations */
export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(100),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Kullanıcının üyesi olduğu şirket ve oradaki rolü. */
export const organizationMembershipSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: organizationRoleSchema,
});
export type OrganizationMembership = z.infer<typeof organizationMembershipSchema>;

/** POST /v1/invitations (yalnızca yönetici) */
export const createInvitationSchema = z.object({
  role: organizationRoleSchema.default('EMPLOYEE'),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const invitationSchema = z.object({
  code: z.string(),
  role: organizationRoleSchema,
  expiresAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/** POST /v1/invitations/accept */
export const acceptInvitationSchema = z.object({
  code: z.string().trim().min(8).max(32),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

/** Şirket üyesi (yönetici ekranı). */
export const memberSchema = z.object({
  /** Üyelik kimliği (depo yetkisi uçlarında kullanılır). */
  id: z.uuid(),
  userId: z.uuid(),
  email: z.string().nullable(),
  role: organizationRoleSchema,
  isActive: z.boolean(),
  /** İşlem yapabileceği depolar. Yöneticiler bu listeden bağımsız olarak tüm depolarda yetkilidir. */
  warehouseIds: z.array(z.uuid()),
});
export type Member = z.infer<typeof memberSchema>;

export const organizationMembershipListSchema = z.array(organizationMembershipSchema);
export const memberListSchema = z.array(memberSchema);
