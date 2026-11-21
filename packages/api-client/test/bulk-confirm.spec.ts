import { describe, expect, it } from 'vitest';

import { bulkConfirmOutcome, bulkConfirmSummary, confirmEach } from '../src/index.js';
import type { BulkConfirmTarget, CardConfirmKey } from '../src/index.js';

// Onay kuyruğunda toplu onay (#87): her işlem kendi isteği ve kendi Idempotency-Key'iyle gider, biri reddedilse de
// ötekiler gönderilir; sonuç işlem işlem gösterilir.

const A = { id: '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e01', version: 1 };
const B = { id: '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e02', version: 3 };
const C = { id: '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e03', version: 1 };
const D = { id: '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e04', version: 2 };

/** API'nin hata gövdesi; tipli istemci hatayı bu biçimde fırlatır. */
function apiError(code: string, message = 'Sunucunun mesajı.'): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

/** Sıralı anahtar üretici: hangi isteğin hangi anahtarla gittiği testte okunabilsin. */
function keyMaker(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `anahtar-${next}`;
  };
}

/** Sahte onay ucu: gelen istekleri kaydeder, verilen işlem için hata fırlatır. */
function fakeConfirm(failures: Record<string, unknown> = {}): {
  calls: { id: string; version: number; key: string }[];
  confirm: (target: BulkConfirmTarget, key: string) => Promise<void>;
} {
  const calls: { id: string; version: number; key: string }[] = [];
  return {
    calls,
    confirm: async (target, key) => {
      calls.push({ id: target.id, version: target.version, key });
      const failure = failures[target.id];
      if (failure !== undefined) {
        throw failure;
      }
    },
  };
}

describe('confirmEach', () => {
  it('her işlemi kendi isteği ve kendi anahtarıyla, sırayla gönderir; biri reddedilse de ötekiler gider', async () => {
    const api = fakeConfirm({
      [B.id]: apiError('INSUFFICIENT_STOCK', 'Stok yetersiz.'),
      [C.id]: apiError('OPERATION_EXPIRED'),
    });
    const outcomes = await confirmEach([A, B, C, D], { confirm: api.confirm, keys: new Map(), makeKey: keyMaker() });

    expect(api.calls).toEqual([
      { id: A.id, version: 1, key: 'anahtar-1' },
      { id: B.id, version: 3, key: 'anahtar-2' },
      { id: C.id, version: 1, key: 'anahtar-3' },
      { id: D.id, version: 2, key: 'anahtar-4' },
    ]);
    expect(outcomes.map((outcome) => [outcome.operationId, outcome.result, outcome.label])).toEqual([
      [A.id, 'APPLIED', 'Uygulandı'],
      [B.id, 'INSUFFICIENT_STOCK', 'Yetersiz stok'],
      [C.id, 'EXPIRED', 'Süresi doldu'],
      [D.id, 'APPLIED', 'Uygulandı'],
    ]);
  });

  it('aynı işlem aynı sürümle yeniden gönderilirse aynı anahtar gider; sürüm değişmişse yeni anahtar', async () => {
    const keys = new Map<string, CardConfirmKey>();
    const makeKey = keyMaker();
    const first = fakeConfirm({ [A.id]: new TypeError('fetch failed'), [B.id]: new TypeError('fetch failed') });
    const failed = await confirmEach([A, B], { confirm: first.confirm, keys, makeKey });
    expect(failed.map((outcome) => outcome.result)).toEqual(['NETWORK', 'NETWORK']);

    // Ağ hatasından sonra tekrar: A aynı sürümle (sunucu ilk isteği uygulamışsa aynı anahtarı tanır, stok bir kez
    // değişir); B bu arada sohbette düzenlenmiş, yeni sürümle yeni anahtar.
    const second = fakeConfirm();
    await confirmEach([A, { ...B, version: 4 }], { confirm: second.confirm, keys, makeKey });
    expect(second.calls).toEqual([
      { id: A.id, version: 1, key: first.calls[0]?.key },
      { id: B.id, version: 4, key: 'anahtar-3' },
    ]);
  });

  it('aynı işlem listede iki kez varsa bir kez gönderilir', async () => {
    const api = fakeConfirm();
    const outcomes = await confirmEach([A, A, B], { confirm: api.confirm, keys: new Map(), makeKey: keyMaker() });
    expect(api.calls.map((call) => call.id)).toEqual([A.id, B.id]);
    expect(outcomes).toHaveLength(2);
  });

  it('her sonuç geldiğinde ilerlemeyi bildirir', async () => {
    const progress: [string, number, number][] = [];
    await confirmEach([A, B], {
      confirm: fakeConfirm({ [A.id]: apiError('OPERATION_VERSION_MISMATCH') }).confirm,
      keys: new Map(),
      makeKey: keyMaker(),
      onProgress: (outcome, done, total) => progress.push([outcome.result, done, total]),
    });
    expect(progress).toEqual([
      ['VERSION_CHANGED', 1, 2],
      ['APPLIED', 2, 2],
    ]);
  });
});

describe('bulkConfirmOutcome', () => {
  it('kabul kriterindeki dört sonuç: uygulandı, yetersiz stok, süresi doldu, sürüm değişti', () => {
    expect(bulkConfirmOutcome(A.id, null)).toMatchObject({ result: 'APPLIED', tone: 'applied', retryable: false });
    expect(bulkConfirmOutcome(A.id, { code: 'INSUFFICIENT_STOCK', message: 'Stok yetersiz.' })).toMatchObject({
      result: 'INSUFFICIENT_STOCK',
      tone: 'critical',
      retryable: false,
    });
    expect(bulkConfirmOutcome(A.id, { code: 'OPERATION_EXPIRED', message: '' })).toMatchObject({ result: 'EXPIRED', tone: 'muted' });
    expect(bulkConfirmOutcome(A.id, { code: 'OPERATION_VERSION_MISMATCH', message: '' })).toMatchObject({
      result: 'VERSION_CHANGED',
      label: 'Sürüm değişti',
      tone: 'pending',
    });
  });

  it('başkasının onayı, iptal, yetki ve ağ hatası ayrı gösterilir; bilinmeyen hata sunucunun mesajıyla', () => {
    expect(bulkConfirmOutcome(A.id, { code: 'OPERATION_ALREADY_APPLIED', message: '' }).result).toBe('ALREADY_APPLIED');
    expect(bulkConfirmOutcome(A.id, { code: 'OPERATION_NOT_PENDING', message: '' }).result).toBe('NOT_PENDING');
    expect(bulkConfirmOutcome(A.id, { code: 'WAREHOUSE_FORBIDDEN', message: 'Bu depoda yetkin yok.' })).toMatchObject({
      result: 'FORBIDDEN',
      message: 'Bu depoda yetkin yok.',
    });
    const network = bulkConfirmOutcome(A.id, { code: 'NETWORK_ERROR', message: "API'ye ulaşılamadı." });
    expect(network).toMatchObject({ result: 'NETWORK', retryable: true });
    expect(network.message).toContain('stok iki kez değişmez');
    expect(bulkConfirmOutcome(A.id, { code: 'WAREHOUSE_INACTIVE', message: 'Depo pasif.' })).toMatchObject({
      result: 'FAILED',
      message: 'Depo pasif.',
      retryable: false,
    });
  });
});

describe('bulkConfirmSummary', () => {
  it('sonuçları sayar; uygulananlar önce', () => {
    const outcomes = [
      bulkConfirmOutcome(A.id, { code: 'OPERATION_VERSION_MISMATCH', message: '' }),
      bulkConfirmOutcome(B.id, null),
      bulkConfirmOutcome(C.id, { code: 'INSUFFICIENT_STOCK', message: '' }),
      bulkConfirmOutcome(D.id, null),
    ];
    expect(bulkConfirmSummary(outcomes)).toBe('4 işlem gönderildi: 2 uygulandı, 1 yetersiz stok, 1 sürüm değişti.');
  });
});
