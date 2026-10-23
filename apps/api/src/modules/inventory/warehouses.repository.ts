import { warehouses } from '@ambarci/db';
import type { Database, DbExecutor } from '@ambarci/db';
import type { Warehouse } from '@ambarci/shared';
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
