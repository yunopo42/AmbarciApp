import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

import { ambarciRules } from '../../eslint.base.mjs';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ['**/*.{ts,tsx}'], rules: ambarciRules },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
