// ABC Elektrik'in açılış stoklarını yükler. Doğrudan değil, kök dizindeki "pnpm db:seed" ile çalışır: önce
// katalog (packages/db), sonra bu betik. Derlenmiş API'den çalışır (dist/scripts), çünkü işlem servisi
// Nest'in bağımlılık enjeksiyonunu kullanır; HTTP sunucusu açılmaz.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Database } from '@ambarci/db';
import { ABC_ELEKTRIK_ID, abcElektrikOpeningStock } from '@ambarci/db/demo';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { DATABASE } from '../database/database.module.js';
import { OperationsService } from '../modules/operations/operations.service.js';
import { seedOpeningStock } from './opening-stock.js';

const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const results = await seedOpeningStock(
    app.get<Database>(DATABASE),
    app.get(OperationsService),
    ABC_ELEKTRIK_ID,
    abcElektrikOpeningStock,
  );
  for (const result of results) {
    const state = result.status === 'applied' ? 'açılış işlemi onaylandı' : 'zaten yüklü, atlandı';
    console.log(`Açılış stoğu, ${result.warehouse}: ${state} (${result.lineCount} kalem).`);
  }
} catch (error) {
  console.error('Açılış stoğu yüklenemedi:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
