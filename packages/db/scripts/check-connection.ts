// DATABASE_URL ile veritabanına bağlanmayı dener: pnpm db:check
// Bağlantı adresi ve şifre ekrana yazılmaz.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL tanımlı değil. Depo kökündeki .env dosyasını kontrol edin.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });

try {
  const [row] = await sql<{ version: string; database: string; user: string }[]>`
    select current_setting('server_version') as version,
           current_database() as database,
           current_user as user
  `;
  console.log(`Bağlantı başarılı: PostgreSQL ${row?.version}, veritabanı ${row?.database}, kullanıcı ${row?.user}`);
} catch (error) {
  console.error('Bağlantı kurulamadı:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
