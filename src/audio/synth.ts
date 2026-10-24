import { ANIMALS_BY_ID, type AnimalDef } from '../game/animals'
import { AUDIO } from '../game/constants'
import type { AnimalId } from '../game/types'
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

  function unlock(): void {
    if (context === null) {
      try {
        context = new AudioContext()
        master = context.createGain()
        master.gain.value = muted ? 0 : AUDIO.masterGain
        master.connect(context.destination)
      } catch {
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
  }

  function playPop(animalId: AnimalId, count: number): void {
    const nodes = ready()
    if (nodes === null) return

    const animal: AnimalDef | undefined = ANIMALS_BY_ID.get(animalId)
    const root = animal?.pitch ?? 659.25
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

  function playReshuffle(): void {
    const nodes = ready()
    if (nodes === null) return

    const { audio, output } = nodes
    const start = audio.currentTime
    const frames = Math.max(1, Math.floor(audio.sampleRate * AUDIO.whooshDuration))
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
    filter.frequency.setValueAtTime(320, start)
    filter.frequency.exponentialRampToValueAtTime(2600, start + AUDIO.whooshDuration * 0.45)
    filter.frequency.exponentialRampToValueAtTime(520, start + AUDIO.whooshDuration)

    const gain = audio.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(AUDIO.whooshGain, start + 0.08)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + AUDIO.whooshDuration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(output)
    source.start(start)
    source.stop(start + AUDIO.whooshDuration + 0.02)
  }

  function setMuted(next: boolean): void {
    muted = next
    if (master !== null) master.gain.value = muted ? 0 : AUDIO.masterGain
  }

  return {
    unlock,
    playPop,
    playInvalid,
    playReshuffle,
    setMuted,
    isMuted: () => muted,
  }
}
