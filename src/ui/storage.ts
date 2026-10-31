import type { KeyValueStore } from '../game/types'

/** Reading storage must never throw: the game plays fine without it, it just cannot resume. */
export function localStorageStore(): KeyValueStore {
  const store = typeof localStorage === 'object' ? localStorage : null
  return {
    read(key: string): string | null {
      if (store === null) return null
      try {
        return store.getItem(key)
      } catch (unused) {
        return null
      }
    },
    write(key: string, value: string): boolean {
      if (store === null) return false
      try {
        store.setItem(key, value)
        return true
      } catch (unused) {
        return false
      }
    },
  }
}
