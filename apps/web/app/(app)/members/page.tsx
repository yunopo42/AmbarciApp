import type { Metadata } from 'next';
import type { JSX } from 'react';

import { MembersManager } from '@/components/members-manager';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = {
  title: 'Üyeler · Ambarcı',
};

// Yetki API'de denetlenir (yalnızca yönetici); bu sayfa çalışana yalnızca bilgi mesajı gösterir.
export default function MembersPage(): JSX.Element {
  return (
    <>
      <PageHeader title="Üyeler" description="Çalışanları davet kodu ile ekle, hangi depolarda işlem yapacaklarını seç." />
      <MembersManager />
    </>
  );
}
