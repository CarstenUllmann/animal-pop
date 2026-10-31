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
import { pickBalloonColour } from './balloonColours'
import { bunchFactor, clampToBoard, placeBunch, placeSlot, type BunchMetrics, type Place } from './bunch'
import { hasMatchMedia } from './capabilities'
import { createFrameTierMeter, type FrameTier } from './frameTier'
import { createPool } from './pool'
import type { Timer } from './timer'

export type { FrameTier } from './frameTier'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The party: rising balloons, their pops, a firework bed and the play arrow.
 *
 * Visual randomness only, and it comes through the injected `Rng` so a session replays. The layer
 * drops to 30fps when frames run over budget; that decision lives in `ui/frameTier.ts`.
 */

export interface CelebrationLayer {
  start(): void
  stop(): void
  /** Re-clamps the hanging balloons to the new board after a rotation. */
  resize(): void
  frameTier(): FrameTier
  /** Balloons on screen, which refill as she pops. */
  balloonCount(): number
  /** Pops this party has seen, which is what the debug row reports. */
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
  /** The life it spawned with, so its age reads as a fraction. */
  maxLife: number
  radius: number
  color: string
}

interface Balloon {
  el: HTMLElement
  /** The pop has happened, so a second tap must not pop it again. */
  popped: boolean
  /** The place the rule answered, kept so a rotation moves rather than re-places it. */
  place: Place
  /** Assigned at spawn; a refill is coloured against the balloons already hanging. */
  colour: string
}

export interface CelebrationOptions {
  /** The tier the party earned, read when the party starts. */
  tier: () => PartyTier
  /** Bubbles left, read on each set so a refill uses the current size. */
  balloons: () => number
  onFirstBalloon?: () => void
  onPlayReady?: () => void
  onPlay?: () => void
  /** The board and arrow band the bunch is placed inside. */
  metrics: () => BunchMetrics
  /** The painted board's origin inside the overlay, which turns a place into px. */
  boardOrigin: () => { x: number; y: number }
  /** Delayed work, so `stop()` can clear exactly what this layer scheduled. */
  timer: Timer
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

  /** Pops this party, which is what the `balloons popped` row reports. */
  let poppedCount = 0

  // The arrow is in the DOM from the start, so it is tappable the instant the fade-in reveals it.
  const playRow = document.createElement('div')
  playRow.className = 'celebration__row'
  const play = document.createElement('button')
  play.type = 'button'
  play.className = 'next'
  play.setAttribute('aria-label', 'Next level')
  play.append(playGlyph())
  play.addEventListener('click', () => {
    if (!running || opts.onPlay === undefined) return
    opts.onPlay()
  })
  playRow.append(play)
  root.append(playRow)

  let running = false
  let raf = 0
  /** When the last drawn frame started, so `dt` is time between drawn frames. */
  let drawnAt = 0

  /** Only timers that can still fire, so a long party cannot grow the list. */
  const timers: number[] = []

  const meter = createFrameTierMeter()
  let shownTier: FrameTier = '60fps'
  root.dataset.tier = shownTier

  function later(ms: number, run: () => void): void {
    const id = opts.timer.after(ms, () => {
      const at = timers.indexOf(id)
      if (at >= 0) timers.splice(at, 1)
      run()
    })
    timers.push(id)
  }

  function clearTimers(): void {
    for (const id of timers) opts.timer.clear(id)
    timers.length = 0
  }

  // Reduced motion is a CSS rule, so the loop has to stop too: a hidden layer still burns frames.
  const reducedMotion = hasMatchMedia(window) && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function resize(): void {
    const rect = root.getBoundingClientRect()
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)

    // A move, not a new placement: the sizes are kept and the rise and float are not restarted.
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

  /** A 2-3 hue subset, drawn once per burst rather than per particle or per frame. */
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

  /** A burst takes only what the pool can hand out; reduced motion skips work it cannot show. */
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
      const hue = hues[i % hues.length]
      const white = rng.next() < PARTICLES.whiteShare
      particle.color = white || hue === undefined ? PARTICLES.whiteColor : hue
    }
  }

  function draw(): void {
    if (!running || ctx === null) return

    const now = performance.now()
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

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)
    for (const particle of particles.active()) {
      const age = Math.max(0, Math.min(1, particle.life / particle.maxLife))
      const radius = particle.radius * (0.35 + 0.65 * age)
      ctx.globalAlpha = age
      ctx.fillStyle = particle.color
      ctx.beginPath()
      ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2)
      ctx.fill()
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

  /** One firework: the burst and its thump, from the same `Rng` draw. Sound plays under reduced motion. */
  function firework(fx: number, fy: number): void {
    if (!running) return
    if (!reducedMotion) spawnBurst((canvas.width / dpr) * fx, (canvas.height / dpr) * fy)
    audio.playFirework(rng.next())
  }

  /** The bed: one burst and one thump a second, on a timer so the 30fps tier cannot halve it. */
  function startBed(): void {
    if (!running) return
    firework(rng.next(), 0.15 + rng.next() * 0.7)
    later(CELEBRATION.fireworkBedMs, startBed)
  }

  /** The number of balloons this set: bubbles left, capped at twelve. */
  function partySize(): number {
    return Math.min(opts.balloons(), MAX_BALLOONS)
  }

  /**
   * Write a place as px against the board's origin. The box is hung around the centre, and its size
   * is the one the rule reserved, carried to CSS as `--balloon-jitter`.
   */
  function hangAt(place: Place, el: HTMLElement): void {
    const board = opts.metrics()
    const origin = opts.boardOrigin()
    const halfBoxPx = (place.size * LAYOUT.balloonHeightRatio) / 2
    el.style.left = `${Math.round(origin.x + place.x - place.size / 2)}px`
    el.style.bottom = `${Math.round(origin.y + place.y - halfBoxPx)}px`
    el.style.setProperty('--balloon-jitter', String(place.size / board.balloonPx))
  }

  /** Hang the set the rule answers, biggest first. The stagger keeps it from arriving as a flat wall. */
  function hangBunch(): void {
    const places = placeBunch(opts.metrics(), rng, partySize())
    for (let i = 0; i < places.length; i++) spawnBalloon(places[i] as Place, i * CELEBRATION.balloonStaggerMs)

    if (places.length > 0 && opts.onFirstBalloon !== undefined) opts.onFirstBalloon()
  }

  /**
   * Pop one balloon, then remove it on a timer `stop()` can clear. The timer, rather than
   * `transitionend`, is what keeps a party she has left from touching the next one. The empty slot is
   * refilled so the bunch never runs out.
   */
  function popBalloon(balloon: Balloon): void {
    balloon.popped = true
    poppedCount += 1
    balloon.el.classList.add('balloon--popped')
    // A restored party opens with no gesture behind it, so this tap may be what creates the context.
    audio.unlock()
    audio.playBalloon(rng.next())

    const own = balloon.el.getBoundingClientRect()
    const board = root.getBoundingClientRect()
    spawnBurst(own.left - board.left + own.width / 2, own.top - board.top + own.height / 2)

    const exit = (): void => {
      const at = balloons.indexOf(balloon)
      if (at >= 0) balloons.splice(at, 1)
      balloon.el.remove()

      if (balloons.length >= partySize()) return

      const metrics = opts.metrics()
      const place = placeSlot(balloons.map((entry) => entry.place), metrics, rng, bunchFactor(metrics, partySize()))
      if (place === null) return

      spawnBalloon(place, 0)
    }

    if (reducedMotion) {
      exit()
      return
    }
    later(CELEBRATION.balloonCollapseMs, exit)
  }

  function spawnBalloon(place: Place, delayMs: number): void {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'balloon'
    el.setAttribute('aria-label', 'Balloon')

    // Three elements, one transform owner each: the button rises (so its hit box travels with it),
    // the float carries the endless sway, and the shape carries the pop.
    const float = document.createElement('span')
    float.className = 'balloon__float'
    const shape = document.createElement('span')
    shape.className = 'balloon__shape'
    shape.append(balloonShape())
    float.append(shape)
    el.append(float)

    // `fill: currentColor` in the stylesheet reads this, and the colour avoids its neighbours.
    const colour = pickBalloonColour(place, balloons, BALLOON_COLORS, rng)
    el.style.color = colour
    el.style.animationDelay = `${delayMs}ms`
    hangAt(place, el)

    // A negative delay starts the float mid-cycle, and the direction differs so no two move in lockstep.
    const period = CELEBRATION.balloonFloatMsMin + rng.next() * (CELEBRATION.balloonFloatMsMax - CELEBRATION.balloonFloatMsMin)
    float.style.animationDuration = `${period / 1000}s`
    float.style.animationDelay = `${(-rng.next() * period) / 1000}s`
    float.style.animationDirection = rng.next() < 0.5 ? 'reverse' : 'normal'

    root.appendChild(el)

    const balloon: Balloon = { el, popped: false, place, colour }
    balloons.push(balloon)

    el.addEventListener('click', () => {
      if (!running || balloon.popped) return
      popBalloon(balloon)
    })
  }

  function start(): void {
    running = true
    clearTimers()
    poppedCount = 0
    resize()
    // The first drawn frame has no previous frame to integrate from.
    drawnAt = 0

    const size = partySize()
    const playDelay = playButtonDelayMsFor(size)
    play.style.setProperty('--play-button-delay', `${playDelay}ms`)

    if (!reducedMotion) draw()

    later(CELEBRATION.fireworkVolleyAtMs, () => firework(0.5, 0.42))
    later(CELEBRATION.fireworkVolleyAtMs + CELEBRATION.fireworkVolleyGapMs, () => firework(0.27, 0.55))
    later(CELEBRATION.fireworkVolleyAtMs + CELEBRATION.fireworkVolleySecondGapMs, () => firework(0.73, 0.5))
    later(CELEBRATION.fireworkBedStartsAtMs, startBed)

    hangBunch()

    audio.playCompletion(opts.tier())

    // The arrow waits for the last balloon, and reduced motion shows it at once.
    const reveal = (): void => {
      if (!running) return
      play.classList.add('next--ready')
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
    poppedCount = 0
    particles.reset()
    if (ctx !== null) ctx.clearRect(0, 0, canvas.width, canvas.height)
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

/** The stylesheet draws the balloon; the module only shapes it. */
function balloonShape(): Element {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'balloon__svg')
  svg.setAttribute('viewBox', '0 0 44 52')
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

/** ▶ as a shape rather than a glyph, so it scales with the tap target. */
function playGlyph(): Element {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')

  const triangle = document.createElementNS(SVG_NS, 'polygon')
  triangle.setAttribute('points', '6,4 20,12 6,20')

  svg.append(triangle)
  return svg
}
