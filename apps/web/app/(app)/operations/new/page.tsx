import type { Metadata } from 'next';
import type { JSX } from 'react';

import { OperationForm } from '@/components/operation-form';

export const metadata: Metadata = {
  title: 'Yeni stok işlemi · Ambarcı',
};

export default function NewOperationPage(): JSX.Element {
  return <OperationForm />;
}
