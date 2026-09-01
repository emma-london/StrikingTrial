/// <reference lib="webworker" />
/**
 * Writes captured PCM to an OPFS file as a WAV, and nothing else (ADR-0003).
 *
 * OPFS synchronous access handles are only available inside a worker, which is
 * the immediate reason this thread exists. The better reason is isolation: this
 * is the path that must survive anything the detector does.
 *
 * The WAV header is written first with zero sizes and patched on close, because
 * the length is not known until the session ends.
 */
import { WAV_HEADER_BYTES, wavHeader } from '../logic/audio/wav'

type Incoming =
  | { type: 'open'; fileName: string; sampleRate: number }
  | { type: 'write'; pcm: Int16Array }
  | { type: 'close' }

let handle: FileSystemSyncAccessHandle | null = null
let sampleRate = 48000
let dataBytes = 0

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const message = event.data
  try {
    if (message.type === 'open') {
      sampleRate = message.sampleRate
      dataBytes = 0
      const root = await navigator.storage.getDirectory()
      const recordings = await root.getDirectoryHandle('recordings', { create: true })
      const file = await recordings.getFileHandle(message.fileName, { create: true })
      handle = await file.createSyncAccessHandle()
      handle.truncate(0)
      handle.write(new Uint8Array(wavHeader(sampleRate, 0)), { at: 0 })
      self.postMessage({ type: 'opened' })
      return
    }

    if (message.type === 'write') {
      if (!handle) return
      const bytes = new Uint8Array(message.pcm.buffer, message.pcm.byteOffset, message.pcm.byteLength)
      handle.write(bytes, { at: WAV_HEADER_BYTES + dataBytes })
      dataBytes += bytes.byteLength
      return
    }

    if (message.type === 'close') {
      if (!handle) return
      // Patch the sizes now the length is known, then flush before releasing —
      // an unflushed handle can leave a file that plays as silence.
      handle.write(new Uint8Array(wavHeader(sampleRate, dataBytes)), { at: 0 })
      handle.flush()
      handle.close()
      handle = null
      self.postMessage({ type: 'closed', dataBytes })
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) })
  }
}
