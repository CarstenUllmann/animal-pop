/**
 * The clock's delayed half, as a seam (SPEC §15).
 *
 * `Date.now` answers "what time is it"; this answers "call me later", and the two are separate because a
 * module that schedules work should not also be the thing that reads the wall clock. `ui/adultReset.ts`
 * and `ui/celebration.ts` own pending work, so both take a `Timer` rather than reaching for `window`.
 * The browser adapter is the composition root's job (`main.ts`); a test supplies one it can advance.
 */
export interface Timer {
  /** Runs `run` after `ms`; the number it returns is what `clear` takes. */
  after(ms: number, run: () => void): number
  clear(id: number): void
}
