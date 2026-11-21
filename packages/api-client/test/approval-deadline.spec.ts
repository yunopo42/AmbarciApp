import { describe, expect, it } from 'vitest';

import { approvalDeadline, nextDeadline } from '../src/index.js';

// Onay kuyruğunda sohbet önerisinin kalan süresi (#87).

const NOW = new Date('2026-11-21T10:00:00.000Z');

describe('approvalDeadline', () => {
  it('süresi olmayan işlemde etiket yok', () => {
    expect(approvalDeadline(null, NOW)).toEqual({ expired: false, label: null });
  });

  it('kalan dakikayı aşağı yuvarlar; bir dakikadan azı ayrı söyler', () => {
    expect(approvalDeadline('2026-11-21T10:12:59.000Z', NOW)).toEqual({ expired: false, label: '12 dk kaldı' });
    expect(approvalDeadline('2026-11-21T10:00:30.000Z', NOW)).toEqual({ expired: false, label: "1 dk'dan az kaldı" });
  });

  it('son onay anı geldiyse ya da geçtiyse süresi dolmuş sayılır', () => {
    expect(approvalDeadline('2026-11-21T10:00:00.000Z', NOW)).toEqual({ expired: true, label: 'Süresi doldu' });
    expect(approvalDeadline('2026-11-21T09:59:00.000Z', NOW)).toEqual({ expired: true, label: 'Süresi doldu' });
  });
});

describe('nextDeadline', () => {
  it('şu andan sonraki en yakın son onay anını seçer; geçmiş ve boş olanları atlar', () => {
    const next = nextDeadline(
      [null, '2026-11-21T09:59:00.000Z', '2026-11-21T10:20:00.000Z', '2026-11-21T10:05:00.000Z'],
      NOW,
    );
    expect(next?.toISOString()).toBe('2026-11-21T10:05:00.000Z');
    expect(nextDeadline([null, '2026-11-21T09:00:00.000Z'], NOW)).toBeNull();
  });
});
