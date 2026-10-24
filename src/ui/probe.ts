/**
 * Launch probe — issue #23.
 *
 * Fixing the Chrome 61 syntax did not change what the tablet does, so the open question is no longer
 * *which* API is too new but *where* a launch stops. `index.html` runs an inline classic script in ES5,
 * syntax every engine parses, before the module is requested — so it can report what the module cannot
 * report about itself: whether the page loaded at all in the installed app, or whether the module failed
 * to parse.
 *
 * One line per launch under its own key (SPEC §14.1): `time engine mode`. A line is proof that the page
 * parsed and that storage accepted it on that engine, so a launch that leaves no line ran no script at
 * all. The three outcomes the tablet can produce:
 *
 * - no probe line, nothing on screen: the page never loaded in the installed app, so the fault is in the
 *   launch path, not in our code;
 * - a probe line, no boot steps from that launch: the page parsed, the module did not run;
 * - a probe line plus boot steps: our code ran and threw somewhere.
 *
 * Pure, so the wording can be tested without a browser. `baseline.test.ts` keeps the inline script in
 * index.html on the same key and inside ES5, which is the point of a probe that has to parse anywhere.
 */

export const PROBE_KEY = 'pop-pals.probe.v1'

/** Launches kept; older lines fall off the front. */
export const PROBE_MAX_LINES = 12

export interface ProbeFacts {
  /** The engine as `capabilities.ts` names it, e.g. `engine Chrome/61`. */
  engine: string
  /** `standalone` or `browser`, the same words the debug overlay's display row uses. */
  mode: string
}

/** One launch, as one line. The time is the moment the HTML parsed. */
export function probeLine(facts: ProbeFacts, time: number): string {
  return [new Date(time).toISOString(), facts.engine, facts.mode].join(' ')
}

/**
 * Whether storage took the line. Only the fact that a line is in the history proves it was written, so
 * this is the on-screen half: a device that prints `cannot write` has storage denied, and then nothing
 * it records can be read back from the browser.
 */
export function probeStatus(facts: ProbeFacts, time: number, writable: boolean): string {
  return `${probeLine(facts, time)} ${writable ? 'wrote' : 'cannot write'}`
}

/** Plain text lines, oldest first. A half-written value from a killed process is still readable. */
export function probeLines(raw: string): string[] {
  const lines: string[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '') lines.push(trimmed)
  }
  return lines
}

/** Read, append, cap — the ES5 form of what the inline script in index.html does. */
export function appendProbeLine(raw: string, line: string): string {
  const lines = probeLines(raw)
  lines.push(line)
  while (lines.length > PROBE_MAX_LINES) lines.shift()
  return lines.join('\n')
}
