import { CELEBRATION, MAX_BALLOONS, PARTICLES } from '../game/constants'
import type { AudioPlayer } from '../audio/player'
import type { PartyTier, Rng } from '../game/types'
import { hasMatchMedia } from './capabilities'
import { createPool } from './pool'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The celebration layer (SPEC §10, issues #12 and #13). Balloons rise one at a time so the scene
 * does not arrive as one flat wall, each chimes on entry and pops on tap, and popping the last one
 * brings a whole new set. The play button appears after the fanfare has run, not at the same time.
 *
 * This is the only particle system in the game. Density is capped by `PARTICLES` and the burst
 * objects come from `ui/pool.ts`, which never grows past its capacity, so a burst cannot make the
 * old WebView stutter (SPEC §5). When frames run over budget for `degradeAfterMs` the layer drops
 * to the 30fps tier for good, and that tier only reaches CSS when this module writes `data-tier`.
 *
 * Random is allowed here for visual jitter only, never for gameplay, and it comes through the
 * injected `Rng` so a session can be replayed (SPEC §2).
 */

export type FrameTier = '60fps' | '30fps'

export interface CelebrationLayer {
  start(): void
  stop(): void
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
  life: number
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
  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  const canvas = document.createElement('canvas')
  canvas.className = 'particle-layer'
  root.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const particles = createPool<Particle>(PARTICLES.capacity, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0 }))
  const balloons: Balloon[] = []

  // SPEC §10.1 phase 3 (issue #13): the big pulsing ▶ under the balloons. It is in the DOM from the
  // moment the party starts, so it is tappable the instant the fade-in reveals it - the delay is CSS,
  // mirroring CELEBRATION.playButtonDelayMs.
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
  root.append(row)

  let running = false
  let raf = 0
  let lastFrame = 0
  let frameCount = 0
  let lateStreak = 0
  let tier: FrameTier = '60fps'

  // Reduced motion is a CSS rule, so the module has to stop drawing as well: a layer that keeps
  // running at 60fps underneath `visibility: hidden` is still burning frames on a weak tablet (SPEC §13).
  const reducedMotion = hasMatchMedia(window) && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function resize(): void {
    const rect = root.getBoundingClientRect()
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
  }

  function setTier(next: FrameTier): void {
    if (next === tier) return
    tier = next
    root.dataset.tier = tier
  }

  /** A burst takes only what the pool can hand out, so a burst that would exceed the cap drops particles (SPEC §5). */
  function spawnBurst(x: number, y: number): void {
    const perBurst = tier === '30fps' ? PARTICLES.degradePerBurst : PARTICLES.perBurst
    for (let i = 0; i < perBurst; i++) {
      const particle = particles.acquire()
      if (particle === null) break

      const angle = (i / perBurst) * Math.PI * 2
      const speed = PARTICLES.speed * (0.6 + rng.next() * 0.6)
      particle.x = x
      particle.y = y
      particle.vx = Math.cos(angle) * speed
      particle.vy = Math.sin(angle) * speed
      particle.life = PARTICLES.life * (0.7 + rng.next() * 0.4)
    }
  }

  function draw(): void {
    if (!running || ctx === null) return

    const now = performance.now()
    const dt = lastFrame === 0 ? 0 : (now - lastFrame) / 1000
    lastFrame = now

    if (dt > 0) {
      // A frame over the budget is a late frame; a sustained run of them drops the tier for good (SPEC §10.2).
      if (dt * 1000 > PARTICLES.frameBudgetMs) {
        lateStreak += 1
        if (lateStreak > 10) setTier('30fps')
      } else {
        lateStreak = 0
      }
    }

    const active = particles.active()
    for (const particle of active) {
      particle.life -= dt
      if (particle.life <= 0) {
        particles.release(particle)
        continue
      }
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      particle.vy += PARTICLES.gravity * dt
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
      ctx.globalAlpha = Math.max(0, Math.min(1, particle.life / PARTICLES.life))
      ctx.fillStyle = '#ffd84d'
      ctx.beginPath()
      ctx.arc(particle.x, particle.y, PARTICLES.particleSize, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    raf = window.requestAnimationFrame(draw)
  }

  function spawnBalloon(index: number): void {
    if (balloons.length >= MAX_BALLOONS) return

    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'balloon'
    el.setAttribute('aria-label', 'Balloon')
    el.append(balloonShape())
    // SPEC §10.1: staggered entry, so balloons do not arrive as one flat wall.
    el.style.animationDelay = `${index * CELEBRATION.balloonStaggerMs}ms`
    const span = 100 / (MAX_BALLOONS + 1)
    el.style.left = `${span * (index + 1)}%`
    root.appendChild(el)

    const balloon: Balloon = { el, popped: false, chimeIndex: index }
    balloons.push(balloon)

    // SPEC §11: the entry chime rises in pitch with the set.
    window.setTimeout(() => {
      if (!running) return
      audio.playBalloon(balloon.chimeIndex)
      if (balloons.length === 1 && opts.onFirstBalloon !== undefined) opts.onFirstBalloon()
    }, index * CELEBRATION.balloonStaggerMs)

    el.addEventListener('click', () => {
      if (!running || balloon.popped) return
      balloon.popped = true
      el.classList.add('balloon--popped')
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
      for (let i = 0; i < MAX_BALLOONS; i++) spawnBalloon(i)
    })
  }

  function start(): void {
    running = true
    resize()

    if (!reducedMotion) draw()

    for (let i = 0; i < MAX_BALLOONS; i++) spawnBalloon(i)

    // SPEC §10.1 phase 1: the completion cue is the existing fanfare, sized by the party.
    audio.playCompletion(opts.tier())

    // SPEC §10.1: the play button appears after the fanfare, not at the same time. It is already in
    // the DOM and already tappable; this is only the pulse, which reduced motion keeps still (SPEC §13).
    window.setTimeout(() => {
      if (!running) return
      if (!reducedMotion) play.classList.add('next--pulsing')
      if (opts.onPlayReady !== undefined) opts.onPlayReady()
    }, CELEBRATION.playButtonDelayMs)
  }

  function stop(): void {
    running = false
    window.cancelAnimationFrame(raf)
    play.classList.remove('next--pulsing')
    for (const balloon of balloons) balloon.el.remove()
    balloons.length = 0
    particles.reset()
    if (ctx !== null) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  return {
    start,
    stop,
    frameTier: () => tier,
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
