import { SessionLog, type SessionMeta } from '../session/sessionLog'
import { HeartbeatMonitor } from '../session/heartbeat'
import { blockLevel, LevelMeter } from '../session/level'
import { keepScreenAwake, type ScreenLock } from '../session/wakeLock'
import { saveLog } from '../session/store'

/**
 * Owns the microphone, the audio graph and the recorder worker for one session.
 *
 * The topology is ADR-0003: the worklet captures and tags blocks with a sample
 * index, this class fans them out, the recorder worker writes them to OPFS, and
 * (later) an analysis worker gets a copy. The sample index comes from the
 * worklet and is never recomputed here, so a delayed or dropped message cannot
 * pull the recording and the event log out of alignment.
 *
 * Since ADR-0006 it also keeps the session alive-and-honest: a heartbeat every
 * few seconds comparing the audio clock against the wall clock, the log flushed
 * to storage each time, and a wake lock held for the duration. The flush is the
 * important half — without it a session the phone kills takes its own evidence
 * with it, which is the one case the log exists for.
 *
 * This layer is browser plumbing and is deliberately thin — it is a manual
 * device check, not a unit test (see CLAUDE.md). Everything with a decision in
 * it lives in the pure modules it calls.
 */

export interface HeartbeatView {
  sample: number
  driftMs: number
  elapsedWallMs: number
  wakeLock: boolean
  visibility: 'visible' | 'hidden'
  /** Held peak and latest RMS, 0-1 of full scale, and any clipping so far. */
  peak: number
  rms: number
  clipped: number
}

export interface CaptureCallbacks {
  /** Every captured block, for analysis. Called after the block is queued for writing. */
  onBlock?: (startSample: number, pcm: Int16Array) => void
  /** Each heartbeat, for the recording screen. Never the measurement. */
  onHeartbeat?: (view: HeartbeatView) => void
  onError?: (message: string) => void
}

/** How often the two clocks are compared, and the log flushed. ADR-0006. */
const HEARTBEAT_MS = 5000

export interface CaptureHandle {
  readonly log: SessionLog
  readonly sampleRate: number
  /** Samples captured so far — the session's clock. */
  currentSample(): number
  stop(): Promise<void>
}

/** What we ask the browser for. Processing is disabled by preference rather
 *  than necessity: measurement showed AGC, noise suppression and band-limiting
 *  to 3.4 kHz barely affect detection, because calibration runs through the
 *  same capture chain as operation. Asking for raw audio is still the right
 *  default, but a device that ignores it is not a reason to refuse to record. */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
}

export async function startCapture(
  meta: Omit<SessionMeta, 'sampleRate'>,
  callbacks: CaptureCallbacks = {},
): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS })
  const context = new AudioContext()
  const sampleRate = context.sampleRate

  const log = new SessionLog({ ...meta, sampleRate })
  let latestSample = 0

  const meter = new LevelMeter()
  const monitor = new HeartbeatMonitor(Date.now(), sampleRate, HEARTBEAT_MS)
  let wakeLockHeld = false
  const screenLock: ScreenLock = keepScreenAwake((held) => {
    wakeLockHeld = held
  })

  const worker = new Worker(new URL('../../workers/recorder.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.onmessage = (event: MessageEvent<{ type: string; message?: string }>) => {
    if (event.data.type === 'error') callbacks.onError?.(event.data.message ?? 'recorder failed')
  }
  worker.postMessage({ type: 'open', fileName: `${meta.id}.wav`, sampleRate })

  await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`)
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'capture-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
  })

  node.port.onmessage = (event: MessageEvent<{ startSample: number; pcm: Int16Array }>) => {
    const { startSample, pcm } = event.data
    latestSample = startSample + pcm.length

    // Recording first, always. Analysis gets a copy afterwards, so a slow or
    // throwing consumer cannot delay the write (ADR-0001).
    const forWriting = pcm.slice()
    worker.postMessage({ type: 'write', pcm: forWriting }, [forWriting.buffer])

    // Cheap, and it answers "is this phone hearing the bells at all" in the
    // tower rather than at home. Says nothing about striking.
    meter.push(blockLevel(pcm))

    try {
      callbacks.onBlock?.(startSample, pcm)
    } catch (error) {
      callbacks.onError?.(`analysis threw: ${String(error)}`)
    }
  }

  source.connect(node)

  // A background tab has its timers throttled, so heartbeats can arrive late or
  // stop entirely. That is not a problem to solve — it is signal. A late beat
  // still records the true elapsed wall time, and a run of missing beats with
  // no `ended` event afterwards is exactly what a killed session looks like.
  const beat = async () => {
    const now = Date.now()
    const visibility = document.visibilityState === 'visible' ? 'visible' : 'hidden'
    try {
      const reading = monitor.read(now, latestSample, { visibility, wakeLock: wakeLockHeld })
      log.heartbeat({
        sample: reading.sample,
        wallMs: reading.wallMs,
        driftMs: reading.driftMs,
        visibility: reading.visibility,
        wakeLock: reading.wakeLock,
      })
      callbacks.onHeartbeat?.({
        sample: reading.sample,
        driftMs: reading.driftMs,
        elapsedWallMs: reading.elapsedWallMs,
        wakeLock: reading.wakeLock,
        visibility: reading.visibility,
        peak: meter.peak,
        rms: meter.rms,
        clipped: meter.clipped,
      })
      // The flush is the point of the whole mechanism (ADR-0006): without it a
      // killed session loses its own account of being killed.
      await saveLog(log.toJSON())
    } catch (error) {
      // Never let the bookkeeping take down the recording (ADR-0001).
      callbacks.onError?.(`heartbeat failed: ${String(error)}`)
    }
  }
  const heartbeatTimer = setInterval(() => void beat(), HEARTBEAT_MS)

  return {
    log,
    sampleRate,
    currentSample: () => latestSample,
    async stop() {
      clearInterval(heartbeatTimer)
      await screenLock.release()
      node.port.postMessage('stop')
      node.port.onmessage = null
      source.disconnect()
      for (const track of stream.getTracks()) track.stop()
      await context.close()
      await new Promise<void>((resolve) => {
        const done = (event: MessageEvent<{ type: string }>) => {
          if (event.data.type === 'closed' || event.data.type === 'error') {
            worker.removeEventListener('message', done)
            resolve()
          }
        }
        worker.addEventListener('message', done)
        worker.postMessage({ type: 'close' })
        // Never hang the UI on a worker that has gone away — the recording is
        // already on disk bar the header patch, and a stuck stop button is how
        // someone force-quits mid-session and loses the lot.
        setTimeout(resolve, 4000)
      })
      worker.terminate()

      // Written last, once the audio is safely closed, so its presence means
      // the whole session completed rather than merely that stop was pressed.
      try {
        log.ended(latestSample)
        await saveLog(log.toJSON())
      } catch (error) {
        callbacks.onError?.(`could not write the end of the log: ${String(error)}`)
      }
    },
  }
}
