// Sohbet önerisinin son onay anı (#75) onay kuyruğunda (#87): kalan süre ve süresi dolmuş satır. Asıl kontrol sunucuda,
// onayda kilit altında ve veritabanının saatiyledir; bu hesap yalnızca ekranı günceller. Cihazın saati kaymışsa onay yine
// de 409 OPERATION_EXPIRED alabilir.

export interface ApprovalDeadline {
  /** Cihazın saatine göre son onay anı geçti: satır seçilemez, liste yeniden okunur. */
  expired: boolean;
  /** "12 dk kaldı", "1 dk'dan az kaldı", "Süresi doldu"; süresi olmayan işlemde null. */
  label: string | null;
}

/** `expiresAt`: listedeki son onay anı (ISO) ya da null (ekrandan, içe aktarmadan açılan işlemin süresi yoktur). */
export function approvalDeadline(expiresAt: string | null, now: Date): ApprovalDeadline {
  if (!expiresAt) {
    return { expired: false, label: null };
  }
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (left <= 0) {
    return { expired: true, label: 'Süresi doldu' };
  }
  if (left < 60_000) {
    return { expired: false, label: "1 dk'dan az kaldı" };
  }
  return { expired: false, label: `${Math.floor(left / 60_000)} dk kaldı` };
}

/** Listedeki son onay anlarından şu andan sonraki ilki; liste o an yeniden okunur. Yoksa null. */
export function nextDeadline(expiresAts: (string | null)[], now: Date): Date | null {
  let next: Date | null = null;
  for (const value of expiresAts) {
    if (!value) {
      continue;
    }
    const at = new Date(value);
    if (at > now && (!next || at < next)) {
      next = at;
    }
  }
  return next;
}
