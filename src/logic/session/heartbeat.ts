/**
 * Comparing the two clocks a recording has: the wall clock and the sample clock.
 *
 * ADR-0006. Everything else in this app is timestamped by sample index and
 * deliberately knows nothing about wall-clock time (ADR-0001). This module is
 * the one exception, and it exists to answer a question the sample index cannot
 * answer alone: *did capture stop while the app was not looking?*
 *
 * The sample clock only advances when audio arrives. The wall clock advances
 * regardless. So their difference is the audio that did not arrive, and the
 * moment it appears is the moment capture stalled.
 *
 * **Read the shape, not the magnitude.** An AudioContext's real sample rate is
 * not exactly its nominal one, so a steady slope is expected and means nothing —
 * 0.01% is 540 ms over ninety minutes. A *step* is a stall. That is why this
 * module reports a series of readings and refuses to reduce them to a single
 * number: a summary cannot tell the two apart, and the difference is the whole
 * result.
 *
 * Pure: no Date, no AudioContext, no DOM. The caller supplies both clocks.
 */

/** Where the app was when a reading was taken. Not interpreted here. */
export interface CaptureState {
  /** `document.visibilityState` at the moment of the reading. */
  visibility: 'visible' | 'hidden'
  /** Whether the screen wake lock was actually held — not whether it was asked for. */
  wakeLock: boolean
}

export interface HeartbeatReading extends CaptureState {
  /** Samples captured since the session began, from the worklet's index. */
  sample: number
  /** Wall clock at the reading, as the caller's epoch milliseconds. */
  wallMs: number
  /** Wall-clock milliseconds since capture started. */
  elapsedWallMs: number
  /** Audio milliseconds since capture started, derived from `sample`. */
  elapsedAudioMs: number
  /**
   * `elapsedWallMs - elapsedAudioMs`: audio that should have arrived and did not.
   * Positive means the sample clock has fallen behind. Negative is not a stall —
   * it means the oscillator runs slightly fast, which is ordinary.
   */
  driftMs: number
}

/**
 * Tracks one session's two clocks and decides when a reading is due.
 *
 * Construction fixes the origin of both clocks, so every reading is relative to
 * the same instant and drift accumulates across the session rather than being
 * measured fresh each time. That is deliberate: a stall that has ended still
 * shows in every later reading, because the audio it swallowed is still missing.
 */
export class HeartbeatMonitor {
  private lastEmittedWallMs: number
  private lastSample = 0

  constructor(
    private readonly originWallMs: number,
    private readonly sampleRate: number,
    /** How often a reading is due. Five seconds by default — see ADR-0006. */
    private readonly intervalMs = 5000,
  ) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error(`heartbeat needs a usable sample rate, got ${sampleRate}`)
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(`heartbeat needs a positive interval, got ${intervalMs}`)
    }
    // The origin counts as a reading, so the first due time is one interval in.
    this.lastEmittedWallMs = originWallMs
  }

  /** Is a reading due at this wall-clock instant? */
  isDue(wallMs: number): boolean {
    return wallMs - this.lastEmittedWallMs >= this.intervalMs
  }

  /**
   * Take a reading. Records it as the most recent, so `isDue` measures from here.
   *
   * The sample index must not go backwards. Downstream this is a `SessionLog`
   * invariant, but catching it here says something more specific — the worklet
   * restarted, or a block was delivered out of order — and a drift figure
   * computed from a rewound index would be a large negative number that looks
   * like a clock problem rather than a plumbing one.
   */
  read(wallMs: number, sample: number, state: CaptureState): HeartbeatReading {
    if (sample < this.lastSample) {
      throw new Error(
        `sample index went backwards: ${sample} after ${this.lastSample}`,
      )
    }
    this.lastSample = sample
    this.lastEmittedWallMs = wallMs

    const elapsedWallMs = wallMs - this.originWallMs
    const elapsedAudioMs = (sample / this.sampleRate) * 1000

    return {
      sample,
      wallMs,
      elapsedWallMs,
      elapsedAudioMs,
      driftMs: elapsedWallMs - elapsedAudioMs,
      ...state,
    }
  }
}

/**
 * The largest jump in drift between consecutive readings, and where it happened.
 *
 * This is the slope/step separation of ADR-0006 made concrete for display. A
 * clock mismatch spreads its drift evenly across every interval, so its largest
 * single jump stays near zero however big the total drift grows. A stall puts
 * nearly all of its drift into one interval.
 *
 * Returns null for fewer than two readings — one reading has no jump, and
 * inventing a zero would let a session with no data render as a clean one.
 */
export function largestDriftStep(
  readings: readonly HeartbeatReading[],
): { jumpMs: number; afterSample: number; atWallMs: number } | null {
  if (readings.length < 2) return null

  let worst = { jumpMs: -Infinity, afterSample: 0, atWallMs: 0 }
  for (let i = 1; i < readings.length; i++) {
    const jumpMs = readings[i].driftMs - readings[i - 1].driftMs
    if (jumpMs > worst.jumpMs) {
      worst = {
        jumpMs,
        afterSample: readings[i - 1].sample,
        atWallMs: readings[i].wallMs,
      }
    }
  }
  return worst
}
