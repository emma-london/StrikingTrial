import { describe, expect, it } from 'vitest'
import fixtures from './fixtures.json'
import { PartialChannel } from './partialChannel'

/**
 * The oracle here is half a second of the real Eltham Bob Doubles recording,
 * run through the Python prototype's demodulator at 3736 Hz with a 20 Hz
 * low-pass — the tenor's best partial, and the exact configuration the analysis
 * was validated with against BReNDA's strike times.
 *
 * Real audio rather than a synthetic tone deliberately: a synthetic tone at the
 * centre frequency exercises none of the rejection this stage exists for, and a
 * channel that simply took |x| would pass it.
 */

const SR = fixtures.audio_sr as number
const PARTIAL = fixtures.audio_partial as number
const BW = fixtures.audio_bw as number
const SEG = Float64Array.from(fixtures.audio_seg as number[])
const ENV = fixtures.audio_env as number[]

describe('PartialChannel', () => {
  it('reproduces the Python envelope on real ringing audio', () => {
    const ch = new PartialChannel(PARTIAL, BW, SR)
    const out = ch.process(SEG)

    const peak = Math.max(...ENV)
    expect(peak).toBeGreaterThan(0) // guard: a dead fixture would pass everything below

    let compared = 0
    for (let i = 0; i < ENV.length; i++) {
      if (ENV[i] < peak * 1e-3) continue
      expect(Math.abs(out[i] - ENV[i])).toBeLessThanOrEqual(1e-6 * ENV[i])
      compared++
    }
    expect(compared).toBeGreaterThan(500)
  })

  it('rejects a tone well outside its band', () => {
    // Not a fixture comparison — an independent statement of what the stage is
    // for. 3736 Hz channel, 20 Hz wide; a tone 300 Hz away must be crushed.
    const inBand = tone(PARTIAL, SR, 4000)
    const outOfBand = tone(PARTIAL + 300, SR, 4000)
    const passed = rms(new PartialChannel(PARTIAL, BW, SR).process(inBand))
    const rejected = rms(new PartialChannel(PARTIAL, BW, SR).process(outOfBand))
    expect(20 * Math.log10(passed / rejected)).toBeGreaterThan(40)
  })

  it('gives identical output whatever the block size', () => {
    // The worklet feeds 128 samples; the tests and the replay feed whole files.
    const whole = Float64Array.from(new PartialChannel(PARTIAL, BW, SR).process(SEG))
    for (const block of [1, 128, 333]) {
      const ch = new PartialChannel(PARTIAL, BW, SR)
      const out = new Float64Array(SEG.length)
      for (let i = 0; i < SEG.length; i += block) {
        out.set(ch.process(SEG.subarray(i, Math.min(i + block, SEG.length))), i)
      }
      for (let i = 0; i < SEG.length; i++) {
        expect(Math.abs(out[i] - whole[i])).toBeLessThanOrEqual(1e-12)
      }
    }
  })

  it('keeps its oscillator phase accurate over a long session', { timeout: 20_000 }, () => {
    // Phase is accumulated rather than recomputed from the sample index, so it
    // is worth knowing the drift stays negligible over a long session. Three
    // minutes here to keep the suite quick; accumulated phase error grows as
    // the square root of sample count, so a half-hour practice is about 2.7x
    // this and still nowhere near the tolerance.
    // Compared against a freshly-started channel, which has no accumulated error.
    const ch = new PartialChannel(PARTIAL, BW, SR)
    const silence = new Float64Array(100_000)
    for (let i = 0; i < 40; i++) ch.process(silence) // 4M samples, ~3 minutes
    const late = ch.process(SEG)
    const fresh = new PartialChannel(PARTIAL, BW, SR).process(SEG)
    const peak = Math.max(...fresh)
    for (let i = 0; i < SEG.length; i++) {
      if (fresh[i] < peak * 1e-3) continue
      expect(Math.abs(late[i] - fresh[i])).toBeLessThanOrEqual(1e-6 * fresh[i])
    }
  })
})

function tone(freq: number, sampleRate: number, n: number): Float64Array {
  const a = new Float64Array(n)
  for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate)
  return a
}

function rms(a: ArrayLike<number>): number {
  let s = 0
  // Skip the filter's settling time; a 20 Hz filter takes ~500 samples to rise.
  for (let i = 1000; i < a.length; i++) s += a[i] * a[i]
  return Math.sqrt(s / (a.length - 1000))
}
