import type { AuthUser } from '@ambarci/shared';
import { ApiProperty } from '@nestjs/swagger';

// Swagger için sınıf karşılığı; alanlar packages/shared içindeki authUserSchema ile aynı kalmak zorunda.
export class AuthUserDto implements AuthUser {
  @ApiProperty({ format: 'uuid', description: 'Supabase Auth kullanıcı kimliği' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'saha@ornek.com' })
  email!: string | null;
}
