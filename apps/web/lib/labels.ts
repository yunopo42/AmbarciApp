import type { OrganizationRole, PartyType, RecordStatusFilter, WarehouseType } from '@ambarci/shared';

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  ADMIN: 'Yönetici',
  EMPLOYEE: 'Çalışan',
};

export const WAREHOUSE_TYPE_LABELS: Record<WarehouseType, string> = {
  WAREHOUSE: 'Depo',
  BRANCH: 'Şube',
  VEHICLE: 'Araç',
};

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  SUPPLIER: 'Tedarikçi',
  CUSTOMER: 'Müşteri',
};

/** Listelerdeki durum süzgecinin seçenekleri; varsayılan yalnızca aktif kayıtlar (API ile aynı). */
export const RECORD_STATUS_LABELS: Record<RecordStatusFilter, string> = {
  active: 'Aktif',
  inactive: 'Pasif',
  all: 'Tümü',
};

const dateTimeFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}
