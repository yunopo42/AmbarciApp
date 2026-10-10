import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

import type { NextConfig } from 'next';

// Yerelde depo kökündeki .env dosyasından yalnızca NEXT_PUBLIC_ ile başlayan değişkenler
// alınır; backend anahtarları web sürecine girmez. Vercel'de dosya yoktur, değişkenler
// panelden gelir.
const rootEnvFile = path.join(__dirname, '../../.env');
if (existsSync(rootEnvFile)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnvFile, 'utf8')))) {
    if (key.startsWith('NEXT_PUBLIC_')) {
      process.env[key] ??= value;
    }
  }
}

const nextConfig: NextConfig = {};

export default nextConfig;
