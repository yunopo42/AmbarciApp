import type { Metadata } from 'next';
import type { JSX } from 'react';

import { PartyList } from '@/components/party-list';

export const metadata: Metadata = {
  title: 'Cariler · Ambarcı',
};

export default function PartiesPage(): JSX.Element {
  return <PartyList />;
}
