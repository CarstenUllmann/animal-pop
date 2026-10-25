// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AudioPlayer } from '../audio/player'
import { CELEBRATION } from '../game/constants'
import { createRng } from '../game/rng'
import { createCelebration, type CelebrationLayer } from './celebration'
import { bunchMetricsFor } from './layout'

/**
 * Issue #35: the first behavioural test in this suite, because a pop that only exists as a string cannot
 * show what is left in the tree. Every other test in `celebration.test.ts` reads the source - `vitest.config.ts`
 * pins the node environment, so mounting is what this file is for.
 *
 * What jsdom gives the layer: a DOM and real timers. What it does not give it: a canvas (`getContext('2d')`
 * is null, so the layer draws nothing and returns before the first frame), layout (`getBoundingClientRect` is
 * all zeros) and hit-testing. So the mount proves what the module does to the tree and what it schedules, and
 * the hit box is held by the stylesheet rule read below - `styles.test.ts` holds the same rule against the
 * constants. That split is deliberate: the module's own guard is what the mount can prove, and the rule that
 * makes a tap land on the balloon underneath is CSS, which jsdom never applies.
 */

// jsdom has no canvas package, so every `getContext` call prints a warning on its virtual console. The layer
// already handles a null context, which is the path this mount takes, so the stub keeps the suite output clean
// without changing what runs.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']

const SRC = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(SRC, '..', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The target tablet, so the rule has board enough to answer with places rather than run out of it. */
const BOARD = bunchMetricsFor(540, 135, 106)

/** jsdom has no Web Audio, so the player only records what it was asked for. */
function stubAudio(): { player: AudioPlayer; pops: number[] } {
  const pops: number[] = []
  return {
    pops,
    player: {
      unlock: () => {},
      playPop: () => {},
      playInvalid: () => {},
      playReshuffle: () => {},
      playBubble: () => {},
      playBalloon: (index: number) => {
        pops.push(index)
      },
      playCompletion: () => {},
      stop: () => {},
      setMuted: () => {},
      isMuted: () => false,
    },
  }
}

interface Mounted {
  layer: CelebrationLayer
  root: HTMLElement
  pops: number[]
}

function mount(count: number, reducedMotion: boolean = false): Mounted {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  document.body.append(root)
  const audio = stubAudio()
  if (reducedMotion) {
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
    }) as unknown as MediaQueryList) as typeof window.matchMedia
  }
  const layer = createCelebration(root, audio.player, createRng(42), {
    tier: () => 'big',
    balloons: () => count,
    metrics: () => BOARD,
    boardOrigin: () => ({ x: 89, y: 30 }),
  })
  return { layer, root, pops: audio.pops }
}

function balloonsIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll('.balloon')) as HTMLElement[]
}

/** Longer than the collapse, so a scheduled exit has had time to run. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('a popped balloon collapses to nothing and leaves the layer (issue #35)', () => {
  it('removes the element when the collapse ends, so nothing poppable is left behind', async () => {
    const { layer, root } = mount(2)
    layer.start()

    const popped = balloonsIn(root)[0] as HTMLElement
    const kept = balloonsIn(root)[1] as HTMLElement
    expect(balloonsIn(root)).toHaveLength(2)

    popped.click()
    // While it collapses the element is still in the tree: the transition is what makes the pop read as a
    // pop, and the class is the rule that takes its hit box away.
    expect(popped.isConnected).toBe(true)
    expect(popped.classList.contains('balloon--popped')).toBe(true)

    await wait(CELEBRATION.balloonCollapseMs + 150)

    // SPEC §10.1: the balloon is gone. The stub that used to sit there until every balloon in the set was
    // popped is what made her tap the same balloon over and over.
    expect(popped.isConnected).toBe(false)
    expect(kept.isConnected).toBe(true)
    expect(balloonsIn(root)).toEqual([kept])
    expect(layer.balloonCount()).toBe(1)

    // Pop the last one and the set arrives again - and the new set carries no popped balloon, so the layer
    // holds nothing that looks poppable.
    kept.click()
    await wait(CELEBRATION.balloonCollapseMs + 150)
    const hanging = balloonsIn(root)
    expect(hanging).toHaveLength(2)
    expect(hanging.some((el) => el.classList.contains('balloon--popped'))).toBe(false)
  })

  it('takes the hit box off a collapsing balloon, so a tap lands on the balloon underneath', async () => {
    // The hit box is the button, so the rule that stops it taking taps has to be the stylesheet's: jsdom
    // applies no CSS at all, which is why this is read as text here and held as a number in
    // `styles.test.ts`. What the mount can prove is the module's own half - a second tap does nothing.
    const start = css.indexOf('.balloon--popped {')
    expect(css.slice(start, css.indexOf('}', start))).toContain('pointer-events: none')

    const { layer, root, pops } = mount(2)
    layer.start()
    // The two entry chimes are on timers, so they are done before the counting starts.
    await wait(300)
    expect(pops).toEqual([0, 1])

    const popped = balloonsIn(root)[0] as HTMLElement
    popped.click()
    expect(pops).toEqual([0, 1, 0])
    popped.click()
    expect(pops).toHaveLength(3)
    expect(popped.isConnected).toBe(true)

    await wait(CELEBRATION.balloonCollapseMs + 150)
    expect(popped.isConnected).toBe(false)
  })

  it('cancels a pending exit on stop, so a force-closed party leaves nothing behind', async () => {
    const { layer, root } = mount(2)
    layer.start()

    const popped = balloonsIn(root)[0] as HTMLElement
    popped.click()
    // A party she has left: the timer set is cleared, and the balloon that was mid-collapse is taken with
    // every other hanging one.
    layer.stop()
    expect(popped.isConnected).toBe(false)
    expect(balloonsIn(root)).toHaveLength(0)

    // Had the exit been allowed to fire, it would have refilled the bunch on an idle layer. That is the leak
    // a `transitionend` listener could not be cleared from, and it is why the removal is a timer.
    await wait(CELEBRATION.balloonCollapseMs + 150)
    expect(balloonsIn(root)).toHaveLength(0)
    expect(layer.balloonCount()).toBe(0)
  })

  it('pops and removes in the same step under reduced motion (SPEC §13)', async () => {
    const matchMedia = window.matchMedia
    const { layer, root } = mount(2, true)
    try {
      layer.start()

      const popped = balloonsIn(root)[0] as HTMLElement
      const kept = balloonsIn(root)[1] as HTMLElement
      popped.click()
      // The stylesheet makes the collapse a single frame, so there is no travel for a timer to wait on: the
      // pop and the removal are the same step, and the tree is already the answer.
      expect(popped.isConnected).toBe(false)
      expect(kept.isConnected).toBe(true)
      expect(layer.balloonCount()).toBe(1)

      // Nothing is still scheduled behind the pop, so a tick later the tree is the same tree.
      await wait(200)
      expect(balloonsIn(root)).toEqual([kept])
    } finally {
      window.matchMedia = matchMedia
    }
  })
})
