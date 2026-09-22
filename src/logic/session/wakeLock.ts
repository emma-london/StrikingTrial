/**
 * Holding the screen awake for the length of a recording.
 *
 * On iOS this is the difference between recording and not: a web app is
 * suspended the moment the screen locks, and there is no background audio mode
 * available to an installed web app (ADR-0009, docs/platform-question.md). On
 * Android it matters less and is still worth having.
 *
 * Two things shape this module. **The lock is dropped by the browser whenever
 * the page is hidden** and does not come back on its own, so it has to be
 * re-requested on `visibilitychange`. And **it can fail silently** — an
 * unsupported browser, a denied permission, a low-power mode — so the app
 * records whether the lock is *actually held* rather than whether it was asked
 * for. That distinction is the reason `wakeLock` is a field on every heartbeat
 * (ADR-0006): an instrument does not assume.
 *
 * Everything here is best-effort by design. A wake lock that cannot be had must
 * never stop a recording starting or continuing — ADR-0001 puts the recording
 * first, and the screen going to sleep is a worse recording, not a failed one.
 */

/** The parts of the Screen Wake Lock API this uses, declared locally so the
 *  build does not depend on which DOM lib version is in play. */
interface WakeLockSentinelLike {
  released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

function api(): WakeLockLike | null {
  const candidate = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
  return candidate && typeof candidate.request === 'function' ? candidate : null
}

export interface ScreenLock {
  /** Whether the lock is held *now* — not whether it was requested. */
  held(): boolean
  /** Stop re-acquiring and let the screen sleep again. Safe to call twice. */
  release(): Promise<void>
}

/** Is there any point offering this in the UI? */
export function wakeLockSupported(): boolean {
  return api() !== null
}

/**
 * Request the screen wake lock and keep re-requesting it for the session.
 *
 * Resolves as soon as the first attempt has been made, whether or not it
 * succeeded — the caller is starting a recording and must not be blocked on a
 * convenience. Ask `held()` for the truth at any moment.
 */
export function keepScreenAwake(onChange?: (held: boolean) => void): ScreenLock {
  const wakeLock = api()
  let sentinel: WakeLockSentinelLike | null = null
  let wanted = true

  const announce = () => onChange?.(sentinel !== null && !sentinel.released)

  const acquire = async () => {
    if (!wanted || !wakeLock || document.visibilityState !== 'visible') return
    if (sentinel && !sentinel.released) return
    try {
      const next = await wakeLock.request('screen')
      if (!wanted) {
        // Released while the request was in flight; do not leave one held.
        await next.release().catch(() => {})
        return
      }
      sentinel = next
      // The browser drops the lock when the page hides and fires this. Keeping
      // the flag honest matters more than re-acquiring, because the heartbeat
      // reads it.
      next.addEventListener('release', announce)
      announce()
    } catch {
      // Unsupported, denied, or refused in a low-power mode. Not an error the
      // ringer can act on, and never a reason to stop recording.
      sentinel = null
      announce()
    }
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') void acquire()
    else announce()
  }

  document.addEventListener('visibilitychange', onVisibility)
  void acquire()

  return {
    held: () => sentinel !== null && !sentinel.released,
    async release() {
      wanted = false
      document.removeEventListener('visibilitychange', onVisibility)
      const current = sentinel
      sentinel = null
      announce()
      if (current && !current.released) await current.release().catch(() => {})
    },
  }
}
