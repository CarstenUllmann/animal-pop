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
    expect(between(mainSource, 'function playTapSounds(', '}')).not.toContain('playReshuffle')
  })
})

describe('the celebration hangs the bunch from the board the game has (issue #34)', () => {
  it('is handed the board `ui/layout.ts` derives, read as functions so a rotation gives the new one', () => {
    // The end markers are text beyond the wiring rather than a closing brace: the option values are arrow
    // functions, and the first `})` after the start would cut the section inside `boardOrigin`.
    const wiring = between(mainSource, 'const celebration = createCelebration(', '// The overlay measures frames itself')
    expect(wiring).toContain('metrics: () => bunchMetricsFor(layout.boardPx, layout.balloonPx, layout.arrowBandPx)')
    expect(wiring).toContain('boardOrigin: () => ({ x: layout.boardOffsetXPx, y: layout.boardOffsetYPx })')
    // Delayed work comes from the composition root's adapter, which is the only place allowed to know the
    // browser's clock (SPEC §15).
    expect(wiring).toContain('timer: timer()')

    // The layer reads these on every set and on every re-clamp, so the handler has to apply the new layout
    // before it tells the layer to resize: a turn mid-party moves the balloons to the board the game has now.
    const resize = between(mainSource, "window.addEventListener('resize'", 'report()')
    expect(resize.indexOf('applyLayout(')).toBeLessThan(resize.indexOf('celebration.resize()'))
  })
})

describe('the row that claims pops gets the pops rather than the size of the set (issue #37)', () => {
  it('reports the counter the label claims, because the number it used to report refills as she pops', () => {
    const report = between(mainSource, 'function report(', 'function showLevel(')
    // `balloons popped` is a count of what she did, and a set that refills (issue #36) cannot show that: the
    // live size reads 12 -> 11 -> 12, and the row would be wrong from the first pop.
    expect(report).toContain('balloons: celebration.popCount()')
    expect(report).not.toContain('balloonCount()')
  })

  it('belongs to the party, so the paths that open and leave a party are the paths that reset it', () => {
    // The tap that earns a party and the launch restoring one both go through `showParty` (SPEC §14.1, issue
    // #15, the path the restored-party test above reads), so a restored party reports the count it opens with:
    // nothing has been popped in this run yet.
    const party = between(mainSource, 'function showParty(', 'function nextLevel(')
    expect(party).toContain('celebration.start()')
    // The party rows are only reported while the party is on screen, so the count cannot outlive the party it
    // describes (the report's `live` is null while `party.hidden`).
    expect(between(mainSource, 'function report(', 'function showLevel(')).toContain('party.hidden')

    // `nextLevel()` leaves the party before the next one is opened, so the row cannot read as the total of a
    // level she has moved on from - and the adult reset is a level change too, so it leaves the party the same
    // way (SPEC §14.2).
    const next = between(mainSource, 'function nextLevel(', 'function divWithClass(')
    expect(next).toContain('celebration.stop()')
    expect(between(mainSource, 'onReset:', 'void view')).toContain('celebration.stop()')
  })
})
