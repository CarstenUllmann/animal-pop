import type { KeyValueStore } from '../game/types'

/**
 * The persisted store, reached through `typeof` because Chrome 61 has no global-object alias
 * (issue #23) and a WebView can deny `localStorage` outright. Reading it must not throw: this is
 * the code that has to survive a force-close, and the game plays fine without storage - it just
 * cannot resume (SPEC §14.1).
 */
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
