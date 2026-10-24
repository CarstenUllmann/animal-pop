import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIO } from '../game/constants'
import { createSynthPlayer } from './synth'

class FakeParam {
  value = 0
  setValueAtTime(): this {
    return this
  }
  linearRampToValueAtTime(): this {
    return this
  }
  exponentialRampToValueAtTime(): this {
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
    return new FakeOscillator()
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
})
