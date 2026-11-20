import { OPERATION_STATUS_LABELS, OPERATION_TYPE_LABELS } from '@ambarci/shared';

import type { MessageOperation } from '../operations/operations.repository.js';

/** Notta en fazla bu kadar öneri: en yenileri. Daha eskileri modelin işine yaramaz, yalnızca token harcar. */
export const PROPOSAL_NOTE_LIMIT = 10;

/** Notun ilk satırı. Ekranda gösterilmez; kullanıcının yazmadığını modele de söyler. */
export const PROPOSAL_NOTE_HEADER = '[Sunucu notu, kullanıcı yazmadı]';

/**
 * Yeni kullanıcı mesajına eklenen durum notu (#79). Model önerinin durumunu yalnızca öneriyi açtığı andaki araç
 * sonucundan bilir ("Onay bekliyor"); kullanıcı kartı sohbetin dışında onaylar ya da iptal eder ve model bunu
 * öğrenemez. Telefon denemesinin 9. adımında model, onaylanmış iki kartı hâlâ bekliyor sandı ve yeni çıkış önerisini
 * "kart zaten hazır" diyerek açmadı. Not, sohbetteki önerilerin o anki durumunu verir. Öneri yoksa not da yoktur.
 */
export function proposalStatusNote(operations: Pick<MessageOperation, 'id' | 'type' | 'status'>[]): string | null {
  if (operations.length === 0) {
    return null;
  }
  const recent = operations.slice(-PROPOSAL_NOTE_LIMIT);
  const lines = recent.map(
    (operation) => `- ${operation.id}: ${OPERATION_TYPE_LABELS[operation.type]}, ${OPERATION_STATUS_LABELS[operation.status]}`,
  );
  return [
    `${PROPOSAL_NOTE_HEADER} Bu sohbette açtığın önerilerin şu anki durumu${operations.length > recent.length ? ` (son ${recent.length})` : ''}. Kullanıcı kartları sohbetin dışında onaylar ya da iptal eder; önceki araç sonuçlarındaki "Onay bekliyor" bilgisi eskimiş olabilir, bu listeye güven:`,
    ...lines,
    'Kullanıcı yeni bir işlem istiyorsa ve önceki öneri onay beklemiyorsa yeni öneri aç. Onay bekleyen bir öneriyi değiştireceksen o önerinin operation_id değeriyle çağır.',
  ].join('\n');
}
