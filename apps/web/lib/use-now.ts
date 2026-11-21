'use client';

import { useEffect, useState } from 'react';

/**
 * Belirli aralıkla yenilenen "şimdi" (ör. onay kuyruğundaki "12 dk kaldı"). `enabled` false iken saat durur: süresi
 * olan satır yoksa ekran boşuna yeniden çizilmez.
 */
export function useNow(intervalMs: number, enabled = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    // Saat durmuşken geçen süre hemen yansısın: ilk güncelleme beklemeden, sonra aralıkla.
    const first = setTimeout(() => setNow(new Date()), 0);
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [intervalMs, enabled]);
  return now;
}
