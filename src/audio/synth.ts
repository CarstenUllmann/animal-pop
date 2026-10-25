import { ANIMALS_BY_ID, type AnimalDef } from '../game/animals'
import { AUDIO, CELEBRATION } from '../game/constants'
import type { AnimalId, PartyTier } from '../game/types'
import type { AudioPlayer } from './player'

/** Major pentatonic offsets used to arpeggiate larger clusters. */
const ARPEGGIO_RATIOS = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2] as const

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

  function tone(
    frequency: number,
    at: number,
    duration: number,
    gainValue: number,
    type: OscillatorType = 'triangle',
  ): void {
    const nodes = ready()
    if (nodes === null) return

    const osc = nodes.audio.createOscillator()
    const gain = nodes.audio.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(frequency, at)
    // A small downward glide gives the blip a "pop" rather than a beep.
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.82, at + duration)

    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(gainValue, at + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)

    osc.connect(gain)
    gain.connect(nodes.output)
    osc.start(at)
    osc.stop(at + duration + 0.03)
    track(osc, at + duration + 0.03)
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
      tone(root * ratio, start + note * AUDIO.popNoteSpacing, AUDIO.popDuration, loudness)
    }
  }

  function playInvalid(): void {
    const nodes = ready()
    if (nodes === null) return
    tone(
      AUDIO.boopPitch,
      nodes.audio.currentTime + 0.005,
      AUDIO.boopDuration,
      AUDIO.boopGain,
      'sine',
    )
  }

  /**
   * Filtered noise, the shape the whoosh, the shimmer and a balloon pop all share (SPEC §11).
   * `peakAt` is optional because the whoosh reads as wind only when the band rises and then
   * falls; a balloon pop is too short for a peak and sweeps straight down.
   */
  function noise(
    at: number,
    duration: number,
    gainValue: number,
    filterStart: number,
    filterEnd: number,
    peakAt?: number,
    peakHz?: number,
  ): void {
    const nodes = ready()
    if (nodes === null) return

    const { audio, output } = nodes
    const frames = Math.max(1, Math.floor(audio.sampleRate * duration))
    const buffer = audio.createBuffer(1, frames, audio.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1
    }

    const source = audio.createBufferSource()
    source.buffer = buffer

    const filter = audio.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 0.7
    filter.frequency.setValueAtTime(filterStart, at)
    if (peakAt !== undefined && peakHz !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(peakHz, at + duration * peakAt)
    }
    filter.frequency.exponentialRampToValueAtTime(filterEnd, at + duration)

    const gain = audio.createGain()
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(gainValue, at + Math.min(0.08, duration * 0.25))
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(output)
    source.start(at)
    source.stop(at + duration + 0.02)
    track(source, at + duration + 0.02)
  }

  function playReshuffle(): void {
    const nodes = ready()
    if (nodes === null) return

    noise(
      nodes.audio.currentTime + 0.005,
      AUDIO.whooshDuration,
      AUDIO.whooshGain,
      320,
      520,
      0.45,
      2600,
    )
  }

  /** A single bubble leaving the rack: one short high tick (SPEC §11). */
  function playBubble(): void {
    const nodes = ready()
    if (nodes === null) return
    tone(AUDIO.bubblePitch, nodes.audio.currentTime + 0.005, AUDIO.bubbleDuration, AUDIO.bubbleGain, 'sine')
  }

  /** Ascending pentatonic degrees, so the twelfth balloon is higher than the first but still in tune. */
  function balloonPitch(index: number): number {
    const degree = ARPEGGIO_RATIOS[index % ARPEGGIO_RATIOS.length] as number
    const octave = Math.min(Math.floor(index / ARPEGGIO_RATIOS.length), 1)
    return CELEBRATION.balloonPitchHz * degree * Math.pow(2, octave)
  }

  function playBalloon(index: number): void {
    const nodes = ready()
    if (nodes === null) return

    const start = nodes.audio.currentTime + 0.005
    noise(start, AUDIO.balloonNoiseDuration, AUDIO.balloonNoiseGain, 2400, 600)
    tone(balloonPitch(index), start + 0.02, 0.14, 0.12, 'triangle')
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
        tone(pitch, start + note * AUDIO.chimeSpacing, AUDIO.chimeDuration, AUDIO.chimeGain, 'sine')
      }
      return
    }

    for (let note = 0; note < AUDIO.fanfareNotes.length; note++) {
      const pitch = AUDIO.fanfareNotes[note]
      if (pitch === undefined) continue
      tone(pitch, start + note * AUDIO.fanfareNoteSpacing, AUDIO.fanfareNoteDuration, AUDIO.fanfareNoteGain, 'triangle')
    }
    noise(start, 1.2, AUDIO.shimmerGain, AUDIO.shimmerFilterStart, AUDIO.shimmerFilterEnd)
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
    playCompletion,
    stop,
    setMuted,
    isMuted: () => muted,
  }
}
