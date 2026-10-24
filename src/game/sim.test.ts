import { describe, expect, it } from 'vitest'
import { ANIMAL_IDS } from './animalIds'
import { SIM } from './constants'
import { createRng } from './rng'
import { POLICIES, playLevel, simulate, summarise } from './sim'
import type { LevelSummary } from './sim'

/**
 * The acceptance bands SPEC §16.2 lists, asserted against the ramp in `constants.ts`. These are the
 * numbers the ramp was chosen from, so a change to the ramp has to survive them.
 *
 * The two readings are not interchangeable, and the test keeps them apart on purpose:
 * - the numeric band and the tier band are stated on the mean run, which is what §16.2 writes them on;
 * - the floor clause is stated on a percentile, because §9.1 says random "can plausibly end with" 2-3
 *   balloons, and a plausibility is a percentile, not an average.
 * Reading the floor clause as a mean is what makes the two bands pull the rack in opposite directions;
 * reading it as the percentile is what makes it the sizing rule, and the last test records what that costs.
 */

const summaries = summarise(simulate(ANIMAL_IDS, SIM.runs, SIM.levels, SIM.seed))

function find(level: number, policy: string): LevelSummary {
  const summary = summaries.find((entry) => entry.level === level && entry.policy === policy)
  if (summary === undefined) throw new Error(`no summary for level ${level}`)
  return summary
}

function range(from: number, to: number): number[] {
  const levels: number[] = []
  for (let level = from; level <= to; level++) levels.push(level)
  return levels
}

describe('the ramp against its acceptance bands (SPEC §16.2)', () => {
  it('completes at every level, for both policies', () => {
    for (const summary of summaries) {
      expect(summary.completedShare).toBe(1)
    }
  })

  it('lets the greedy policy finish at least 30% ahead at levels 1-6', () => {
    for (const level of range(1, SIM.leadLevels)) {
      const lead = find(level, 'greedy').meanShare / find(level, 'random').meanShare
      expect(lead).toBeGreaterThanOrEqual(1 + SIM.leadMargin)
    }
  })

  it('puts the greedy policy inside its band at the levels the ramp is sized against it', () => {
    for (const level of range(SIM.greedyBand.numericFrom, SIM.greedyBand.numericTo)) {
      const share = find(level, 'greedy').meanShare
      expect(share).toBeGreaterThanOrEqual(SIM.greedyBand.min)
      expect(share).toBeLessThanOrEqual(SIM.greedyBand.max)
    }
  })

  it('never puts the party below medium, for either policy, at any level', () => {
    for (const summary of summaries) {
      expect(summary.meanTier).not.toBe('small')
    }
  })

  it('keeps the party big through level 12 for the greedy policy', () => {
    const bigLevels = summaries.filter((summary) => summary.meanTier === 'big').map((summary) => summary.level)
    expect(Math.max(...bigLevels)).toBeGreaterThanOrEqual(SIM.greedyBand.bigThrough)
  })

  it('leaves random play plausibly within 2-3 balloons of the floor from level 11', () => {
    for (const level of range(SIM.floorFromLevel, SIM.levels)) {
      const left = find(level, 'random').p10Left
      expect(left).toBeGreaterThanOrEqual(SIM.floorBand.min)
      expect(left).toBeLessThanOrEqual(SIM.floorBand.max + SIM.bandTolerance)
    }
  })

  it('sizes every rack from level 11 as the p90 pop count plus the floor band', () => {
    for (const level of range(SIM.floorFromLevel, SIM.levels)) {
      const summary = find(level, 'random')
      const drift = Math.abs(summary.rack - (summary.p90Pops + SIM.rackSlack))
      expect(drift).toBeLessThanOrEqual(SIM.bandTolerance)
    }
  })

  it('keeps the goal phase inside the 30-60 second band at the plateau', () => {
    for (const level of range(SIM.floorFromLevel, SIM.levels)) {
      const seconds = find(level, 'greedy').medianGoalSeconds
      expect(seconds).toBeGreaterThanOrEqual(SIM.sessionBand.min)
      expect(seconds).toBeLessThanOrEqual(SIM.sessionBand.max)
    }
  })

  it('replays identically for a given seed', () => {
    for (const entry of POLICIES) {
      const first = playLevel(SIM.levels, SIM.seed, ANIMAL_IDS, entry.policy, entry.name, createRng(SIM.seed))
      const second = playLevel(SIM.levels, SIM.seed, ANIMAL_IDS, entry.policy, entry.name, createRng(SIM.seed))
      expect(first).toEqual(second)
    }
  })

  /**
   * The trade the ramp takes, recorded so nobody "fixes" it by moving a ramp number. The plausibly
   * smallest run reads below the tier band at every level, so the tier band can only be asserted on the
   * mean run; and at the plateau the mean run for both policies hits the meter's cap, so the count reads
   * the same for them there and only the tier separates them. A rack tight enough for the count to read
   * apart puts random's p10 at the floor itself — one balloon, outside the floor clause.
   */
  it('records that the tier band holds on the mean run, not on the plausibly smallest one', () => {
    const plateau = find(SIM.levels, 'random')
    expect(plateau.meanTier).toBe('medium')
    expect(plateau.p10Tier).toBe('small')

    // Both mean parties sit at the cap at the plateau, so the meter's count cannot separate them there.
    expect(plateau.medianBalloons).toBe(12)
    expect(find(SIM.levels, 'greedy').medianBalloons).toBe(12)
    expect(plateau.meanBalloons).toBeLessThan(12)
  })
})
