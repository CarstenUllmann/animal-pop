/**
 * Fixed-capacity object pool (SPEC §10.2). Particles are reused from an array of prefilled
 * objects; nothing is allocated inside the draw loop, so a fireworks burst cannot make the
 * old WebView stutter. `acquire` returns null once the pool is exhausted rather than
 * growing it, which is what keeps the 500-object cap real.
 */
export interface Pool<T> {
  readonly capacity: number
  /** null when the pool is exhausted - the caller drops the object instead of allocating. */
  acquire(): T | null
  release(item: T): void
  /** Objects currently handed out, in acquisition order. */
  active(): readonly T[]
  activeCount(): number
  /** Number of objects the pool was created with: nothing is added later. */
  createdCount(): number
  reset(): void
}

export function createPool<T>(capacity: number, create: () => T): Pool<T> {
  const items: T[] = []
  for (let i = 0; i < capacity; i++) items.push(create())

  const active: T[] = []
  const handed = new Set<T>()

  return {
    capacity,
    acquire(): T | null {
      if (active.length >= capacity) return null
      // Reuse a released object before creating anything, which is the point of the pool.
      const free = items.find((item) => !handed.has(item))
      if (free === undefined) return null
      handed.add(free)
      active.push(free)
      return free
    },
    release(item: T): void {
      if (!handed.has(item)) return
      handed.delete(item)
      const position = active.indexOf(item)
      if (position >= 0) active.splice(position, 1)
    },
    active(): readonly T[] {
      return active
    },
    activeCount(): number {
      return active.length
    },
    createdCount(): number {
      return items.length
    },
    reset(): void {
      handed.clear()
      active.length = 0
    },
  }
}
