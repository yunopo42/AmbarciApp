import type { Metadata } from 'next';
import type { JSX } from 'react';

import { OperationReview } from '@/components/operation-review';

export const metadata: Metadata = {
  title: 'Stok işlemi · Ambarcı',
};

export default async function OperationPage(props: PageProps<'/operations/[operationId]'>): Promise<JSX.Element> {
  const { operationId } = await props.params;
  return <OperationReview operationId={operationId} />;
}
