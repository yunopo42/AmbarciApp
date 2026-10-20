import { z } from 'zod';

/** Oturumdaki kullanıcı: Supabase Auth kullanıcı kimliği ve e-postası. */
export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
});

export type AuthUser = z.infer<typeof authUserSchema>;
