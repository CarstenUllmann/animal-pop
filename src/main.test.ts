import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The composition root (SPEC §15). `main.ts` mounts the real board, the panel and the celebration, so
 * vitest cannot run it in node (`vitest.config.ts`). What node can hold to is the wiring that is invisible
 * to the pure tests: the pure modules decide, and this file is where a decision becomes a screen. The
 * assertions read the shipped source the way `debug.test.ts` and `panelView.test.ts` do.
 *
 * The gaps these pin were both quiet ones: a core result that was never shown (the reshuffle), and a state
 * that was restored but never revealed (a party that was already earned).
 */

const SRC = dirname(fileURLToPath(import.meta.url))
const mainSource = readFileSync(join(SRC, 'main.ts'), 'utf8')

/** The source between two markers, which is how a branch is read without parsing TypeScript. */
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from === -1) return ''
  const to = source.indexOf(end, from + start.length)
  return to === -1 ? source.slice(from) : source.slice(from, to)
}

describe('the board on screen matches the board in the state (SPEC §7.4, issue #5)', () => {
  // `resolveTap` decides a reshuffle in the core, and `state.board` becomes the reshuffled board. The view
  // has to be told separately: `animatePop` animates the settle that *preceded* the dead-board check.
  const popBranch = between(mainSource, 'if (result.group !== null) {', '} else {')

  it('animates the reshuffled board after the pop that ran into it', () => {
    const pop = popBranch.indexOf('await view.animatePop(')
    const whoosh = popBranch.indexOf('player.playReshuffle()')
    const reshuffle = popBranch.indexOf('await view.animateReshuffle(result.reshuffled)')

    expect(pop).toBeGreaterThan(-1)
    expect(reshuffle).toBeGreaterThan(pop)
    // The whoosh belongs to the animation it announces, not to the pop that started the chain.
    expect(whoosh).toBeGreaterThan(pop)
    expect(whoosh).toBeLessThan(reshuffle)
  })

  it('uses the board the core decided, never the settled board the pop described', () => {
    // `popForView` hands the settle to `animatePop`; the reshuffle is `result.reshuffled` and nothing else.
    expect(popBranch).toContain('await view.animateReshuffle(result.reshuffled)')
    expect(popBranch).not.toContain('animateReshuffle(result.state.board)')
  })

  it('keeps the whoosh out of the pop, so it cannot play over a board that is still playable', () => {
    // The regression: `playTap` played the whoosh whenever `result.reshuffled` was set, but nothing then
    // showed the reshuffle, so the sound announced a change the screen never made.
    expect(between(mainSource, 'function playTap(', '}')).not.toContain('playReshuffle')
  })
})

describe('a party restored after a force-close (SPEC §14.1, issue #15)', () => {
  const firstFrame = between(mainSource, "log.step('first frame')", '.catch(')

  it('opens the party when the resumed save is already complete', () => {
    // A save written after the goals hit zero is a party she has not tapped ▶ on yet. Reopening it used to
    // show the finished board with the party hidden and no arrow: a screen with no way forward.
    expect(firstFrame).toContain('shouldShowParty(state, partyShown)')
    expect(firstFrame).toContain('showParty(false)')
    expect(firstFrame.indexOf('showLevel()')).toBeLessThan(firstFrame.indexOf('showParty(false)'))
    expect(firstFrame.indexOf('showParty(false)')).toBeLessThan(firstFrame.indexOf('drainQueue()'))
  })

  it('counts the completion once, when the tap earns it rather than when the launch restores it', () => {
    const party = between(mainSource, 'function showParty(', 'function nextLevel(')
    expect(party).toContain('if (countCompletion)')
    expect(party).toContain('context.levelsCompleted += 1')
    // The tap path uses the rule without the override, so it counts.
    const tapPath = between(mainSource, '// SPEC §8.1: both goals at zero', '} catch (error)')
    expect(tapPath).toContain('showParty()')
  })

  it('drops a tap still queued from the settle that won, rather than popping behind the party', () => {
    // SPEC §7.5 keeps a tap that arrives during an animation, but §10 makes the board inert once the
    // party is up. A queued tap that ran afterwards would change the saved rack after the balloons were
    // sized from it, and pop a tile she can only see through the dim.
    expect(between(mainSource, 'function showParty(', 'function nextLevel(')).toContain('queue.clear()')
  })

  it('reads the same rule on both paths, so they cannot drift apart', () => {
    const calls = mainSource.match(/shouldShowParty\(state, partyShown\)/g) ?? []
    expect(calls).toHaveLength(2)
  })
})

describe('the celebration hangs the bunch from the board the game has (issue #34)', () => {
  it('is handed the board `ui/layout.ts` derives, read as functions so a rotation gives the new one', () => {
    // The end markers are text beyond the wiring rather than a closing brace: the option values are arrow
    // functions, and the first `})` after the start would cut the section inside `boardOrigin`.
    const wiring = between(mainSource, 'const celebration = createCelebration(', '// The overlay measures frames itself')
    expect(wiring).toContain('metrics: () => bunchMetricsFor(layout.boardPx, layout.balloonPx, layout.arrowBandPx)')
    expect(wiring).toContain('boardOrigin: () => ({ x: layout.boardOffsetXPx, y: layout.boardOffsetYPx })')

    // The layer reads these on every set and on every re-clamp, so the handler has to apply the new layout
    // before it tells the layer to resize: a turn mid-party moves the balloons to the board the game has now.
    const resize = between(mainSource, "window.addEventListener('resize'", 'reportEnvironment()')
    expect(resize.indexOf('applyLayout(')).toBeLessThan(resize.indexOf('celebration.resize()'))
  })
})
