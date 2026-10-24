import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

import { ApiProvider } from '@/components/api-provider';

import './globals.css';

export const metadata: Metadata = {
  title: 'Ambarcı',
  description: 'Yapay zekâ destekli saha stok asistanı: yönetim paneli',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="tr">
      <body className="antialiased">
        <ApiProvider>{children}</ApiProvider>
      </body>
    </html>
  );
}
