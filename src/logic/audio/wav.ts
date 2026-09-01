/**
 * Mono 16-bit PCM WAV.
 *
 * Recording is lossless and in a format every tool can open, because the
 * archive is the app's most valuable output (ADR-0001) and will be re-analysed
 * for years. `MediaRecorder` was the obvious alternative and would have been
 * less code, but it produces Opus in a WebM container: lossy, and with no
 * guarantee that a decoded sample lines up with the sample index the detector
 * saw. Sample-exact alignment between the recording and the event log is the
 * property the whole replay approach rests on.
 *
 * Quantisation happens *before* analysis, not after, so the detector sees
 * exactly the samples that reach disk and a replay reproduces the session
 * rather than approximating it.
 */

const HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16
const CHANNELS = 1

/**
 * Convert float samples in [-1, 1] to signed 16-bit: scale by 32767, round half
 * *away from zero*, clamp.
 *
 * The tie-break is a real choice, not an arbitrary one. `Math.round` breaks ties
 * toward +Infinity, so -16383.5 becomes -16383 while +16383.5 becomes +16384 —
 * asymmetric, and it puts a small positive DC offset into everything recorded.
 * Rounding away from zero is symmetric, which is what the tests assert. (NumPy
 * rounds half to even, which is also symmetric; either is defensible, an
 * asymmetric one is not.)
 *
 * Clamping rather than wrapping matters too: towers are loud, over-driven input
 * happens, and a wrapped sample is a full-scale click sitting in the archive
 * forever.
 */
export function floatToPcm16(input: ArrayLike<number>): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const x = input[i] * 32767
    const scaled = x < 0 ? -Math.round(-x) : Math.round(x)
    out[i] = scaled > 32767 ? 32767 : scaled < -32768 ? -32768 : scaled
  }
  return out
}

/**
 * A 44-byte canonical WAV header.
 *
 * `dataBytes` is written into the two size fields. A streaming writer does not
 * know the length up front, so it writes a header with zero, appends samples,
 * then rewrites the first 44 bytes with the real size. The offsets that
 * patching depends on are asserted in the tests.
 */
export function wavHeader(sampleRate: number, dataBytes: number): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_BYTES)
  const view = new DataView(buffer)
  const byteRate = (sampleRate * CHANNELS * BITS_PER_SAMPLE) / 8
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8

  ascii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(view, 8, 'WAVE')
  ascii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  ascii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  return buffer
}

/** A complete WAV file. For whole-buffer use; recording streams instead. */
export function encodeWav(pcm: Int16Array, sampleRate: number): ArrayBuffer {
  const dataBytes = pcm.length * 2
  const out = new Uint8Array(HEADER_BYTES + dataBytes)
  out.set(new Uint8Array(wavHeader(sampleRate, dataBytes)), 0)
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, dataBytes), HEADER_BYTES)
  return out.buffer
}

export const WAV_HEADER_BYTES = HEADER_BYTES

function ascii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}
