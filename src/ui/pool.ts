/** A fixed-capacity object pool, so the draw loop allocates nothing. */
export interface Pool<T> {
  readonly capacity: number
  /** null when the pool is exhausted; the caller drops the object rather than allocating. */
  acquire(): T | null
  release(item: T): void
  /** Objects currently handed out, in acquisition order. */
  active(): readonly T[]
  activeCount(): number
  /** How many objects the pool was created with. */
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
