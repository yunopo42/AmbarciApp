import { defineConfig } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';

import { ambarciRules } from '../../eslint.base.mjs';

export default defineConfig([
  expoConfig,
  { files: ['**/*.{ts,tsx}'], rules: ambarciRules },
  { ignores: ['dist/**', '.expo/**'] },
]);
