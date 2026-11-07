import { useCallback, useSyncExternalStore } from 'react';

// Asistan panelinin açık olup olmadığı yalnızca kolaylık için hatırlanır: sayfa yenilense ya da şirket değişse de
// panel açık kalır. Değer tarayıcı depolamasında; depolama kapalıysa bu sayfa boyunca bellekte tutulur.
//
// useSyncExternalStore kullanılıyor: sunucuda çizilen sayfa depolamayı bilmez (kapalı çizilir); React, sayfa
// tarayıcıda canlanırken önce sunucunun değerini, hemen ardından depodakini kullanır. Böylece sunucu ve tarayıcı
// çıktısı arasında uyuşmazlık uyarısı çıkmaz.

const STORAGE_KEY = 'ambarci.chatPanelOpen';
const listeners = new Set<() => void>();
let fallback = false;

function read(): boolean {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Başka sekmede açılıp kapanırsa bu sekme de izler.
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function serverSnapshot(): boolean {
  return false;
}

/** Panelin açık olup olmadığı ve değiştirme fonksiyonu. */
export function useChatPanelOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, read, serverSnapshot);
  const setOpen = useCallback((next: boolean): void => {
    fallback = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Depolama kapalı: değer yalnızca bellekte.
    }
    for (const listener of listeners) {
      listener();
    }
  }, []);
  return [open, setOpen];
}
