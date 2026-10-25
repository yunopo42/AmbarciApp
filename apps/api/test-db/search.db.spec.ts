// Türkçe arama dönüşümünün veritabanındaki karşılığı (private.fold_search, 0005_trigram_search.sql) ve trigram
// indeksleri. Asistanın ürün araması kolonu ve aranan metni aynı biçime getirip benzerlikle arar. SQL fonksiyonu
// foldForSearch'ten farklı sonuç verseydi ekrandaki aramanın bulduğu ürünü asistan bulamayabilirdi.
import { createDatabase } from '@ambarci/db';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { foldForSearch } from '../src/common/search.js';
import { databaseUrl } from './support/stock-fixture.js';

const connection = createDatabase(databaseUrl(), { maxConnections: 1 });
const { db } = connection;

afterAll(async () => {
  await connection.close();
});

const SAMPLES = [
  'YANGIN',
  'yangın',
  'yangin',
  'İZMİR',
  'Işık',
  'ŞEKER ÇÖĞÜ',
  'NYM Kablo 3x2,5 mm²',
  'Kaçak Akım Rölesi 40A 30mA',
  ' ıİIi ',
  '%_\\',
];

/** EXPLAIN çıktısının satırları tek metin olarak. */
async function plan(query: ReturnType<typeof sql>): Promise<string> {
  const rows = await db.transaction(async (tx) => {
    // Tablolar küçük olduğu için planlayıcı sıralı taramayı seçer; indeksin kullanılabildiğini görmek için kapatılır.
    await tx.execute(sql`set local enable_seqscan = off`);
    return tx.execute<{ 'QUERY PLAN': string }>(sql`explain ${query}`);
  });
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe('Türkçe arama dönüşümü ve trigram indeksleri (gerçek veritabanı)', () => {
  it('private.fold_search, foldForSearch ile aynı sonucu verir', async () => {
    const values = sql.join(
      SAMPLES.map((sample) => sql`(${sample}::text)`),
      sql`, `,
    );
    const rows = await db.execute<{ input: string; folded: string }>(
      sql`select input, private.fold_search(input) as folded from (values ${values}) as t(input)`,
    );
    expect(rows).toHaveLength(SAMPLES.length);
    for (const row of rows) {
      expect(row.folded, row.input).toBe(foldForSearch(row.input));
    }
    expect(foldForSearch('YANGIN')).toBe('yangin');
  });

  it('ürün adı ve alternatif ad aramasında trigram indeksi kullanılır', async () => {
    // Sorgudaki ifade indeksteki ifadeyle aynı yazılmazsa (ör. lower(name) % ...) indeks hiç kullanılamaz. Şirket
    // koşulu sorguya eklenmez: küçük tabloda planlayıcı şirket kolonu için başka bir B-tree indeksini seçebilir ve
    // test istatistiklere bağlı olurdu. Benzerlik koşulunu ise yalnızca trigram indeksi karşılayabilir.
    const products = await plan(
      sql`select id from products where private.fold_search(name) % private.fold_search(${'kabllo'}::text)`,
    );
    const aliases = await plan(
      sql`select id from product_aliases where private.fold_search(alias) % private.fold_search(${'otomat'}::text)`,
    );
    expect(products).toContain('products_org_name_trgm_idx');
    expect(aliases).toContain('product_aliases_org_alias_trgm_idx');
  });
});
