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
