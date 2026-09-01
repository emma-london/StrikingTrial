import { describe, expect, it } from 'vitest'
import fixtures from './wav.fixtures.json'
import { encodeWav, floatToPcm16, wavHeader } from './wav'

/**
 * The oracle is a WAV written by SciPy from known samples. Producing
 * byte-identical output means the file will open in every tool the archive will
 * ever be read by, which is the whole point of recording losslessly.
 *
 * ADR-0001 also depends on this being exact: the detector analyses the same
 * quantised samples that get written, so an offline replay of a session
 * reproduces what the phone did rather than merely approximating it.
 */

describe('floatToPcm16', () => {
  it('maps the full scale to the full range', () => {
    expect(Array.from(floatToPcm16(Float32Array.from([0, 1, -1, 0.5, -0.5])))).toEqual([
      0, 32767, -32767, 16384, -16384,
    ])
  })

  it('is symmetric about zero, so recording adds no DC offset', () => {
    // Not a fixture comparison, because the tie-break is a choice rather than a
    // standard — an earlier version of this test asserted NumPy's banker's
    // rounding and was really just recording which library generated it.
    // Symmetry is the property that actually matters: `Math.round` breaks ties
    // toward +Infinity, which biases every recording slightly positive.
    // Inside full scale only: int16's range is asymmetric (-32768..32767), so
    // the clamp deliberately breaks symmetry past +/-1. That is covered by the
    // clamping test below.
    // Asserted as "they cancel" rather than "one is the negation of the other",
    // because at zero the latter compares +0 with -0 and Object.is says no.
    const cancels = (x: number) =>
      floatToPcm16(Float32Array.from([x]))[0] + floatToPcm16(Float32Array.from([-x]))[0]
    for (let k = 0; k <= 32767; k += 7) expect(cancels(k / 32767)).toBe(0)
    // And the half-way values specifically, which is where a tie-break shows up.
    for (const half of [0.5, 1.5, 16383.5]) expect(cancels(half / 32767)).toBe(0)
  })

  it('clamps rather than wrapping when the signal is over-driven', () => {
    // A wrapped sample is a full-scale click in the archive, and towers are loud
    // enough that clipping happens. +2.0 must become +32767, not -1.
    const got = floatToPcm16(Float32Array.from([2, -2, 100, -100]))
    expect(Array.from(got)).toEqual([32767, -32768, 32767, -32768])
  })

  it('round-trips within one quantisation step', () => {
    const input = new Float32Array(512)
    for (let i = 0; i < input.length; i++) input[i] = Math.sin(i / 7) * 0.9
    const back = floatToPcm16(input)
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(back[i] / 32767 - input[i])).toBeLessThan(1 / 32767)
    }
  })
})

describe('encodeWav', () => {
  it('is byte-identical to a SciPy-written WAV', () => {
    const pcm = Int16Array.from(fixtures.wav_expected_int16 as number[])
    const bytes = new Uint8Array(encodeWav(pcm, fixtures.wav_sample_rate as number))
    expect(Array.from(bytes)).toEqual(fixtures.wav_bytes)
  })

  it('declares the sizes a streaming writer has to patch in later', () => {
    // Recording streams to disk before the length is known, so the header is
    // written first with placeholder sizes and corrected at the end. These
    // offsets are what the patching code relies on; if they move, it breaks
    // silently and produces a file that plays as a fraction of its real length.
    const header = new Uint8Array(wavHeader(48000, 1234))
    expect(header.length).toBe(44)
    expect(String.fromCharCode(...header.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...header.slice(8, 12))).toBe('WAVE')
    expect(String.fromCharCode(...header.slice(36, 40))).toBe('data')
    const view = new DataView(header.buffer)
    expect(view.getUint32(4, true)).toBe(36 + 1234) // RIFF size
    expect(view.getUint32(40, true)).toBe(1234) // data size
    expect(view.getUint32(24, true)).toBe(48000) // sample rate
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint16(34, true)).toBe(16) // bit depth
  })

  it('keeps byte rate and block align consistent with the format', () => {
    // Wrong values here produce a file that plays at the wrong speed — which
    // would silently corrupt every timing measurement taken from the archive.
    const view = new DataView(wavHeader(22050, 0))
    const channels = view.getUint16(22, true)
    const rate = view.getUint32(24, true)
    const bits = view.getUint16(34, true)
    expect(view.getUint32(28, true)).toBe((rate * channels * bits) / 8) // byte rate
    expect(view.getUint16(32, true)).toBe((channels * bits) / 8) // block align
  })
})
