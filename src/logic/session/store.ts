import { parseSessionLog, type StoredSessionLog } from './sessionLog'

/**
 * Sessions on disk: a WAV and a JSON log per session, in OPFS.
 *
 * OPFS rather than IndexedDB because the recorder worker streams into it
 * through a synchronous access handle, so a half-hour recording never has to be
 * held in memory. It is also per-origin and survives reloads and crashes, which
 * matters when the thing being protected is the only copy of a practice night.
 *
 * Everything here is defensive. A session directory may hold a WAV whose header
 * was never patched because the app was killed mid-recording, or a log that was
 * half-written. Neither may take out the list — a broken session must still be
 * visible and exportable, because it is still evidence.
 */

export interface SessionSummary {
  id: string
  bytes: number
  hasLog: boolean
  /** Present when the log parsed; absent for a session that ended badly. */
  log?: StoredSessionLog
  problem?: string
}

const DIR = 'recordings'

async function dir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(DIR, { create: true })
}

export async function saveLog(log: StoredSessionLog): Promise<void> {
  const handle = await (await dir()).getFileHandle(`${log.meta.id}.json`, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(log, null, 2))
  await writable.close()
}

export async function listSessions(): Promise<SessionSummary[]> {
  const handle = await dir()
  const wavs = new Map<string, number>()
  const logs = new Set<string>()

  // @ts-expect-error - entries() is present on OPFS directory handles but is
  // missing from the DOM lib at this TypeScript version.
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file') continue
    if (name.endsWith('.wav')) wavs.set(name.slice(0, -4), (await entry.getFile()).size)
    if (name.endsWith('.json')) logs.add(name.slice(0, -5))
  }

  const summaries: SessionSummary[] = []
  for (const [id, bytes] of wavs) {
    const summary: SessionSummary = { id, bytes, hasLog: logs.has(id) }
    if (summary.hasLog) {
      try {
        const file = await (await handle.getFileHandle(`${id}.json`)).getFile()
        summary.log = parseSessionLog(JSON.parse(await file.text()))
      } catch (error) {
        // A session with an unreadable log is still worth listing and exporting.
        summary.problem = `log unreadable: ${String(error)}`
      }
    }
    summaries.push(summary)
  }
  return summaries.sort((a, b) => (a.id < b.id ? 1 : -1))
}

export async function readSessionFile(name: string): Promise<File> {
  return (await (await dir()).getFileHandle(name)).getFile()
}

export async function deleteSession(id: string): Promise<void> {
  const handle = await dir()
  for (const name of [`${id}.wav`, `${id}.json`]) {
    try {
      await handle.removeEntry(name)
    } catch {
      // Already gone, which is the desired end state anyway.
    }
  }
}

/** Rough size on disk, so the UI can warn before storage runs out mid-practice. */
export async function storageEstimate(): Promise<{ usedBytes: number; quotaBytes: number }> {
  const estimate = await navigator.storage.estimate()
  return { usedBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0 }
}
