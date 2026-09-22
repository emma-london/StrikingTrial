import { describe, expect, it } from 'vitest'
import { HeartbeatMonitor, largestDriftStep, type CaptureState } from './heartbeat'

/**
 * These tests are about one property: drift separates a capture that stalled
 * from one that did not, and does it in a way a clock mismatch cannot imitate.
 *
 * The numbers are constructed rather than measured, because the thing being
 * checked is arithmetic — what a real device does is a manual check on a phone
 * (CLAUDE.md), and no test here can stand in for Tuesday.
 */

const RATE = 48000
const AWAKE: CaptureState = { visibility: 'visible', wakeLock: true }
const POCKET: CaptureState = { visibility: 'hidden', wakeLock: false }

/** Samples that would have arrived in `ms` of uninterrupted capture. */
const samplesFor = (ms: number) => Math.round((ms / 1000) * RATE)

describe('HeartbeatMonitor', () => {
  it('reports no drift while the sample clock keeps up with the wall clock', () => {
    const monitor = new HeartbeatMonitor(1_000_000, RATE)
    for (const elapsed of [5000, 10_000, 60_000, 90 * 60_000]) {
      const reading = monitor.read(1_000_000 + elapsed, samplesFor(elapsed), AWAKE)
      expect(reading.driftMs).toBeCloseTo(0, 6)
      expect(reading.elapsedWallMs).toBe(elapsed)
      expect(reading.elapsedAudioMs).toBeCloseTo(elapsed, 6)
    }
  })

  it('reports drift equal to the audio that did not arrive', () => {
    const monitor = new HeartbeatMonitor(0, RATE)
    // Twenty seconds of wall clock, but capture stopped after ten.
    const reading = monitor.read(20_000, samplesFor(10_000), AWAKE)
    expect(reading.driftMs).toBeCloseTo(10_000, 6)
  })

  it('keeps drift after a stall ends, because the missing audio is still missing', () => {
    const monitor = new HeartbeatMonitor(0, RATE)

    monitor.read(5000, samplesFor(5000), AWAKE)
    // Stalled between 5 s and 15 s: the clock ran, the samples did not.
    const during = monitor.read(15_000, samplesFor(5000), POCKET)
    expect(during.driftMs).toBeCloseTo(10_000, 6)

    // Capture resumes and keeps up perfectly from here.
    const after = monitor.read(25_000, samplesFor(15_000), AWAKE)
    expect(after.driftMs).toBeCloseTo(10_000, 6)

    // This is the point of accumulating from a fixed origin: a session that
    // recovered must not look like one that never stalled.
    expect(after.driftMs).not.toBeCloseTo(0, 3)
  })

  it('measures drift in milliseconds, so the sample rate does not change the answer', () => {
    const readings = [48000, 44100, 22050, 16000].map((rate) => {
      const monitor = new HeartbeatMonitor(0, rate)
      // Ten seconds of wall clock, four seconds of audio, whatever the rate.
      return monitor.read(10_000, Math.round(4 * rate), AWAKE).driftMs
    })
    for (const drift of readings) expect(drift).toBeCloseTo(6000, 6)
  })

  it('carries the capture state through untouched', () => {
    const monitor = new HeartbeatMonitor(0, RATE)
    const reading = monitor.read(5000, samplesFor(5000), POCKET)
    expect(reading.visibility).toBe('hidden')
    expect(reading.wakeLock).toBe(false)
  })

  it('refuses a sample index that goes backwards', () => {
    const monitor = new HeartbeatMonitor(0, RATE)
    monitor.read(5000, samplesFor(5000), AWAKE)
    // A rewound index would otherwise produce a large negative drift, which
    // reads as a clock problem rather than the plumbing fault it is.
    expect(() => monitor.read(10_000, samplesFor(4000), AWAKE)).toThrow(/backwards/)
  })

  it('rejects an unusable sample rate rather than dividing by it', () => {
    expect(() => new HeartbeatMonitor(0, 0)).toThrow(/sample rate/)
    expect(() => new HeartbeatMonitor(0, Number.NaN)).toThrow(/sample rate/)
  })

  describe('isDue', () => {
    it('comes due one interval after the origin, not immediately', () => {
      const monitor = new HeartbeatMonitor(1000, RATE, 5000)
      expect(monitor.isDue(1000)).toBe(false)
      expect(monitor.isDue(5999)).toBe(false)
      expect(monitor.isDue(6000)).toBe(true)
    })

    it('measures from the last reading taken, not from the last time it was due', () => {
      const monitor = new HeartbeatMonitor(0, RATE, 5000)
      // A hidden page gets its timers throttled, so a reading can land late.
      monitor.read(12_000, samplesFor(12_000), POCKET)
      expect(monitor.isDue(16_000)).toBe(false)
      expect(monitor.isDue(17_000)).toBe(true)
    })
  })
})

describe('largestDriftStep', () => {
  /** A session whose drift grows by `perReadingMs` every five seconds. */
  const sloped = (count: number, perReadingMs: number) => {
    const monitor = new HeartbeatMonitor(0, RATE)
    return Array.from({ length: count }, (_, i) => {
      const wall = (i + 1) * 5000
      return monitor.read(wall, samplesFor(wall - (i + 1) * perReadingMs), AWAKE)
    })
  }

  it('stays small for a steady clock mismatch, however large the total drift', () => {
    // 0.01% fast: 540 ms across ninety minutes, and nothing is wrong.
    const readings = sloped(1080, 0.5)
    const total = readings[readings.length - 1].driftMs
    expect(total).toBeGreaterThan(500)

    const step = largestDriftStep(readings)
    expect(step).not.toBeNull()
    // The whole point: a big total with a small largest step is not a stall.
    expect(step!.jumpMs).toBeLessThan(1)
  })

  it('finds a stall, and says which sample it followed', () => {
    const monitor = new HeartbeatMonitor(0, RATE)
    const readings = [
      monitor.read(5000, samplesFor(5000), AWAKE),
      monitor.read(10_000, samplesFor(10_000), AWAKE),
      // Stalled from here to the next reading: the wall clock advances five
      // seconds and the sample count does not move. It does not go *backwards* —
      // that is a worklet restart, and `read` refuses it (tested above).
      monitor.read(15_000, samplesFor(10_000), POCKET),
      // Resumed, and keeping up again: five more seconds of wall, five of audio.
      monitor.read(20_000, samplesFor(15_000), AWAKE),
    ]

    const step = largestDriftStep(readings)
    expect(step!.jumpMs).toBeCloseTo(5000, 6)
    expect(step!.afterSample).toBe(samplesFor(10_000))
    expect(step!.atWallMs).toBe(15_000)

    // The stall is still in the total after recovery, but only one interval
    // carries it — which is the slope/step separation the display relies on.
    expect(readings[3].driftMs).toBeCloseTo(5000, 6)
  })

  it('returns null below two readings rather than inventing a clean session', () => {
    const monitor = new HeartbeatMonitor(0, RATE)
    expect(largestDriftStep([])).toBeNull()
    expect(largestDriftStep([monitor.read(5000, samplesFor(5000), AWAKE)])).toBeNull()
  })
})
