/**
 * The event log for one recorded session.
 *
 * Everything is timestamped by **audio sample index**, never wall-clock
 * (ADR-0001). The point of the archive is re-running a later algorithm over the
 * same audio and diffing it against what the phone decided at the time; that
 * comparison only works if both sides agree on where in the recording they are.
 * Wall-clock and the audio clock drift apart by far more than the ~14 ms this
 * project is trying to measure.
 *
 * The log is deliberately simple and has no dependency on the detector. A
 * session where detection produced nothing at all still carries its metadata
 * and the ringer's own markers, and is still evidence.
 */

export type ProfileSource = 'stored' | 'learned'

export interface SessionMeta {
  id: string
  /** Wall-clock start, for humans finding the session later. Never for timing. */
  startedAtIso: string
  sampleRate: number
  tower: string
  /** Bells actually ringing, numbered as the ring numbers them — see below. */
  bells: number[]
  profileSource: ProfileSource
  method?: string
  notes?: string
  /** Where the phone was, since profiles are position-sensitive. */
  position?: string
}

export type SessionEvent =
  | { kind: 'strike'; sample: number; bell: number; confidence: number }
  | { kind: 'row'; sample: number; order: number[]; confidence: number }
  | { kind: 'marker'; sample: number; label: string }
  | { kind: 'calibration'; sample: number; passed: boolean; detail: string }
  | { kind: 'lock'; sample: number; locked: boolean }
  /**
   * The two clocks, compared on purpose (ADR-0006). The only place in this log
   * that records wall-clock time, and it is here so that a session can say
   * whether capture stopped while nobody was watching.
   */
  | {
      kind: 'heartbeat'
      sample: number
      wallMs: number
      driftMs: number
      visibility: 'visible' | 'hidden'
      wakeLock: boolean
    }
  /**
   * The session was stopped deliberately. **A log with no `ended` event is a
   * session that died**, and its last heartbeat says when and in what state.
   * That is the whole point of writing this one (ADR-0006).
   */
  | { kind: 'ended'; sample: number; reason: 'stopped' }

export interface StoredSessionLog {
  meta: SessionMeta
  events: SessionEvent[]
}

export function sampleToSeconds(sample: number, sampleRate: number): number {
  return sample / sampleRate
}

export class SessionLog {
  readonly events: SessionEvent[] = []
  private lastSample = -1

  constructor(readonly meta: SessionMeta) {}

  strike(sample: number, bell: number, confidence: number): void {
    this.push({ kind: 'strike', sample, bell, confidence })
  }

  row(sample: number, order: number[], confidence: number): void {
    this.push({ kind: 'row', sample, order: [...order], confidence })
  }

  /** Alias kept for readability at call sites that close a row. */
  rowClose(sample: number, order: number[], confidence: number): void {
    this.row(sample, order, confidence)
  }

  /** A tap from the ringer — "that was wrong", "start of a touch", and so on. */
  marker(sample: number, label: string): void {
    this.push({ kind: 'marker', sample, label })
  }

  calibration(sample: number, passed: boolean, detail: string): void {
    this.push({ kind: 'calibration', sample, passed, detail })
  }

  lock(sample: number, locked: boolean): void {
    this.push({ kind: 'lock', sample, locked })
  }

  /** A comparison of the audio clock against the wall clock. See ADR-0006. */
  heartbeat(reading: {
    sample: number
    wallMs: number
    driftMs: number
    visibility: 'visible' | 'hidden'
    wakeLock: boolean
  }): void {
    this.push({ kind: 'heartbeat', ...reading })
  }

  /** Mark a clean stop. Its absence is what identifies a session that died. */
  ended(sample: number): void {
    this.push({ kind: 'ended', sample, reason: 'stopped' })
  }

  /** Did this session stop deliberately? False means it was killed. */
  get endedCleanly(): boolean {
    return this.events.some((event) => event.kind === 'ended')
  }

  toJSON(): StoredSessionLog {
    return { meta: this.meta, events: this.events }
  }

  private push(event: SessionEvent): void {
    // Equal samples are fine — two bells striking together is exactly the case
    // worth recording. Going backwards is not: it means a worklet restart or a
    // dropped block upstream, and a log whose order cannot be trusted is worse
    // than no log, because it will be believed.
    if (event.sample < this.lastSample) {
      throw new Error(
        `session log went backwards: sample ${event.sample} after ${this.lastSample}`,
      )
    }
    this.lastSample = event.sample
    this.events.push(event)
  }
}

/**
 * Validate and rehydrate a stored log.
 *
 * Storage can hand back a half-written file, something hand-edited, or a blob
 * from an older version. None of those may load as a plausible-looking session:
 * a silently truncated log would show up as a band that stopped ringing.
 */
export function parseSessionLog(raw: unknown): StoredSessionLog {
  if (typeof raw !== 'object' || raw === null) throw new Error('session log is not an object')
  const { meta, events } = raw as Partial<StoredSessionLog>

  if (typeof meta !== 'object' || meta === null) throw new Error('session log has no meta')
  if (typeof meta.id !== 'string' || meta.id === '') throw new Error('session meta needs an id')
  if (typeof meta.startedAtIso !== 'string') throw new Error('session meta needs startedAtIso')
  if (!Number.isFinite(meta.sampleRate) || meta.sampleRate <= 0) {
    throw new Error(`session meta has an unusable sampleRate: ${meta.sampleRate}`)
  }
  if (typeof meta.tower !== 'string') throw new Error('session meta needs a tower')
  if (!Array.isArray(meta.bells) || meta.bells.some((b) => !Number.isInteger(b))) {
    throw new Error('session meta needs a list of bell numbers')
  }
  if (meta.profileSource !== 'stored' && meta.profileSource !== 'learned') {
    throw new Error(`unknown profileSource: ${String(meta.profileSource)}`)
  }
  if (!Array.isArray(events)) throw new Error('session log has no events array')

  let last = -1
  for (const event of events) {
    if (typeof event !== 'object' || event === null) throw new Error('event is not an object')
    if (!Number.isFinite((event as SessionEvent).sample)) throw new Error('event has no sample index')
    const sample = (event as SessionEvent).sample
    if (sample < last) throw new Error(`stored events go backwards at sample ${sample}`)
    last = sample
  }

  return { meta: meta as SessionMeta, events: events as SessionEvent[] }
}

/**
 * Did this stored session stop deliberately?
 *
 * ADR-0006: the log is flushed during recording, so a session the phone killed
 * still has everything up to the moment it died — but no `ended` event. The
 * session list uses this to say "ended unexpectedly" rather than showing a short
 * recording that looks like a short practice.
 */
export function endedCleanly(log: StoredSessionLog): boolean {
  return log.events.some((event) => event.kind === 'ended')
}

/**
 * The last heartbeat in a stored log, or null if there is none.
 *
 * For a session that died, this is the evidence: when it was last alive, how far
 * the audio clock had fallen behind the wall clock by then, and whether the page
 * was visible and holding the wake lock at the time.
 */
export function lastHeartbeat(
  log: StoredSessionLog,
): Extract<SessionEvent, { kind: 'heartbeat' }> | null {
  for (let i = log.events.length - 1; i >= 0; i--) {
    const event = log.events[i]
    if (event.kind === 'heartbeat') return event
  }
  return null
}
