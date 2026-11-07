'use client';

import { SquarePen } from 'lucide-react';
import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime } from '@/lib/labels';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

/**
 * Sohbet geçmişi: kullanıcının aktif şirketteki sohbetleri, en son konuşulan önce, ve "Yeni sohbet". Sorgu aktif
 * şirketin istemcisiyle gider; şirket değişince panel o şirketin sohbetlerini gösterir.
 */
export function ConversationList({
  currentId,
  onSelect,
  onNew,
}: {
  currentId: string | null;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
}): JSX.Element {
  const { $api } = useApi();
  const query = $api.useInfiniteQuery(
    'get',
    '/v1/conversations',
    { params: { query: { pageSize: PAGE_SIZE } } },
    {
      pageParamName: 'page',
      initialPageParam: 1,
      getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    },
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <Button onClick={onNew}>
        <SquarePen aria-hidden />
        Yeni sohbet
      </Button>

      {query.isPending ? (
        <p aria-live="polite" className="text-body-md text-text-muted">
          Sohbetler yükleniyor…
        </p>
      ) : query.isError ? (
        <div className="flex flex-col items-start gap-2">
          <Alert>{errorMessage(query.error)}</Alert>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Tekrar dene
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-body-md text-text-muted">Henüz sohbet yok. İlk sorunu sorunca burada görünür.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider overflow-hidden rounded-lg border border-border bg-card shadow-1">
          {items.map((item) => {
            const selected = item.id === currentId;
            return (
              <li key={item.id}>
                {/* Liste satırı (docs/tasarim.md): en az 56 px, dikey 14 px iç boşluk. */}
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    'flex min-h-14 w-full cursor-pointer flex-col items-start gap-1 px-4 py-3.5 text-left hover:bg-divider focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-action',
                    selected && 'bg-primary-soft hover:bg-primary-soft',
                  )}
                >
                  <span className={cn('w-full truncate text-body-lg-bold', selected ? 'text-primary' : 'text-text')}>
                    {item.title ?? 'Başlıksız sohbet'}
                  </span>
                  <span className="text-body-md text-text-muted tabular-nums">{formatDateTime(item.lastMessageAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {query.hasNextPage ? (
        <Button variant="secondary" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Yükleniyor…' : 'Daha eski sohbetler'}
        </Button>
      ) : null}
    </div>
  );
}
