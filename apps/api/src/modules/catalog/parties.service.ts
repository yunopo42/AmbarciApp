import type { Party, PartyInput, PartyList, PartyListQuery } from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { postgresErrorOf } from '../../common/postgres-error.js';
import { PartiesRepository } from './parties.repository.js';

@Injectable()
export class PartiesService {
  constructor(@Inject(PartiesRepository) private readonly repository: PartiesRepository) {}

  list(organizationId: string, query: PartyListQuery): Promise<PartyList> {
    return this.repository.list(organizationId, query);
  }

  async get(organizationId: string, partyId: string): Promise<Party> {
    const party = await this.repository.findById(organizationId, partyId);
    if (!party) {
      throw partyNotFound();
    }
    return party;
  }

  create(organizationId: string, input: PartyInput): Promise<Party> {
    return withTaxIdConflict(() => this.repository.create(organizationId, input));
  }

  async update(organizationId: string, partyId: string, input: PartyInput): Promise<Party> {
    const party = await withTaxIdConflict(() => this.repository.update(organizationId, partyId, input));
    if (!party) {
      throw partyNotFound();
    }
    return party;
  }
}

/** Aynı VKN/TCKN şirket içinde ikinci kez kullanılamaz (parties_org_tax_id_key). */
async function withTaxIdConflict<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (postgresErrorOf(error).constraint === 'parties_org_tax_id_key') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'PARTY_TAX_ID_TAKEN',
        'Bu vergi numarası başka bir caride kullanılıyor.',
      );
    }
    throw error;
  }
}

function partyNotFound(): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, 'PARTY_NOT_FOUND', 'Cari bulunamadı.');
}
