import { sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';

// Türkçe arama. PostgreSQL'in ILIKE'ı büyük "I"yı "i"ye çevirir; Türkçede küçüğü "ı"dır. Bu yüzden "YANGIN"
// araması "yangın"ı bulmaz, İngilizce klavyeyle yazılan "yangin" de bulmaz. Arama metni ve kolon aynı biçime
// getirilir: I, İ ve ı harflerinin hepsi "i" olur, sonra küçük harfe çevrilir. Aynı dönüşümün veritabanındaki
// karşılığı private.fold_search'tür (0005_trigram_search.sql); benzerlik araması (pg_trgm) onun üzerine kurulu.
// Biri değişirse öteki de değişmeli: test-db/search.db.spec.ts ikisinin aynı sonucu verdiğini denetler.

const DOTTED_AND_DOTLESS = /[İIı]/g;

/** Arama metninin karşılaştırma biçimi (SQL'deki foldedColumn ile aynı dönüşüm). */
export function foldForSearch(value: string): string {
  return value.replace(DOTTED_AND_DOTLESS, 'i').toLowerCase();
}

/** Kolonun karşılaştırma biçimi: lower(translate(kolon, 'İIı', 'iii')). */
export function foldedColumn(column: AnyColumn): SQL {
  return sql`lower(translate(${column}, 'İIı', 'iii'))`;
}

/** LIKE deseninde özel karakterler (%, _, \) düz karakter olarak kalsın. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Kolon, arama metnini içeriyor mu (Türkçe harf ve büyük/küçük farkı gözetmeden). */
export function containsText(column: AnyColumn, search: string): SQL {
  return sql`${foldedColumn(column)} like ${`%${escapeLike(foldForSearch(search))}%`}`;
}

/** Kolon, arama metniyle başlıyor mu (ör. vergi numarası). */
export function startsWithText(column: AnyColumn, search: string): SQL {
  return sql`${foldedColumn(column)} like ${`${escapeLike(foldForSearch(search))}%`}`;
}
