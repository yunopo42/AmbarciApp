import { warehouses } from '@ambarci/db';
import type { Database, DbExecutor } from '@ambarci/db';
import type { Warehouse, WarehouseInput } from '@ambarci/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';

const COLUMNS = {
  id: warehouses.id,
  name: warehouses.name,
  type: warehouses.type,
  isActive: warehouses.isActive,
};

/** Depo sorguları; her sorgu aktif şirketin kimliğiyle sınırlanır. */
@Injectable()
export class WarehousesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  listByOrganization(organizationId: string): Promise<Warehouse[]> {
    return this.db
      .select(COLUMNS)
      .from(warehouses)
      .where(eq(warehouses.organizationId, organizationId))
      .orderBy(asc(warehouses.name));
  }

  async findById(organizationId: string, warehouseId: string): Promise<Warehouse | null> {
    const [row] = await this.db
      .select(COLUMNS)
      .from(warehouses)
      .where(and(eq(warehouses.organizationId, organizationId), eq(warehouses.id, warehouseId)))
      .limit(1);
    return row ?? null;
  }

  async create(organizationId: string, input: WarehouseInput): Promise<Warehouse> {
    const [row] = await this.db
      .insert(warehouses)
      .values({ organizationId, name: input.name, type: input.type, isActive: input.isActive })
      .returning(COLUMNS);
    if (!row) {
      throw new Error('Depo eklenemedi.');
    }
    return row;
  }

  /** Depo bu şirkette yoksa null döner. Depo silinmez; pasife almak için isActive: false. */
  async update(organizationId: string, warehouseId: string, input: WarehouseInput): Promise<Warehouse | null> {
    const [row] = await this.db
      .update(warehouses)
      .set({ name: input.name, type: input.type, isActive: input.isActive })
      .where(and(eq(warehouses.organizationId, organizationId), eq(warehouses.id, warehouseId)))
      .returning(COLUMNS);
    return row ?? null;
  }

  /** Verilen depolardan bu şirkette var olanların aktiflik durumu (yoksa listede yer almaz). */
  findStatuses(
    executor: DbExecutor,
    organizationId: string,
    warehouseIds: string[],
  ): Promise<{ id: string; isActive: boolean }[]> {
    return executor
      .select({ id: warehouses.id, isActive: warehouses.isActive })
      .from(warehouses)
      .where(and(eq(warehouses.organizationId, organizationId), inArray(warehouses.id, warehouseIds)));
  }
}
