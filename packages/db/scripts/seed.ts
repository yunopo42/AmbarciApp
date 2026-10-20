// Demo verisini (ABC Elektrik ve Kuzey Tesisat) yükler: pnpm db:seed
// Tekrar çalıştırmak güvenlidir: kayıtlar çoğalmaz, var olanlar güncellenir.
// .env içinde SEED_ADMIN_EMAIL varsa o e-postayla kayıtlı kullanıcı ABC Elektrik'e yönetici olarak bağlanır.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { seedDemoData } from '../seed/seed-demo-data.ts';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL tanımlı değil. Depo kökündeki .env dosyasını kontrol edin.');
  process.exit(1);
}

const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
const db = drizzle(client);
const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim() || undefined;

try {
  // Tek transaction: bir adım başarısız olursa hiçbir şey yazılmaz.
  const result = await db.transaction((tx) => seedDemoData(tx, { adminEmail }));
  console.log(
    `Demo verisi yüklendi: ${result.companies} şirket, ${result.warehouses} depo, ${result.products} ürün, ${result.parties} cari.`,
  );
  if (result.adminLinked === true) {
    console.log("SEED_ADMIN_EMAIL kullanıcısı ABC Elektrik'e yönetici olarak bağlandı.");
  } else if (result.adminLinked === false) {
    console.log(
      "SEED_ADMIN_EMAIL ile kayıtlı kullanıcı bulunamadı. Kullanıcıyı Supabase Auth'ta oluşturup seed'i yeniden çalıştırın.",
    );
  }
} catch (error) {
  console.error('Seed başarısız:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
