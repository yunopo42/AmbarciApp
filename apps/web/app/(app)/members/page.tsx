import type { Metadata } from 'next';
import type { JSX } from 'react';

import { MembersManager } from '@/components/members-manager';

export const metadata: Metadata = {
  title: 'Üyeler · Ambarcı',
};

// Yetki API'de denetlenir (yalnızca yönetici); bu sayfa çalışana yalnızca bilgi mesajı gösterir.
export default function MembersPage(): JSX.Element {
  return (
    <>
      <h1 className="text-xl font-semibold">Üyeler</h1>
      <MembersManager />
    </>
  );
}
