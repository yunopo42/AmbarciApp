// Ortak ESLint ayarları. Her paketin eslint.config.mjs dosyası buradan türetilir.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Proje standardı: `any` yasak, dışa açık fonksiyonlarda açık dönüş tipi zorunlu.
// Yalnızca kural içerir; Next ve Expo yapılandırmaları kendi TypeScript eklentisini getirir.
export const ambarciRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/explicit-module-boundary-types': 'error',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
};

// Node.js üzerinde çalışan TypeScript paketleri için (apps/api, packages/shared).
export const nodeConfig = defineConfig([
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,mts,cts,js,mjs}'],
    languageOptions: { globals: globals.node },
    rules: ambarciRules,
  },
]);
