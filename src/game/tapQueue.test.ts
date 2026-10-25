import { describe, expect, it } from 'vitest'
import { legalGroupAt } from './board'
import { MAX_QUEUED_TAPS } from './constants'
import { createLevel } from './level'
import { resolveTap } from './rules'
import { createTapQueue } from './tapQueue'
import type { Board, Goal, LevelState, Rng } from './types'

/**
 * Issue #11, SPEC §7.5: the five criteria, asserted on the pure model. `resolveTap` stands for the settle
 * the animation is showing, and opening or closing the window stands for that animation starting and
 * ending - so what is under test is the queue's decisions, not the view's timing (vitest runs in node,
 * with no screen).
 */

function boardFromRows(rows: string[]): Board {
  expect(rows).toHaveLength(6)
  const board: Board = []
  for (const row of rows) {
    expect(row).toHaveLength(6)
    for (const char of row) board.push(char === '.' ? null : char)
  }
  return board
}

function goal(animal: string, remaining: number, target: number): Goal {
  return { animal, remaining, target }
}

function stateWith(board: Board, goals: Goal[], bubbles: number, bubblesStart: number, roster: string[]): LevelState {
  return { level: 1, sessionSeed: 1, seed: 1, roster, board, goals, bubbles, bubblesStart }
}

/**
 * The settle refills the top of a column through the injected `Rng` (SPEC §7.3), so a scripted one is the
 * only way to know what the board has become by the time a queued tap is allowed to run - which is the
 * second criterion, and the reason these boards are settled rather than assumed.
 */
function scriptedRng(picks: string[]): Rng {
  let calls = 0
  return {
    next: () => 0,
    int: () => 0,
    pick<T>(_items: readonly T[]): T {
      const animal = picks[calls % picks.length]
      calls += 1
      return animal as unknown as T
    },
    shuffle<T>(items: readonly T[]): T[] {
      return items.slice()
    },
  }
}

describe('tap queue', () => {
  it('two quick taps in a row both register, in the order they arrived', () => {
    const queue = createTapQueue()

    // The first tap is the one the game is resolving, so the two that follow are the quick ones.
    expect(queue.register(13)).toBe('run')
    queue.openWindow()

    // Nothing is dropped: two taps arriving during a settle both join the queue, within the cap.
    expect(queue.register(21)).toBe('wait')
    expect(queue.register(28)).toBe('wait')
    expect(queue.size()).toBe(2)

    // Order is arrival order, not board order: 21 was tapped before 28 even though 28 is the lower cell.
    queue.closeWindow()
    expect(queue.drain()).toBe(21)
    expect(queue.drain()).toBe(28)
    expect(queue.drain()).toBeNull()
  })

  it('a queued tap is decided against the board as it settled, not the board she tapped on', () => {
    const staleBoard = boardFromRows([
      'fppppp',
      'fppppp',
      'cppppp',
      'cppppp',
      'cppppp',
      'cppppp',
    ])
    const goals = [goal('frog', 2, 2), goal('panda', 2, 2)]
    const stale = stateWith(staleBoard, goals, 12, 12, ['frog', 'cat', 'panda'])

    // She taps the frog pair, then taps the cell she has just popped while its settle is still running.
    const queue = createTapQueue()
    expect(queue.register(0)).toBe('run')
    queue.openWindow()
    expect(queue.register(6)).toBe('wait')

    // The settle happens under her finger: column 0 refills from the top, so index 6 is a different
    // animal by the time the queue is allowed to answer.
    const running = resolveTap(stale, 0, scriptedRng(['cat', 'frog']))
    const settled = running.state
    expect(settled.board[6]).not.toBe(staleBoard[6])
    queue.closeWindow()

    const index = queue.drain()
    // The queue gave back an index and nothing else - it never kept a board to decide against.
    expect(index).toBe(6)

    // Against the board she saw, index 6 was part of a legal group and would have spent a bubble.
    // Against the settled board the same cell is a single animal: free, and not a pop (SPEC §7.2).
    expect(legalGroupAt(staleBoard, index!)).not.toBeNull()
    const decision = resolveTap(settled, index!, scriptedRng(['cat']))
    expect(decision.outcome).toBe('invalid')
    expect(decision.bubbleSpent).toBe(false)
    expect(decision.state.bubbles).toBe(11) // only the tap that was running paid for itself
  })

  it('is never blocked longer than the animation that is running', () => {
    const queue = createTapQueue()

    // The window is the animation, and it is opened by the caller; the queue has no clock of its own, so
    // the block can only ever be as long as that window.
    queue.openWindow()
    expect(queue.register(9)).toBe('wait')

    // Still animating: the tap that arrived during it waits.
    expect(queue.drain()).toBeNull()

    // The first moment the window closes it runs - there is no second gate to wait for.
    queue.closeWindow()
    expect(queue.drain()).toBe(9)

    // And a tap that arrives after the window closed is never made to wait for a tap it is not behind.
    expect(queue.register(15)).toBe('run')
  })

  it('discards a tap past the cap quietly, and a dropped tap costs nothing', () => {
    // Three separate legal groups, so each tap would have paid for itself if it had been kept.
    const board = boardFromRows([
      'aaxyzw',
      'pbbqrs',
      'tuvccn',
      'defghi',
      'jklmno',
      'pqrstu',
    ])
    const goals = [goal('q', 2, 2), goal('r', 2, 2)]
    const queue = createTapQueue()

    queue.openWindow()
    expect(queue.register(0)).toBe('wait')
    expect(queue.register(7)).toBe('wait')
    // The cap is already full, so this tap is discarded quietly: nothing throws, and nothing about it is
    // remembered anywhere, so there is no penalty.
    expect(() => queue.register(15)).not.toThrow()
    expect(queue.register(15)).toBe('dropped')
    expect(queue.size()).toBe(MAX_QUEUED_TAPS)

    // The two that were already waiting are the ones kept: a tap over the cap cannot displace an earlier
    // one, so the queue is still what she tapped first.
    queue.closeWindow()
    const first = queue.drain()
    const second = queue.drain()
    expect([first, second]).toEqual([0, 7])
    expect(queue.drain()).toBeNull()

    // No penalty: the rack is exactly what the two kept taps spent. The discarded tap was a legal tap, so
    // it is the discard - not the rules - that keeps the rack at 10 rather than 9, and nothing about the
    // dropped tap is recorded.
    let state = stateWith(board, goals, 12, 12, ['a', 'b', 'c', 'q', 'r'])
    state = resolveTap(state, first!, scriptedRng(['x', 'y'])).state
    state = resolveTap(state, second!, scriptedRng(['x', 'y'])).state
    expect(state.bubbles).toBe(10)
    expect(state.goals).toEqual(goals)
    expect(legalGroupAt(board, 15)).not.toBeNull()
  })

  it('is cleared on a level change, so nothing from the level she left can run', () => {
    const board = boardFromRows([
      'aaxyzw',
      'pbbqrs',
      'tuvccn',
      'defghi',
      'jklmno',
      'pqrstu',
    ])
    const queue = createTapQueue()

    // The last settle of level 1 is still animating when the level changes - issue #11's case, and what
    // `nextLevel()` and the adult reset (SPEC §14.2) both do.
    queue.openWindow()
    expect(queue.register(1)).toBe('wait')
    expect(queue.register(8)).toBe('wait')

    queue.clear()
    expect(queue.size()).toBe(0)
    // Cleared correctly means there is nothing left to decide against the board the new level was dealt
    // (SPEC §9.2): an index from level 1 has no meaning on level 2's board.
    expect(queue.drain()).toBeNull()

    // The window is not cleared with the taps, because the new level is dealt by an animation: a tap during
    // the deal still has to wait rather than run against a board that is not on screen yet.
    const levelTwo = createLevel(2, 7, ['a', 'b', 'c', 'q', 'r'])
    expect(queue.register(15)).toBe('wait')
    expect(levelTwo.board).not.toEqual(board)
    queue.closeWindow()

    // And the queue works for the new level from then on.
    expect(queue.drain()).toBe(15)
    expect(queue.size()).toBe(0)
  })
})
