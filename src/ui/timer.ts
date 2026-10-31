/** Delayed work as a seam, so modules that schedule it do not reach for `window`. */
export interface Timer {
  /** Runs `run` after `ms`; the number it returns is what `clear` takes. */
  after(ms: number, run: () => void): number
  clear(id: number): void
}
