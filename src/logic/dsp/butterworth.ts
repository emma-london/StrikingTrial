/**
 * Butterworth low-pass design and a cascaded-biquad filter.
 *
 * Coefficients are computed here rather than lifted from SciPy (ADR-0002), so
 * the app can filter at any bandwidth a tower profile asks for without a build
 * step. `butterworth.test.ts` checks the result against SciPy's response.
 *
 * Everything is `Float64Array`. The cutoffs used here are very low relative to
 * the sample rate — 20 Hz at 22.05 kHz is 0.0018 of Nyquist — which puts the
 * poles close to the unit circle where a biquad is numerically delicate.
 * Float32 loses audible precision there; the input arrives as Float32 from the
 * worklet and is widened on the way in.
 */

/** One second-order section, `[b0, b1, b2, a0, a1, a2]`, with `a0` normalised to 1. */
export type Section = number[]

/**
 * Design a low-pass Butterworth as a cascade of second-order sections.
 *
 * Bilinear transform of the analog prototype: pre-warp the cutoff, place the
 * analog poles on the left half of a circle, map each to the z-plane, and pair
 * conjugates into sections. All zeros sit at z = -1.
 */
export function designLowpassSos(order: number, cutoffHz: number, sampleRate: number): Section[] {
  if (order < 2 || order % 2 !== 0) {
    // Only even orders are needed here, and restricting it keeps the pairing
    // below honest — an odd order leaves a real pole with no partner.
    throw new Error(`designLowpassSos supports even orders only, got ${order}`)
  }
  if (!(cutoffHz > 0) || cutoffHz >= sampleRate / 2) {
    throw new Error(`cutoff ${cutoffHz} Hz out of range for sample rate ${sampleRate}`)
  }

  // Pre-warp so the digital cutoff lands where asked after the bilinear map.
  const warped = 2 * sampleRate * Math.tan((Math.PI * cutoffHz) / sampleRate)
  const fs2 = 2 * sampleRate

  const sections: Section[] = []
  for (let k = 0; k < order / 2; k++) {
    // Analog prototype poles, evenly spaced on the left half-circle. Taking one
    // of each conjugate pair is enough; the pair is reconstructed below.
    const theta = (Math.PI * (2 * k + order + 1)) / (2 * order)
    const pRe = warped * Math.cos(theta)
    const pIm = warped * Math.sin(theta)

    // Bilinear: z = (2*fs + p) / (2*fs - p)
    const nRe = fs2 + pRe
    const nIm = pIm
    const dRe = fs2 - pRe
    const dIm = -pIm
    const den = dRe * dRe + dIm * dIm
    const zRe = (nRe * dRe + nIm * dIm) / den
    const zIm = (nIm * dRe - nRe * dIm) / den

    // (z - zk)(z - conj(zk)) = z^2 - 2*Re(zk) z + |zk|^2
    sections.push([1, 2, 1, 1, -2 * zRe, zRe * zRe + zIm * zIm])
  }

  // Normalise so the cascade has unity gain at DC (z = 1, i.e. sum the taps).
  let dc = 1
  for (const [b0, b1, b2, a0, a1, a2] of sections) {
    dc *= (b0 + b1 + b2) / (a0 + a1 + a2)
  }
  const gain = 1 / dc
  sections[0] = [sections[0][0] * gain, sections[0][1] * gain, sections[0][2] * gain, 1, sections[0][4], sections[0][5]]

  return sections
}

/**
 * A cascade of biquads in transposed direct form II, matching SciPy's `sosfilt`.
 *
 * State is held per section and carried across calls, so the filter is
 * block-size agnostic: feeding it 128 samples at a time gives bit-identical
 * output to feeding it the whole signal (tested). That property is what lets
 * the same code run in the AudioWorklet and over a whole file offline.
 */
export class SosFilter {
  private readonly sections: Section[]
  private readonly z1: Float64Array
  private readonly z2: Float64Array
  private out: Float64Array = new Float64Array(0)

  constructor(sections: Section[]) {
    this.sections = sections.map((s) => [...s])
    this.z1 = new Float64Array(sections.length)
    this.z2 = new Float64Array(sections.length)
  }

  /**
   * Filter a block. The returned array is reused between calls — copy it if you
   * need to keep it. Returning a fresh array per 128-sample block would churn
   * the allocator inside a real-time audio callback.
   */
  process(input: ArrayLike<number>): Float64Array {
    if (this.out.length !== input.length) this.out = new Float64Array(input.length)
    const out = this.out
    const secs = this.sections
    const z1 = this.z1
    const z2 = this.z2

    for (let i = 0; i < input.length; i++) {
      let x = input[i]
      for (let s = 0; s < secs.length; s++) {
        const [b0, b1, b2, , a1, a2] = secs[s]
        const y = b0 * x + z1[s]
        z1[s] = b1 * x - a1 * y + z2[s]
        z2[s] = b2 * x - a2 * y
        x = y
      }
      out[i] = x
    }
    return out
  }

  /** Return to rest, so a replay starts from the same state a session did. */
  reset(): void {
    this.z1.fill(0)
    this.z2.fill(0)
  }
}
