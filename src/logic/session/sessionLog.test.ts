import { describe, expect, it } from 'vitest'
import { SessionLog, endedCleanly, lastHeartbeat, parseSessionLog, sampleToSeconds } from './sessionLog'

const META = {
  id: 'eltham-2026-09-02-1',
  startedAtIso: '2026-09-02T19:30:00.000Z',
  sampleRate: 48000,
  tower: 'Eltham St John',
  bells: [3, 4, 5, 6, 7, 8],
  profileSource: 'stored' as const,
}

describe('SessionLog', () => {
  it('records events against the audio clock, not the wall clock', () => {
    // ADR-0001: an offline re-run has to line up with what the phone decided,
    // and only the sample index survives that comparison. Wall-clock drifts
    // against the audio clock by enough to ruin a 14 ms measurement.
    const log = new SessionLog(META)
    log.strike(48000, 5, 0.9)
    expect(log.events[0]).toMatchObject({ kind: 'strike', sample: 48000, bell: 5 })
    expect(sampleToSeconds(log.events[0].sample, META.sampleRate)).toBe(1)
  })

  it('refuses an event that goes backwards', () => {
    // Out-of-order events mean something has gone wrong upstream — a worklet
    // restart, a dropped block. Failing loudly beats writing a log whose
    // ordering silently cannot be trusted.
    const log = new SessionLog(META)
    log.strike(1000, 3, 1)
    expect(() => log.strike(999, 4, 1)).toThrow(/backwards/i)
  })

  it('allows two events at the same sample', () => {
    // Two bells striking together is the case we most want recorded, not
    // rejected as a duplicate.
    const log = new SessionLog(META)
    log.strike(1000, 3, 1)
    expect(() => log.strike(1000, 4, 1)).not.toThrow()
    expect(log.events).toHaveLength(2)
  })

  it('round-trips through serialisation', () => {
    const log = new SessionLog(META)
    log.strike(100, 3, 0.8)
    log.marker(2000, 'sounded-wrong')
    log.rowClose(3000, [3, 4, 5, 6, 7, 8], 0.7)
    log.calibration(4000, false, 'slot 2 matched bell 3')
    const back = parseSessionLog(JSON.parse(JSON.stringify(log.toJSON())))
    expect(back.meta).toEqual(META)
    expect(back.events).toEqual(log.events)
  })

  it('rejects a stored log that has been corrupted', () => {
    // Persistence validation: a half-written or hand-edited file must not load
    // as a plausible-looking session.
    expect(() => parseSessionLog(null)).toThrow()
    expect(() => parseSessionLog({ meta: META })).toThrow()
    expect(() => parseSessionLog({ meta: { ...META, sampleRate: 0 }, events: [] })).toThrow(/sampleRate/)
    expect(() => parseSessionLog({ meta: META, events: [{ kind: 'strike' }] })).toThrow(/sample/)
    expect(() =>
      parseSessionLog({ meta: META, events: [{ kind: 'strike', sample: 5, bell: 3, confidence: 1 },
                                             { kind: 'strike', sample: 4, bell: 3, confidence: 1 }] }),
    ).toThrow(/backwards/i)
  })

  it('keeps markers even when nothing else is working', () => {
    // The feedback button has to log something usable in a session where the
    // detector produced nothing at all — that session is still evidence.
    const log = new SessionLog(META)
    log.marker(12345, 'sounded-wrong')
    expect(log.events).toHaveLength(1)
    expect(parseSessionLog(log.toJSON()).events[0]).toMatchObject({ kind: 'marker', sample: 12345 })
  })
})

describe('sampleToSeconds', () => {
  it('uses the rate the session was recorded at, not a default', () => {
    // Phones hand out 44100 or 48000 depending on the device and the moment.
    // Assuming one of them turns every timing figure into a 9% error.
    expect(sampleToSeconds(44100, 44100)).toBe(1)
    expect(sampleToSeconds(44100, 48000)).toBeCloseTo(0.91875, 10)
  })
})

describe('liveness (ADR-0006)', () => {
  const beat = (sample: number, wallMs: number, driftMs: number) => ({
    sample,
    wallMs,
    driftMs,
    visibility: 'hidden' as const,
    wakeLock: false,
  })

  it('treats a log with no ended event as a session that died', () => {
    // This is the whole point of ADR-0006: the log is flushed while recording,
    // so a killed session still has everything up to the moment it died — and
    // it must not be presentable as a short practice.
    const log = new SessionLog(META)
    log.heartbeat(beat(48000, 1_000_000, 0))
    expect(log.endedCleanly).toBe(false)
    expect(endedCleanly(parseSessionLog(log.toJSON()))).toBe(false)
  })

  it('treats a log with an ended event as a clean stop', () => {
    const log = new SessionLog(META)
    log.heartbeat(beat(48000, 1_000_000, 0))
    log.ended(96000)
    expect(log.endedCleanly).toBe(true)
    expect(endedCleanly(parseSessionLog(log.toJSON()))).toBe(true)
  })

  it('round-trips heartbeats, so the evidence survives being stored', () => {
    // A killed session is read back from disk, never from memory, so anything
    // parseSessionLog drops is evidence we do not have.
    const log = new SessionLog(META)
    log.heartbeat(beat(48000, 1_000_000, 0))
    log.heartbeat(beat(48000, 1_010_000, 10_000))
    const back = parseSessionLog(JSON.parse(JSON.stringify(log.toJSON())))
    expect(back.events).toEqual(log.events)
  })

  it('finds the last heartbeat, which is when a dead session was last alive', () => {
    const log = new SessionLog(META)
    log.heartbeat(beat(48000, 1_000_000, 0))
    log.marker(50000, 'sounded-wrong')
    log.heartbeat(beat(96000, 1_005_000, 4000))
    log.marker(99000, 'sounded-wrong')

    const last = lastHeartbeat(parseSessionLog(log.toJSON()))
    expect(last).toMatchObject({ sample: 96000, driftMs: 4000 })
  })

  it('returns no heartbeat rather than inventing one', () => {
    // A session that died before its first heartbeat has no evidence, and
    // saying so is better than a zero that reads as "no drift".
    const log = new SessionLog(META)
    log.marker(1000, 'sounded-wrong')
    expect(lastHeartbeat(parseSessionLog(log.toJSON()))).toBeNull()
  })

  it('still refuses an event that goes backwards, heartbeats included', () => {
    const log = new SessionLog(META)
    log.heartbeat(beat(96000, 1_000_000, 0))
    expect(() => log.heartbeat(beat(48000, 1_005_000, 0))).toThrow(/backwards/i)
  })

  it('allows a heartbeat at the same sample as the last, which is what a stall is', () => {
    // A stalled capture means the sample index does not move while the wall
    // clock does. If the log refused that, it would refuse exactly the case it
    // exists to record.
    const log = new SessionLog(META)
    log.heartbeat(beat(48000, 1_000_000, 0))
    expect(() => log.heartbeat(beat(48000, 1_005_000, 5000))).not.toThrow()
  })
})
