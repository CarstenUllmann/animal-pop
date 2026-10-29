import { ANIMALS_BY_ID, type AnimalDef } from '../game/animals'
import { AUDIO } from '../game/constants'
import type { AnimalId, PartyTier } from '../game/types'
import type { AudioPlayer } from './player'

/** Major pentatonic offsets used to arpeggiate larger clusters. */
const ARPEGGIO_RATIOS = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2] as const

/** How far a blip falls by the end of its envelope, which is what makes it a "pop" rather than a beep. */
const GLIDE = 0.82

interface ToneShape {
  at: number
  /** Start and end frequency. The glide is the shape, so a plopp can drop far further than a blip. */
  from: number
  to: number
  duration: number
  gain: number
  /** Seconds to reach `gain`: a longer attack reads as a swell, a shorter one as a hit. */
  attack?: number
  type?: OscillatorType
}

interface NoiseShape {
  at: number
  duration: number
  gain: number
  filterStart: number
  filterEnd: number
  /**
   * `peakAt` and `peakHz` give the band a mid-point, so the whoosh can rise and then fall. Without them
   * the filter sweeps straight from one edge to the other, which is what a short grain wants.
   */
  peakAt?: number
  peakHz?: number
  type?: BiquadFilterType
}

/**
 * Web Audio implementation of the player (SPEC §11). No files, no network, no
 * looping background music: every sound is synthesised on demand.
 *
 * The context is created lazily inside the first gesture (Android requires it) and
 * then reused. Before unlock, every play call is a no-op.
 */
export function createSynthPlayer(): AudioPlayer {
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let muted = false
  /** One noise buffer for the player's life, read from a random offset per grain, so nothing allocates. */
  let noiseBuffer: AudioBuffer | null = null

  /**
   * Nodes that have started but not finished, each with the time it is scheduled to end at.
   * `stop()` cancels them (SPEC §10.1, issue #14): a fanfare still running when she taps the play
   * arrow must not bleed into the next level. Entries are pruned by their own end time rather than by
   * `onended`, so a long session does not keep every chime it has ever played, and nothing here needs
   * an API the engine baseline does not have.
   */
  const sounding: Array<{ node: { stop(when?: number): void }; endsAt: number }> = []

  function track(node: { stop(when?: number): void }, endsAt: number): void {
    prune()
    sounding.push({ node, endsAt })
  }

  function prune(): void {
    if (context === null) return
    for (let i = sounding.length - 1; i >= 0; i--) {
      const entry = sounding[i]
      if (entry !== undefined && entry.endsAt <= context.currentTime) sounding.splice(i, 1)
    }
  }

  function stop(): void {
    if (context === null) return
    const now = context.currentTime
    for (const entry of sounding) {
      try {
        entry.node.stop(now)
      } catch (unused) {
        // Some engines throw when a node that already finished is stopped again; that is not an error.
      }
    }
    sounding.length = 0
  }

  function unlock(): void {
    if (context === null) {
      try {
        context = new AudioContext()
        master = context.createGain()
        master.gain.value = muted ? 0 : AUDIO.masterGain
        master.connect(context.destination)
      } catch (unused) {
        context = null
        master = null
        return
      }
    }
    // `state` and `resume()` are not guaranteed on an older WebView, and Android only allows the
    // context to start inside a gesture. Resuming an already-running context is a no-op, and an
    // engine without `resume` simply leaves the taps silent rather than throwing.
    if (typeof context.resume === 'function') {
      void Promise.resolve(context.resume()).catch(() => undefined)
    }
  }

  function ready(): { audio: AudioContext; output: GainNode } | null {
    if (context === null || master === null || muted) return null
    return { audio: context, output: master }
  }

  /**
   * A deterministic number sequence from the seed the caller passed in. The celebration draws that seed
   * from the injected `Rng`, so a replayed session wobbles the same way (SPEC §2); the synth holds no
   * random state of its own, which is why a firework and a plopp can vary without either of them being
   * un-testable.
   */
  function seeded(seed: number): () => number {
    let state = Math.floor(Math.abs(seed) * 4294967296) % 4294967296
    if (state === 0) state = 1
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296
      return state / 4294967296
    }
  }

  function tone(shape: ToneShape): void {
    const nodes = ready()
    if (nodes === null) return

    const attack = shape.attack === undefined ? 0.01 : shape.attack
    const osc = nodes.audio.createOscillator()
    const gain = nodes.audio.createGain()
    osc.type = shape.type === undefined ? 'triangle' : shape.type
    osc.frequency.setValueAtTime(shape.from, shape.at)
    osc.frequency.exponentialRampToValueAtTime(shape.to, shape.at + shape.duration)

    gain.gain.setValueAtTime(0.0001, shape.at)
    gain.gain.exponentialRampToValueAtTime(shape.gain, shape.at + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, shape.at + shape.duration)

    osc.connect(gain)
    gain.connect(nodes.output)
    osc.start(shape.at)
    osc.stop(shape.at + shape.duration + 0.03)
    track(osc, shape.at + shape.duration + 0.03)
  }

  /**
   * Filtered noise, the shape the whoosh, the shimmer, a plopp's click and a firework's tail all share
   * (SPEC §11). The band is read from one shared buffer at a random offset, so a burst of seventeen
   * sparkle grains allocates one source each rather than one buffer each.
   */
  function noise(shape: NoiseShape): void {
    const nodes = ready()
    if (nodes === null) return

    const { audio, output } = nodes
    if (noiseBuffer === null) {
      const frames = Math.max(1, Math.floor(audio.sampleRate * 2))
      noiseBuffer = audio.createBuffer(1, frames, audio.sampleRate)
      const data = noiseBuffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1
      }
    }

    const source = audio.createBufferSource()
    source.buffer = noiseBuffer

    const filter = audio.createBiquadFilter()
    filter.type = shape.type === undefined ? 'bandpass' : shape.type
    filter.Q.value = 0.7
    filter.frequency.setValueAtTime(shape.filterStart, shape.at)
    if (shape.peakAt !== undefined && shape.peakHz !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(shape.peakHz, shape.at + shape.duration * shape.peakAt)
    }
    filter.frequency.exponentialRampToValueAtTime(shape.filterEnd, shape.at + shape.duration)

    const gain = audio.createGain()
    gain.gain.setValueAtTime(0.0001, shape.at)
    gain.gain.exponentialRampToValueAtTime(shape.gain, shape.at + Math.min(0.08, shape.duration * 0.25))
    gain.gain.exponentialRampToValueAtTime(0.0001, shape.at + shape.duration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(output)
    // A short grain and a long swell must not begin on the same samples every time, so each read starts
    // somewhere else in the buffer.
    const span = Math.max(0, noiseBuffer.duration - shape.duration)
    source.start(shape.at, Math.random() * span)
    source.stop(shape.at + shape.duration + 0.02)
    track(source, shape.at + shape.duration + 0.02)
  }

  function playPop(animalId: AnimalId, count: number): void {
    const nodes = ready()
    if (nodes === null) return

    const animal: AnimalDef | undefined = ANIMALS_BY_ID.get(animalId)
    // Fallback for engines that cannot parse the nullish coalescing operator.
    const root = animal === undefined ? 659.25 : animal.pitch
    const notes = Math.min(Math.max(1, count), AUDIO.popMaxNotes)
    const start = nodes.audio.currentTime + 0.005
    const loudness = Math.min(AUDIO.popGain + (count - 1) * 0.012, 0.26)

    for (let note = 0; note < notes; note++) {
      const ratio = ARPEGGIO_RATIOS[note % ARPEGGIO_RATIOS.length] as number
      const pitch = root * ratio
      tone({
        at: start + note * AUDIO.popNoteSpacing,
        from: pitch,
        to: pitch * GLIDE,
        duration: AUDIO.popDuration,
        gain: loudness,
      })
    }
  }

  function playInvalid(): void {
    const nodes = ready()
    if (nodes === null) return
    tone({
      at: nodes.audio.currentTime + 0.005,
      from: AUDIO.boopPitch,
      to: AUDIO.boopPitch * GLIDE,
      duration: AUDIO.boopDuration,
      gain: AUDIO.boopGain,
      type: 'sine',
    })
  }

  function playReshuffle(): void {
    const nodes = ready()
    if (nodes === null) return

    noise({
      at: nodes.audio.currentTime + 0.005,
      duration: AUDIO.whooshDuration,
      gain: AUDIO.whooshGain,
      filterStart: 320,
      filterEnd: 520,
      peakAt: 0.45,
      peakHz: 2600,
    })
  }

  /** A single bubble leaving the rack: one short high tick (SPEC §11). */
  function playBubble(): void {
    const nodes = ready()
    if (nodes === null) return
    tone({
      at: nodes.audio.currentTime + 0.005,
      from: AUDIO.bubblePitch,
      to: AUDIO.bubblePitch * GLIDE,
      duration: AUDIO.bubbleDuration,
      gain: AUDIO.bubbleGain,
      type: 'sine',
    })
  }

  /**
   * The sparkle tail of a firework: short high grains scattered over `spread` seconds, each with its own
   * level. It is what turns a thump into a firework rather than a door closing.
   */
  function crackle(at: number, spread: number, count: number, level: number, next: () => number): void {
    for (let i = 0; i < count; i++) {
      noise({
        at: at + next() * spread,
        duration: 0.008 + next() * 0.018,
        gain: AUDIO.fireworkCrackleGain * level * (0.4 + next() * 0.6),
        filterStart: 3000,
        filterEnd: 5600,
        type: 'highpass',
      })
    }
  }

  /**
   * A firework: a muffled thump and a sparkle tail, kept well under a balloon's plopp because it is
   * weather rather than an event (SPEC §11). Everything that differs between two bursts - pitch, level,
   * how many sparks and how far they scatter - comes from the seed the celebration drew from the
   * injected `Rng`, so a replay sounds the same and no two bursts are identical (SPEC §2).
   */
  function playFirework(seed: number): void {
    const nodes = ready()
    if (nodes === null) return

    const next = seeded(seed)
    const start = nodes.audio.currentTime + 0.005
    const pitch = 1 + (next() - 0.5) * 0.16
    const level = 0.85 + next() * 0.3

    tone({
      at: start,
      from: AUDIO.fireworkThumpFromHz * pitch,
      to: AUDIO.fireworkThumpToHz * pitch,
      duration: AUDIO.fireworkThumpDuration,
      gain: AUDIO.fireworkThumpGain * level,
      attack: 0.006,
      type: 'sine',
    })
    noise({
      at: start,
      duration: AUDIO.fireworkAirDuration,
      gain: AUDIO.fireworkAirGain * level,
      filterStart: AUDIO.fireworkAirFilterStart,
      filterEnd: AUDIO.fireworkAirFilterEnd,
      type: 'lowpass',
    })

    const sparks =
      AUDIO.fireworkCrackleMin + Math.floor(next() * (AUDIO.fireworkCrackleMax - AUDIO.fireworkCrackleMin + 1))
    const spread =
      AUDIO.fireworkCrackleSpreadMin + next() * (AUDIO.fireworkCrackleSpreadMax - AUDIO.fireworkCrackleSpreadMin)
    crackle(start + 0.02, spread, sparks, level, next)
  }

  /**
   * A balloon giving way (SPEC §11): the latex snapping, then the body it leaves behind, dropping from
   * 320 Hz to 120 Hz. There is no pitched blip and no ladder to climb - a pop is the same pop every
   * time, apart from the small drift the seed allows, so a handful of taps does not sound like one tap
   * replayed.
   */
  function playBalloon(seed: number): void {
    const nodes = ready()
    if (nodes === null) return

    const next = seeded(seed)
    const start = nodes.audio.currentTime + 0.005
    const pitch = 1 + (next() - 0.5) * 2 * AUDIO.ploppPitchJitter

    noise({
      at: start,
      duration: AUDIO.ploppClickDuration,
      gain: AUDIO.ploppClickGain,
      filterStart: AUDIO.ploppClickStartHz,
      filterEnd: AUDIO.ploppClickEndHz,
    })
    tone({
      at: start + 0.004,
      from: AUDIO.ploppBodyFromHz * pitch,
      to: AUDIO.ploppBodyToHz * pitch,
      duration: AUDIO.ploppDuration,
      gain: AUDIO.ploppGain,
      attack: 0.005,
    })
  }

  /**
   * Completion cue (SPEC §10.1, §11). Big and medium parties get the rising arpeggio with a
   * shimmer; a small one gets the soft two-note chime, which is quieter but not sad — there is
   * no fail state, so nothing here sounds like a mistake.
   */
  function playCompletion(tier: PartyTier): void {
    const nodes = ready()
    if (nodes === null) return

    const start = nodes.audio.currentTime + 0.01
    if (tier === 'small') {
      for (let note = 0; note < AUDIO.chimeNotes.length; note++) {
        const pitch = AUDIO.chimeNotes[note]
        if (pitch === undefined) continue
        tone({
          at: start + note * AUDIO.chimeSpacing,
          from: pitch,
          to: pitch * GLIDE,
          duration: AUDIO.chimeDuration,
          gain: AUDIO.chimeGain,
          type: 'sine',
        })
      }
      return
    }

    for (let note = 0; note < AUDIO.fanfareNotes.length; note++) {
      const pitch = AUDIO.fanfareNotes[note]
      if (pitch === undefined) continue
      tone({
        at: start + note * AUDIO.fanfareNoteSpacing,
        from: pitch,
        to: pitch * GLIDE,
        duration: AUDIO.fanfareNoteDuration,
        gain: AUDIO.fanfareNoteGain,
      })
    }
    noise({
      at: start,
      duration: AUDIO.shimmerDuration,
      gain: AUDIO.shimmerGain,
      filterStart: AUDIO.shimmerFilterStart,
      filterEnd: AUDIO.shimmerFilterEnd,
    })
  }

  function setMuted(next: boolean): void {
    muted = next
    if (master !== null) master.gain.value = muted ? 0 : AUDIO.masterGain
    // Issue #17: mute is a cut, not a pause. Everything already scheduled would otherwise become
    // audible again the moment she unmutes, which is a backlog of sounds she never heard being
    // played late. `ready()` already refuses to start anything new while muted.
    if (next) stop()
  }

  return {
    unlock,
    playPop,
    playInvalid,
    playReshuffle,
    playBubble,
    playBalloon,
    playFirework,
    playCompletion,
    stop,
    setMuted,
    isMuted: () => muted,
  }
}
