import {
  CELEBRATION,
  FIREWORK_COLORS,
  LAYOUT,
  MAX_BALLOONS,
  PARTICLES,
  playButtonDelayMsFor,
} from '../game/constants'
import type { AudioPlayer } from '../audio/player'
import type { PartyTier, Rng } from '../game/types'
import { hasMatchMedia } from './capabilities'
import { createFrameTierMeter, type FrameTier } from './frameTier'
import { createPool } from './pool'

export type { FrameTier } from './frameTier'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The balloon colours. The shape is filled with `currentColor` in the stylesheet, and nothing set a colour,
 * so every balloon rendered white. A party of white ovals does not read as balloons; the palette only ever
 * changes the decoration, never the tap target or its sound.
 */
const BALLOON_COLORS = ['#ff8fab', '#ffd166', '#7bdff2', '#a0e57c', '#c9a7ff', '#ff9f68']

/**
 * The celebration layer (SPEC §10, issues #12 and #13). Balloons rise one at a time so the scene
 * does not arrive as one flat wall, each chimes on entry and pops on tap, and popping the last one
 * brings a whole new set. The number of balloons is the bubbles she has left, capped at twelve. The
 * play button appears once the last balloon has settled, and it becomes visible and tappable in the
 * same step (issue #28), while the balloons keep swaying behind it (issue #26).
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
 * Random is allowed here for visual jitter only, never for gameplay, and it comes through the
 * injected `Rng` so a session can be replayed (SPEC §2).
 */

export interface CelebrationLayer {
  start(): void
  stop(): void
  /** Called on rotation: the canvas is sized from the layer's rect, so a portrait turn has to resize it (SPEC §13, issue #19). */
  resize(): void
  /** The tier in effect, which is what the debug overlay reports (issue #18). */
  frameTier(): FrameTier
  balloonCount(): number
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
  popped: boolean
  /** Which chime of the set this balloon is, so its sound rises with the set (SPEC §11). */
  chimeIndex: number
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
   * Every pending timer this layer owns: the staggered balloon chimes, the play-arrow reveal and the
   * opening bursts. `stop()` clears them all, so a party that has been left cannot tick into the next
   * one and an idle layer owns nothing (SPEC §10.1, issue #12).
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

  /** The number of balloons this set: the bubbles she has left, capped at twelve (SPEC §10.1, issue #13). */
  function partySize(): number {
    return Math.min(opts.balloons(), MAX_BALLOONS)
  }

  /** Where along the wider-than-the-board spread this balloon hangs, in `left` percent (issue #25). */
  function spreadLeft(index: number, size: number): number {
    const span = LAYOUT.balloonSpreadEnd - LAYOUT.balloonSpreadStart
    return LAYOUT.balloonSpreadStart + (span * index) / (size - 1)
  }

  /** ±5% of the resting band, so the arc is a bunch rather than a curve drawn with a ruler (issue #25). */
  function bandJitter(): number {
    const band = LAYOUT.balloonBandBottomMax - LAYOUT.balloonBandBottomMin
    return (rng.next() * 2 - 1) * band * 0.05
  }

  function spawnBalloon(index: number): void {
    const size = partySize()
    if (balloons.length >= size) return

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
    // SPEC §10.1: staggered entry, so balloons do not arrive as one flat wall.
    el.style.animationDelay = `${index * CELEBRATION.balloonStaggerMs}ms`
    // Issue #25: the bunch spreads wider than the board (`left: -8%..108%`), so twelve balloons of this
    // size overlap and the outermost hang off the edge. A single balloon sits centred.
    el.style.left = `${size <= 1 ? 50 : spreadLeft(index, size)}%`
    // Heights follow a gentle arc across the row - outermost lowest, the middle highest - with a
    // ±5% jitter of the band, so it reads as a bunch rather than a row or a random clump.
    const arc = Math.sin((Math.PI * (index + 0.5)) / size)
    const band = LAYOUT.balloonBandBottomMin + (LAYOUT.balloonBandBottomMax - LAYOUT.balloonBandBottomMin) * arc
    // The jitter stays inside the band: the resting places are 50%-78%, never above the top edge and
    // never low enough for the arrow's row.
    const bottom = Math.max(LAYOUT.balloonBandBottomMin, Math.min(LAYOUT.balloonBandBottomMax, band + bandJitter()))
    el.style.bottom = `${bottom}%`
    // Each balloon's own size is jittered from the injected Rng, so a session still replays (SPEC §2).
    // The stylesheet multiplies this by the inherited `--balloon-px`, so a rotation re-sizes the
    // balloon without the module having to touch it again.
    el.style.setProperty('--balloon-jitter', String(1 + (rng.next() * 2 - 1) * LAYOUT.balloonSizeJitter))

    // Issue #26: the float never stops, including after the arrow appears. The phase and the direction
    // come from the injected Rng, so no two balloons move in lockstep; a negative delay starts the
    // animation mid-cycle rather than waiting for it.
    const period = CELEBRATION.balloonFloatMsMin + rng.next() * (CELEBRATION.balloonFloatMsMax - CELEBRATION.balloonFloatMsMin)
    float.style.animationDuration = `${period / 1000}s`
    float.style.animationDelay = `${(-rng.next() * period) / 1000}s`
    float.style.animationDirection = rng.next() < 0.5 ? 'reverse' : 'normal'

    root.appendChild(el)

    const balloon: Balloon = { el, popped: false, chimeIndex: index }
    balloons.push(balloon)

    // SPEC §11: the entry chime rises in pitch with the set.
    later(index * CELEBRATION.balloonStaggerMs, () => {
      if (!running) return
      audio.playBalloon(balloon.chimeIndex)
      if (balloons.length === 1 && opts.onFirstBalloon !== undefined) opts.onFirstBalloon()
    })

    el.addEventListener('click', () => {
      if (!running || balloon.popped) return
      balloon.popped = true
      el.classList.add('balloon--popped')
      // A party restored after a force-close (SPEC §14.1) opens with no gesture behind it, so the audio
      // context may not exist yet. This tap is the gesture that may create it, exactly as Android requires
      // (SPEC §11); on a party she played into, unlock is a no-op.
      audio.unlock()
      audio.playBalloon(balloon.chimeIndex)

      const own = el.getBoundingClientRect()
      const board = root.getBoundingClientRect()
      spawnBurst(own.left - board.left + own.width / 2, own.top - board.top + own.height / 2)

      // SPEC §10.1: pop the last one and a whole new set arrives. The burst belongs to this pop,
      // so the respawn must not fire a second one.
      const allPopped = balloons.every((entry) => entry.popped)
      if (!allPopped) return

      for (const entry of balloons) entry.el.remove()
      balloons.length = 0
      for (let i = 0; i < partySize(); i++) spawnBalloon(i)
    })
  }

  function start(): void {
    running = true
    // A party always starts clean: no timer or balloon from a party she left can arrive in this one.
    clearTimers()
    resize()
    // The first drawn frame has no previous frame to integrate from, even if the last party ran minutes
    // ago, so the burst does not jump by the gap between parties.
    drawnAt = 0
    // Issue #28: read the party size once, at the moment the party starts, and derive the arrow's delay
    // from it. A respawn can change the count, so the count the delay was built from is this one.
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

    for (let i = 0; i < size; i++) spawnBalloon(i)

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
    for (const balloon of balloons) balloon.el.remove()
    balloons.length = 0
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
