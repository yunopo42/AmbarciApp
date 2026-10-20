import type { AuthUser } from '@ambarci/shared';

/**
 * Erişim token'ını doğrulayan port. Kimlik sağlayıcı değişirse yalnızca bu sınıfın
 * uygulaması değişir. Soyut sınıf, Nest'te enjeksiyon anahtarı olarak da kullanılır.
 */
export abstract class AccessTokenVerifier {
  /** Token geçerliyse kullanıcıyı döner; geçersizse ApiException (401) fırlatır. */
  abstract verify(token: string): Promise<AuthUser>;
}
