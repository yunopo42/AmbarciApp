import type { DbExecutor } from '@ambarci/db';
import { Inject, Injectable } from '@nestjs/common';

import { CatalogRepository } from './catalog.repository.js';
import type { UnitConversion, UnitConversionInput } from './catalog.repository.js';

/** Diğer modüllerin katalog tablolarına erişim yolu (modül sınırı: tablolar yalnızca bu modülün repository'sinde). */
@Injectable()
export class CatalogService {
  constructor(@Inject(CatalogRepository) private readonly repository: CatalogRepository) {}

  convertToBaseUnits(
    executor: DbExecutor,
    organizationId: string,
    lines: UnitConversionInput[],
  ): Promise<UnitConversion[]> {
    return this.repository.convertToBaseUnits(executor, organizationId, lines);
  }

  isActiveParty(executor: DbExecutor, organizationId: string, partyId: string): Promise<boolean> {
    return this.repository.isActiveParty(executor, organizationId, partyId);
  }
}
