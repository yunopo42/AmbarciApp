'use client';

import { cardActionFailure, confirmKeyFor, describeApiError, randomUuid } from '@ambarci/api-client';
import type { ApiFailure, CardConfirmKey, CardPreview } from '@ambarci/api-client';
import type { ConfirmOperationResult } from '@ambarci/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-provider';

// İşlemin önizlemesi, onayı ve iptali: web'deki özet sayfası (operation-review.tsx, 3. hafta) ve sohbet panelindeki
// işlem kartı (#77) aynı istekleri ve aynı kuralları kullanır. Stok yalnızca onay ucunda değişir (mimari değişmez 2).

const PREVIEW_PATH = '/v1/operations/{operationId}/preview';

export interface OperationActions {
  preview: CardPreview | undefined;
  loading: boolean;
  /** Önizleme okunamadı ve elde gösterilecek bir hâli yok. */
  loadError: string | null;
  fetching: boolean;
  confirming: boolean;
  cancelling: boolean;
  reversing: boolean;
  busy: boolean;
  /** Son onay ya da iptal hatası (API'nin kodu ve mesajı); yeni denemede temizlenir. */
  failure: ApiFailure | null;
  /** Onayın cevabı: yazılan hareketler. */
  result: ConfirmOperationResult | null;
  confirm: (version: number) => Promise<void>;
  cancel: () => Promise<void>;
  /**
   * Geri al (#78): stoğu değiştirmez, onay bekleyen bir ters kayıt açar (ya da bekleyeni bulur). Ters kaydın kimliğini
   * döner; hata olursa null (hata `failure`'da).
   */
  reverse: () => Promise<string | null>;
  refresh: () => Promise<void>;
}

/**
 * Onay anahtarı (Idempotency-Key) o sürümün ilk onay denemesinde üretilir; aynı sürümün sonraki denemeleri (çift
 * tıklama, ağ hatasından sonra tekrar) aynı anahtarla gider ve stok bir kez değişir; sürüm değişince yeni anahtar
 * (packages/api-client/src/operation-card.ts). İşlem başarılıysa ya da hata durumu veya stoğu değiştirdiyse önizleme ve
 * stok listeleri yeniden okunur; ağ hatasında okunmaz (eldeki hâl kalsın, tekrar denenebilsin).
 */
export function useOperationActions(operationId: string): OperationActions {
  const { $api } = useApi();
  const queryClient = useQueryClient();
  const init = useMemo(() => ({ params: { path: { operationId } } }), [operationId]);
  const query = $api.useQuery('get', PREVIEW_PATH, init);
  const confirmMutation = $api.useMutation('post', '/v1/operations/{operationId}/confirm');
  const cancelMutation = $api.useMutation('post', '/v1/operations/{operationId}/cancel');
  const reverseMutation = $api.useMutation('post', '/v1/operations/{operationId}/reverse');
  const confirmKey = useRef<CardConfirmKey | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [result, setResult] = useState<ConfirmOperationResult | null>(null);

  // Sabit kimlik: kartın "yeni sürüm geldi" effect'i her çizimde yeniden tetiklenmesin.
  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      // Bütün önizlemeler: ters kayıt onaylanınca geri aldığı işlemin kartı ve özeti de "Geri alındı" olur (#78).
      queryClient.invalidateQueries({ queryKey: ['get', PREVIEW_PATH] }),
      // Stok listesi, hareket geçmişi ve onay bekleyen işlemler bir sonraki açılışta sunucudan yeniden okunur.
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/operations'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/warehouses/{warehouseId}/stock'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/products/{productId}/movements'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/products/{productId}/stock'] }),
    ]);
  }, [queryClient]);

  async function act(run: () => Promise<void>): Promise<void> {
    setFailure(null);
    try {
      await run();
      await refresh();
    } catch (reason) {
      const described = describeApiError(reason);
      setFailure(described);
      if (cardActionFailure(described).refresh) {
        await refresh();
      }
    }
  }

  return {
    preview: query.data,
    loading: query.isPending,
    loadError: query.isError && !query.data ? describeApiError(query.error).message : null,
    fetching: query.isFetching,
    confirming: confirmMutation.isPending,
    cancelling: cancelMutation.isPending,
    reversing: reverseMutation.isPending,
    busy: confirmMutation.isPending || cancelMutation.isPending || reverseMutation.isPending,
    failure,
    result,
    confirm: (version) => {
      confirmKey.current = confirmKeyFor(confirmKey.current, version, randomUuid);
      const key = confirmKey.current.key;
      return act(async () => {
        setResult(
          await confirmMutation.mutateAsync({
            params: { path: { operationId }, header: { 'Idempotency-Key': key } },
            body: { version },
          }),
        );
      });
    },
    cancel: () =>
      act(async () => {
        await cancelMutation.mutateAsync({ params: { path: { operationId } } });
      }),
    reverse: async () => {
      let reversalId: string | null = null;
      await act(async () => {
        reversalId = (await reverseMutation.mutateAsync({ params: { path: { operationId } } })).id;
      });
      return reversalId;
    },
    refresh,
  };
}
