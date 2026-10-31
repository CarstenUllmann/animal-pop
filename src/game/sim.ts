import { MIN_GROUP, SIM } from './constants'
import { getGroups } from './board'
import { createLevel, rampForLevel } from './level'
import { isComplete, partySize, partyTier, resolveTap } from './rules'
import { createRng } from './rng'
import type { AnimalId, Group, LevelState, PartyTier, Rng } from './types'

/**
 * The headless player behind `npm run sim`: two policies over levels 1-30, so the ramp is chosen
 * against measured numbers. Pure, so a run replays. The tap queue is not modelled: it decides
 * which legal group she can reach, not whether a group is legal.
 */

/** A policy chooses which legal group to tap. `null` means it does not tap. */
export type TapPolicy = (state: LevelState, rng: Rng) => number | null

/** Picks a random legal group, the way a child mashing does. */
export function randomPolicy(state: LevelState, rng: Rng): number | null {
  return firstCellOf(pickGroup(legalGroups(state), rng))
}

/** Picks the largest group, preferring goal animals. */
export function greedyPolicy(state: LevelState, rng: Rng): number | null {
  const groups = legalGroups(state)
  if (groups.length === 0) return null

  const goalGroups = groups.filter((group) => state.goals.some((goal) => goal.remaining > 0 && goal.animal === group.animal))
  const candidates = goalGroups.length > 0 ? goalGroups : groups
  return firstCellOf(pickGroup(largestGroups(candidates), rng))
}

function legalGroups(state: LevelState): Group[] {
  return getGroups(state.board, MIN_GROUP)
}

function pickGroup(groups: readonly Group[], rng: Rng): Group | null {
  if (groups.length === 0) return null
  const group = rng.pick(groups)
  return group === undefined ? null : group
}

/** The groups tied for largest, so the tie is broken through the injected `Rng`. */
function largestGroups(groups: readonly Group[]): Group[] {
  let size = 0
  for (const group of groups) {
    if (group.cells.length > size) size = group.cells.length
  }
  return groups.filter((group) => group.cells.length === size)
}

function firstCellOf(group: Group | null): number | null {
  if (group === null) return null
  const cell = group.cells[0]
  return cell === undefined ? null : cell
}

export interface SimRun {
  level: number
  policy: string
  /** Taps before both goals reach zero. */
  tapsToGoal: number
  /** The taps among those that spent a bubble. */
  popsToGoal: number
  /** Taps after the goals, for fun. */
  tapsAfterGoal: number
  /** Taps that did nothing. */
  invalidTaps: number
  bubblesLeft: number
  /** `bubblesLeft / bubblesStart` at completion. */
  rackShare: number
  /** What the meter shows at that moment, capped at 12. */
  balloons: number
  /** Taps that counted toward a goal on the first pass. */
  goalTapsFirstPass: number
  reshuffles: number
  /** The goal phase, which is the part of a session the ramp can control. */
  goalSeconds: number
  /** The whole level session, fun tail included. */
  sessionSeconds: number
  /** Always true by design: a level always completes. */
  complete: boolean
}

/** Play one level as `policy` would play it, from a fresh seeded board to the goal. */
export function playLevel(
  level: number,
  sessionSeed: number,
  pool: readonly AnimalId[],
  policy: TapPolicy,
  policyName: string,
  rng: Rng,
): SimRun {
  const run: SimRun = {
    level,
    policy: policyName,
    tapsToGoal: 0,
    popsToGoal: 0,
    tapsAfterGoal: 0,
    invalidTaps: 0,
    bubblesLeft: 0,
    rackShare: 0,
    balloons: 0,
    goalTapsFirstPass: 0,
    reshuffles: 0,
    goalSeconds: 0,
    sessionSeconds: 0,
    complete: false,
  }

  let state = createLevel(level, sessionSeed, pool)

  while (run.tapsToGoal + run.tapsAfterGoal < SIM.maxTaps && !isComplete(state)) {
    const cell = policy(state, rng)
    if (cell === null) break

    const result = resolveTap(state, cell, rng)
    state = result.state
    run.tapsToGoal += 1
    if (result.outcome === 'invalid') run.invalidTaps += 1
    else {
      run.popsToGoal += 1
      if (result.progress > 0) run.goalTapsFirstPass += 1
    }
    if (result.reshuffled !== null) run.reshuffles += 1
  }

  if (isComplete(state)) {
    run.bubblesLeft = state.bubbles
    run.rackShare = state.bubblesStart > 0 ? state.bubbles / state.bubblesStart : 0
    run.balloons = partySize(state).balloons
    run.complete = true

    const tailStart = run.tapsToGoal + run.tapsAfterGoal
    while (run.tapsAfterGoal < SIM.funTailTaps && tailStart + run.tapsAfterGoal < SIM.maxTaps) {
      const cell = policy(state, rng)
      if (cell === null) break
      const result = resolveTap(state, cell, rng)
      state = result.state
      run.tapsAfterGoal += 1
      if (result.outcome === 'invalid') run.invalidTaps += 1
      if (result.reshuffled !== null) run.reshuffles += 1
    }

    run.goalSeconds = tapSeconds(run.tapsToGoal) + SIM.settleMs / 1000
    run.sessionSeconds = tapSeconds(run.tapsToGoal + run.tapsAfterGoal) + SIM.settleMs / 1000
  }

  return run
}

/** One tap every `tapIntervalMs`; the queue lets her tap while the board settles. */
function tapSeconds(taps: number): number {
  return (taps * Math.max(SIM.tapIntervalMs, SIM.settleMs)) / 1000
}

export interface LevelSummary {
  level: number
  policy: string
  runs: number
  completedShare: number

  meanTaps: number
  meanPops: number
  meanLeft: number
  meanShare: number
  meanTier: PartyTier

  medianTaps: number
  medianLeft: number
  medianShare: number
  medianTier: PartyTier

  /** The run that plausibly ends with the least left, which is the floor clause's reading. */
  p10Left: number
  p10Share: number
  p10Tier: PartyTier

  /** The pop count at the top of the distribution, which the rack has to cover. */
  p90Pops: number

  meanBalloons: number
  medianBalloons: number

  meanInvalidShare: number
  medianGoalSeconds: number
  medianSessionSeconds: number

  /** The numbers in the ramp row this level was measured against. */
  rampMinTaps: number
  rampMedianTaps: number
  /** The rack the ramp gives this level. */
  rack: number
}

/** Summarise runs per level and policy; the reporter and the tests both read this. */
export function summarise(results: readonly SimRun[]): LevelSummary[] {
  const groups = new Map<string, SimRun[]>()
  for (const run of results) {
    const key = `${run.level}:${run.policy}`
    const runs = groups.get(key)
    if (runs === undefined) groups.set(key, [run])
    else runs.push(run)
  }

  const summaries: LevelSummary[] = []
  for (const runs of groups.values()) {
    if (runs.length === 0) continue
    const first = runs[0] as SimRun

    const taps = sorted(runs.map((run) => run.tapsToGoal))
    const pops = sorted(runs.map((run) => run.popsToGoal))
    const left = sorted(runs.map((run) => run.bubblesLeft))
    const shares = sorted(runs.map((run) => run.rackShare))
    const balloons = sorted(runs.map((run) => run.balloons))
    const goalSeconds = sorted(runs.map((run) => run.goalSeconds))
    const sessionSeconds = sorted(runs.map((run) => run.sessionSeconds))

    summaries.push({
      level: first.level,
      policy: first.policy,
      runs: runs.length,
      completedShare: runs.filter((run) => run.complete).length / runs.length,
      meanTaps: mean(taps),
      meanPops: mean(pops),
      meanLeft: mean(left),
      meanShare: mean(runs.map((run) => run.rackShare)),
      meanTier: partyTier(mean(runs.map((run) => run.rackShare))),
      medianTaps: median(taps),
      medianLeft: median(left),
      medianShare: median(shares),
      medianTier: partyTier(median(shares)),
      p10Left: percentile(left, SIM.bandPercentile),
      p10Share: percentile(shares, SIM.bandPercentile),
      p10Tier: partyTier(percentile(shares, SIM.bandPercentile)),
      p90Pops: percentile(pops, SIM.rackPercentile),
      meanBalloons: mean(runs.map((run) => run.balloons)),
      medianBalloons: median(balloons),
      meanInvalidShare: mean(runs.map((run) => run.invalidTaps / Math.max(1, run.tapsToGoal + run.tapsAfterGoal))),
      medianGoalSeconds: median(goalSeconds),
      medianSessionSeconds: median(sessionSeconds),
      rampMinTaps: rampForLevel(first.level).minTaps,
      rampMedianTaps: rampForLevel(first.level).medianTaps,
      rack: rampForLevel(first.level).bubbles,
    })
  }

  return summaries.sort((a, b) => (a.level - b.level) || a.policy.localeCompare(b.policy))
}

function sorted(values: readonly number[]): number[] {
  return values.slice().sort((a, b) => a - b)
}

/** Play every level `runs` times for each policy, from one session seed. */
export function simulate(
  pool: readonly AnimalId[],
  runs: number = SIM.runs,
  levels: number = SIM.levels,
  sessionSeed: number = SIM.seed,
): SimRun[] {
  const results: SimRun[] = []
  for (let level = 1; level <= levels; level++) {
    for (let run = 0; run < runs; run++) {
      const seed = (sessionSeed + level * 1000003 + run) >>> 0
      for (const entry of POLICIES) {
        results.push(playLevel(level, seed, pool, entry.policy, entry.name, createRng(seed)))
      }
    }
  }
  return results
}

export const POLICIES: Array<{ name: string; policy: TapPolicy }> = [
  { name: 'random', policy: randomPolicy },
  { name: 'greedy', policy: greedyPolicy },
]

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const middle = Math.floor(values.length / 2)
  if (values.length % 2 === 1) {
    const value = values[middle]
    return value === undefined ? 0 : value
  }
  const left = values[middle - 1]
  const right = values[middle]
  return ((left === undefined ? 0 : left) + (right === undefined ? 0 : right)) / 2
}

/** The value at a percentile of an ascending list, so `0.1` is the 10% smallest. */
function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const index = Math.min(values.length - 1, Math.ceil(fraction * values.length) - 1)
  const value = values[index]
  return value === undefined ? 0 : value
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  let total = 0
  for (const value of values) total += value
  return total / values.length
}
