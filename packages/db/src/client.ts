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
}

/**
 * Veritabanı bağlantı havuzu açar. Yalnızca backend kullanır; DATABASE_URL istemci paketlerine girmez.
 * postgres.js bağlantıyı ilk sorguda kurar; bu fonksiyon ağa çıkmaz.
 */
export function createDatabase(databaseUrl: string, options: DatabaseOptions = {}): DatabaseConnection {
  const client = postgres(databaseUrl, { max: options.maxConnections ?? 5, onnotice: () => undefined });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
