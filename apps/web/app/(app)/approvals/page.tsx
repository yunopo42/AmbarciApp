import type { Metadata } from 'next';
import type { JSX } from 'react';

import { ApprovalQueue } from '@/components/approval-queue';

export const metadata: Metadata = {
  title: 'Onay kuyruğu · Ambarcı',
};

export default function ApprovalsPage(): JSX.Element {
  return <ApprovalQueue />;
}
