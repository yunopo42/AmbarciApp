import { describe, expect, it } from 'vitest';

import { cardActionFailure, confirmKeyFor, operationCardView } from '../src/index.js';
import type { CardPreview } from '../src/index.js';

// Sohbetteki işlem kartının ortak kuralları (#76, #77): başlık, rozet, kalemler, düğmeler, onay anahtarı ve hatalar.

const NOW = new Date('2026-11-19T10:00:00.000Z');
const MAIN = { id: '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e01', name: 'Merkez Depo' };
const BRANCH = { id: '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e02', name: 'Ostim Depo' };

function preview(overrides: Partial<CardPreview> = {}, line: Partial<CardPreview['lines'][number]> = {}): CardPreview {
  return {
    operationId: '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e99',
    type: 'STOCK_OUT',
    status: 'PENDING_CONFIRMATION',
    version: 1,
    partyId: null,
    partyName: 'Yıldız Yapı İnşaat',
    note: null,
    createdAt: '2026-11-19T09:50:00.000Z',
    expiresAt: '2026-11-19T10:20:00.000Z',
    lines: [
      {
        lineNo: 1,
        productId: '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e10',
        sku: 'PRZ-UCL-15',
        productName: 'Üçlü grup priz, 1,5 m kablolu',
        baseUnit: 'adet',
        quantity: '2.000',
        unit: 'koli',
        baseQuantity: '40.000',
        unitCost: null,
        warehouse: MAIN,
        targetWarehouse: null,
        stock: { before: '120.000', after: '80.000', sufficient: true },
        targetStock: null,
        ...line,
      },
    ],
    ...overrides,
  };
}

describe('operationCardView', () => {
  it('onay bekleyen çıkış: tasarımdaki alanlar, rozet, üç düğme ve not', () => {
    expect(operationCardView(preview(), NOW)).toEqual({
      title: 'Stok çıkışı önerisi',
      status: { label: 'Onay bekliyor', tone: 'pending' },
      party: 'Yıldız Yapı İnşaat',
      note: null,
      lines: [
        {
          lineNo: 1,
          product: 'Üçlü grup priz, 1,5 m kablolu',
          sku: 'PRZ-UCL-15',
          quantityLabel: 'Miktar',
          quantity: '2 koli (40 adet)',
          warehouse: 'Merkez Depo',
          stockChange: { before: '120 adet', after: '80 adet' },
          targetStockChange: null,
          shortage: null,
        },
      ],
      canConfirm: true,
      canCancel: true,
      canEdit: true,
      footnote: 'Onaylamadan stok değişmez.',
      expiresAt: '2026-11-19T10:20:00.000Z',
    });
  });

  it('ana birimde girilen miktar tek parça; transferde iki depo ve iki stok; sayımda "Sayılan"', () => {
    const transfer = operationCardView(
      preview(
        { type: 'TRANSFER', partyName: null },
        {
          unit: null,
          quantity: '15.500',
          baseQuantity: '15.500',
          targetWarehouse: BRANCH,
          targetStock: { before: '0.000', after: '15.500', sufficient: true },
        },
      ),
      NOW,
    );
    expect(transfer.title).toBe('Transfer önerisi');
    expect(transfer.lines[0]).toMatchObject({
      quantity: '15,5 adet',
      warehouse: 'Merkez Depo → Ostim Depo',
      targetStockChange: { before: '0 adet', after: '15,5 adet' },
    });
    const count = operationCardView(preview({ type: 'COUNT' }, { stock: { before: '120.000', after: '1112.000', sufficient: true } }), NOW);
    expect(count.lines[0]).toMatchObject({ quantityLabel: 'Sayılan', stockChange: { before: '120 adet', after: '1.112 adet' } });
  });

  it('stok yetmiyorsa eksi değer gösterilmez, açıklama çıkar; onay kapalı, iptal ve düzenleme açık', () => {
    const view = operationCardView(preview({}, { stock: { before: '35.000', after: '-5.000', sufficient: false } }), NOW);
    expect(view.lines[0]).toMatchObject({ stockChange: null, shortage: 'Stok yetmiyor: 35 adet var, 40 adet gerekiyor.' });
    expect(view).toMatchObject({ canConfirm: false, canCancel: true, canEdit: true });
    expect(view.footnote).toMatch(/onaylanamaz/);
    expect(JSON.stringify(view)).not.toMatch(/-5|−5/);
  });

  it('süre cihazda dolmuşsa kart "Süresi doldu" gösterir ve düğmeleri kapatır (sunucu henüz bilmese de)', () => {
    const view = operationCardView(preview(), new Date('2026-11-19T10:20:00.000Z'));
    expect(view).toMatchObject({
      title: 'Stok çıkışı',
      status: { label: 'Süresi doldu', tone: 'muted' },
      canConfirm: false,
      canCancel: false,
      canEdit: false,
      expiresAt: null,
    });
    expect(view.footnote).toMatch(/süresi doldu/);
  });

  it('sonuçlanmış öneri: uygulandı yeşil, iptal ve süre dolumu gri; düğme yok; ekran fişinde süre yok', () => {
    const applied = operationCardView(preview({ status: 'APPLIED', expiresAt: null }, { stock: null }), NOW);
    expect(applied).toMatchObject({ title: 'Stok çıkışı', status: { label: 'Uygulandı', tone: 'applied' }, canConfirm: false, footnote: null });
    expect(applied.lines[0]?.stockChange).toBeNull();
    expect(operationCardView(preview({ status: 'CANCELLED' }), NOW)).toMatchObject({ status: { label: 'İptal edildi' }, canCancel: false });
    expect(operationCardView(preview({ status: 'EXPIRED' }), NOW).status).toEqual({ label: 'Süresi doldu', tone: 'muted' });
    expect(operationCardView(preview({ expiresAt: null }), new Date('2030-01-01T00:00:00.000Z')).canConfirm).toBe(true);
  });
});

describe('confirmKeyFor', () => {
  it('aynı sürümde aynı anahtar (tekrar denemede stok bir kez değişir); sürüm değişince yeni anahtar', () => {
    let made = 0;
    const make = (): string => `anahtar-${++made}`;
    const first = confirmKeyFor(null, 1, make);
    expect(first).toEqual({ version: 1, key: 'anahtar-1' });
    expect(confirmKeyFor(first, 1, make)).toBe(first);
    expect(confirmKeyFor(first, 2, make)).toEqual({ version: 2, key: 'anahtar-2' });
    expect(made).toBe(2);
  });
});

describe('cardActionFailure', () => {
  it('sürüm, başka cihazdan onay, süre, stok ve durum hatası kartı yeniler; ağ hatası yenilemez, tekrar güvenli', () => {
    expect(cardActionFailure({ code: 'OPERATION_VERSION_MISMATCH', message: 'x' })).toEqual({
      message: 'Öneri değişti. Güncel hâlini kontrol edip yeniden onayla.',
      refresh: true,
    });
    expect(cardActionFailure({ code: 'OPERATION_ALREADY_APPLIED', message: 'x' }).refresh).toBe(true);
    for (const code of ['INSUFFICIENT_STOCK', 'OPERATION_EXPIRED', 'OPERATION_NOT_PENDING']) {
      expect(cardActionFailure({ code, message: 'API mesajı' })).toEqual({ message: 'API mesajı', refresh: true });
    }
    expect(cardActionFailure({ code: 'NETWORK_ERROR', message: "API'ye ulaşılamadı." })).toEqual({
      message: "API'ye ulaşılamadı. Tekrar denersen stok iki kez değişmez.",
      refresh: false,
    });
    expect(cardActionFailure({ code: 'WAREHOUSE_FORBIDDEN', message: 'Bu depoda işlem yetkiniz yok.' }).refresh).toBe(false);
  });
});
