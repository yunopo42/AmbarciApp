import type {
  AcceptInvitationInput,
  CreateOrganizationInput,
  Invitation,
  Member,
  OrganizationMembership,
  OrganizationRole,
} from '@ambarci/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Swagger için sınıf karşılıkları; alanlar packages/shared içindeki şemalarla aynı kalmak zorunda.
// Gövde doğrulaması ZodValidationPipe ile ortak şemadan yapılır.

const ROLES: OrganizationRole[] = ['ADMIN', 'EMPLOYEE'];

export class CreateOrganizationDto implements CreateOrganizationInput {
  @ApiProperty({ minLength: 2, maxLength: 100, example: 'ABC Elektrik' })
  name!: string;
}

export class OrganizationMembershipDto implements OrganizationMembership {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ABC Elektrik' })
  name!: string;

  @ApiProperty({ enum: ROLES })
  role!: OrganizationRole;
}

export class CreateInvitationDto {
  @ApiPropertyOptional({ enum: ROLES, default: 'EMPLOYEE' })
  role?: OrganizationRole;

  @ApiPropertyOptional({ minimum: 1, maximum: 30, default: 7, description: 'Kodun geçerli olacağı gün sayısı' })
  expiresInDays?: number;
}

export class InvitationDto implements Invitation {
  @ApiProperty({ example: 'K7M2XQ9RTA', description: 'Tek kullanımlık davet kodu' })
  code!: string;

  @ApiProperty({ enum: ROLES })
  role!: OrganizationRole;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class AcceptInvitationDto implements AcceptInvitationInput {
  @ApiProperty({ example: 'K7M2XQ9RTA', description: 'Büyük/küçük harf, boşluk ve tire farkı yok sayılır' })
  code!: string;
}

export class MemberDto implements Member {
  @ApiProperty({ format: 'uuid', description: 'Üyelik kimliği' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Supabase Auth kullanıcı kimliği' })
  userId!: string;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ enum: ROLES })
  role!: OrganizationRole;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: [String], format: 'uuid', description: 'Çalışanın işlem yapabileceği depolar' })
  warehouseIds!: string[];
}
