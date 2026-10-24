import { ANIMALS_BY_ID } from '../game/animals'
import { colOf, rowOf } from '../game/board'
import { GRID, MOTION } from '../game/constants'
import type { AnimalId, Board, PopResult } from '../game/types'
import { canAnimate, canAwaitFinished, canListAnimations, hasMatchMedia } from './capabilities'

export interface BoardView {
  readonly element: HTMLElement
  /** Deal the first board in from above. */
  renderInitial(board: Board): Promise<void>
  /** Burst the popped group, then drop and refill the rest of the board. */
  animatePop(result: PopResult): Promise<void>
  /** Wobble one tile for an invalid tap (or blink it with reduced motion). */
  animateInvalid(index: number): void
  /** Shake, scatter and deal a fresh board. */
  animateReshuffle(next: Board): Promise<void>
  destroy(): void
}

export interface BoardViewOptions {
  onTap(index: number): void
}

const REDUCED_MOTION =
  hasMatchMedia(window) && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const ms = (duration: number): number => (REDUCED_MOTION ? Math.min(duration, 80) : duration)
const stagger = (delay: number): number => (REDUCED_MOTION ? 0 : delay)

/**
 * Run one keyframe effect, or resolve at once when the engine cannot animate. The tile keeps
 * the inline transform it is given, so the board still lands in the right place as a static
 * grid on an engine without the Web Animations API.
 */
function runAnimation(
  element: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Promise<unknown> {
  if (!canAnimate(element)) return Promise.resolve()
  const animation = element.animate(keyframes, options)
  // Chrome 61 can animate but cannot say when an animation lands, so there is no completion
  // signal to sequence the board on. The tile keeps the inline transform its caller already set,
  // which is the static board SPEC §14.3 allows.
  if (!canAwaitFinished(animation)) return Promise.resolve()
  return animation.finished.catch(() => undefined)
}

export function createBoardView(options: BoardViewOptions): BoardView {
  const board = document.createElement('div')
  board.className = 'board'
  board.style.setProperty('--grid', String(GRID))
  board.setAttribute('role', 'group')
  board.setAttribute('aria-label', 'Animals')

  const handlePointerDown = (event: PointerEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const tile = target.closest<HTMLElement>('.tile')
    if (tile === null || !board.contains(tile)) return
    event.preventDefault()
    const index = Number(tile.dataset.index)
    if (Number.isInteger(index)) options.onTap(index)
  }

  board.addEventListener('pointerdown', handlePointerDown)

  function createTile(animal: AnimalId, index: number): HTMLButtonElement {
    const definition = ANIMALS_BY_ID.get(animal)
    const tile = document.createElement('button')
    tile.type = 'button'
    tile.className = 'tile'
    tile.tabIndex = -1
    tile.dataset.index = String(index)
    tile.dataset.animal = animal
    tile.setAttribute('aria-label', definition === undefined ? animal : definition.label)

    const face = document.createElement('img')
    face.className = 'tile__face'
    face.alt = ''
    face.draggable = false
    face.decoding = 'async'
    if (definition !== undefined) face.src = definition.face
    tile.append(face)

    return tile
  }

  function findTile(index: number): HTMLElement | null {
    return board.querySelector<HTMLElement>(`.tile[data-index="${index}"]`)
  }

  function clearTiles(): void {
    for (const tile of board.querySelectorAll('.tile, .burst')) tile.remove()
  }

  function drop(
    tile: HTMLElement,
    col: number,
    destRow: number,
    startRow: number,
    delay: number,
  ): Promise<unknown> {
    tile.style.transform = transformAt(destRow, col)
    if (REDUCED_MOTION || destRow === startRow) return Promise.resolve()

    const distance = Math.abs(destRow - startRow)
    return runAnimation(
      tile,
      [{ transform: transformAt(startRow, col) }, { transform: transformAt(destRow, col) }],
      {
        duration: ms(MOTION.dropDuration + distance * MOTION.dropPerRow),
        delay: stagger(delay),
        easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
        fill: 'backwards',
      },
    )
  }

  async function deal(next: Board): Promise<void> {
    const animations: Array<Promise<unknown>> = []
    for (let index = 0; index < next.length; index++) {
      const animal = next[index]
      if (animal === null || animal === undefined) continue
      const row = rowOf(index)
      const col = colOf(index)
      const tile = createTile(animal, index)
      board.append(tile)

      const startRow = row - GRID
      tile.style.transform = transformAt(startRow, col)
      animations.push(drop(tile, col, row, startRow, row * MOTION.dealStagger))
    }
    await Promise.all(animations)
  }

  async function settle(result: PopResult): Promise<void> {
    const newPerColumn = new Map<number, number>()
    for (const move of result.moves) {
      if (move.from !== null) continue
      const col = colOf(move.to)
      const seen = newPerColumn.get(col)
      newPerColumn.set(col, seen === undefined ? 1 : seen + 1)
    }

    const animations: Array<Promise<unknown>> = []
    for (const move of result.moves) {
      const row = rowOf(move.to)
      const col = colOf(move.to)
      const tile = createTile(move.animal, move.to)
      board.append(tile)

      let startRow: number
      let delay: number
      if (move.from === null) {
        // New animals stack above the board and drop in from the top.
        const stacked = newPerColumn.get(col)
        startRow = row - (stacked === undefined ? 1 : stacked)
        delay = row * MOTION.dealStagger
      } else {
        startRow = rowOf(move.from)
        // Lower rows move first so a column collapses bottom-up.
        delay = (GRID - 1 - row) * MOTION.dropPerRow
      }

      animations.push(drop(tile, col, row, startRow, delay))
    }

    await Promise.all(animations)
  }

  function spawnBurst(index: number): void {
    const burst = document.createElement('span')
    burst.className = 'burst'
    burst.style.transform = transformAt(rowOf(index), colOf(index))
    board.append(burst)
    window.setTimeout(() => burst.remove(), ms(520))
  }

  async function animatePop(result: PopResult): Promise<void> {
    const animations: Array<Promise<unknown>> = []
    for (const index of result.cleared) {
      const tile = findTile(index)
      if (tile === null) continue
      if (!REDUCED_MOTION) spawnBurst(index)

      const base = transformAt(rowOf(index), colOf(index))
      animations.push(
        runAnimation(
          tile,
          REDUCED_MOTION
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [
                { transform: `${base} scale(1)`, opacity: 1, offset: 0 },
                { transform: `${base} scale(1.18)`, opacity: 1, offset: 0.35 },
                { transform: `${base} scale(0)`, opacity: 0, offset: 1 },
              ],
          { duration: ms(MOTION.pop), easing: 'ease-out', fill: 'forwards' },
        ),
      )
    }

    await Promise.all(animations)
    clearTiles()
    await settle(result)
  }

  function animateInvalid(index: number): void {
    const tile = findTile(index)
    if (tile === null) return

    if (REDUCED_MOTION) {
      void runAnimation(tile, [{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }], {
        duration: ms(MOTION.wobble),
        easing: 'ease-in-out',
      })
      return
    }

    const base = transformAt(rowOf(index), colOf(index))
    void runAnimation(
      tile,
      [
        { transform: base },
        { transform: `${base} rotate(-6deg)` },
        { transform: `${base} rotate(6deg)` },
        { transform: `${base} rotate(-3deg)` },
        { transform: base },
      ],
      { duration: ms(MOTION.wobble), easing: 'ease-in-out' },
    )
  }

  async function animateReshuffle(next: Board): Promise<void> {
    const tiles = Array.from(board.querySelectorAll<HTMLElement>('.tile'))

    const escapes = tiles.map((tile, order) => {
      const index = Number(tile.dataset.index)
      const row = rowOf(index)
      const col = colOf(index)

      if (REDUCED_MOTION) {
        return runAnimation(tile, [{ opacity: 1 }, { opacity: 0 }], {
          duration: ms(MOTION.reshuffleScatter),
          delay: stagger((order % 3) * 12),
          easing: 'ease-in',
          fill: 'forwards',
        })
      }

      const driftX = ((order % 5) - 2) * 24
      const driftY = -14 - (order % 4) * 18
      return runAnimation(
        tile,
        [
          { transform: transformAt(row, col), opacity: 1 },
          {
            transform: `translate3d(${col * 100 + driftX}%, ${row * 100 + driftY}%, 0) scale(0.3) rotate(${driftX}deg)`,
            opacity: 0,
          },
        ],
        {
          duration: ms(MOTION.reshuffleScatter),
          delay: stagger((order % 3) * 12),
          easing: 'ease-in',
          fill: 'forwards',
        },
      )
    })

    if (!REDUCED_MOTION) {
      void runAnimation(
        board,
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-1.2%)' },
          { transform: 'translateX(1.2%)' },
          { transform: 'translateX(-0.7%)' },
          { transform: 'translateX(0)' },
        ],
        { duration: ms(MOTION.reshuffleShake), easing: 'ease-in-out' },
      )
    }

    await Promise.all(escapes)
    clearTiles()
    await deal(next)
  }

  return {
    element: board,
    renderInitial: async (initial: Board) => {
      clearTiles()
      await deal(initial)
    },
    animatePop,
    animateInvalid,
    animateReshuffle,
    destroy(): void {
      board.removeEventListener('pointerdown', handlePointerDown)
      if (canListAnimations(board)) {
        for (const animation of board.getAnimations({ subtree: true })) animation.cancel()
      }
      board.remove()
    },
  }
}

function transformAt(row: number, col: number): string {
  return `translate3d(${col * 100}%, ${row * 100}%, 0)`
}
