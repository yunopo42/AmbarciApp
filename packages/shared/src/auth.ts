import { z } from 'zod';

/** Oturumdaki kullanıcı: Supabase Auth kullanıcı kimliği ve e-postası. */
export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
});

export type AuthUser = z.infer<typeof authUserSchema>;

/**
 * Supabase Auth giriş hatasını kullanıcıya gösterilecek Türkçe mesaja çevirir. Web ve mobil aynı
 * mesajları gösterir. Hangi alanın yanlış olduğu bilerek söylenmez (e-posta var mı yok mu sızmaz).
 */
export function describeSignInError(error: { code?: string; status?: number }): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'E-posta veya şifre hatalı.';
    case 'email_not_confirmed':
      return 'E-posta adresi henüz doğrulanmamış.';
    case 'user_banned':
      return 'Bu hesap kullanıma kapatılmış.';
  }
  if (error.status === 429) {
    return 'Çok fazla deneme yapıldı; biraz sonra tekrar deneyin.';
  }
  return 'Giriş yapılamadı; bağlantınızı kontrol edip tekrar deneyin.';
}
