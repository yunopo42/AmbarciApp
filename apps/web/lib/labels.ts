import type { OrganizationRole, WarehouseType } from '@ambarci/shared';

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  ADMIN: 'Yönetici',
  EMPLOYEE: 'Çalışan',
};

export const WAREHOUSE_TYPE_LABELS: Record<WarehouseType, string> = {
  WAREHOUSE: 'Depo',
  BRANCH: 'Şube',
  VEHICLE: 'Araç',
};

const dateTimeFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}
