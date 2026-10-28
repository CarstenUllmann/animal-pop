import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CELEBRATION, LAYOUT, PARTICLES, playButtonDelayMsFor } from '../game/constants'

/**
 * `ui/celebration.ts` is a DOM module and vitest runs in node (`vitest.config.ts`), so the parts that
 * need a canvas cannot be mounted here. What can be held to is the source itself, the same way
 * `styles.test.ts` and `mute.test.ts` check the couplings that only exist in a browser.
 */

const SRC = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(SRC, 'celebration.ts'), 'utf8')

function section(start: string, end: string): string {
  const from = source.indexOf(start)
  if (from === -1) return ''
  const to = source.indexOf(end, from + start.length)
  return to === -1 ? source.slice(from) : source.slice(from, to)
}

describe('celebration module (issues #12, #13, #25-#28)', () => {
  it('reveals the play arrow pulsing, not just visible', () => {
    // The stylesheet cannot add the pulse by itself: `next--pulsing` is the class the module has to
    // put on the arrow. It used to remove the class on stop but never add it.
    const reveal = section('const reveal = (): void =>', 'if (reducedMotion)')
    expect(reveal).toContain('next--ready')
    expect(reveal).toContain('next--pulsing')
    expect(source).toContain("play.classList.remove('next--pulsing')")
  })

  it('opens the party with a three-burst volley instead of waiting for a balloon or the ambient timer', () => {
    // SPEC §10.1 phase 1 (issue #27): three bursts at 0/180/460ms. The ambient burst is every 60
    // frames, so a party that only drew on a balloon pop opened on a dimmed, still board.
    const start = section('function start(): void {', 'function stop(): void {')
    expect(start).toContain('spawnBurst(')
    expect(start).toContain('draw()')
    expect(start).toContain('later(180,')
    expect(start).toContain('later(460,')
  })

  it('owns and clears every timer it schedules, so a left party cannot tick into the next one', () => {
    expect(source).toContain('const timers: number[] = []')
    expect(section('function stop(): void {', 'return {')).toContain('clearTimers()')
    // Delayed work goes through the injected `Timer`, never through the module's own window: that is what
    // lets the mount test advance the collapse instead of sleeping through it, and it keeps this module as
    // testable as `ui/adultReset.ts`, which takes the same seam.
    expect(source).not.toContain('window.setTimeout')
    expect(source).not.toContain('window.clearTimeout')
    expect(section('function later(', 'function clearTimers')).toContain('opts.timer.after(')
    expect(section('function clearTimers(', '// Reduced motion')).toContain('opts.timer.clear(')
  })

  it('derives the play-arrow delay from the party the set actually has (issue #28)', () => {
    // The party read at start is the one the delay is built from, because a respawn can change the
    // count. The same number is written inline and used for the reveal timer, so the CSS fade-in and
    // the class that makes the arrow tappable cannot drift apart.
    const start = section('function start(): void {', 'function stop(): void {')
    expect(start).toContain('const size = partySize()')
    expect(start).toContain('const playDelay = playButtonDelayMsFor(size)')
    expect(start).toContain("play.style.setProperty('--play-button-delay'")
    expect(start).toContain('later(playDelay, reveal)')
    // Twelve balloons land at 2.52s and three at 1.44s, not at the old fixed 1500ms.
    expect(playButtonDelayMsFor(12)).toBe(2520)
    expect(playButtonDelayMsFor(3)).toBe(1440)
    expect(CELEBRATION.playButtonDelayMs).toBe(1500)
  })

  it('keeps only timers that can still fire, so a long party cannot grow the list', () => {
    // Every pop schedules an exit, so a list that also kept the ids it had already fired would grow for as
    // long as she plays, which is what "idles indefinitely" rules out (SPEC §10.1 phase 4).
    const later = section('function later(', 'function clearTimers')
    expect(later).toContain('timers.splice(at, 1)')
    expect(later).toContain('timers.push(id)')
  })

  it('times the browser\'s frames, not its own draw work, so the 30fps tier can actually fire', () => {
    // SPEC §10.2's budget is frame time. Timing this layer's own `draw()` (a few hundred arcs) always
    // reads healthy even while the screen runs at 25fps, so the degrade could never happen on the
    // tablet and #12's "observable and reversible" was only half true.
    const draw = section('function draw(): void {', '/** The number of balloons')
    expect(draw).toContain('meter.tick(now)')
    expect(draw).toContain('setTier(tick.tier)')
    expect(draw).not.toContain('workStart')
    expect(source).toContain('createFrameTierMeter()')
  })

  it('exposes the tier from the first party frame, not only after a change (issue #12)', () => {
    // `setTier` writes on change, so a healthy party carried no `data-tier` at all: the one observable
    // the device check has said nothing until the tablet was already in trouble.
    expect(source).toContain('root.dataset.tier = shownTier')
    const assignments = source.match(/root\.dataset\.tier = shownTier/g) ?? []
    expect(assignments.length).toBeGreaterThanOrEqual(2)
  })

  it('gives every balloon a colour, because the stylesheet fills it with currentColor', () => {
    // The SVG body is `fill: currentColor`; nothing set the inherited colour, so the party was a row of
    // white ovals rather than balloons (SPEC §10.1). The colour is drawn against the balloons already
    // hanging rather than from the spawn index, so overlapping bodies differ (issue #49).
    expect(source).toContain('el.style.color')
    expect(source).toContain('BALLOON_COLORS')
    expect(source).toContain('pickBalloonColour(place, balloons, BALLOON_COLORS, rng)')
    expect(source).not.toContain('index % BALLOON_COLORS.length')
  })

  it('builds the three-element balloon, one transform owner each (issues #25, #26)', () => {
    // `.balloon` owns the rise (the hit box travels with the balloon), `.balloon__float` owns the
    // endless sway/bob, `.balloon__shape` owns the pop. Reintroducing the single-element structure is
    // exactly the mid-rise silent pop this test exists to catch.
    const spawn = section('function spawnBalloon(', 'function start(): void {')
    expect(spawn).toContain("float.className = 'balloon__float'")
    expect(spawn).toContain("shape.className = 'balloon__shape'")
    expect(spawn).toContain('float.append(shape)')
    expect(spawn).toContain('el.append(float)')
    // Issue #35: the pop is its own step now, so the button only wires the tap.
    expect(spawn).toContain('popBalloon(balloon)')
    expect(spawn).not.toContain("el.style.transform")
  })

  it('pops to nothing and leaves the tree, on a timer the module owns (issue #35)', () => {
    const pop = section('function popBalloon(', 'function spawnBalloon(')
    expect(pop).toContain("classList.add('balloon--popped')")
    // The removal is a timer in the set `stop()` clears, never a `transitionend` listener: that is what left
    // the poppable stub in the tree, and it is why a party she has left cannot remove an element in the next
    // one.
    expect(pop).toContain('later(CELEBRATION.balloonCollapseMs,')
    expect(pop).toContain('balloon.el.remove()')
    expect(pop).not.toContain('transitionend')
    // Reduced motion makes the collapse a single frame in the stylesheet, so pop and removal are the same
    // step (SPEC §13): there is no travel for a timer to wait on.
    expect(pop).toContain('if (reducedMotion)')
    // The burst still fires at pop time, from the balloon's own box (issue #27; fireworks are not in scope).
    expect(pop).toContain('spawnBurst(')
    // The hit box goes with the balloon: `styles.test.ts` holds the stylesheet's `pointer-events: none`, and
    // the module keeps its own guard so a second tap cannot pop the same balloon twice.
    expect(source).toContain('if (!running || balloon.popped) return')
    // `stop()` cancels the pending exits and takes a mid-collapse balloon with it.
    const stop = section('function stop(): void {', 'return {')
    expect(stop).toContain('clearTimers()')
    expect(stop).toContain('balloon.el.remove()')
  })

  it('refills the slot a pop leaves, at the cap, with no delay and no sound (issue #36)', () => {
    const pop = section('function popBalloon(', 'function spawnBalloon(')
    const spawn = section('function spawnBalloon(', 'function start(): void {')
    const hang = section('function hangBunch(', 'function popBalloon(')

    // One slot at a time rather than a re-hung set: the bunch she sees is the one the rule answered, and only
    // the gap a pop made is new. Re-hanging the whole set is what left a shrunken bunch on the board and a
    // child tapping at nothing.
    expect(pop).toContain('placeSlot(')
    expect(pop).not.toContain('hangBunch()')

    // The cap is the party rather than the board (SPEC §8.4), so a long session cannot grow the set, and
    // `placeSlot` answers `null` when no spot is free, which is the honest answer on a board that is already
    // full at the rung the bunch sits at (issue #33).
    expect(pop).toContain('balloons.length >= partySize()')
    expect(pop).toContain('if (place === null) return')
    // The refill is asked against the bunch still hanging, which is the set as she sees it: by the time the
    // exit runs, the spot this balloon was fading out of is free, so a refill may drift into it.
    expect(pop).toContain('balloons.map((entry) => entry.place)')

    // No delay beyond the rise. The set that arrives together is still staggered, a refilled slot is not, so
    // the 1200ms climb overlaps the 180ms collapse the slot came from and the blob never pauses.
    expect(hang).toContain('i * CELEBRATION.balloonStaggerMs')
    expect(pop).toContain('spawnBalloon(place, 0)')
    expect(spawn).toContain('el.style.animationDelay = `${delayMs}ms`')

    // Sound belongs to the pop only, so the pop's pitch is the index in the set as it is now, and the entry
    // chime with the `chimeIndex` it needed is gone (SPEC §11). The debug step for the first balloon is
    // reported at hang time, once per set, because a spawn has nothing left to report it from (issue #18).
    expect(spawn).not.toContain('audio.')
    expect(source).not.toContain('chimeIndex')
    expect(pop).toContain('audio.playBalloon(balloons.indexOf(balloon))')
    expect(hang).toContain('opts.onFirstBalloon')

    // A mid-rise balloon is tappable and pops exactly like one at rest, because the pop is not a state of the
    // rise: the same click handler and the same `popBalloon`, and nothing that asks how far the climb got.
    // The rise keeps its own transform owner, so a pop mid-climb cannot restart it (issue #25).
    expect(spawn).toContain('if (!running || balloon.popped) return')
    expect(pop).not.toContain('animation')
  })

  it('counts the pops the debug row is labelled for, for the party rather than the set (issue #37)', () => {
    const pop = section('function popBalloon(', 'function spawnBalloon(')
    const start = section('function start(): void {', 'function stop(): void {')
    const stop = section('function stop(): void {', 'return {')

    // The row is labelled `balloons popped`, and the set refills as she pops (issue #36), so the size of the
    // set cannot be what it shows: the two numbers come apart at the first pop. The counter is the party's, so
    // the party's own two ends are what reset it - opening it and leaving it.
    expect(source).toContain('popCount(): number')
    expect(source).toContain('popCount: () => poppedCount')
    expect(start).toContain('poppedCount = 0')
    expect(stop).toContain('poppedCount = 0')

    // Counted at the pop rather than at the removal, which is what the label claims: the increment is reached
    // before the exit is scheduled, so a balloon that never gets removed still counts. The guard in the click
    // handler is what keeps one balloon from counting twice.
    expect(pop).toContain('poppedCount += 1')
    expect(pop.indexOf('poppedCount += 1')).toBeLessThan(pop.indexOf('const exit = ('))

    // The live set is still readable, because it is a different number and the mount tests read it.
    expect(source).toContain('balloonCount: () => balloons.length')
  })

  it('hangs the bunch through the placement rule, in px against the board rather than as a percent of the overlay (issues #25, #32-#34)', () => {
    const hang = section('function hangAt(', 'function hangBunch(')
    const spawn = section('function spawnBalloon(', 'function start(): void {')

    // The module asks the rule for the places and writes what it answers, so the composition has one owner:
    // `styles.test.ts` reads the same rule for the stylesheet.
    expect(source).toContain("from './bunch'")
    expect(source).toContain('placeBunch(')
    expect(source).toContain('hangBunch()')

    // A place is a centre in the board, so the CSS is px measured from the board's origin inside the overlay,
    // not a percentage of an overlay that is not the board. The band and the spread are gone with the code
    // that read them, and so is the size draw: the rule draws the jitter, and the box the stylesheet draws
    // has to be the size the rule reserved, otherwise the float amplitudes it charges are not the amplitudes
    // the box travels.
    expect(hang).toContain('origin.x + place.x')
    expect(hang).toContain('origin.y + place.y')
    expect(hang).toMatch(/px`/)
    expect(hang).toContain("setProperty('--balloon-jitter'")
    expect(hang).toContain('board.balloonPx')
    expect(source).not.toContain('LAYOUT.balloonSizeJitter')
    expect(source).not.toContain('balloonBandBottomMin')
    expect(source).not.toContain('balloonBandBottomMax')
    expect(source).not.toContain('balloonSpreadStart')
    expect(source).not.toContain('balloonSpreadEnd')

    // The arrow's band is still a no-go, and the rule is what refuses it: the module hangs only what the rule
    // answered, so nothing here can put a balloon on the button she taps to move on (SPEC §10.1).
    expect(hang).not.toContain('balloonBand')

    // The float period, phase and direction still come from the injected Rng (SPEC §2).
    expect(spawn).toContain('balloonFloatMsMin')
    expect(spawn).toContain('animationDirection')
    expect(spawn).toContain('-rng.next() * period')
  })

  it('re-clamps the balloons that are already hanging on a rotation, without replaying the rise (issue #34)', () => {
    const resize = section('function resize(): void {', 'function setTier(')
    // The canvas is still sized from the rect the party covers (issue #19).
    expect(resize).toContain('canvas.width')
    // Every balloon already hanging is moved with the same charges `canPlace` reads, so a turn that would put
    // one in the arrow band pulls it up out of it. The places the rule answered are kept rather than drawn
    // again: no `Rng`, so the count cannot change with the orientation.
    expect(resize).toContain('clampToBoard(')
    expect(resize).toContain('hangAt(')
    expect(resize).not.toContain('rng.next')
    expect(resize).not.toContain('placeBunch')
    // A move, not a replay: the rise and the float keep their own transform owners and are not restarted.
    expect(resize).not.toContain('animation')
  })

  it('assigns firework colour at spawn, from a 2-3 hue subset (issue #27)', () => {
    const burst = section('function spawnBurst(', 'function draw(): void {')
    expect(burst).toContain('burstHues()')
    expect(burst).toContain('particle.color =')
    expect(burst).toContain('PARTICLES.whiteShare')
    // The draw loop reads the stored colour; it never picks one per frame.
    const draw = section('function draw(): void {', '/** The number of balloons')
    expect(draw).toContain('ctx.fillStyle = particle.color')
    expect(draw).not.toContain('FIREWORK_COLORS[')
    expect(draw).toContain('PARTICLES.hotCoreLifeFraction')
    expect(draw).toContain('particle.radius *')
    // The caps are unchanged: 120/burst, 60 on the 30fps tier, pool 500.
    expect(PARTICLES.perBurst).toBe(120)
    expect(PARTICLES.degradePerBurst).toBe(60)
    expect(PARTICLES.capacity).toBe(500)
    expect(PARTICLES.ambientFrames).toBe(60)
    expect(LAYOUT.dprMax).toBe(2)
  })
})
