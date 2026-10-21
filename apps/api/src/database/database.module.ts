import { createDatabase } from '@ambarci/db';
import type { Database, DatabaseConnection } from '@ambarci/db';
import { Global, Inject, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

/** Drizzle bağlantısının enjeksiyon anahtarı. Yalnızca repository'ler kullanır. */
export const DATABASE = Symbol('DATABASE');
const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');

function readDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    // Açılışta durmak, hatayı ilk sorguda değil deploy sırasında gösterir.
    throw new Error(
      "DATABASE_URL tanımlı değil. Yerelde .env dosyasına, Render'da servis ortam değişkenlerine (Session pooler adresi) ekleyin.",
    );
  }
  return value;
}

@Global()
@Module({
  providers: [
    { provide: DATABASE_CONNECTION, useFactory: (): DatabaseConnection => createDatabase(readDatabaseUrl()) },
    {
      provide: DATABASE,
      useFactory: (connection: DatabaseConnection): Database => connection.db,
      inject: [DATABASE_CONNECTION],
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
