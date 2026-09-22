/**
 * How loud the microphone is hearing, from one block of PCM.
 *
 * This says nothing about striking and is not part of the measurement. It
 * answers a question you can only otherwise answer by going home and running
 * the pipeline: **is this phone, in this position, hearing the bells usefully
 * at all?** A recording that is clipping or barely above the noise floor is a
 * wasted practice, and a practice costs a week.
 *
 * Deliberately crude. Peak and RMS over a block, and a count of samples pinned
 * at the rail. No smoothing, no weighting, no gating — the display smooths, and
 * anything cleverer here would be a measurement nobody has checked.
 *
 * Pure: no AudioContext, no DOM. Int16 in, numbers out.
 */

/** Full scale for signed 16-bit. `-32768` is representable and `+32768` is not. */
const FULL_SCALE = 32768

export interface BlockLevel {
  /** Largest absolute sample in the block, 0–1 of full scale. */
  peak: number
  /** Root mean square of the block, 0–1 of full scale. */
  rms: number
  /** Samples sitting at either rail. Any at all means the input is too hot. */
  clipped: number
}

/**
 * Measure one block.
 *
 * An empty block returns silence rather than throwing: the worklet can deliver
 * one while the graph is still connecting, and a level meter is not worth
 * failing a recording for.
 */
export function blockLevel(pcm: Int16Array): BlockLevel {
  if (pcm.length === 0) return { peak: 0, rms: 0, clipped: 0 }

  let peak = 0
  let sumSquares = 0
  let clipped = 0

  for (let i = 0; i < pcm.length; i++) {
    const sample = pcm[i]
    const magnitude = sample < 0 ? -sample : sample
    if (magnitude > peak) peak = magnitude
    sumSquares += sample * sample
    if (sample >= 32767 || sample <= -32768) clipped++
  }

  return {
    peak: peak / FULL_SCALE,
    rms: Math.sqrt(sumSquares / pcm.length) / FULL_SCALE,
    clipped,
  }
}

/**
 * A level as decibels below full scale, for display.
 *
 * Silence is `-Infinity` mathematically, which does not render. It is clamped
 * to `floorDb` so a meter has somewhere to sit, and the floor is the caller's
 * because it is a display choice, not a measurement.
 */
export function toDbfs(level: number, floorDb = -80): number {
  if (level <= 0) return floorDb
  const db = 20 * Math.log10(level)
  return db < floorDb ? floorDb : db
}

/**
 * Running peak and RMS across blocks, with the peak decaying.
 *
 * A meter that only showed the current block would flicker unreadably at 128
 * samples a block; one that held the maximum for ever would show a single
 * cough for the rest of the evening. The peak falls by `decayPerBlock` each
 * block and is pushed back up by anything louder, which is what a hardware
 * meter does and what a ringer expects to see.
 *
 * `clippedTotal` never decays — clipping at any point in a recording is a fact
 * about that recording, and it should still be visible when the piece ends.
 */
export class LevelMeter {
  private heldPeak = 0
  private latestRms = 0
  private clippedTotal = 0
  private blocks = 0

  constructor(private readonly decayPerBlock = 0.997) {
    if (!(decayPerBlock > 0 && decayPerBlock <= 1)) {
      throw new Error(`decay must be in (0, 1], got ${decayPerBlock}`)
    }
  }

  push(level: BlockLevel): void {
    this.heldPeak = Math.max(level.peak, this.heldPeak * this.decayPerBlock)
    this.latestRms = level.rms
    this.clippedTotal += level.clipped
    this.blocks++
  }

  get peak(): number {
    return this.heldPeak
  }

  get rms(): number {
    return this.latestRms
  }

  get clipped(): number {
    return this.clippedTotal
  }

  /**
   * A one-word verdict for the recording screen.
   *
   * The thresholds are chosen to be obviously right rather than tuned: anything
   * touching the rail is `hot`, a held peak under -45 dBFS is `quiet` (the
   * bells are not reaching the microphone), everything else is `ok`. They are
   * not a striking measurement and nothing downstream reads them.
   */
  get verdict(): 'hot' | 'quiet' | 'ok' | 'unknown' {
    if (this.blocks === 0) return 'unknown'
    if (this.clippedTotal > 0) return 'hot'
    if (toDbfs(this.heldPeak) < -45) return 'quiet'
    return 'ok'
  }
}
