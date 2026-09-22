import { describe, expect, it } from 'vitest'
import { blockLevel, LevelMeter, toDbfs } from './level'

/** A block of a constant value, for checking the arithmetic against something known. */
const constant = (value: number, length = 128) => new Int16Array(length).fill(value)

describe('blockLevel', () => {
  it('reports silence for a silent block', () => {
    const level = blockLevel(constant(0))
    expect(level.peak).toBe(0)
    expect(level.rms).toBe(0)
    expect(level.clipped).toBe(0)
  })

  it('reports an empty block as silence rather than throwing', () => {
    // The worklet can deliver one while the graph is connecting, and a meter is
    // not worth failing a recording for.
    expect(blockLevel(new Int16Array(0))).toEqual({ peak: 0, rms: 0, clipped: 0 })
  })

  it('measures peak and RMS against full scale', () => {
    // A constant block has RMS equal to its own magnitude, which makes this
    // checkable by hand rather than against the implementation.
    const level = blockLevel(constant(16384))
    expect(level.peak).toBeCloseTo(0.5, 10)
    expect(level.rms).toBeCloseTo(0.5, 10)
  })

  it('takes the magnitude, so a negative block is not quieter than a positive one', () => {
    const positive = blockLevel(constant(16384))
    const negative = blockLevel(constant(-16384))
    expect(negative.peak).toBeCloseTo(positive.peak, 10)
    expect(negative.rms).toBeCloseTo(positive.rms, 10)
  })

  it('counts samples at either rail as clipped', () => {
    const pcm = constant(0)
    pcm[0] = 32767
    pcm[1] = -32768
    pcm[2] = 32766 // one short of the rail, and not clipping
    expect(blockLevel(pcm).clipped).toBe(2)
  })

  it('distinguishes a loud block from a clipping one', () => {
    // Loud is fine; clipping is a lost recording. A meter that conflated them
    // would tell someone to move the phone when the level was perfect.
    expect(blockLevel(constant(30000)).clipped).toBe(0)
    expect(blockLevel(constant(32767)).clipped).toBe(128)
  })

  it('reports RMS below peak for anything that is not a constant', () => {
    // A single spike in silence: peak is the spike, RMS is much lower. This is
    // the shape a bell strike has, and the reason both are shown.
    const pcm = constant(0)
    pcm[0] = 32000
    const level = blockLevel(pcm)
    expect(level.peak).toBeCloseTo(32000 / 32768, 10)
    expect(level.rms).toBeLessThan(level.peak / 10)
  })
})

describe('toDbfs', () => {
  it('puts full scale at 0 dB and half scale at about -6', () => {
    expect(toDbfs(1)).toBeCloseTo(0, 6)
    expect(toDbfs(0.5)).toBeCloseTo(-6.02, 2)
    expect(toDbfs(0.1)).toBeCloseTo(-20, 6)
  })

  it('clamps silence to the floor instead of returning -Infinity', () => {
    // -Infinity does not render, and a meter needs somewhere to sit.
    expect(toDbfs(0)).toBe(-80)
    expect(toDbfs(0, -60)).toBe(-60)
    expect(Number.isFinite(toDbfs(0))).toBe(true)
  })

  it('clamps anything below the floor to the floor', () => {
    expect(toDbfs(1e-9)).toBe(-80)
  })
})

describe('LevelMeter', () => {
  const loud = { peak: 0.8, rms: 0.4, clipped: 0 }
  const quiet = { peak: 0.001, rms: 0.0005, clipped: 0 }

  it('knows nothing before it has seen a block', () => {
    // An unknown verdict must not render as a good one — a meter that says "ok"
    // before any audio has arrived is worse than one that says nothing.
    expect(new LevelMeter().verdict).toBe('unknown')
  })

  it('holds the peak and lets it decay, rather than following each block', () => {
    const meter = new LevelMeter(0.9)
    meter.push(loud)
    expect(meter.peak).toBeCloseTo(0.8, 10)

    meter.push(quiet)
    // Decayed, not dropped to the quiet block's own peak.
    expect(meter.peak).toBeCloseTo(0.72, 10)
    expect(meter.peak).toBeGreaterThan(quiet.peak)
  })

  it('pushes the held peak straight back up for anything louder', () => {
    const meter = new LevelMeter(0.5)
    meter.push(loud)
    meter.push(quiet)
    meter.push({ peak: 0.95, rms: 0.5, clipped: 0 })
    expect(meter.peak).toBeCloseTo(0.95, 10)
  })

  it('follows the latest block for RMS, without holding', () => {
    const meter = new LevelMeter()
    meter.push(loud)
    meter.push(quiet)
    expect(meter.rms).toBeCloseTo(quiet.rms, 10)
  })

  it('never forgets clipping, because it is a fact about the recording', () => {
    const meter = new LevelMeter(0.5)
    meter.push({ peak: 1, rms: 0.7, clipped: 3 })
    for (let i = 0; i < 500; i++) meter.push(quiet)
    expect(meter.clipped).toBe(3)
    expect(meter.verdict).toBe('hot')
  })

  it('calls a signal that never reaches the rail ok, and a tiny one quiet', () => {
    const ok = new LevelMeter()
    ok.push(loud)
    expect(ok.verdict).toBe('ok')

    const faint = new LevelMeter()
    faint.push(quiet) // -60 dBFS, well under the -45 threshold
    expect(faint.verdict).toBe('quiet')
  })

  it('prefers hot over quiet when a recording did both', () => {
    // A recording that clipped early and went quiet later is a clipped
    // recording; the damage is already done and is the thing to report.
    const meter = new LevelMeter(0.5)
    meter.push({ peak: 1, rms: 0.7, clipped: 1 })
    for (let i = 0; i < 200; i++) meter.push(quiet)
    expect(meter.verdict).toBe('hot')
  })

  it('refuses a decay that would never fall or would fall instantly', () => {
    expect(() => new LevelMeter(0)).toThrow(/decay/)
    expect(() => new LevelMeter(1.5)).toThrow(/decay/)
    expect(() => new LevelMeter(1)).not.toThrow() // 1 means "hold for ever", which is legal
  })
})
