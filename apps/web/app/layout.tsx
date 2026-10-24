import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { JSX, ReactNode } from 'react';

import { ApiProvider } from '@/components/api-provider';

import './globals.css';

// Inter, build sırasında indirilip uygulamayla birlikte sunulur (tarayıcı Google'a istek atmaz). Türkçe harfler
// (ğ, ş, İ, ı) latin-ext alt kümesinde.
const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Ambarcı',
  description: 'Yapay zekâ destekli saha stok asistanı: yönetim paneli',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="tr" className={inter.variable}>
      <body className="bg-canvas font-sans text-body-md text-text antialiased">
        <ApiProvider>{children}</ApiProvider>
      </body>
    </html>
  );
}
