// Onay transaction'ının eşzamanlılık ve geri alma davranışı (#34), gerçek veritabanında. Yarışlar rastlantıya
// bırakılmaz: test önce satırı kendi transaction'ında kilitler, istekleri gönderir, ikisinin de kilit beklediğini
// görünce kilidi bırakır (support/stock-fixture.ts, raceWhileLocked).
import { randomUUID } from 'node:crypto';

import { apiErrorSchema, confirmOperationResultSchema } from '@ambarci/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresErrorOf } from '../src/common/postgres-error.js';
import { createStockFixture, lockStockRow, raceWhileLocked } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

const DEADLOCK_DETECTED = '40P01';

describe('Eşzamanlı onay ve geri alma (gerçek veritabanı)', () => {
  let fx: StockFixture;

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'Eşzamanlılık' });
  });

  afterAll(async () => {
    await fx?.close();
  });

  const errorCode = (body: unknown): string => apiErrorSchema.parse(body).error.code;

  it('aynı stoktan iki çıkış aynı anda: yalnızca stoğun yettiği uygulanır, stok eksiye düşmez', async () => {
    const product = await fx.addProduct('ES-CIKIS');
    await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '10', unitCost: '5' }]);
    const first = await fx.open('STOCK_OUT', [{ productId: product, warehouseId: fx.main, quantity: '7' }]);
    const second = await fx.open('STOCK_OUT', [{ productId: product, warehouseId: fx.main, quantity: '7' }]);

    const responses = await raceWhileLocked(fx.db, [lockStockRow(fx.org, fx.main, product)], 2, () => [
      fx.confirm(first),
      fx.confirm(second),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const loser = responses.find((response) => response.status === 409);
    expect(apiErrorSchema.parse(loser?.body).error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [expect.objectContaining({ requested: '7.000', available: '3.000' })],
    });
    expect(await fx.stockOf(fx.main, product)).toEqual({ quantity: '3.000', averageCost: '5.0000' });
    const [row] = await fx.db.execute<{ outs: number }>(sql`
      select count(*)::int as outs from inventory_movements
      where organization_id = ${fx.org} and product_id = ${product} and type = 'OUT'`);
    expect(row?.outs).toBe(1);
  });

  it("kilit sırası olmasaydı: ters sırayla kilitleyen iki transaction'dan birini PostgreSQL iptal eder", async () => {
    // Bu test uygulamanın değil, korunduğumuz tehlikenin gösterimi: A→B ve B→A sırasıyla kilit alan iki
    // transaction birbirini bekler; PostgreSQL döngüyü görür ve birini deadlock hatasıyla geri alır.
    const a = await fx.addProduct('DL-A');
    const b = await fx.addProduct('DL-B');
    await fx.apply('STOCK_IN', [
      { productId: a, warehouseId: fx.main, quantity: '5' },
      { productId: b, warehouseId: fx.main, quantity: '5' },
    ]);
    let aLocked!: () => void;
    let bLocked!: () => void;
    const aIsLocked = new Promise<void>((resolve) => (aLocked = resolve));
    const bIsLocked = new Promise<void>((resolve) => (bLocked = resolve));

    const results = await Promise.allSettled([
      fx.db.transaction(async (tx) => {
        await tx.execute(lockStockRow(fx.org, fx.main, a));
        aLocked();
        await bIsLocked;
        await tx.execute(lockStockRow(fx.org, fx.main, b));
      }),
      fx.db.transaction(async (tx) => {
        await tx.execute(lockStockRow(fx.org, fx.main, b));
        bLocked();
        await aIsLocked;
        await tx.execute(lockStockRow(fx.org, fx.main, a));
      }),
    ]);

    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(postgresErrorOf((rejected[0] as PromiseRejectedResult).reason).code).toBe(DEADLOCK_DETECTED);
  });

  it('API: kalemleri ters sırada olan iki işlem aynı anda onaylanınca ikisi de tamamlanır (deadlock yok)', async () => {
    const a = await fx.addProduct('SIRA-A');
    const b = await fx.addProduct('SIRA-B');
    await fx.apply('STOCK_IN', [
      { productId: a, warehouseId: fx.main, quantity: '10' },
      { productId: b, warehouseId: fx.main, quantity: '10' },
    ]);
    const forward = await fx.open('STOCK_OUT', [
      { productId: a, warehouseId: fx.main, quantity: '1' },
      { productId: b, warehouseId: fx.main, quantity: '1' },
    ]);
    const backward = await fx.open('STOCK_OUT', [
      { productId: b, warehouseId: fx.main, quantity: '1' },
      { productId: a, warehouseId: fx.main, quantity: '1' },
    ]);

    // İki satır da test tarafından kilitliyken iki onay gönderilir. Uygulama kilitleri kalem sırasıyla alsaydı biri
    // A'yı, öteki B'yi alır ve yukarıdaki testteki döngü oluşurdu. Ürün kimliği sırası ikisine de aynı sırayı verir.
    const responses = await raceWhileLocked(
      fx.db,
      [lockStockRow(fx.org, fx.main, a), lockStockRow(fx.org, fx.main, b)],
      2,
      () => [fx.confirm(forward), fx.confirm(backward)],
    );

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await fx.stockOf(fx.main, a)).toMatchObject({ quantity: '8.000' });
    expect(await fx.stockOf(fx.main, b)).toMatchObject({ quantity: '8.000' });
  });

  it('aynı işlem için aynı anda gelen iki onay (aynı anahtar): stok bir kez değişir, ikisi aynı cevabı alır', async () => {
    const product = await fx.addProduct('CIFT-1');
    await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '5' }]);
    const operation = await fx.open('STOCK_OUT', [{ productId: product, warehouseId: fx.main, quantity: '2' }]);
    const key = randomUUID();

    // Bu kez işlem satırı kilitlenir: iki istek de işlemi kilitlemeye çalışırken bekler.
    const responses = await raceWhileLocked(
      fx.db,
      [sql`select 1 from operations where id = ${operation.id} for update`],
      2,
      () => [fx.confirm(operation, key), fx.confirm(operation, key)],
    );

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(confirmOperationResultSchema.parse(responses[0]?.body)).toEqual(
      confirmOperationResultSchema.parse(responses[1]?.body),
    );
    expect(await fx.stockOf(fx.main, product)).toMatchObject({ quantity: '3.000' });
    expect(await fx.writtenFor(operation.id)).toEqual({ movements: 1, audits: 1, events: 1 });
  });

  it('aynı işlem için aynı anda gelen iki onay (farklı anahtar): biri uygulanır, öteki 409 alır', async () => {
    const product = await fx.addProduct('CIFT-2');
    await fx.apply('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '5' }]);
    const operation = await fx.open('STOCK_OUT', [{ productId: product, warehouseId: fx.main, quantity: '2' }]);

    const responses = await raceWhileLocked(
      fx.db,
      [sql`select 1 from operations where id = ${operation.id} for update`],
      2,
      () => [fx.confirm(operation), fx.confirm(operation)],
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(errorCode(responses.find((response) => response.status === 409)?.body)).toBe('OPERATION_ALREADY_APPLIED');
    expect(await fx.stockOf(fx.main, product)).toMatchObject({ quantity: '3.000' });
    expect(await fx.writtenFor(operation.id)).toEqual({ movements: 1, audits: 1, events: 1 });
  });

  it('çok kalemli işlemde bir kalem yetmezse hiçbir kalem yazılmaz: stok, maliyet, yeni satır, denetim, outbox', async () => {
    const enough = await fx.addProduct('RB-YETER');
    const short = await fx.addProduct('RB-YETMEZ');
    await fx.apply('STOCK_IN', [
      { productId: enough, warehouseId: fx.main, quantity: '10', unitCost: '5' },
      { productId: short, warehouseId: fx.main, quantity: '1', unitCost: '5' },
    ]);
    // 1. ve 3. kalem uygulanabilir; 2. kalem yetmez. Transfer hedefi Ostim'de bu ürünlerin satırı henüz yok.
    const operation = await fx.open('TRANSFER', [
      { productId: enough, warehouseId: fx.main, targetWarehouseId: fx.branch, quantity: '4' },
      { productId: short, warehouseId: fx.main, targetWarehouseId: fx.branch, quantity: '5' },
      { productId: enough, warehouseId: fx.main, targetWarehouseId: fx.branch, quantity: '1' },
    ]);

    const response = await fx.confirm(operation).expect(409);
    expect(apiErrorSchema.parse(response.body).error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [expect.objectContaining({ lineNo: 2, requested: '5.000', available: '1.000' })],
    });
    // Kaynak depo olduğu gibi; hedef depoda açılan satırlar da geri alındı.
    expect(await fx.stockOf(fx.main, enough)).toEqual({ quantity: '10.000', averageCost: '5.0000' });
    expect(await fx.stockOf(fx.main, short)).toEqual({ quantity: '1.000', averageCost: '5.0000' });
    expect(await fx.stockOf(fx.branch, enough)).toBeNull();
    expect(await fx.stockOf(fx.branch, short)).toBeNull();
    expect(await fx.writtenFor(operation.id)).toEqual({ movements: 0, audits: 0, events: 0 });
    expect(await fx.statusOf(operation.id)).toBe('PENDING_CONFIRMATION');
  });

  it('son adımda hata olsa bile (anahtar başka işlemde kullanılmış) önceden yazılan stok ve maliyet geri alınır', async () => {
    const product = await fx.addProduct('RB-SON');
    const key = randomUUID();
    const first = await fx.open('STOCK_IN', [{ productId: product, warehouseId: fx.main, quantity: '10', unitCost: '5' }]);
    await fx.confirm(first, key).expect(200);

    // Bu girişin hareketleri ve yeni ortalaması ((10 × 5 + 10 × 20) ÷ 20 = 12,5) yazılır; ardından işlem APPLIED
    // yapılırken anahtar kısıtı ihlal edilir. Transaction'ın tamamı geri alınmalı.
    const operation = await fx.open('STOCK_IN', [
      { productId: product, warehouseId: fx.main, quantity: '10', unitCost: '20' },
      { productId: product, warehouseId: fx.branch, quantity: '3', unitCost: '20' },
    ]);
    const response = await fx.confirm(operation, key).expect(409);
    expect(errorCode(response.body)).toBe('IDEMPOTENCY_KEY_REUSED');

    expect(await fx.stockOf(fx.main, product)).toEqual({ quantity: '10.000', averageCost: '5.0000' });
    expect(await fx.stockOf(fx.branch, product)).toBeNull();
    expect(await fx.writtenFor(operation.id)).toEqual({ movements: 0, audits: 0, events: 0 });
    expect(await fx.statusOf(operation.id)).toBe('PENDING_CONFIRMATION');
  });
});
