import type { OperationStatus } from '@ambarci/shared';

/**
 * İşlem durum makinesi (mimari referans):
 *
 *   RECEIVED → NEEDS_CLARIFICATION → PENDING_CONFIRMATION → APPLIED → REVERSED
 *                                             ├→ CANCELLED
 *                                             ├→ EXPIRED (30 dk, 5. hafta)
 *                                             └→ FAILED
 *
 * Durum yalnızca bu tablodaki geçişlerle değişir. APPLIED'dan tek çıkış ters kayıttır (REVERSED); iptal,
 * süre aşımı ve başarısızlık son durumlardır. Bir işlem iki kez uygulanamaz: APPLIED → APPLIED geçişi yoktur.
 */
const TRANSITIONS: Record<OperationStatus, readonly OperationStatus[]> = {
  RECEIVED: ['NEEDS_CLARIFICATION', 'PENDING_CONFIRMATION', 'CANCELLED', 'FAILED'],
  NEEDS_CLARIFICATION: ['PENDING_CONFIRMATION', 'CANCELLED', 'EXPIRED'],
  PENDING_CONFIRMATION: ['APPLIED', 'CANCELLED', 'EXPIRED', 'FAILED'],
  APPLIED: ['REVERSED'],
  REVERSED: [],
  CANCELLED: [],
  EXPIRED: [],
  FAILED: [],
};

export function canTransition(from: OperationStatus, to: OperationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
