import { SosFilter, designLowpassSos } from './butterworth'

/**
 * One partial of one bell, as a narrowband envelope.
 *
 * Complex demodulation: multiply the signal by e^(-j·2πf·n/fs) to bring the
 * partial down to DC, low-pass what is left, and take the magnitude. The result
 * is how much energy sits within ±bandwidth of that frequency, sample by
 * sample — which is what a bell's onset shows up in.
 *
 * Why this rather than an STFT bin: the group delay is known and constant, so
 * an onset time can be corrected for it exactly, and the time resolution is not
 * quantised to a hop size. Measured onset timing with this front end is ~14 ms
 * IQR against BReNDA on real recordings.
 *
 * Bandwidth is the parameter that matters most. Narrow gives better separation
 * between bells — essential on a heavy twelve, where adjacent nominals can be
 * 34 Hz apart — at the cost of a slower rise. At the blow spacings in real
 * ringing (221 ms on a heavy twelve, 310 ms on a light six) even a 20 ms rise
 * is under 10% of the gap, so narrow is close to free. 15–20 Hz is the current
 * default; 35 Hz was an early arbitrary choice and is worse everywhere tested.
 */
export class PartialChannel {
  private readonly step: number
  private readonly re: SosFilter
  private readonly im: SosFilter
  private phase = 0
  private out: Float64Array = new Float64Array(0)

  /** Group delay in seconds — 4th-order Butterworth at DC is 2.6131/ωc. */
  readonly groupDelaySeconds: number

  constructor(
    readonly frequencyHz: number,
    readonly bandwidthHz: number,
    readonly sampleRate: number,
    order = 4,
  ) {
    const sos = designLowpassSos(order, bandwidthHz, sampleRate)
    this.re = new SosFilter(sos)
    this.im = new SosFilter(sos)
    this.step = (2 * Math.PI * frequencyHz) / sampleRate
    const gd: Record<number, number> = { 2: 1.4142, 4: 2.6131, 6: 3.8637 }
    this.groupDelaySeconds = gd[order] / (2 * Math.PI * bandwidthHz)
  }

  /**
   * Process a block and return the envelope at full rate. The returned array is
   * reused between calls — copy it if you need to keep it.
   */
  process(input: ArrayLike<number>): Float64Array {
    const n = input.length
    if (this.out.length !== n) this.out = new Float64Array(n)
    const mixedRe = new Float64Array(n)
    const mixedIm = new Float64Array(n)

    // e^(-jθn): real part cos(θn), imaginary part -sin(θn).
    let phase = this.phase
    for (let i = 0; i < n; i++) {
      const x = input[i]
      mixedRe[i] = x * Math.cos(phase)
      mixedIm[i] = -x * Math.sin(phase)
      phase += this.step
      // Wrap rather than letting the accumulator grow. Accumulated error over
      // the ~40M samples of a half-hour session stays around 1e-12 radians,
      // which is far better than recomputing θ·n from a large sample index
      // would manage — see the long-session test.
      if (phase >= TWO_PI) phase -= TWO_PI
    }
    this.phase = phase

    const fr = this.re.process(mixedRe)
    const fi = this.im.process(mixedIm)
    for (let i = 0; i < n; i++) this.out[i] = Math.hypot(fr[i], fi[i])
    return this.out
  }

  reset(): void {
    this.re.reset()
    this.im.reset()
    this.phase = 0
  }
}

const TWO_PI = 2 * Math.PI
