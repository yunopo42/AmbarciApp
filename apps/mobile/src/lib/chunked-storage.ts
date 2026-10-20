/** Anahtar-değer deposu (expo-secure-store'un kullanılan kısmı). */
export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** supabase-js'in oturumu saklamak için beklediği arayüz. */
export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// Güvenli depo bazı cihazlarda tek kayıtta büyük değerleri reddedebilir; oturum (~2–3 KB) parçalanır.
// 500 karakter, karakter başına en fazla 4 bayt ile ~2 KB eder.
const CHUNK_SIZE = 500;

const countKey = (key: string): string => `${key}.count`;
const chunkKey = (key: string, index: number): string => `${key}.${index}`;

/**
 * Değeri parçalara bölerek saklayan depo. Parça sayısı ayrı bir kayıtta tutulur; parçalar okunurken
 * eksik çıkarsa değer hiç yokmuş gibi davranılır (yarım kalmış bir yazım oturum sayılmaz).
 */
export function createChunkedStorage(store: KeyValueStore): SessionStorage {
  async function readCount(key: string): Promise<number> {
    const raw = await store.getItemAsync(countKey(key));
    const count = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isInteger(count) && count > 0 ? count : 0;
  }

  async function deleteChunks(key: string, from: number, to: number): Promise<void> {
    for (let index = from; index < to; index += 1) {
      await store.deleteItemAsync(chunkKey(key, index));
    }
  }

  return {
    async getItem(key) {
      const count = await readCount(key);
      if (count === 0) {
        return null;
      }
      const parts: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const part = await store.getItemAsync(chunkKey(key, index));
        if (part === null) {
          return null;
        }
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key, value) {
      const previousCount = await readCount(key);
      // Karakter (kod noktası) bazında bölünür; çok baytlı bir karakter iki parçaya ayrılmaz.
      const characters = Array.from(value);
      const count = Math.max(1, Math.ceil(characters.length / CHUNK_SIZE));
      for (let index = 0; index < count; index += 1) {
        const part = characters.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE).join('');
        await store.setItemAsync(chunkKey(key, index), part);
      }
      await store.setItemAsync(countKey(key), String(count));
      // Önceki değer daha uzunsa artan parçalar silinir.
      await deleteChunks(key, count, previousCount);
    },

    async removeItem(key) {
      const count = await readCount(key);
      await store.deleteItemAsync(countKey(key));
      await deleteChunks(key, 0, count);
    },
  };
}
