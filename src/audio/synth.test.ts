import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIO } from '../game/constants'
import { createSynthPlayer } from './synth'

class FakeParam {
  value = 0
  /** Every value written, so a test can tell one seed's pitch from another's. */
  readonly points: number[] = []
  setValueAtTime(value: number): this {
    this.points.push(value)
    return this
  }
  linearRampToValueAtTime(value: number): this {
    this.points.push(value)
    return this
  }
  exponentialRampToValueAtTime(value: number): this {
    this.points.push(value)
    return this
  }
}

class FakeNode {
  connect(): this {
    return this
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam()
}

class FakeOscillator extends FakeNode {
  type = 'sine'
  frequency = new FakeParam()
  start(): void {}
  stop(): void {
    FakeContext.stops += 1
  }
}

class FakeBuffer {
  duration = 2
  getChannelData(): Float32Array {
    return new Float32Array(64)
  }
}

class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null
  start(): void {}
  stop(): void {
    FakeContext.stops += 1
  }
}

class FakeFilter extends FakeNode {
  type = 'lowpass'
  frequency = new FakeParam()
  Q = new FakeParam()
}

class FakeContext {
  static instances: FakeContext[] = []
  static oscillators = 0
  static bufferSources = 0
  /** Every `stop()` call, so a test can tell the node's own scheduled end from a cancellation. */
  static stops = 0

  static reset(): void {
    FakeContext.instances = []
    FakeContext.oscillators = 0
    FakeContext.bufferSources = 0
    FakeContext.stops = 0
  }

  readonly gains: FakeGain[] = []
  readonly oscillators: FakeOscillator[] = []
  readonly destination = new FakeNode()
  readonly sampleRate = 8000
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  currentTime = 0

  constructor() {
    FakeContext.instances.push(this)
  }

  resume(): Promise<void> {
    this.state = 'running'
    return Promise.resolve()
  }

  createGain(): FakeGain {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }

  createOscillator(): FakeOscillator {
    FakeContext.oscillators += 1
    const osc = new FakeOscillator()
    this.oscillators.push(osc)
    return osc
  }

  createBuffer(): FakeBuffer {
    return new FakeBuffer()
  }

  createBufferSource(): FakeBufferSource {
    FakeContext.bufferSources += 1
    return new FakeBufferSource()
  }

  createBiquadFilter(): FakeFilter {
    return new FakeFilter()
  }
}

beforeEach(() => {
  FakeContext.reset()
  vi.stubGlobal('AudioContext', FakeContext)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSynthPlayer', () => {
  it('does nothing before the unlock gesture', () => {
    const player = createSynthPlayer()

    expect(() => {
      player.playPop('cat', 3)
      player.playInvalid()
      player.playReshuffle()
    }).not.toThrow()
    expect(FakeContext.instances).toHaveLength(0)
    expect(FakeContext.oscillators).toBe(0)
  })

  it('creates and resumes one context on unlock', () => {
    const player = createSynthPlayer()
    player.unlock()
    player.unlock()

    expect(FakeContext.instances).toHaveLength(1)
    expect(FakeContext.instances[0]?.state).toBe('running')
    expect(FakeContext.instances[0]?.gains[0]?.gain.value).toBe(AUDIO.masterGain)
  })

  it('arpeggiates up to the note cap for a big cluster', () => {
    const player = createSynthPlayer()
    player.unlock()

    player.playPop('fox', 3)
    expect(FakeContext.oscillators).toBe(3)

    FakeContext.oscillators = 0
    player.playPop('fox', 30)
    expect(FakeContext.oscillators).toBe(AUDIO.popMaxNotes)
  })

  it('plays one quiet tone for an invalid tap', () => {
    const player = createSynthPlayer()
    player.unlock()

    player.playInvalid()
    expect(FakeContext.oscillators).toBe(1)
  })

  it('uses a filtered noise source for the reshuffle whoosh', () => {
    const player = createSynthPlayer()
    player.unlock()

    player.playReshuffle()
    expect(FakeContext.bufferSources).toBe(1)
    expect(FakeContext.oscillators).toBe(0)
  })

  it('creates no sound while muted and restores the master gain on unmute', () => {
    const player = createSynthPlayer()
    player.unlock()
    const master = FakeContext.instances[0]?.gains[0] as FakeGain

    player.setMuted(true)
    expect(player.isMuted()).toBe(true)
    expect(master.gain.value).toBe(0)

    player.playPop('cat', 4)
    player.playInvalid()
    player.playReshuffle()
    expect(FakeContext.oscillators).toBe(0)
    expect(FakeContext.bufferSources).toBe(0)

    player.setMuted(false)
    expect(master.gain.value).toBe(AUDIO.masterGain)
    player.playPop('cat', 2)
    expect(FakeContext.oscillators).toBe(2)
  })

  it('a mute cuts what is already scheduled, so unmuting cannot play a backlog (issue #17)', () => {
    const player = createSynthPlayer()
    player.unlock()

    player.playCompletion('big')
    const scheduled = FakeContext.stops
    expect(scheduled).toBe(AUDIO.fanfareNotes.length + 1)

    // Muting is a cut, not a pause: the scheduled fanfare is stopped rather than left to become
    // audible again when she turns the sound back on.
    player.setMuted(true)
    expect(FakeContext.stops).toBe(scheduled * 2)

    player.setMuted(false)
    expect(FakeContext.stops).toBe(scheduled * 2)
  })

  it('cancels what is still sounding when the party ends, so the cue cannot bleed into the next level (issue #14)', () => {
    const player = createSynthPlayer()
    player.unlock()

    player.playCompletion('big')
    // Four fanfare notes plus the shimmer, each with its own scheduled end.
    const scheduled = FakeContext.stops
    expect(scheduled).toBe(AUDIO.fanfareNotes.length + 1)

    // The celebration stops the party when the play arrow is tapped early: the same nodes are stopped
    // a second time, now at the current time rather than at their scheduled one.
    player.stop()
    expect(FakeContext.stops).toBe(scheduled * 2)

    // Nothing left to cancel, so a second stop is quiet and the list does not keep growing.
    player.stop()
    expect(FakeContext.stops).toBe(scheduled * 2)
  })

  it('plopps a balloon as a click over a body that drops in pitch, with no ladder left (SPEC §11)', () => {
    const player = createSynthPlayer()
    player.unlock()
    const ctx = FakeContext.instances[0] as FakeContext

    player.playBalloon(0.5)
    // One noise grain for the latex and one tone for the body: the pentatonic blip is gone, so a pop is
    // two nodes rather than two nodes plus a pitched chirp.
    expect(FakeContext.bufferSources).toBe(1)
    expect(ctx.oscillators).toHaveLength(1)

    const body = ctx.oscillators[0] as FakeOscillator
    const from = body.frequency.points[0] as number
    const to = body.frequency.points[1] as number
    // The seed drifts the pair together, so the body keeps its shape: that fall is what makes it a plopp
    // rather than the small glide a blip uses.
    expect(from).toBeGreaterThanOrEqual(AUDIO.ploppBodyFromHz * (1 - AUDIO.ploppPitchJitter))
    expect(from).toBeLessThanOrEqual(AUDIO.ploppBodyFromHz * (1 + AUDIO.ploppPitchJitter))
    expect(to / from).toBeCloseTo(AUDIO.ploppBodyToHz / AUDIO.ploppBodyFromHz, 5)
  })

  it('drifts a plopp from the seed it was handed, so a replay pops the same pitches (SPEC §2)', () => {
    const player = createSynthPlayer()
    player.unlock()
    const ctx = FakeContext.instances[0] as FakeContext

    player.playBalloon(0.1)
    player.playBalloon(0.1)
    player.playBalloon(0.9)

    const first = ctx.oscillators[0]?.frequency.points[0]
    const again = ctx.oscillators[1]?.frequency.points[0]
    const other = ctx.oscillators[2]?.frequency.points[0]

    expect(first).toBe(again)
    expect(other).not.toBe(first)
    // The drift is small: a pop that wandered would stop sounding like the same balloon.
    expect(first).toBeGreaterThanOrEqual(AUDIO.ploppBodyFromHz * (1 - AUDIO.ploppPitchJitter))
    expect(first).toBeLessThanOrEqual(AUDIO.ploppBodyFromHz * (1 + AUDIO.ploppPitchJitter))
  })

  it('sounds a firework as a thump plus a sparkle tail, under the plopp (SPEC §11)', () => {
    const player = createSynthPlayer()
    player.unlock()
    const ctx = FakeContext.instances[0] as FakeContext

    player.playFirework(0.4)
    // One tone for the thump, one noise grain for the air, and the sparkle tail on top of it.
    expect(ctx.oscillators).toHaveLength(1)
    expect(FakeContext.bufferSources).toBeGreaterThanOrEqual(AUDIO.fireworkCrackleMin + 1)
    expect(FakeContext.bufferSources).toBeLessThanOrEqual(AUDIO.fireworkCrackleMax + 1)

    // Weather, not an event: the bed is 40% of a plopp's peak and nothing ducks when a pop lands, so the
    // thing she is tapping stays the loudest sound in the room (SPEC §11).
    expect(AUDIO.fireworkThumpGain).toBeLessThan(AUDIO.ploppGain)
    expect(AUDIO.fireworkThumpGain).toBeCloseTo(0.4 * AUDIO.ploppGain, 3)

    const thump = ctx.oscillators[0] as FakeOscillator
    expect(thump.frequency.points[0]).toBeCloseTo(AUDIO.fireworkThumpFromHz, -1)
  })

  it('varies a firework from its seed, so two bursts are not the same sound', () => {
    const player = createSynthPlayer()
    player.unlock()
    const ctx = FakeContext.instances[0] as FakeContext

    player.playFirework(0.2)
    const before = FakeContext.bufferSources
    player.playFirework(0.2)
    const sameSeed = FakeContext.bufferSources - before

    const firstThump = ctx.oscillators[0]?.frequency.points[0]
    const secondThump = ctx.oscillators[1]?.frequency.points[0]
    // A replay is the same party: the same seed is the same burst, down to how many sparks it spends.
    expect(secondThump).toBe(firstThump)
    expect(sameSeed).toBeGreaterThanOrEqual(AUDIO.fireworkCrackleMin + 1)

    player.playFirework(0.85)
    const otherThump = ctx.oscillators[2]?.frequency.points[0]
    expect(otherThump).not.toBe(firstThump)
  })
})
