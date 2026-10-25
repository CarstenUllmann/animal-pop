import { CELEBRATION, LAYOUT, MAX_BALLOONS, PARTICLES } from '../game/constants'
import type { AudioPlayer } from '../audio/player'
import type { PartyTier, Rng } from '../game/types'
import { hasMatchMedia } from './capabilities'
import { createPool } from './pool'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The celebration layer (SPEC §10, issues #12 and #13). Balloons rise one at a time so the scene
 * does not arrive as one flat wall, each chimes on entry and pops on tap, and popping the last one
 * brings a whole new set. The number of balloons is the bubbles she has left, capped at twelve. The
 * play button appears after the fanfare has run, not at the same time, and it becomes visible and
 * tappable in the same step.
 *
 * This is the only particle system in the game. Density is capped by `PARTICLES` and the burst
 * objects come from `ui/pool.ts`, which never grows past its capacity, so a burst cannot make the
 * old WebView stutter (SPEC §5). When frames run over budget for `degradeAfterMs` the layer drops
 * to the 30fps tier for good, and comes back after `recoverAfterMs` of frames inside the budget: one
 * bad stretch on the tablet would otherwise be the tier for the rest of the session (issue #12). That
 * tier only reaches CSS when this module writes `data-tier`.
 *
 * The layer is an overlay over the board rather than a band below it: the board stays visible under the
 * dim, and this module's root element is the rect the canvas measures, so that element has to be
 * resized when the tablet turns (issue #19).
 *
 * Random is allowed here for visual jitter only, never for gameplay, and it comes through the
 * injected `Rng` so a session can be replayed (SPEC §2).
 */

export type FrameTier = '60fps' | '30fps'

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
  // The arrow has to be in the tree, or the `next--ready` step below reveals an element that is not on
  // screen: the party would show its balloons and then have no way out of the level (issue #13).
  row.append(play)
  root.append(row)

  let running = false
  let raf = 0
  let lastFrame = 0
  let frameCount = 0
  /**
   * Every pending timer this layer owns: the staggered balloon chimes, the play-arrow reveal and the
   * opening bursts. `stop()` clears them all, so a party that has been left cannot tick into the next
   * one and an idle layer owns nothing (SPEC §10.1, issue #12).
   */
  const timers: number[] = []
  // The tier is decided by the time the layer itself spends on a frame, not by the wall-clock gap
  // between frames, because the 30fps tier deliberately delivers every other frame (issue #12).
  let lateMs = 0
  let onTimeMs = 0
  let skipFrame = false
  let tier: FrameTier = '60fps'

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
    if (next === tier) return
    tier = next
    root.dataset.tier = tier
  }

  /**
   * A burst takes only what the pool can hand out, so a burst that would exceed the cap drops
   * particles (SPEC §5). Under reduced motion the layer is hidden by CSS, so drawing a burst it cannot
   * show is only work: the debug row would report live particles while nothing renders (issue #12).
   */
  function spawnBurst(x: number, y: number): void {
    if (reducedMotion) return
    const perBurst = tier === '30fps' ? PARTICLES.degradePerBurst : PARTICLES.perBurst
    for (let i = 0; i < perBurst; i++) {
      const particle = particles.acquire()
      if (particle === null) break

      const angle = (i / perBurst) * Math.PI * 2
      const speed = PARTICLES.speedPxPerSecond * (0.6 + rng.next() * 0.6)
      particle.x = x
      particle.y = y
      particle.vx = Math.cos(angle) * speed
      particle.vy = Math.sin(angle) * speed
      particle.life = PARTICLES.lifeSeconds * (0.7 + rng.next() * 0.4)
    }
  }

  function draw(): void {
    if (!running || ctx === null) return

    const now = performance.now()
    const dt = lastFrame === 0 ? 0 : (now - lastFrame) / 1000
    lastFrame = now

    // The 30fps tier is an actual throttle, not just a smaller burst: every other frame is skipped, so
    // the scene updates at 30fps instead of running 60fps draws that the tablet cannot afford (issue #12).
    if (tier === '30fps') {
      if (!skipFrame) {
        skipFrame = true
        raf = window.requestAnimationFrame(draw)
        return
      }
      skipFrame = false
    }

    const workStart = performance.now()

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
      ctx.globalAlpha = Math.max(0, Math.min(1, particle.life / PARTICLES.lifeSeconds))
      ctx.fillStyle = '#ffd84d'
      ctx.beginPath()
      ctx.arc(particle.x, particle.y, PARTICLES.particleSize, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    // The tier is measured on the work this layer does, so a skipped frame cannot make it look late.
    const workMs = performance.now() - workStart
    if (workMs > PARTICLES.frameBudgetMs) {
      lateMs += workMs
      onTimeMs = 0
      if (tier === '60fps' && lateMs >= PARTICLES.degradeAfterMs) setTier('30fps')
    } else {
      onTimeMs += workMs
      lateMs = 0
      // SPEC §10.2 only says the layer drops, so without this the degrade is a ratchet: one bad stretch
      // on the tablet would be the tier for the rest of the session (issue #12).
      if (tier === '30fps' && onTimeMs >= PARTICLES.recoverAfterMs) setTier('60fps')
    }

    raf = window.requestAnimationFrame(draw)
  }

  /** The number of balloons this set: the bubbles she has left, capped at twelve (SPEC §10.1, issue #13). */
  function partySize(): number {
    return Math.min(opts.balloons(), MAX_BALLOONS)
  }

  function spawnBalloon(index: number): void {
    if (balloons.length >= partySize()) return

    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'balloon'
    el.setAttribute('aria-label', 'Balloon')
    el.append(balloonShape())
    // SPEC §10.1: staggered entry, so balloons do not arrive as one flat wall.
    el.style.animationDelay = `${index * CELEBRATION.balloonStaggerMs}ms`
    // Spread across the party size, so a small set does not look like a broken row of twelve.
    const span = 100 / (partySize() + 1)
    el.style.left = `${span * (index + 1)}%`
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

    if (!reducedMotion) {
      draw()
      // SPEC §10.1 phase 1: fireworks begin immediately, over the board. Waiting for the first balloon
      // pop or the ambient timer meant the "party" opened on a dimmed, still board.
      const width = canvas.width / dpr
      const height = canvas.height / dpr
      spawnBurst(width * 0.5, height * 0.45)
      later(180, () => {
        if (!running) return
        spawnBurst(width * 0.32, height * 0.55)
      })
    }

    for (let i = 0; i < partySize(); i++) spawnBalloon(i)

    // SPEC §10.1 phase 1: the completion cue is the existing fanfare, sized by the party.
    audio.playCompletion(opts.tier())

    // SPEC §10.1: the play button appears after the fanfare, not at the same time. The ready class is
    // what makes it visible and tappable at the same moment (issue #13), and reduced motion shows it at
    // once, because "after a beat" is a travel and travels are what reduced motion removes (SPEC §13).
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
      later(CELEBRATION.playButtonDelayMs, reveal)
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
