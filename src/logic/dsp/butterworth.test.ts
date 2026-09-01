import { describe, expect, it } from 'vitest'
import fixtures from './fixtures.json'
import { SosFilter, designLowpassSos } from './butterworth'

/**
 * The expected values here come from SciPy — `butter(4, bw, btype='low',
 * fs=22050, output='sos')` and `sosfilt` — which is the reference the Python
 * prototype was validated against on real recordings. They are an external
 * oracle, not a record of what this code happens to produce.
 *
 * The response is asserted rather than the coefficients. A cascade can be
 * factored into second-order sections in more than one order and still be the
 * same filter, so comparing coefficient arrays would test the shape while
 * saying nothing about the payload.
 */

const BWS = [20, 35] as const

describe('designLowpassSos', () => {
  it.each(BWS)('matches SciPy magnitude response at %d Hz cutoff', (bw) => {
    const sos = designLowpassSos(4, bw, 22050)
    const freqs = fixtures.magfreqs as number[]
    const expected = fixtures[`mag_${bw}` as 'mag_20'] as number[]
    freqs.forEach((f, i) => {
      const got = magnitudeAt(sos, f, 22050)
      expect(got).toBeCloseTo(expected[i], 8)
    })
  })

  it('is 3 dB down at the cutoff, which is what makes it a Butterworth', () => {
    // Independent of the fixture: a defining property of the filter family.
    const sos = designLowpassSos(4, 20, 22050)
    expect(magnitudeAt(sos, 20, 22050)).toBeCloseTo(Math.SQRT1_2, 6)
  })
})

describe('SosFilter', () => {
  /**
   * These assert *relative* error over a window long enough to contain the
   * response. An earlier version compared 64 samples with an absolute
   * tolerance, which looked thorough and proved nothing: at a 20 Hz cutoff the
   * response is still around 1e-9 after 64 samples — shorter than the filter's
   * ~176-sample time constant — so a filter with no pre-warping at all passed.
   * Mutation-checking found it; see `testing.md` in the ringing-apps skill.
   */
  it.each(BWS)('reproduces the SciPy impulse response at %d Hz', (bw) => {
    const f = new SosFilter(designLowpassSos(4, bw, 22050))
    const input = new Float64Array(2000)
    input[0] = 1
    const out = f.process(input)
    const expected = fixtures[`impulse_${bw}` as 'impulse_20'] as number[]

    const peak = fixtures[`impulse_peak_${bw}` as 'impulse_peak_20'] as number
    const peakIndex = fixtures[`impulse_peak_index_${bw}` as 'impulse_peak_index_20'] as number
    expectRelative(out[peakIndex], peak)
    expect(indexOfMax(out)).toBe(peakIndex)

    let compared = 0
    for (let i = 0; i < expected.length; i++) {
      if (Math.abs(expected[i]) < peak * 1e-3) continue
      expectRelative(out[i], expected[i])
      compared++
    }
    expect(compared).toBeGreaterThan(1000)
  })

  it.each(BWS)('reproduces the SciPy step response at %d Hz', (bw) => {
    const f = new SosFilter(designLowpassSos(4, bw, 22050))
    const out = f.process(new Float64Array(2000).fill(1))
    const expected = fixtures[`step_${bw}` as 'step_20'] as number[]
    expectRelative(out[out.length - 1], fixtures[`step_final_${bw}` as 'step_final_20'] as number)
    let compared = 0
    for (let i = 0; i < expected.length; i++) {
      if (Math.abs(expected[i]) < 1e-4) continue
      expectRelative(out[i], expected[i])
      compared++
    }
    expect(compared).toBeGreaterThan(1000)
  })

  it('gives identical output whatever the block size', () => {
    // ADR-0002: the worklet feeds 128 samples, the tests feed whole files, and
    // the Node replay feeds something else again. A stage that only works at
    // one block size passes every other test in this file and fails in a tower.
    const signal = new Float64Array(1500)
    for (let i = 0; i < signal.length; i++) {
      signal[i] = Math.sin((2 * Math.PI * 12 * i) / 22050) + (i % 97) / 400
    }
    const whole = new SosFilter(designLowpassSos(4, 20, 22050)).process(signal)

    for (const block of [1, 7, 128, 512]) {
      const f = new SosFilter(designLowpassSos(4, 20, 22050))
      const out = new Float64Array(signal.length)
      for (let i = 0; i < signal.length; i += block) {
        const chunk = signal.subarray(i, Math.min(i + block, signal.length))
        out.set(f.process(chunk), i)
      }
      for (let i = 0; i < signal.length; i++) {
        expect(out[i]).toBeCloseTo(whole[i], 12)
      }
    }
  })

  it('starts from rest, so a session and a replay of it agree', () => {
    const f = new SosFilter(designLowpassSos(4, 20, 22050))
    expect(f.process(new Float64Array(10))).toEqual(new Float64Array(10))
  })
})

/** Evaluate |H(e^jw)| for a cascade of biquads, for the response assertions. */
function magnitudeAt(sos: number[][], freqHz: number, sampleRate: number): number {
  const w = (2 * Math.PI * freqHz) / sampleRate
  let re = 1
  let im = 0
  for (const [b0, b1, b2, a0, a1, a2] of sos) {
    const nr = b0 + b1 * Math.cos(-w) + b2 * Math.cos(-2 * w)
    const ni = b1 * Math.sin(-w) + b2 * Math.sin(-2 * w)
    const dr = a0 + a1 * Math.cos(-w) + a2 * Math.cos(-2 * w)
    const di = a1 * Math.sin(-w) + a2 * Math.sin(-2 * w)
    const d = dr * dr + di * di
    const qr = (nr * dr + ni * di) / d
    const qi = (ni * dr - nr * di) / d
    const pr = re * qr - im * qi
    im = re * qi + im * qr
    re = pr
  }
  return Math.hypot(re, im)
}

/** Relative comparison — absolute tolerances are meaningless across a response
 *  that spans nine orders of magnitude. */
function expectRelative(got: number, expected: number, rtol = 1e-7): void {
  expect(Math.abs(got - expected)).toBeLessThanOrEqual(rtol * Math.abs(expected))
}

function indexOfMax(a: Float64Array): number {
  let best = 0
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i
  return best
}
