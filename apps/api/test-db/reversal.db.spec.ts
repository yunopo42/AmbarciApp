// Ters kayıtla geri alma (#78, mimari değişmez 7), gerçek veritabanında. Geri alma da onaydan geçer: istek stoğa
// dokunmadan onay bekleyen bir REVERSAL açar; stok yalnızca onay ucunda değişir. Maliyet kuralı "değeri tam geri
// çevir": geri alınan hareketin birim maliyeti kullanılır (docs/stok-islemleri.md, Ters kayıt). #79'dan taşınan
// senaryolar da burada: iki kez geri alma, aynı ters kaydın eşzamanlı iki onayı, eksiye düşüren ters kayıt, 15 dakika.
import { randomUUID } from 'node:crypto';

import {
  apiErrorSchema,
  confirmOperationResultSchema,
  IDEMPOTENCY_HEADER,
  operationPreviewSchema,
  operationSchema,
} from '@ambarci/shared';
import type { ConfirmOperationResult, Operation, OperationPreview } from '@ambarci/shared';
import { sql } from 'drizzle-orm';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStockFixture, raceWhileLocked } from './support/stock-fixture.js';
import type { Item, StockFixture } from './support/stock-fixture.js';

describe('Ters kayıtla geri alma (gerçek veritabanı, #78)', () => {
  let fx: StockFixture;
  let employee: string;
  let otherEmployee: string;

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'Ters kayıt' });
    employee = await fx.addMember('EMPLOYEE');
    otherEmployee = await fx.addMember('EMPLOYEE');
    // İki çalışan da yalnızca Merkez'de yetkili.
    await fx.db.execute(sql`insert into user_warehouse_access (organization_id, organization_user_id, warehouse_id)
      select organization_id, id, ${fx.main} from organization_users
      where organization_id = ${fx.org} and user_id in (${employee}, ${otherEmployee})`);
  });

  afterAll(async () => {
    await fx?.close();
  });

  const errorCode = (body: unknown): string => apiErrorSchema.parse(body).error.code;
  const reverse = (operationId: string, userId?: string): request.Test =>
    fx.call('post', `/v1/operations/${operationId}/reverse`, userId);

  async function reversalOf(operationId: string, userId?: string): Promise<Operation> {
    return operationSchema.parse((await reverse(operationId, userId).expect(201)).body);
  }

  async function previewOf(operationId: string, userId?: string): Promise<OperationPreview> {
    return operationPreviewSchema.parse((await fx.call('get', `/v1/operations/${operationId}/preview`, userId).expect(200)).body);
  }

  /** Geri al ve onayla (yönetici). */
  async function undo(operationId: string): Promise<ConfirmOperationResult> {
    const reversal = await reversalOf(operationId);
    return confirmOperationResultSchema.parse((await fx.confirm(reversal).expect(200)).body);
  }

  /** Çalışan adına aç ve onayla. */
  async function applyAs(userId: string, type: string, items: Item[]): Promise<Operation> {
    const opened = operationSchema.parse((await fx.call('post', '/v1/operations', userId).send({ type, items }).expect(201)).body);
    const confirmed = await fx
      .call('post', `/v1/operations/${opened.id}/confirm`, userId)
      .set(IDEMPOTENCY_HEADER, randomUUID())
      .send({ version: opened.version })
      .expect(200);
    return confirmOperationResultSchema.parse(confirmed.body).operation;
  }

  async function auditCount(operationId: string, action: string): Promise<number> {
    const [row] = await fx.db.execute<{ count: number }>(sql`
      select count(*)::int as count from audit_logs where entity_id = ${operationId} and action = ${action}`);
    return row?.count ?? -1;
  }

  /** İşlemin uygulanma anını geçmişe çeker (15 dakika kuralı). */
  async function appliedMinutesAgo(operationId: string, minutes: number): Promise<void> {
    await fx.db.execute(sql`update operations set applied_at = now() - make_interval(mins => ${minutes})
      where id = ${operationId}`);
  }

  it('giriş geri alınınca stok ve ortalama maliyet girişten önceki hâline döner; işlem REVERSED, denetim ve outbox', async () => {
    const product = await fx.addProduct('TK-GIRIS');
    await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '10', unitCost: '5' }]);
    // Yanlış maliyetle girilmiş alış: ortalama (10 × 5 + 10 × 50) ÷ 20 = 27,5.
    const wrong = (await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '10', unitCost: '50' }])).operation;
    expect(await fx.stockOf(fx.main, product)).toEqual({ quantity: '20.000', averageCost: '27.5000' });

    // İstek stoğa dokunmaz: ters kalemli, onay bekleyen bir REVERSAL açar.
    const reversal = await reversalOf(wrong.id);
    expect(reversal).toMatchObject({
      type: 'REVERSAL',
      status: 'PENDING_CONFIRMATION',
      reversedOperationId: wrong.id,
      items: [{ lineNo: 1, productId: product, warehouseId: fx.main, quantity: '10.000', unit: null, unitCost: null }],
    });
    expect(await fx.stockOf(fx.main, product)).toEqual({ quantity: '20.000', averageCost: '27.5000' });
    expect((await previewOf(reversal.id)).lines[0]?.stock).toEqual({ before: '20.000', after: '10.000', sufficient: true });

    const confirmed = confirmOperationResultSchema.parse((await fx.confirm(reversal).expect(200)).body);
    expect(confirmed.movements).toEqual([
      expect.objectContaining({ type: 'REVERSAL', quantityChange: '-10.000', unitCost: '50.0000', quantityAfter: '10.000', averageCostAfter: '5.0000' }),
    ]);
    expect(await fx.stockOf(fx.main, product)).toEqual({ quantity: '10.000', averageCost: '5.0000' });
    expect(await fx.statusOf(wrong.id)).toBe('REVERSED');
    expect(await fx.statusOf(reversal.id)).toBe('APPLIED');
    expect(await fx.writtenFor(reversal.id)).toEqual({ movements: 1, audits: 1, events: 1 });
    expect(await fx.writtenFor(wrong.id)).toEqual({ movements: 1, audits: 1, events: 1 });
    expect(await auditCount(wrong.id, 'operation.reversed')).toBe(1);

    // Kart: işlem "Geri alındı", ters kaydı altında; yeniden geri alınamaz.
    expect(await previewOf(wrong.id)).toMatchObject({
      status: 'REVERSED',
      reversal: { operationId: reversal.id, status: 'APPLIED' },
      canReverse: false,
    });
  });

  it('çıkış geri alınınca mal çıktığı andaki maliyetle geri girer; ortalama ağırlıklı değişir', async () => {
    const product = await fx.addProduct('TK-CIKIS');
    await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '10', unitCost: '5' }]);
    const out = (await fx.apply('STOCK_OUT', [{ productId: product, warehouseId: fx.main, quantity: '4' }])).operation;
    // Sonra 6 adet 10 TL'den: (6 × 5 + 6 × 10) ÷ 12 = 7,5.
    await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '6', unitCost: '10' }]);

    const { movements } = await undo(out.id);
    // 4 adet çıktığı maliyetle (5 TL) geri girer: (12 × 7,5 + 4 × 5) ÷ 16 = 6,875.
    expect(movements).toEqual([expect.objectContaining({ quantityChange: '4.000', unitCost: '5.0000' })]);
    expect(await fx.stockOf(fx.main, product)).toEqual({ quantity: '16.000', averageCost: '6.8750' });
  });

  it('transfer geri alınınca mal hedef depodan çıkar, kaynak depoya aynı maliyetle döner', async () => {
    const product = await fx.addProduct('TK-TRANSFER');
    await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '10', unitCost: '8' }]);
    const transfer = (
      await fx.apply('TRANSFER', [{ productId: product, warehouseId: fx.main, targetWarehouseId: fx.branch, quantity: '4' }])
    ).operation;

    const reversal = await reversalOf(transfer.id);
    expect(reversal.items).toEqual([
      expect.objectContaining({ lineNo: 1, warehouseId: fx.main, targetWarehouseId: fx.branch, quantity: '4.000' }),
    ]);
    // Önizleme: kaynak depo 6 → 10, hedef depo 4 → 0.
    expect((await previewOf(reversal.id)).lines[0]).toMatchObject({
      stock: { before: '6.000', after: '10.000', sufficient: true },
      targetStock: { before: '4.000', after: '0.000', sufficient: true },
    });

    const { movements } = confirmOperationResultSchema.parse((await fx.confirm(reversal).expect(200)).body);
    // Son yazılan önce geri alınır: önce hedef depodan çıkar, sonra kaynağa girer.
    expect(movements.map(({ warehouseId, quantityChange }) => ({ warehouseId, quantityChange }))).toEqual([
      { warehouseId: fx.branch, quantityChange: '-4.000' },
      { warehouseId: fx.main, quantityChange: '4.000' },
    ]);
    expect(await fx.stockOf(fx.main, product)).toEqual({ quantity: '10.000', averageCost: '8.0000' });
    // Hedef depoda stok sıfırlandı: ortalama değişmez.
    expect(await fx.stockOf(fx.branch, product)).toEqual({ quantity: '0.000', averageCost: '8.0000' });
  });

  it('sayım farkı geri alınır: fazla çıkar, noksan geri girer; farkı çıkmayan sayım geri alınamaz', async () => {
    const product = await fx.addProduct('TK-SAYIM');
    await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '10', unitCost: '4' }]);

    const surplus = (await fx.apply('COUNT', [{ productId: product, warehouseId: fx.main, quantity: '12' }])).operation;
    const surplusReversal = await reversalOf(surplus.id);
    // Ters kaydın kalemi sayılan miktar (12) değil, sayım farkıdır (2).
    expect(surplusReversal.items[0]?.quantity).toBe('2.000');
    await fx.confirm(surplusReversal).expect(200);
    expect(await fx.stockOf(fx.main, product)).toEqual({ quantity: '10.000', averageCost: '4.0000' });

    const shortage = (await fx.apply('COUNT', [{ productId: product, warehouseId: fx.main, quantity: '7' }])).operation;
    await undo(shortage.id);
    expect(await fx.stockOf(fx.main, product)).toEqual({ quantity: '10.000', averageCost: '4.0000' });

    const matched = (await fx.apply('COUNT', [{ productId: product, warehouseId: fx.main, quantity: '10' }])).operation;
    expect(errorCode((await reverse(matched.id).expect(409)).body)).toBe('NOTHING_TO_REVERSE');
  });

  it('stoğu eksiye düşürecek ters kayıt 409 INSUFFICIENT_STOCK alır; hiçbir şey yazılmaz', async () => {
    const product = await fx.addProduct('TK-EKSI');
    const entry = (await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '10', unitCost: '5' }])).operation;
    await fx.apply('STOCK_OUT', [{ productId: product, warehouseId: fx.main, quantity: '8' }]);

    // Girişin 8'i çıktı; 10 adetlik ters kayıt stoğu eksiye düşürürdü. İstek açılır, önizleme yetmediğini gösterir.
    const reversal = await reversalOf(entry.id);
    expect((await previewOf(reversal.id)).lines[0]?.stock).toMatchObject({ before: '2.000', sufficient: false });

    const response = await fx.confirm(reversal).expect(409);
    expect(apiErrorSchema.parse(response.body).error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [expect.objectContaining({ requested: '10.000', available: '2.000' })],
    });
    expect(await fx.stockOf(fx.main, product)).toEqual({ quantity: '2.000', averageCost: '5.0000' });
    expect(await fx.statusOf(entry.id)).toBe('APPLIED');
    expect(await fx.statusOf(reversal.id)).toBe('PENDING_CONFIRMATION');
    expect(await fx.writtenFor(reversal.id)).toEqual({ movements: 0, audits: 0, events: 0 });
    expect(await auditCount(entry.id, 'operation.reversed')).toBe(0);
  });

  it('bir işlem bir kez geri alınır; bekleyen ters kayıt tekrar istenince aynısı döner; iptalden sonra yeniden istenebilir', async () => {
    const product = await fx.addProduct('TK-BIRKEZ');
    const entry = (await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '5', unitCost: '1' }])).operation;

    const first = await reversalOf(entry.id);
    const again = operationSchema.parse((await reverse(entry.id).expect(200)).body);
    expect(again.id).toBe(first.id);

    // İptal edilen ters kayıt sayılmaz (kısmi benzersiz indeks): işlem yeniden geri alınabilir.
    await fx.call('post', `/v1/operations/${first.id}/cancel`).expect(200);
    const second = await reversalOf(entry.id);
    expect(second.id).not.toBe(first.id);
    await fx.confirm(second).expect(200);

    expect(errorCode((await reverse(entry.id).expect(409)).body)).toBe('OPERATION_ALREADY_REVERSED');
    expect(errorCode((await reverse(second.id).expect(409)).body)).toBe('OPERATION_NOT_REVERSIBLE');
    const pending = await fx.open('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '1' }]);
    expect(errorCode((await reverse(pending.id).expect(409)).body)).toBe('OPERATION_NOT_REVERSIBLE');
    expect(await fx.stockOf(fx.main, product)).toMatchObject({ quantity: '0.000' });
  });

  it('aynı ters kayda aynı anda iki onay (farklı anahtar): biri uygulanır, öteki 409; stok bir kez değişir', async () => {
    const product = await fx.addProduct('TK-CIFT');
    const entry = (await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '6', unitCost: '2' }])).operation;
    const reversal = await reversalOf(entry.id);

    const responses = await raceWhileLocked(fx.db, [sql`select 1 from operations where id = ${reversal.id} for update`], 2, () => [
      fx.confirm(reversal),
      fx.confirm(reversal),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(errorCode(responses.find((response) => response.status === 409)?.body)).toBe('OPERATION_ALREADY_APPLIED');
    expect(await fx.stockOf(fx.main, product)).toMatchObject({ quantity: '0.000' });
    expect(await fx.writtenFor(reversal.id)).toEqual({ movements: 1, audits: 1, events: 1 });
    expect(await auditCount(entry.id, 'operation.reversed')).toBe(1);
  });

  it('aynı işlem için aynı anda iki geri alma isteği: tek ters kayıt açılır, ikisi de onu alır', async () => {
    const product = await fx.addProduct('TK-ISTEK');
    const entry = (await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '3', unitCost: '1' }])).operation;

    const responses = await raceWhileLocked(fx.db, [sql`select 1 from operations where id = ${entry.id} for update`], 2, () => [
      reverse(entry.id),
      reverse(entry.id),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const ids = responses.map((response) => operationSchema.parse(response.body).id);
    expect(ids[0]).toBe(ids[1]);
    const [row] = await fx.db.execute<{ count: number }>(sql`
      select count(*)::int as count from operations where reversed_operation_id = ${entry.id}`);
    expect(row?.count).toBe(1);
  });

  it('15 dakika: açan çalışan süre içinde geri alır; süre geçince yalnızca yönetici; başkası alamaz; kural onayda yeniden', async () => {
    const product = await fx.addProduct('TK-SURE');
    await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '20', unitCost: '3' }]);
    const own = await applyAs(employee, 'STOCK_OUT', [{ productId: product, warehouseId: fx.main, quantity: '2' }]);

    // Kart: açan çalışan için "Geri al" ve son an; başka çalışan için yok.
    const ownPreview = await previewOf(own.id, employee);
    expect(ownPreview.canReverse).toBe(true);
    expect(ownPreview.reversibleUntil).not.toBeNull();
    expect((await previewOf(own.id, otherEmployee)).canReverse).toBe(false);
    expect(errorCode((await reverse(own.id, otherEmployee).expect(403)).body)).toBe('REVERSAL_FORBIDDEN');

    // Süre içinde istedi, onaylamadan süre geçti: onayda kilit altında yeniden denetlenir.
    const reversal = await reversalOf(own.id, employee);
    await appliedMinutesAgo(own.id, 16);
    const late = await fx
      .call('post', `/v1/operations/${reversal.id}/confirm`, employee)
      .set(IDEMPOTENCY_HEADER, randomUUID())
      .send({ version: reversal.version })
      .expect(403);
    expect(errorCode(late.body)).toBe('REVERSAL_WINDOW_PASSED');
    expect(await fx.stockOf(fx.main, product)).toMatchObject({ quantity: '18.000' });
    // Yönetici her zaman geri alabilir.
    await fx.confirm(reversal).expect(200);
    expect(await fx.stockOf(fx.main, product)).toMatchObject({ quantity: '20.000' });

    // Süre geçmiş işlem: çalışan istekte reddedilir, kartta düğme yok; yönetici açabilir.
    const old = await applyAs(employee, 'STOCK_OUT', [{ productId: product, warehouseId: fx.main, quantity: '1' }]);
    await appliedMinutesAgo(old.id, 16);
    expect((await previewOf(old.id, employee)).canReverse).toBe(false);
    expect(errorCode((await reverse(old.id, employee).expect(403)).body)).toBe('REVERSAL_WINDOW_PASSED');
    await reversalOf(old.id);
  });

  it('açılış stoğunu yalnızca yönetici geri alır', async () => {
    const product = await fx.addProduct('TK-ACILIS');
    const opening = (await fx.apply('OPENING', [{ productId: product, warehouseId: fx.main, quantity: '7', unitCost: '2' }])).operation;

    const denied = await reverse(opening.id, employee).expect(403);
    expect(apiErrorSchema.parse(denied.body).error).toMatchObject({
      code: 'REVERSAL_FORBIDDEN',
      message: 'Açılış stoğunu yalnızca yönetici geri alabilir.',
    });
    await undo(opening.id);
    expect(await fx.stockOf(fx.main, product)).toMatchObject({ quantity: '0.000' });
  });

  it('değişmez: her depoda stok, o deponun hareketlerinin toplamıdır (ters kayıtlar dahil)', async () => {
    const rows = await fx.db.execute<{ quantity: string; moved: string }>(sql`
      select i.quantity::text as quantity, coalesce((
        select sum(m.quantity_change) from inventory_movements m
        where m.organization_id = i.organization_id and m.warehouse_id = i.warehouse_id and m.product_id = i.product_id
      ), 0)::numeric(14,3)::text as moved
      from inventory i where i.organization_id = ${fx.org}`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.quantity).toBe(row.moved);
    }
  });
});
