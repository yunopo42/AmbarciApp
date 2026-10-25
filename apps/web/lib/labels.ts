// Enum etiketleri web ve mobilde ortak (packages/shared/src/labels.ts); tarih biçimi web'e özgü.
export {
  ACTION_SOURCE_LABELS,
  MOVEMENT_TYPE_LABELS,
  OPERATION_STATUS_LABELS,
  OPERATION_TYPE_LABELS,
  PARTY_TYPE_LABELS,
  RECORD_STATUS_LABELS,
  ROLE_LABELS,
  WAREHOUSE_TYPE_LABELS,
} from '@ambarci/shared';

const dateTimeFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}
