import { useEffect, useState } from 'react'
import { deleteSession, listSessions, readSessionFile, storageEstimate, type SessionSummary } from '../logic/session/store'

/**
 * The sessions on the phone, and how to get them off it.
 *
 * A session with an unreadable log is still listed and still exportable — a
 * practice that ended in a crash is exactly the one worth looking at, and
 * hiding it would be the app deciding on its own that data is worthless.
 */
export default function SessionList({ refreshKey }: { refreshKey: number }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [storage, setStorage] = useState<{ usedBytes: number; quotaBytes: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([listSessions(), storageEstimate()])
      .then(([list, estimate]) => {
        if (!live) return
        setSessions(list)
        setStorage(estimate)
      })
      .catch((cause) => live && setError(String(cause)))
    return () => {
      live = false
    }
  }, [refreshKey])

  const download = async (name: string) => {
    const file = await readSessionFile(name)
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  }

  if (error) return <section className="panel"><p className="error">Could not read sessions: {error}</p></section>
  if (!sessions) return <section className="panel"><p className="hint">Reading sessions…</p></section>

  return (
    <section className="panel">
      <h2>Sessions ({sessions.length})</h2>
      {storage && (
        <p className="hint">
          {formatBytes(storage.usedBytes)} used of {formatBytes(storage.quotaBytes)} available
        </p>
      )}
      {sessions.length === 0 && <p className="hint">Nothing recorded yet.</p>}
      <ul className="sessions">
        {sessions.map((session) => (
          <li key={session.id} className="session">
            <div className="session-head">
              <span className="session-id">{session.id}</span>
              <span className="session-size">{formatBytes(session.bytes)}</span>
            </div>
            <p className="session-detail">
              {session.log
                ? `${session.log.meta.tower} · bells ${session.log.meta.bells.join(' ')} · ${session.log.events.length} events`
                : session.problem ?? 'no log'}
            </p>
            <div className="session-actions">
              <button type="button" onClick={() => download(`${session.id}.wav`)}>Audio</button>
              {session.hasLog && (
                <button type="button" onClick={() => download(`${session.id}.json`)}>Log</button>
              )}
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  if (!confirm(`Delete ${session.id}? This cannot be undone.`)) return
                  await deleteSession(session.id)
                  setSessions((current) => current?.filter((s) => s.id !== session.id) ?? null)
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${(bytes / 1e3).toFixed(0)} kB`
}
