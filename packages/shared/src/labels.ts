// Ekranlarda gösterilen Türkçe adlar; web ve mobil aynı adları kullanır. Kodda İngilizce değerler (ADMIN, STOCK_IN) kalır.

import type { PartyType, RecordStatusFilter } from './catalog.js';
import type { WarehouseType } from './inventory.js';
import type { ActionSource, MovementType, OperationStatus, OperationType } from './operations.js';
import type { OrganizationRole } from './organizations.js';

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

export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  STOCK_IN: 'Giriş',
  STOCK_OUT: 'Çıkış',
  TRANSFER: 'Transfer',
  COUNT: 'Sayım',
  WASTE: 'Fire',
  OPENING: 'Açılış',
  REVERSAL: 'Ters kayıt',
};

export const OPERATION_STATUS_LABELS: Record<OperationStatus, string> = {
  RECEIVED: 'Alındı',
  NEEDS_CLARIFICATION: 'Bilgi bekliyor',
  PENDING_CONFIRMATION: 'Onay bekliyor',
  APPLIED: 'Uygulandı',
  REVERSED: 'Geri alındı',
  CANCELLED: 'İptal edildi',
  EXPIRED: 'Süresi doldu',
  FAILED: 'Başarısız',
};

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  IN: 'Giriş',
  OUT: 'Çıkış',
  TRANSFER_OUT: 'Transfer çıkışı',
  TRANSFER_IN: 'Transfer girişi',
  COUNT_SURPLUS: 'Sayım fazlası',
  COUNT_SHORTAGE: 'Sayım noksanı',
  WASTE: 'Fire',
  REVERSAL: 'Ters kayıt',
};

/** İşlemin nereden geldiği. */
export const ACTION_SOURCE_LABELS: Record<ActionSource, string> = {
  SCREEN: 'Ekran',
  CHAT: 'Sohbet',
  DOCUMENT: 'Belge',
  IMPORT: 'İçe aktarma',
  SYSTEM: 'Sistem',
};
