/**
 * Girişten sonra dönülecek adres. Yalnızca site içi yollar kabul edilir; "//kotu-site.com" gibi
 * başka siteye yönlendiren değerler (açık yönlendirme) ana sayfaya çevrilir.
 */
export function safeNextPath(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value;
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
    return '/';
  }
  return path;
}
