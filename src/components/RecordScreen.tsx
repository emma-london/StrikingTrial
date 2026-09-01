import { useCallback, useRef, useState } from 'react'
import { startCapture, type CaptureHandle } from '../logic/audio/capture'
import { saveLog } from '../logic/session/store'
import type { ProfileSource } from '../logic/session/sessionLog'

/**
 * Setting up and running one recording.
 *
 * Two things shape this screen. It is read at arm's length by someone sitting
 * out at a practice, so the controls are large and the state is legible from
 * across a ringing chamber. And ADR-0001's rule that the recording is the
 * app's first duty means the stop button must always work — every failure path
 * here still ends with the file closed.
 */

const ELTHAM_BELLS = [1, 2, 3, 4, 5, 6, 7, 8]

interface Props {
  onFinished: () => void
}

export default function RecordScreen({ onFinished }: Props) {
  const [tower, setTower] = useState('Eltham St John')
  const [bells, setBells] = useState<number[]>([3, 4, 5, 6, 7, 8])
  const [method, setMethod] = useState('')
  const [position, setPosition] = useState('')
  const [profileSource, setProfileSource] = useState<ProfileSource>('stored')
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [markers, setMarkers] = useState(0)
  const [blocks, setBlocks] = useState(0)
  const handle = useRef<CaptureHandle | null>(null)

  const toggleBell = (bell: number) =>
    setBells((current) =>
      current.includes(bell) ? current.filter((b) => b !== bell) : [...current, bell].sort((a, b) => a - b),
    )

  const start = useCallback(async () => {
    setError(null)
    try {
      const id = `${slug(tower)}-${new Date().toISOString().replace(/[:.]/g, '-')}`
      handle.current = await startCapture(
        {
          id,
          startedAtIso: new Date().toISOString(),
          tower,
          bells,
          profileSource,
          method: method || undefined,
          position: position || undefined,
        },
        {
          onBlock: () => setBlocks((n) => n + 1),
          onError: (message) => setError(message),
        },
      )
      setMarkers(0)
      setBlocks(0)
      setRecording(true)
    } catch (cause) {
      setError(
        `Could not start recording: ${String(cause)}. Check the microphone permission and try again.`,
      )
    }
  }, [tower, bells, method, position, profileSource])

  const stop = useCallback(async () => {
    const current = handle.current
    if (!current) return
    setRecording(false)
    try {
      await current.stop()
      await saveLog(current.log.toJSON())
    } catch (cause) {
      // The audio is already on disk; say so rather than implying it is lost.
      setError(`Recording saved, but writing the log failed: ${String(cause)}`)
    }
    handle.current = null
    onFinished()
  }, [onFinished])

  const mark = useCallback(() => {
    const current = handle.current
    if (!current) return
    current.log.marker(current.currentSample(), 'sounded-wrong')
    setMarkers((n) => n + 1)
  }, [])

  if (recording) {
    return (
      <section className="panel recording">
        <p className="rec-state" role="status">
          <span className="rec-dot" aria-hidden="true" /> Recording
        </p>
        <p className="rec-detail">
          {tower} · bells {bells.join(' ')} · {blocks.toLocaleString()} blocks captured
        </p>
        <button type="button" className="mark-button" onClick={mark}>
          That sounded wrong
          {markers > 0 && <span className="mark-count">{markers} marked</span>}
        </button>
        <button type="button" className="stop-button" onClick={stop}>
          Stop and save
        </button>
        {error && <p className="error">{error}</p>}
      </section>
    )
  }

  return (
    <section className="panel">
      <h2>New session</h2>

      <label className="field">
        <span>Tower</span>
        <input value={tower} onChange={(e) => setTower(e.target.value)} />
      </label>

      <fieldset className="field">
        <legend>Bells ringing</legend>
        <p className="hint">
          Numbered as the ring numbers them. The back six of an eight are bells 3–8.
        </p>
        <div className="bell-row">
          {ELTHAM_BELLS.map((bell) => (
            <button
              key={bell}
              type="button"
              className={bells.includes(bell) ? 'bell on' : 'bell'}
              aria-pressed={bells.includes(bell)}
              onClick={() => toggleBell(bell)}
            >
              {bell}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span>What is being rung (optional)</span>
        <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Bob Doubles" />
      </label>

      <label className="field">
        <span>Where the phone is (optional)</span>
        <input
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          placeholder="window sill, north side"
        />
      </label>

      <fieldset className="field">
        <legend>Bell frequencies</legend>
        <div className="segmented">
          {(['stored', 'learned'] as const).map((source) => (
            <button
              key={source}
              type="button"
              className={profileSource === source ? 'seg on' : 'seg'}
              aria-pressed={profileSource === source}
              onClick={() => setProfileSource(source)}
            >
              {source === 'stored' ? 'Use stored' : 'Learn from rounds'}
            </button>
          ))}
        </div>
      </fieldset>

      <button type="button" className="record-button" onClick={start} disabled={bells.length < 3}>
        Start recording
      </button>
      {bells.length < 3 && <p className="hint">Choose at least three bells.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
