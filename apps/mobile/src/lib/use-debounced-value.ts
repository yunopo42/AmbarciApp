import { useEffect, useState } from 'react';

/**
 * Değeri, son değişiklikten `delayMs` sonra döner. Arama kutusunda her tuşta API'ye istek gitmesin diye kullanılır:
 * kullanıcı yazmayı bırakınca tek istek gider.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
