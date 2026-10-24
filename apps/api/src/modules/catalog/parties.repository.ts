import { parties } from '@ambarci/db';
import type { Database } from '@ambarci/db';
import type { Party, PartyInput, PartyList, PartyListQuery } from '@ambarci/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { containsText, startsWithText } from '../../common/search.js';
import { DATABASE } from '../../database/database.module.js';

const PARTY_COLUMNS = {
  id: parties.id,
  name: parties.name,
  type: parties.type,
  taxId: parties.taxId,
  isActive: parties.isActive,
};

/** Cari sorguları; her sorgu şirket kimliğiyle sınırlanır. VKN/TCKN loglanmaz. */
@Injectable()
export class PartiesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(organizationId: string, query: PartyListQuery): Promise<PartyList> {
    const conditions: SQL[] = [eq(parties.organizationId, organizationId)];
    if (query.status !== 'all') {
      conditions.push(eq(parties.isActive, query.status === 'active'));
    }
    if (query.type) {
      conditions.push(eq(parties.type, query.type));
    }
    if (query.search) {
      // Ad içinde geçen, vergi numarası ise baştan eşleşen kayıtlar.
      const matches = or(containsText(parties.name, query.search), startsWithText(parties.taxId, query.search));
      if (matches) {
        conditions.push(matches);
      }
    }
    const where = and(...conditions);
    const [totalRow] = await this.db.select({ total: count() }).from(parties).where(where);
    const items = await this.db
      .select(PARTY_COLUMNS)
      .from(parties)
      .where(where)
      .orderBy(asc(parties.name))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return { items, total: totalRow?.total ?? 0, page: query.page, pageSize: query.pageSize };
  }

  async findById(organizationId: string, partyId: string): Promise<Party | null> {
    const [row] = await this.db
      .select(PARTY_COLUMNS)
      .from(parties)
      .where(and(eq(parties.organizationId, organizationId), eq(parties.id, partyId)))
      .limit(1);
    return row ?? null;
  }

  async create(organizationId: string, input: PartyInput): Promise<Party> {
    const [row] = await this.db
      .insert(parties)
      .values({ organizationId, ...partyFields(input) })
      .returning(PARTY_COLUMNS);
    if (!row) {
      throw new Error('Cari eklenemedi.');
    }
    return row;
  }

  /** Cari bu şirkette yoksa null döner. Cari silinmez; pasife almak için isActive: false. */
  async update(organizationId: string, partyId: string, input: PartyInput): Promise<Party | null> {
    const [row] = await this.db
      .update(parties)
      .set(partyFields(input))
      .where(and(eq(parties.organizationId, organizationId), eq(parties.id, partyId)))
      .returning(PARTY_COLUMNS);
    return row ?? null;
  }
}

function partyFields(input: PartyInput): Pick<Party, 'name' | 'type' | 'taxId' | 'isActive'> {
  return { name: input.name, type: input.type, taxId: input.taxId ?? null, isActive: input.isActive };
}
