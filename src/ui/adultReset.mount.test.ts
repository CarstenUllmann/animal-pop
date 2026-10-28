// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { ADULT_RESET } from '../game/constants'
import { mountAdultReset } from './adultReset'
import type { Timer } from './timer'

/**
 * The adult reset's pointer handling, mounted (SPEC §14.2, issue #16).
 *
 * `game/adultReset.test.ts` proves the rules; this proves the wiring that made the rules unreachable:
 * a browser sends a `click` when the long press ends, and that click used to run the numeral's cancel
 * handler, closing the confirm step one event after it opened. The same long press also made the
 * second tap land on the numeral rather than on the tiny tick, so the reset is mounted against what
 * the pointer really does, not against an idealised tap.
 *
 * The real-browser behaviour (long press produces pointerdown, then pointerup, then click) is
 * replicated by dispatching all three. jsdom has no layout, so this proves the tree and the callback,
 * which is the half that was broken; the target size is the stylesheet's business.
 */

interface Harness {
  numeral: HTMLElement
  number: HTMLElement
  icon: HTMLElement
  advance(ms: number): void
  /** A full tap: down, up, click, as a browser sends for a short press. */
  tap(node: Element): void
  resets: number
  now(): number
  destroy(): void
}

function harness(): Harness {
  const numeral = document.createElement('span')
  numeral.className = 'panel__level-value'
  const number = document.createElement('span')
  number.className = 'panel__level-number'
  number.textContent = '4'
  numeral.append(number)
  document.body.append(numeral)

  let now = 1000
  let nextId = 1
  let jobs: Array<{ id: number; due: number; run: () => void }> = []
  const timer: Timer = {
    after(ms, run) {
      const id = nextId++
      jobs.push({ id, due: now + ms, run })
      return id
    },
    clear(id) {
      jobs = jobs.filter((job) => job.id !== id)
    },
  }
  const advance = (ms: number): void => {
    now += ms
    const due = jobs.filter((job) => job.due <= now).sort((a, b) => a.due - b.due)
    jobs = jobs.filter((job) => job.due > now)
    for (const job of due) job.run()
  }

  let resets = 0
  const view = mountAdultReset(numeral, {
    clock: { now: () => now },
    timer,
    onReset: () => {
      resets += 1
    },
  })
  const icon = numeral.querySelector<HTMLElement>('.adult-confirm')
  if (icon === null) throw new Error('mountAdultReset did not add its confirm icon')

  return {
    numeral,
    number,
    icon,
    advance,
    tap(node: Element): void {
      node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      node.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    },
    get resets() {
      return resets
    },
    now: () => now,
    destroy(): void {
      view.destroy()
      numeral.remove()
    },
  }
}

/** Hold the numeral for three seconds, then release the way a browser does. */
function hold(h: Harness): void {
  h.number.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  h.advance(ADULT_RESET.holdMs)
  h.number.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
  h.number.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('adult reset pointer handling (SPEC §14.2, issue #16)', () => {
  it('keeps the confirm step open when the long press ends', () => {
    // The regression: the click that a browser sends on release hit the numeral's cancel handler, so
    // the confirm step closed in the same gesture that opened it.
    const h = harness()
    h.number.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    h.advance(ADULT_RESET.holdMs)

    expect(h.icon.hidden).toBe(false)
    expect(h.numeral.classList.contains('panel__level--confirming')).toBe(true)

    // Release the hold: pointerup, then the trailing click on the same element.
    h.number.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    h.number.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(h.icon.hidden).toBe(false)
    expect(h.numeral.classList.contains('panel__level--confirming')).toBe(true)
    expect(h.resets).toBe(0)
    h.destroy()
  })

  it('confirms on a second tap on the numeral, not only on the tick', () => {
    // The adult held the numeral, so that is the target they will tap again. The tick is 17px of text
    // inside it; requiring the second tap to land on the glyph made the path fail for a finger.
    const h = harness()
    hold(h)

    h.tap(h.number)

    expect(h.resets).toBe(1)
    expect(h.icon.hidden).toBe(true)
    expect(h.numeral.classList.contains('panel__level--confirming')).toBe(false)
    h.destroy()
  })

  it('confirms when the tick itself is activated, so the icon is still a button', () => {
    const click = harness()
    hold(click)

    click.icon.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(click.resets).toBe(1)
    click.destroy()

    // A span with role="button" has no native keyboard activation, so the module handles the keys.
    const key = harness()
    hold(key)
    key.icon.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(key.resets).toBe(1)
    key.destroy()
  })

  it('cancels cleanly on a tap outside the numeral, and that tap does not reset', () => {
    const h = harness()
    hold(h)
    const board = document.createElement('button')
    document.body.append(board)

    board.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(h.icon.hidden).toBe(true)
    expect(h.numeral.classList.contains('panel__level--confirming')).toBe(false)

    // The confirm step is gone, so a later tap on the numeral is a normal tap again.
    h.tap(h.number)
    expect(h.resets).toBe(0)
    board.remove()
    h.destroy()
  })

  it('a normal tap never opens the confirm step, even after the hold timer would have fired', () => {
    const h = harness()

    h.tap(h.number)
    h.advance(ADULT_RESET.holdMs + 5000)

    expect(h.icon.hidden).toBe(true)
    expect(h.resets).toBe(0)
    h.destroy()
  })

  it('gives the confirm step up after its timeout', () => {
    const h = harness()
    hold(h)
    expect(h.icon.hidden).toBe(false)

    h.advance(ADULT_RESET.confirmTimeoutMs + 1)
    expect(h.icon.hidden).toBe(true)

    h.tap(h.number)
    expect(h.resets).toBe(0)
    h.destroy()
  })
})
