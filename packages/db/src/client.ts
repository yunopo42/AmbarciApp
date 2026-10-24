import type { PgDatabase } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase, PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../schema/index.ts';

/** Şema tipleriyle Drizzle bağlantısı. API'deki repository'ler bunu kullanır. */
export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Sorgu çalıştırabilen her şey: bağlantı havuzu ya da açık bir transaction. Birden çok modülün tek
 * transaction'da yazması gerektiğinde (stok onayı) repository'ler transaction'ı bu tiple parametre olarak alır.
 */
export type DbExecutor = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

export interface DatabaseConnection {
  db: Database;
  /** Havuzdaki bağlantıları kapatır (uygulama kapanırken). */
  close: () => Promise<void>;
}

export interface DatabaseOptions {
  /** Havuzdaki en fazla bağlantı. Supabase ücretsiz planda session pooler bağlantı sayısı sınırlıdır. */
  maxConnections?: number;
  /** Veritabanına giden her sorguda çağrılır (gecikme ölçümünde transaction başına sorgu sayısı için). */
  onQuery?: (query: string) => void;
}

/**
 * Veritabanı bağlantı havuzu açar. Yalnızca backend kullanır; DATABASE_URL istemci paketlerine girmez.
 * postgres.js bağlantıyı ilk sorguda kurar; bu fonksiyon ağa çıkmaz.
 */
export function createDatabase(databaseUrl: string, options: DatabaseOptions = {}): DatabaseConnection {
  const { onQuery } = options;
  const client = postgres(databaseUrl, {
    max: options.maxConnections ?? 5,
    onnotice: () => undefined,
    ...(onQuery ? { debug: (_connection: number, query: string) => onQuery(query) } : {}),
  });
  return { db: drizzle(preparedByDefault(client), { schema }), close: () => client.end() };
}

/**
 * Sorguları hazırlanmış ifade (prepared statement) olarak gönderir.
 *
 * Drizzle'ın postgres.js sürücüsü her sorguyu sql.unsafe(…, { prepare: false }) ile gönderir. postgres.js,
 * hazırlanmamış parametreli bir sorguda önce parametre tiplerini sorar (Parse + Describe), cevabı bekler, sonra
 * çalıştırır: her sorgu veritabanına iki gidiş-dönüş olur. Hazırlanmış ifade bağlantı başına önbelleğe alınır;
 * aynı sorgunun sonraki çalıştırmaları tek gidiş-dönüştür. Onay transaction'ı 12–16 sorgu olduğu ve kilitler
 * transaction boyunca tutulduğu için bu, kilit süresini yaklaşık yarıya indirir (ölçüm: docs/veritabani.md, #34).
 *
 * Sarmalayıcı unsafe çağrısını hazırlanmış yapar; begin ve savepoint içindeki transaction bağlantısını da aynı
 * şekilde sarar (Drizzle transaction'da o bağlantının unsafe'ini çağırır). Supabase'in session pooler'ı (5432)
 * hazırlanmış ifadeleri destekler; transaction pooler (6543) desteklemez, DATABASE_URL o adres olmamalıdır.
 */
function preparedByDefault<T extends object>(sql: T): T {
  return new Proxy(sql, {
    get(target, property, receiver): unknown {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') {
        return value;
      }
      if (property === 'unsafe') {
        return (query: string, parameters?: unknown[], queryOptions?: object): unknown =>
          value.call(target, query, parameters, { ...queryOptions, prepare: true });
      }
      if (property === 'begin' || property === 'savepoint') {
        // begin(fn), begin(seçenek, fn), savepoint(fn), savepoint(ad, fn): son argüman transaction'ı alan fonksiyondur.
        return (...args: unknown[]): unknown => {
          const callback = args.at(-1);
          if (typeof callback !== 'function') {
            return value.apply(target, args);
          }
          const wrapped = (transaction: object): unknown => callback(preparedByDefault(transaction));
          return value.apply(target, [...args.slice(0, -1), wrapped]);
        };
      }
      return value;
    },
  });
}
