/** PostgreSQL hata kodu ve kısıt adı. Drizzle sürücü hatasını "cause" içine sarar; ikisine de bakılır. */
export function postgresErrorOf(error: unknown): { code?: string; constraint?: string } {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && 'code' in candidate) {
      const { code, constraint_name: constraint } = candidate as { code?: unknown; constraint_name?: unknown };
      return {
        code: typeof code === 'string' ? code : undefined,
        constraint: typeof constraint === 'string' ? constraint : undefined,
      };
    }
  }
  return {};
}
