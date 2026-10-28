import {
  BALLOON_COLORS,
  CELEBRATION,
  FIREWORK_COLORS,
  LAYOUT,
  MAX_BALLOONS,
  PARTICLES,
  playButtonDelayMsFor,
} from '../game/constants'
import type { AudioPlayer } from '../audio/player'
import type { PartyTier, Rng } from '../game/types'
import { bunchFactor, clampToBoard, placeBunch, placeSlot, type BunchMetrics, type Place } from './bunch'
import { hasMatchMedia } from './capabilities'
import { createFrameTierMeter, type FrameTier } from './frameTier'
import { createPool } from './pool'

export type { FrameTier } from './frameTier'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The celebration layer (SPEC §10, issues #12 and #13). Balloons rise one at a time so the scene does not
 * arrive as one flat wall, each pops on tap, and the slot a pop leaves is refilled by a fresh draw so the
 * bunch never empties (issue #36). Sound belongs to the pop only. The number of balloons is the bubbles she
 * has left, capped at twelve. The play button appears once the last balloon has settled, and it becomes
 * visible and tappable in the same step (issue #28), while the balloons keep swaying behind it (issue #26).
 * A pop is a collapse that ends with the balloon taken out of the tree, and while it collapses it takes no
 * taps (issue #35).
 *
 * This is the only particle system in the game. Density is capped by `PARTICLES` and the burst
 * objects come from `ui/pool.ts`, which never grows past its capacity, so a burst cannot make the
 * old WebView stutter (SPEC §5). When frames run over budget for `degradeAfterMs` the layer drops
 * to the 30fps tier, and comes back after `recoverAfterMs` of frames inside the budget: one bad
 * stretch on the tablet would otherwise be the tier for the rest of the session (issue #12). That
 * decision is `ui/frameTier.ts`, where the measurement and the recovery are testable; this module
 * only applies it.
 *
 * The layer is an overlay over the board rather than a band below it: the board stays visible under the
 * dim, and this module's root element is the rect the canvas measures, so that element has to be
 * resized when the tablet turns (issue #19).
 *
 * Since issue #34 the layer does not decide where the balloons hang: `ui/bunch.ts` answers the places, and
 * this module hangs them in px against the board rather than as percentages of the overlay, because the
 * overlay is not the board. A rotation re-clamps what is already hanging - a move, not a new placement, so
 * no `Rng` is consumed and the rise and the float are not restarted.
 *
 * Random is allowed here for visual jitter only, never for gameplay, and it comes through the
 * injected `Rng` so a session can be replayed (SPEC §2).
 */

export interface CelebrationLayer {
  start(): void
  stop(): void
  /** Called on rotation: the canvas is sized from the layer's rect, so a portrait turn has to resize it, and
   *  the balloons already hanging are re-clamped to the new board rather than placed again (SPEC §13, issues
   *  #19, #34). */
  resize(): void
  /** The tier in effect, which is what the debug overlay reports (issue #18). */
  frameTier(): FrameTier
  /** The size of the set she is looking at, which shrinks and refills as she pops. The `balloons popped` row
   *  is not this number: it reads `popCount()` instead, because a set that refills cannot show what she did
   *  (issue #37). */
  balloonCount(): number
  /** What the `balloons popped` row reports: the pops this party has earned, reset when a party opens (issue
   *  #37). */
  popCount(): number
  particleCount(): number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  /** Seconds left before the particle is released. */
  life: number
  /** The life this particle spawned with, so its age is a fraction rather than a raw count. */
  maxLife: number
  /** The radius at spawn, in CSS px. It shrinks as the particle dies (issue #27). */
  radius: number
  /** The hue is taken at spawn, never per frame: assigning it while drawing would burn main-thread time. */
  color: string
}

interface Balloon {
  el: HTMLElement
  /** The pop has happened, so a second tap must not pop the same balloon twice (issue #35). The stylesheet
   *  takes the hit box off a collapsing balloon; this is the module's own belt under that rule. */
  popped: boolean
  /** The place this balloon is hung at, in the board the rule was read against (issue #34). A rotation
   *  re-clamps this rather than drawing a new one, so the bunch she sees is the bunch the rule answered. */
  place: Place
}

export interface CelebrationOptions {
  /** The tier the party earned, read when the party starts rather than when the layer is built (SPEC §8.4). */
  tier: () => PartyTier
  /** The bubbles she has left, which is the number of balloons (SPEC §10.1, issue #13). Read on each
   *  set, so a respawn uses the size the core has now, not the size at the moment the party started. */
  balloons: () => number
  onFirstBalloon?: () => void
  /** Called when the play arrow appears, which is after the fanfare has run (SPEC §10.1). */
  onPlayReady?: () => void
  /** Tapping the play arrow. The game decides what "the next level" means (issue #13). */
  onPlay?: () => void
  /** The board the bunch is placed inside: the painted board, the nominal balloon size on this device, and
   *  where the play arrow's band begins. Read on each set and on every rotation, so the celebration hangs
   *  the places `ui/bunch.ts` answers against the board the game has now (issue #34). */
  metrics: () => BunchMetrics
  /** The painted board's origin inside the overlay, which is what turns a place into px: a place is a centre
   *  in the board, and the overlay is not the board, so a percentage of the overlay cannot be a place in it
   *  (issue #32, SPEC §10.1 *The bunch*). The placement rule never reads these numbers; the paint step does. */
  boardOrigin: () => { x: number; y: number }
}

export function createCelebration(
  root: HTMLElement,
  audio: AudioPlayer,
  rng: Rng,
  opts: CelebrationOptions,
): CelebrationLayer {
  const dpr = Math.min(window.devicePixelRatio || 1, LAYOUT.dprMax)

  const canvas = document.createElement('canvas')
  canvas.className = 'particle-layer'
  root.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const particles = createPool<Particle>(PARTICLES.capacity, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 0,
    radius: 0,
    color: PARTICLES.whiteColor,
  }))
  const balloons: Balloon[] = []

  // Issue #37: what the `balloons popped` row reports. It is the pops this party has earned, not the size of
  // the set, because a set that refills as she pops (issue #36) says nothing about what she popped - the two
  // numbers come apart at the first pop. It counts the pop rather than the removal, because the row is about
  // what she did, and the double-tap guard means one balloon can only ever contribute one.
  let poppedCount = 0

  // SPEC §10.1 phase 3 (issue #13): the big pulsing ▶ under the balloons. It is in the DOM from the
  // moment the party starts, so it is tappable the instant the fade-in reveals it - the delay is CSS,
  // written inline per party from the last balloon's landing (issue #28), with the constant as fallback.
  const row = document.createElement('div')
  row.className = 'celebration__row'
  const play = document.createElement('button')
  play.type = 'button'
  play.className = 'next'
  play.setAttribute('aria-label', 'Next level')
  play.append(playGlyph())
  play.addEventListener('click', () => {
    if (!running || opts.onPlay === undefined) return
    opts.onPlay()
  })
  // The arrow has to be in the tree, or the `next--ready` step below reveals an element that is not on
  // screen: the party would show its balloons and then have no way out of the level (issue #13).
  row.append(play)
  root.append(row)

  let running = false
  let raf = 0
  /** When the last drawn frame started, so `dt` is the time between drawn frames, not the ticks. */
  let drawnAt = 0
  let frameCount = 0
  /**
   * Every pending timer this layer owns: the play-arrow reveal, the opening bursts and the exits that remove a
   * collapsing balloon (issue #35). `stop()` clears them all, so a party that has been left cannot tick into
   * the next one and an idle layer owns nothing (SPEC §10.1, §10.2, issue #12).
   */
  const timers: number[] = []
  // The tier decision lives in `ui/frameTier.ts`; the meter is fed every animation frame and also owns
  // the 30fps throttle. `shownTier` is only what has reached the DOM, so `data-tier` is written when it
  // changes rather than on every frame.
  const meter = createFrameTierMeter()
  let shownTier: FrameTier = '60fps'
  // Issue #12: the tier has to be observable from the first frame of the party, not only once it changes.
  // `setTier` writes on change, so without this the healthy party carried no `data-tier` at all.
  root.dataset.tier = shownTier

  function later(ms: number, run: () => void): void {
    // Only pending timers are kept: a party that is left open respawns a set of balloons every time she
    // pops them all, and a list that also held every timer already fired would grow for as long as she
    // plays (SPEC §10.1 phase 4, "idles indefinitely"). `clearTimers` then walks exactly what can still fire.
    const id = window.setTimeout(() => {
      const at = timers.indexOf(id)
      if (at >= 0) timers.splice(at, 1)
      run()
    }, ms)
    timers.push(id)
  }

  function clearTimers(): void {
    for (const id of timers) window.clearTimeout(id)
    timers.length = 0
  }

  // Reduced motion is a CSS rule, so the module has to stop drawing as well: a layer that keeps
  // running at 60fps underneath `visibility: hidden` is still burning frames on a weak tablet (SPEC §13).
  const reducedMotion = hasMatchMedia(window) && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function resize(): void {
    const rect = root.getBoundingClientRect()
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    // Issue #34: a turn mid-party also moves the balloons that are already hanging. The places the rule
    // answered are kept - this is a re-clamp, not a new placement, so nothing is drawn from `Rng` again and
    // the count cannot change with the orientation. `clampToBoard` reads the same charges `canPlace` does,
    // so a centre a turn puts in the arrow band is pulled up out of it, and one the new board cannot give
    // its region is pulled in to the edge the board can give.
    // It is a move: the rise and the float keep their own transform owners and are not restarted, so a
    // balloon does not climb or swing again on a turn (issue #26).
    for (const balloon of balloons) {
      const place = clampToBoard(opts.metrics(), balloon.place)
      balloon.place = place
      hangAt(place, balloon.el)
    }
  }

  function setTier(next: FrameTier): void {
    if (next === shownTier) return
    shownTier = next
    root.dataset.tier = shownTier
  }

  /**
   * A burst draws from a 2-3 hue subset of the palette (issue #27). The subset is chosen once, from
   * the injected `Rng`, and the particles take their hue from it at spawn: the colour is decided while
   * there is time, not per frame, and a replayed session gets the same bursts (SPEC §2).
   */
  function burstHues(): readonly string[] {
    const count = PARTICLES.burstHuesMin + Math.floor(rng.next() * (PARTICLES.burstHuesMax - PARTICLES.burstHuesMin + 1))
    const offset = Math.floor(rng.next() * FIREWORK_COLORS.length)
    // A 1-3 stride walks distinct entries: the palette is seven long and a burst takes at most three.
    const stride = 1 + Math.floor(rng.next() * 3)
    const hues: string[] = []
    for (let i = 0; i < count; i++) {
      const hue = FIREWORK_COLORS[(offset + i * stride) % FIREWORK_COLORS.length]
      if (hue !== undefined) hues.push(hue)
    }
    return hues
  }

  /**
   * A burst takes only what the pool can hand out, so a burst that would exceed the cap drops
   * particles (SPEC §5). Under reduced motion the layer is hidden by CSS, so drawing a burst it cannot
   * show is only work: the debug row would report live particles while nothing renders (issue #12).
   */
  function spawnBurst(x: number, y: number): void {
    if (reducedMotion) return
    const perBurst = meter.tier() === '30fps' ? PARTICLES.degradePerBurst : PARTICLES.perBurst
    const hues = burstHues()
    for (let i = 0; i < perBurst; i++) {
      const particle = particles.acquire()
      if (particle === null) break

      const angle = (i / perBurst) * Math.PI * 2
      const speed = PARTICLES.speedPxPerSecond * (0.6 + rng.next() * 0.6)
      particle.x = x
      particle.y = y
      particle.vx = Math.cos(angle) * speed
      particle.vy = Math.sin(angle) * speed
      particle.maxLife = PARTICLES.lifeSeconds * (0.7 + rng.next() * 0.4)
      particle.life = particle.maxLife
      particle.radius = PARTICLES.radiusMin + rng.next() * (PARTICLES.radiusMax - PARTICLES.radiusMin)
      // About one in five is near-white, so a burst sparkles instead of reading as confetti.
      const hue = hues[i % hues.length]
      const white = rng.next() < PARTICLES.whiteShare
      particle.color = white || hue === undefined ? PARTICLES.whiteColor : hue
    }
  }

  function draw(): void {
    if (!running || ctx === null) return

    const now = performance.now()
    // SPEC §10.2 (issue #12): the meter reads the browser's real frame interval and owns the 30fps
    // throttle. A tick it says not to draw is scheduled straight to the next frame: the scene updates at
    // 30fps instead of running 60fps draws the tablet cannot afford.
    const tick = meter.tick(now)
    setTier(tick.tier)
    if (!tick.draw) {
      raf = window.requestAnimationFrame(draw)
      return
    }

    const dt = drawnAt === 0 ? 0 : (now - drawnAt) / 1000
    drawnAt = now

    const active = particles.active()
    for (const particle of active) {
      particle.life -= dt
      if (particle.life <= 0) {
        particles.release(particle)
        continue
      }
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      particle.vy += PARTICLES.gravityPxPerSecond * dt
    }

    frameCount += 1
    // SPEC §10.1 phase 4: the scene stays alive between taps, well under the cap.
    if (balloons.length > 0 && frameCount % PARTICLES.ambientFrames === 0 && particles.activeCount() < PARTICLES.capacity / 2) {
      spawnBurst(rng.next() * canvas.width / dpr, rng.next() * canvas.height / dpr)
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)
    for (const particle of particles.active()) {
      // The age is a fraction of this particle's own life, so the hot core and the shrink are the same
      // shape for a short spark and a long one (issue #27).
      const age = Math.max(0, Math.min(1, particle.life / particle.maxLife))
      // The radius shrinks as it dies, so the burst dissolves instead of blinking out.
      const radius = particle.radius * (0.35 + 0.65 * age)
      ctx.globalAlpha = age
      ctx.fillStyle = particle.color
      ctx.beginPath()
      ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2)
      ctx.fill()
      // A white-hot core for the first fifth of the particle's life, which is what makes the burst read
      // as a firework rather than a handful of coloured dots.
      if (age > 1 - PARTICLES.hotCoreLifeFraction) {
        ctx.fillStyle = PARTICLES.whiteColor
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, radius * 0.45, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()

    raf = window.requestAnimationFrame(draw)
  }

  /** The number of balloons this set: the bubbles she has left, capped at twelve (SPEC §10.1, issue #13). It
   *  is also the cap a refill cannot pass, which is what keeps the bunch from emptying rather than from
   *  growing (issue #36). */
  function partySize(): number {
    return Math.min(opts.balloons(), MAX_BALLOONS)
  }

  /**
   * A place becomes CSS (issue #34). The rule measures a centre from the board's left and bottom edges, so
   * the board's origin inside the overlay is added back and the box is hung around the centre. The size the
   * rule reserved has to be the size the stylesheet draws, otherwise the float amplitudes the rule charges
   * are not the amplitudes this box travels - so `--balloon-jitter` carries the place's own size rather than
   * a draw of its own.
   */
  function hangAt(place: Place, el: HTMLElement): void {
    const board = opts.metrics()
    const origin = opts.boardOrigin()
    const halfBoxPx = (place.size * LAYOUT.balloonHeightRatio) / 2
    el.style.left = `${Math.round(origin.x + place.x - place.size / 2)}px`
    el.style.bottom = `${Math.round(origin.y + place.y - halfBoxPx)}px`
    el.style.setProperty('--balloon-jitter', String(place.size / board.balloonPx))
  }

  /** The bunch for the set this moment, hung at the rung the rule chose (issue #33). The rule answers the
   *  places inside the board, biggest first, which is also the paint order: back to front. It can answer
   *  with fewer than the count asked for, because the count is the conservative lattice rather than a cap.
   *  A bunch that arrives as one set is staggered so it does not arrive as a flat wall (SPEC §10.1); the
   *  slot a pop leaves later is refilled without that delay, so the blob never pauses (issue #36). */
  function hangBunch(): void {
    const places = placeBunch(opts.metrics(), rng, partySize())
    for (let i = 0; i < places.length; i++) spawnBalloon(places[i] as Place, i, i * CELEBRATION.balloonStaggerMs)

    // The debug step records the moment the party first shows a balloon (issue #18). A spawn makes no sound,
    // because sound belongs to the pop only (issue #36), so this is reported here rather than in a chime
    // timer - and once for the set rather than once for every balloon, which is what a restored party needs:
    // it starts full and reports the hang (SPEC §14.1).
    if (places.length > 0 && opts.onFirstBalloon !== undefined) opts.onFirstBalloon()
  }

  /**
   * Issue #35: a popped balloon leaves the layer. The shape owns the collapse, this module owns the timer that
   * removes the element, and the hit box goes with the balloon - `.balloon--popped` takes no taps, so a tap
   * during the collapse lands on the balloon underneath. The removal is scheduled on the timer set `stop()`
   * clears, never by a `transitionend` listener (SPEC §10.1, §10.2), so a party she has left cannot remove an
   * element in the next one, and a balloon that is mid-collapse when the party is force-closed goes with it.
   * The same exit refills the slot it leaves, which is what keeps the bunch from emptying (issue #36).
   */
  function popBalloon(balloon: Balloon): void {
    balloon.popped = true
    // Issue #37: the pop is what the debug row counts, at the moment of the pop rather than at the removal,
    // and the guard in the click handler means a balloon that is already collapsing cannot count twice.
    poppedCount += 1
    balloon.el.classList.add('balloon--popped')
    // A party restored after a force-close (SPEC §14.1) opens with no gesture behind it, so the audio
    // context may not exist yet. This tap is the gesture that may create it, exactly as Android requires
    // (SPEC §11); on a party she played into, unlock is a no-op.
    audio.unlock()
    // Issue #36: sound belongs to the pop only, so this is the only place a balloon makes it. The pitch is
    // its index in the set she can see now, which is what `audio/synth.ts` reads it as (SPEC §11).
    audio.playBalloon(balloons.indexOf(balloon))

    // The burst belongs to this pop and fires at pop time, from the balloon's own box (issue #27).
    const own = balloon.el.getBoundingClientRect()
    const board = root.getBoundingClientRect()
    spawnBurst(own.left - board.left + own.width / 2, own.top - board.top + own.height / 2)

    const exit = (): void => {
      const at = balloons.indexOf(balloon)
      if (at >= 0) balloons.splice(at, 1)
      balloon.el.remove()

      // Issue #36: the slot this balloon has left is filled by a fresh draw, so the bunch replaces itself one
      // balloon at a time and never empties - she always has something to pop. The set is not re-hung: the
      // bunch she sees is the one the rule answered, and only the gap this pop made is new. The cap is the
      // party rather than the board (SPEC §8.4), so nothing here can put a balloon past the count the set was
      // built from.
      if (balloons.length >= partySize()) return

      // The spot this balloon was fading out of is free by now, so a refill may drift into it (SPEC §10.1,
      // *Popping*). `placeSlot` is the placement rule's single-balloon path, read against the bunch still
      // hanging at the rung that bunch was placed at, and it answers `null` when no spot is free (issue #33).
      const metrics = opts.metrics()
      const place = placeSlot(balloons.map((entry) => entry.place), metrics, rng, bunchFactor(metrics, partySize()))
      if (place === null) return

      // No stagger delay, so this climb overlaps the collapse the slot came from: the blob never pauses.
      spawnBalloon(place, balloons.length, 0)
    }

    // Reduced motion makes the collapse a single frame in the stylesheet, so there is no travel to wait for:
    // pop and removal are the same step (SPEC §13).
    if (reducedMotion) {
      exit()
      return
    }
    later(CELEBRATION.balloonCollapseMs, exit)
  }

  function spawnBalloon(place: Place, index: number, delayMs: number): void {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'balloon'
    el.setAttribute('aria-label', 'Balloon')
    // SPEC §10.1 (issue #25): three elements, so each has one transform owner. The button carries the
    // rise (so the hit box travels with the balloon), the float span carries the endless sway/bob, and
    // the shape span carries the pop. A single element could not do all three: an animation holding
    // `transform` beats the pop transition, which is the mid-rise silent pop this structure fixes.
    const float = document.createElement('span')
    float.className = 'balloon__float'
    const shape = document.createElement('span')
    shape.className = 'balloon__shape'
    shape.append(balloonShape())
    float.append(shape)
    el.append(float)

    // `fill: currentColor` in the stylesheet needs a colour to inherit (SPEC §10.1).
    const colour = BALLOON_COLORS[index % BALLOON_COLORS.length]
    el.style.color = colour === undefined ? '#ff8fab' : colour
    // SPEC §10.1: staggered entry, so balloons do not arrive as one flat wall. The delay is the caller's:
    // `hangBunch` staggers the set that arrives together, a refilled slot rises at once (issue #36). The
    // index is the order the rule answered in, which is also the paint order: biggest first, so the small
    // balloons are hung in front of the big ones (issue #33). A refill is appended last, so it paints in
    // front of the bunch it joined - that is the one thing the rule's order cannot decide after a pop.
    el.style.animationDelay = `${delayMs}ms`
    // Issue #34: the position is the place the rule answered, written as px against the board's origin
    // inside the overlay. The percent band and the wider-than-the-board spread this module used to compute
    // are gone: they were percentages of the overlay, which is not the board (issue #32).
    hangAt(place, el)

    // Issue #26: the float never stops, including after the arrow appears. The phase and the direction
    // come from the injected Rng, so no two balloons move in lockstep; a negative delay starts the
    // animation mid-cycle rather than waiting for it.
    const period = CELEBRATION.balloonFloatMsMin + rng.next() * (CELEBRATION.balloonFloatMsMax - CELEBRATION.balloonFloatMsMin)
    float.style.animationDuration = `${period / 1000}s`
    float.style.animationDelay = `${(-rng.next() * period) / 1000}s`
    float.style.animationDirection = rng.next() < 0.5 ? 'reverse' : 'normal'

    root.appendChild(el)

    const balloon: Balloon = { el, popped: false, place }
    balloons.push(balloon)

    el.addEventListener('click', () => {
      if (!running || balloon.popped) return
      // The stylesheet takes the hit box off a collapsing balloon, so this guard is the module's own belt:
      // a second tap on a balloon that is already on its way out must not pop it twice (issue #35).
      popBalloon(balloon)
    })
  }

  function start(): void {
    running = true
    // A party always starts clean: no timer or balloon from a party she left can arrive in this one.
    clearTimers()
    // Issue #37: the pop counter belongs to the party she is opening, so a party the launch restored starts at
    // zero as well - she has not popped anything in this run yet (SPEC §14.1).
    poppedCount = 0
    resize()
    // The first drawn frame has no previous frame to integrate from, even if the last party ran minutes
    // ago, so the burst does not jump by the gap between parties.
    drawnAt = 0
    // Issue #28: read the party size once, at the moment the party starts, and derive the arrow's delay from
    // it. The refills keep the set at this count, so the arrow is not timed against a bunch the party never
    // had (issue #36).
    const size = partySize()
    const playDelay = playButtonDelayMsFor(size)
    // The inline value wins over the stylesheet's `--play-button-delay` fallback, and `reveal` below uses
    // the same number, so the fade-in and the tap-ability cannot drift apart.
    play.style.setProperty('--play-button-delay', `${playDelay}ms`)

    if (!reducedMotion) {
      draw()
      // SPEC §10.1 phase 1 (issue #27): the party opens with a three-burst volley across the board, at
      // 0/180/460ms. Waiting for the first balloon pop or the ambient timer meant the "party" opened on
      // a dimmed, still board.
      const width = canvas.width / dpr
      const height = canvas.height / dpr
      spawnBurst(width * 0.5, height * 0.42)
      later(180, () => {
        if (!running) return
        spawnBurst(width * 0.27, height * 0.55)
      })
      later(460, () => {
        if (!running) return
        spawnBurst(width * 0.73, height * 0.5)
      })
    }

    hangBunch()

    // SPEC §10.1 phase 1: the completion cue is the existing fanfare, sized by the party.
    audio.playCompletion(opts.tier())

    // SPEC §10.1 (issue #28): the play arrow appears once the last balloon has settled, not after a
    // fixed 1500ms that would land in the middle of a 2.5s climb. The ready class is what makes it
    // visible and tappable at the same moment (issue #13), and reduced motion shows it at once, because
    // "after a beat" is a travel and travels are what reduced motion removes (SPEC §13).
    const reveal = (): void => {
      if (!running) return
      play.classList.add('next--ready')
      // SPEC §10.1: the big pulsing ▶. Reduced motion strips the animation in CSS.
      play.classList.add('next--pulsing')
      if (opts.onPlayReady !== undefined) opts.onPlayReady()
    }
    if (reducedMotion) {
      reveal()
    } else {
      later(playDelay, reveal)
    }
  }

  function stop(): void {
    running = false
    clearTimers()
    window.cancelAnimationFrame(raf)
    play.classList.remove('next--pulsing')
    play.classList.remove('next--ready')
    // Issue #35: the exits are the timers `clearTimers()` above has just cancelled, so nothing can remove an
    // element from a party she has left; a balloon that was mid-collapse is taken here instead.
    for (const balloon of balloons) balloon.el.remove()
    balloons.length = 0
    // Issue #37: the counter is the party's, so a party she has left - by the play arrow, by an adult reset,
    // or by a force-close - reports nothing until the next one opens. `main.ts` reports the row on the frame
    // loop, so the row reads 0 rather than the total of a level she is no longer on.
    poppedCount = 0
    particles.reset()
    if (ctx !== null) ctx.clearRect(0, 0, canvas.width, canvas.height)
    // A fanfare that is still running must not be heard in the next level (SPEC §10.1, issue #14).
    audio.stop()
  }

  return {
    start,
    stop,
    resize,
    frameTier: () => meter.tier(),
    balloonCount: () => balloons.length,
    popCount: () => poppedCount,
    particleCount: () => particles.activeCount(),
  }
}

/** The balloon is drawn by the stylesheet's `.balloon__svg` rule, so the module only shapes it. */
function balloonShape(): Element {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'balloon__svg')
  svg.setAttribute('viewBox', '0 0 44 52')
  // The button already carries the label; the shape is decoration.
  svg.setAttribute('aria-hidden', 'true')

  const body = document.createElementNS(SVG_NS, 'ellipse')
  body.setAttribute('cx', '22')
  body.setAttribute('cy', '20')
  body.setAttribute('rx', '18')
  body.setAttribute('ry', '20')

  const string = document.createElementNS(SVG_NS, 'path')
  string.setAttribute('d', 'M22 40c2 4-2 6 0 12')

  svg.append(body, string)
  return svg
}

/** ▶ as a shape rather than a glyph, so it scales with the 90 CSS px tap target (SPEC §13). */
function playGlyph(): Element {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')

  const triangle = document.createElementNS(SVG_NS, 'polygon')
  triangle.setAttribute('points', '6,4 20,12 6,20')

  svg.append(triangle)
  return svg
}
