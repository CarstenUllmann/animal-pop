// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AudioPlayer } from '../audio/player'
import { BALLOON_COLORS, CELEBRATION, LAYOUT } from '../game/constants'
import { createRng } from '../game/rng'
import type { Place } from './bunch'
import { createCelebration, type CelebrationLayer } from './celebration'
import { bunchMetricsFor } from './layout'
import type { Timer } from './timer'

/**
 * The behavioural tests for the celebration: the ones that mount the layer, tap a balloon, and look at what is
 * left in the tree. Every other test in `celebration.test.ts` reads the source, because `vitest.config.ts` pins
 * the node environment for the rest of the suite - a pop that only exists as a string cannot show that the
 * element is gone, and a refill that only exists as a string cannot show that the bunch came back.
 *
 * What jsdom gives the layer: a DOM, and a canvas it answers with null. What it does not give it: layout
 * (`getBoundingClientRect` is all zeros) and hit-testing. So these tests prove what the module does to the
 * tree and what it schedules. Delays come through the injected `Timer`, so a test advances a fake clock
 * instead of sleeping: the collapse is a step, not 220ms of wall time. The hit box is held by the
 * stylesheet rule read below - `styles.test.ts` holds the same rule against the constants - because jsdom
 * applies no CSS at all. That split is deliberate: the module's own guard is what a mount can prove, and
 * the rule that makes a tap land on the balloon underneath is CSS.
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
  clock: FakeTimer
}

/** The seam the layer takes: the test decides when a delayed step runs, rather than sleeping for it. */
interface FakeTimer extends Timer {
  /** Run every callback due within `ms`, in time order, including anything they schedule. */
  advance(ms: number): void
  /** How many callbacks can still fire. */
  pending(): number
}

function fakeTimer(): FakeTimer {
  let now = 0
  let nextId = 1
  const scheduled = new Map<number, { at: number; run: () => void }>()
  return {
    after(ms: number, run: () => void): number {
      const id = nextId
      nextId += 1
      scheduled.set(id, { at: now + ms, run })
      return id
    },
    clear(id: number): void {
      scheduled.delete(id)
    },
    advance(ms: number): void {
      now += ms
      for (;;) {
        let dueId = 0
        let dueAt = 0
        for (const [id, entry] of scheduled) {
          if (entry.at > now) continue
          if (dueId === 0 || entry.at < dueAt) {
            dueId = id
            dueAt = entry.at
          }
        }
        const due = scheduled.get(dueId)
        if (dueId === 0 || due === undefined) return
        scheduled.delete(dueId)
        due.run()
      }
    },
    pending(): number {
      return scheduled.size
    },
  }
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
  const clock = fakeTimer()
  const layer = createCelebration(root, audio.player, createRng(42), {
    tier: () => 'big',
    balloons: () => count,
    metrics: () => BOARD,
    boardOrigin: () => ({ x: 89, y: 30 }),
    timer: clock,
  })
  return { layer, root, pops: audio.pops, clock }
}

function balloonsIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll('.balloon')) as HTMLElement[]
}

/** Longer than the collapse, so a scheduled exit has had time to run. */
const AFTER_COLLAPSE = CELEBRATION.balloonCollapseMs + 150

function asElement(value: HTMLElement | undefined): HTMLElement {
  if (value === undefined) throw new Error('no balloon in the tree')
  return value
}

/** The place a balloon is hung at, as the module wrote it into the element. */
function positionOf(el: HTMLElement): string {
  return `${el.style.left}/${el.style.bottom}`
}

/** The board origin the mount passes into the layer, so a written px position can be read back as a place. */
const ORIGIN = { x: 89, y: 30 }

/** Read the place back out of the px and jitter the module wrote. The DOM rounds px, so this is approximate. */
function placeOf(el: HTMLElement): Place {
  const size = Number(el.style.getPropertyValue('--balloon-jitter')) * BOARD.balloonPx
  return {
    x: Number.parseFloat(el.style.left) + size / 2 - ORIGIN.x,
    y: Number.parseFloat(el.style.bottom) + (size * LAYOUT.balloonHeightRatio) / 2 - ORIGIN.y,
    size,
  }
}

/** jsdom normalises a hex colour to `rgb(...)`, so the palette is normalised the same way. */
function paletteColours(): string[] {
  const probe = document.createElement('span')
  return BALLOON_COLORS.map((colour) => {
    probe.style.color = colour
    return probe.style.color
  })
}

/** Both places were written to the DOM in whole px, so leave two pixels of slack before calling it an overlap. */
function definitelyOverlaps(a: Place, b: Place): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) + 2 < (a.size + b.size) / 2
}

describe('a popped balloon collapses to nothing and leaves the layer (issue #35)', () => {
  it('removes the element when the collapse ends, so nothing poppable is left behind', () => {
    const { layer, root, clock } = mount(2)
    layer.start()

    const popped = asElement(balloonsIn(root)[0])
    const kept = asElement(balloonsIn(root)[1])
    expect(balloonsIn(root)).toHaveLength(2)

    popped.click()
    // While it collapses the element is still in the tree: the transition is what makes the pop read as a pop,
    // and the class is the rule that takes its hit box away.
    expect(popped.isConnected).toBe(true)
    expect(popped.classList.contains('balloon--popped')).toBe(true)

    clock.advance(AFTER_COLLAPSE)

    // SPEC §10.1: the balloon is gone. The stub that used to sit in the tree until every balloon in the set was
    // popped is what made her tap the same balloon over and over.
    expect(popped.isConnected).toBe(false)
    expect(kept.isConnected).toBe(true)
    // The slot is refilled, so the tree is back at the cap with nothing poppable left in it (issue #36).
    const hanging = balloonsIn(root)
    expect(hanging).toHaveLength(2)
    expect(hanging.indexOf(kept)).toBe(0)
    expect(hanging.some((el) => el === popped)).toBe(false)
    expect(hanging.some((el) => el.classList.contains('balloon--popped'))).toBe(false)
  })

  it('takes the hit box off a collapsing balloon, so a tap lands on the balloon underneath', () => {
    // The hit box is the button, so the rule that stops it taking taps has to be the stylesheet's: jsdom
    // applies no CSS at all, which is why this is read as text here and held as a number in `styles.test.ts`.
    // What the mount can prove is the module's own half - a second tap does nothing.
    const rule = css.slice(css.indexOf('.balloon--popped {'), css.indexOf('}', css.indexOf('.balloon--popped {')))
    expect(rule).toContain('pointer-events: none')

    const { layer, root, pops, clock } = mount(2)
    layer.start()

    const popped = asElement(balloonsIn(root)[0])
    popped.click()
    expect(pops).toEqual([0])
    popped.click()
    expect(pops).toHaveLength(1)
    expect(popped.isConnected).toBe(true)

    clock.advance(AFTER_COLLAPSE)
    expect(popped.isConnected).toBe(false)

    // The tap that would have landed on the space this balloon occupied now reaches the balloon hanging in it,
    // because the only thing in the tree is a hanging balloon: the exiting one is out of it.
    const next = asElement(balloonsIn(root)[1])
    next.click()
    expect(pops).toHaveLength(2)
    expect(next.isConnected).toBe(true)
  })

  it('cancels a pending exit on stop, so a force-closed party leaves nothing behind', () => {
    const { layer, root, clock } = mount(2)
    layer.start()

    const popped = asElement(balloonsIn(root)[0])
    popped.click()
    // A party she has left: the timer set is cleared, and the balloon that was mid-collapse is taken with
    // every other hanging one.
    layer.stop()
    expect(popped.isConnected).toBe(false)
    expect(balloonsIn(root)).toHaveLength(0)
    // Nothing is still scheduled, so there is no delayed refill waiting to arrive on an idle layer.
    expect(clock.pending()).toBe(0)

    // Had the exit been allowed to fire, it would have refilled the bunch on an idle layer. That is the leak a
    // `transitionend` listener could not be cleared from, and it is why the removal is a timer.
    clock.advance(AFTER_COLLAPSE)
    expect(balloonsIn(root)).toHaveLength(0)
    expect(layer.balloonCount()).toBe(0)
  })

  it('pops, removes and refills in the same step under reduced motion (SPEC §13)', () => {
    const matchMedia = window.matchMedia
    const { layer, root } = mount(2, true)
    try {
      layer.start()
      const popped = asElement(balloonsIn(root)[0])
      const kept = asElement(balloonsIn(root)[1])
      popped.click()

      // The stylesheet makes the collapse a single frame, so there is no travel for a timer to wait on: the pop,
      // the removal and the refill are one step, and the tree is already the answer.
      expect(popped.isConnected).toBe(false)
      expect(kept.isConnected).toBe(true)
      expect(balloonsIn(root)).toHaveLength(2)
      expect(layer.balloonCount()).toBe(2)
    } finally {
      window.matchMedia = matchMedia
    }
  })
})

describe('the bunch replaces itself as she pops, so it never empties (issue #36)', () => {
  it('fills the slot a pop leaves at the cap, in a fresh position, with no delay beyond the rise', () => {
    const { layer, root, pops, clock } = mount(3)
    layer.start()

    const hung = balloonsIn(root)
    expect(hung).toHaveLength(3)
    // The set that arrives together is still staggered, so the pop's delay cannot be read as the whole rule.
    expect(asElement(hung[0]).style.animationDelay).toBe('0ms')
    expect(asElement(hung[1]).style.animationDelay).toBe(`${CELEBRATION.balloonStaggerMs}ms`)

    const popped = asElement(hung[0])
    const place = positionOf(popped)
    popped.click()
    clock.advance(AFTER_COLLAPSE)

    const after = balloonsIn(root)
    // Back at the cap: the bunch she sees is the bunch the rule answered, with one new place in it.
    expect(after).toHaveLength(3)
    expect(after.some((el) => el === popped)).toBe(false)
    const refill = after.filter((el) => hung.indexOf(el) === -1)
    expect(refill).toHaveLength(1)

    // A fresh draw against the bunch still hanging. The spot this balloon was fading out of is free by the time
    // the exit runs, so the rule is allowed to answer it - seed 42 does not, so this is a different place.
    expect(positionOf(asElement(refill[0]))).not.toBe(place)

    // No delay beyond the rise: the climb starts at once, which is what lets it overlap the collapse.
    expect(asElement(refill[0]).style.animationDelay).toBe('0ms')

    // And the refill made no sound on its way in: the only entry is the tap.
    expect(pops).toEqual([0])
  })

  it('makes no sound at spawn, so the pop is the only sound a balloon makes', () => {
    const { layer, root, pops, clock } = mount(2)
    layer.start()

    clock.advance(300)
    expect(balloonsIn(root)).toHaveLength(2)
    expect(pops).toEqual([])

    // The pitch is the index in the set as it is now (SPEC §11), not the chime it was hung with.
    const second = asElement(balloonsIn(root)[1])
    second.click()
    expect(pops).toEqual([1])

    clock.advance(AFTER_COLLAPSE)
    // The slot refilled, and the refill was silent on the way in.
    expect(balloonsIn(root)).toHaveLength(2)
    expect(pops).toEqual([1])
  })

  it('pops a balloon that is still climbing, exactly like one at rest', () => {
    const { layer, root, pops, clock } = mount(2)
    layer.start()

    const popped = asElement(balloonsIn(root)[0])
    popped.click()
    clock.advance(AFTER_COLLAPSE)

    // This is the mid-rise balloon: the element has just been hung, with no rise delay, so in a browser it is
    // climbing while the tap lands. jsdom has no animation, so what the mount can prove is that nothing in the
    // pop path depends on how far the climb got.
    const climbing = asElement(balloonsIn(root)[1])
    climbing.click()
    expect(climbing.classList.contains('balloon--popped')).toBe(true)
    expect(pops).toEqual([0, 1])
    expect(climbing.isConnected).toBe(true)

    clock.advance(AFTER_COLLAPSE)
    expect(climbing.isConnected).toBe(false)
    expect(balloonsIn(root)).toHaveLength(2)
    expect(balloonsIn(root).some((el) => el.classList.contains('balloon--popped'))).toBe(false)
  })

  it('never grows past the cap however long she pops, and does not leak elements', () => {
    const cap = 3
    const { layer, root, clock } = mount(cap)
    layer.start()

    const seen = new Set<HTMLElement>()
    for (let pop = 0; pop < 10; pop++) {
      const hanging = balloonsIn(root)
      expect(hanging).toHaveLength(cap)
      expect(layer.balloonCount()).toBe(cap)

      const popped = asElement(hanging[0])
      seen.add(popped)
      popped.click()
      clock.advance(AFTER_COLLAPSE)
      // The popped element is out of the tree, so it cannot be a hit target in a later pop.
      expect(popped.isConnected).toBe(false)
    }

    // Ten pops hung ten different elements, and none of them is still in the tree: the refills are new
    // elements, the popped ones leave, and the tree still holds exactly the cap.
    expect(seen).toHaveLength(10)
    expect(balloonsIn(root).some((el) => seen.has(el))).toBe(false)
    expect(balloonsIn(root)).toHaveLength(cap)
    expect(balloonsIn(root).some((el) => el.classList.contains('balloon--popped'))).toBe(false)
    expect(layer.balloonCount()).toBe(cap)
  })
})

describe('the bunch colours overlapping balloons apart (issue #49)', () => {
  it('gives every balloon a palette colour and never repeats one across an overlap', () => {
    const { layer, root } = mount(12)
    layer.start()

    const hung = balloonsIn(root)
    const places = hung.map(placeOf)
    const palette = paletteColours()
    for (const el of hung) expect(palette).toContain(el.style.color)

    let overlaps = 0
    for (let i = 0; i < hung.length; i++) {
      for (let j = i + 1; j < hung.length; j++) {
        if (!definitelyOverlaps(places[i] as Place, places[j] as Place)) continue
        overlaps++
        expect(asElement(hung[j]).style.color).not.toBe(asElement(hung[i]).style.color)
      }
    }
    // Otherwise the test would pass by hanging a bunch with nothing overlapping in it.
    expect(overlaps).toBeGreaterThan(0)
  })

  it('colours a refill against the bunch it joins, and leaves the survivors alone', () => {
    const { layer, root, clock } = mount(12)
    layer.start()

    const before = balloonsIn(root)
    const beforePlaces = before.map(placeOf)
    const popped = asElement(before[0])
    popped.click()
    clock.advance(AFTER_COLLAPSE)

    const after = balloonsIn(root)
    expect(after).toHaveLength(before.length)
    expect(after.some((el) => el === popped)).toBe(false)

    // Every balloon that was already hanging is still the same element with the same colour: a refill
    // never recolours the bunch it joins.
    for (let i = 1; i < before.length; i++) {
      const survivor = asElement(after[i - 1])
      expect(survivor).toBe(before[i])
      expect(survivor.style.color).toBe(asElement(before[i]).style.color)
    }

    const refill = asElement(after[after.length - 1])
    expect(paletteColours()).toContain(refill.style.color)

    // The refill's place is written to the DOM in whole px, so `definitelyOverlaps` keeps a pair that only
    // looks like an overlap after rounding out of the assertion.
    const refillPlace = placeOf(refill)
    let overlaps = 0
    for (let i = 1; i < before.length; i++) {
      if (!definitelyOverlaps(refillPlace, beforePlaces[i] as Place)) continue
      overlaps++
      expect(refill.style.color).not.toBe(asElement(before[i]).style.color)
    }
    expect(overlaps).toBeGreaterThan(0)
  })
})

describe('the party keeps its own count of what she popped (issue #37)', () => {
  it('counts the pops rather than the size of the set, and starts the next party at zero', () => {
    const { layer, root, clock } = mount(2)
    layer.start()
    expect(layer.popCount()).toBe(0)

    const first = asElement(balloonsIn(root)[0])
    first.click()
    expect(layer.popCount()).toBe(1)

    clock.advance(AFTER_COLLAPSE)
    // The set is back at the cap, so the row would read 2 again if it reported the set. The counter is what
    // still says she popped one - which is what the label `balloons popped` claims.
    expect(balloonsIn(root)).toHaveLength(2)
    expect(layer.popCount()).toBe(1)

    const second = asElement(balloonsIn(root)[1])
    second.click()
    expect(layer.popCount()).toBe(2)

    // A second tap on a balloon that is already collapsing does not count it twice, because the same guard
    // that stops the pop stops the count.
    second.click()
    expect(layer.popCount()).toBe(2)

    // Leaving the party is the end of its count: the number belongs to the party she is in, not to the level
    // she has moved on from, and a party the launch restored has popped nothing in this run.
    layer.stop()
    expect(layer.popCount()).toBe(0)
  })
})
