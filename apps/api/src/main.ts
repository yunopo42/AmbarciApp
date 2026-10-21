import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

// Yerelde depo kökündeki .env okunur. Render'da dosya yoktur; değişkenler panelden gelir.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // Render yeni sürümü yayınlarken eski süreci SIGTERM ile kapatır; veritabanı bağlantıları düzgün kapansın.
  app.enableShutdownHooks();
  // Render, sunucunun 0.0.0.0 üzerinde ve PORT değişkenindeki portta dinlemesini bekler.
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}

await bootstrap();
