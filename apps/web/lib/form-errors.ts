import { describeApiError } from '@ambarci/api-client';

/** Alan yolu ("units.0.factor") → o alanın altında gösterilecek ilk hata mesajı. */
export type FieldErrors = Record<string, string>;

/** Zod hatasının burada kullanılan kısmı; web zod'u doğrudan içe aktarmaz, şemalar @ambarci/shared'den gelir. */
interface SchemaIssue {
  code: string;
  path: PropertyKey[];
  message: string;
  origin?: string;
  maximum?: number | bigint;
}

// Paylaşılan şemaların kendi mesajları Türkçedir (barkod, katsayı, VKN...). Zod'un hazır mesajları ise İngilizce ve
// teknik ("Too small: expected string to have >=1 characters"); en sık görülen ikisi burada sade Türkçeye çevrilir.
function messageOf(issue: SchemaIssue): string {
  if (issue.code === 'too_small' && issue.origin === 'string') {
    return 'Bu alan boş bırakılamaz.';
  }
  if (issue.code === 'too_big' && issue.origin === 'string') {
    return `En fazla ${String(issue.maximum)} karakter olabilir.`;
  }
  if (issue.code === 'too_big' && issue.origin === 'array') {
    return `En fazla ${String(issue.maximum)} kayıt eklenebilir.`;
  }
  return issue.message;
}

/** İstemcide paylaşılan Zod şemasıyla yapılan kontrolün hatalarını alanlara dağıtır. */
export function issuesToFieldErrors(issues: readonly SchemaIssue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    errors[issue.path.map(String).join('.')] ??= messageOf(issue);
  }
  return errors;
}

function isPathMessage(value: unknown): value is { path: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { path?: unknown }).path === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/**
 * API hatasını forma çevirir. Şema hatası (400 VALIDATION_FAILED) alanlara, `conflictFields` içindeki bilinen kodlar
 * (ör. 409 PRODUCT_SKU_TAKEN → "sku") ilgili alanın altına, geri kalanı formun üstüne yazılır.
 */
export function apiErrorToForm(
  error: unknown,
  conflictFields: Readonly<Record<string, string>>,
): { fieldErrors: FieldErrors; formError: string | null } {
  const failure = describeApiError(error);
  if (failure.code === 'VALIDATION_FAILED' && Array.isArray(failure.details)) {
    const fieldErrors: FieldErrors = {};
    for (const detail of failure.details.filter(isPathMessage)) {
      fieldErrors[detail.path] ??= detail.message;
    }
    return { fieldErrors, formError: failure.message };
  }
  const field = conflictFields[failure.code];
  if (field) {
    return { fieldErrors: { [field]: failure.message }, formError: null };
  }
  return { fieldErrors: {}, formError: failure.message };
}
