/**
 * Capture only. See docs/adr/ADR-0003.
 *
 * This is deliberately plain JavaScript with no imports and no dependencies: it
 * runs on the audio thread, it is the one component that must never stop, and
 * nothing about the bundler should be able to affect whether it loads.
 *
 * It converts each block to 16-bit PCM, tags it with a running sample index,
 * and transfers it out. Everything else happens elsewhere.
 *
 * The quantisation here must match `floatToPcm16` in src/logic/audio/wav.ts —
 * symmetric, rounding half away from zero, clamped — because the analysis works
 * from these same samples and a replay has to reproduce the session exactly.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.sampleIndex = 0
    this.running = true
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.running = false
    }
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    // No input yet (the graph is still connecting) — keep the node alive but
    // do not advance the sample index, or the timeline gains a silent gap.
    if (!channel) return this.running

    const pcm = new Int16Array(channel.length)
    for (let i = 0; i < channel.length; i++) {
      const x = channel[i] * 32767
      const scaled = x < 0 ? -Math.round(-x) : Math.round(x)
      pcm[i] = scaled > 32767 ? 32767 : scaled < -32768 ? -32768 : scaled
    }

    this.port.postMessage({ startSample: this.sampleIndex, pcm }, [pcm.buffer])
    this.sampleIndex += channel.length
    return this.running
  }
}

registerProcessor('capture-processor', CaptureProcessor)
