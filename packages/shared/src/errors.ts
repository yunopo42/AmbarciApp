import { z } from 'zod';

/** API'nin tüm hata cevaplarının ortak gövdesi: { error: { code, message, details? } }. */
export const apiErrorSchema = z.object({
  error: z.object({
    // Makinenin okuyacağı sabit kod, örn. AUTH_REQUIRED.
    code: z.string(),
    // Kullanıcıya gösterilebilecek Türkçe mesaj.
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
