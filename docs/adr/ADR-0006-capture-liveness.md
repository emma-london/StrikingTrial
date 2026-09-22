# ADR-0006 — A session must leave evidence when it is killed

- **Status:** Accepted
- **Date:** 2026-09-19
- **Deciders:** Emma, Claude
- **Related:** ADR-0001 (instrument first), ADR-0003 (capture topology)

## Context

`../../../docs/platform-question.md` established that the Striking App, being a
PWA, has neither `UIBackgroundModes` nor an Android foreground service of its
own. On iOS that settles it: capture stops when the app is backgrounded or the
screen locks, and a home-screen web app has no `Info.plist` to change it. On
Android it does not: Chrome holds the foreground service on a capturing page's
behalf, and whether that survives a locked screen, a pocket, Doze and Samsung's
battery manager for ninety minutes is unknown to us.

Emma is taking the app ringing to find out, and ringing nights are the scarce
resource — a missed one costs a week.

Which surfaced the defect this record is really about. **The session log is held
in memory and written to OPFS once, by `saveLog()` at `stop()`.** If the app is
killed, the log is lost. The WAV survives, because the recorder worker streams it
through a sync access handle, but its header was never patched and it carries no
account of itself. So the app's evidence of being killed is destroyed by being
killed, and the one measurement Tuesday exists to make is the one that cannot
survive its own result.

ADR-0001 says this app is a data-collection instrument before it is anything
else. An instrument that loses its record precisely when something interesting
happens is not one.

## Decision

**1. A heartbeat event, on the session's own timeline.** Every few seconds the
app records a `heartbeat` carrying the sample index, the wall clock, the
difference between them, `document.visibilityState`, and whether the screen wake
lock is held. It goes through `SessionLog` like everything else, so it is ordered
by sample index with the rest (ADR-0001).

**2. The log is flushed to OPFS on every heartbeat, not only at `stop()`.** At one
heartbeat every five seconds, ninety minutes is about a thousand events — a small
JSON rewrite against a recorder worker already streaming megabytes. The cost is
not worth the evidence it buys.

**3. A clean stop is recorded explicitly.** The log ends with an `ended` event
when the user stops. **A log with no `ended` event is a session that died**, and
its last heartbeat says when, at what sample, and in what visibility and
wake-lock state. That is the test result, and it reads itself.

**4. The measurement is wall clock against the sample clock.** `driftMs` is
elapsed wall-clock minus elapsed audio. If capture never stalls they track; if it
stalls they separate by exactly the amount lost. This also distinguishes the two
Android failure modes `platform-question.md` cannot currently tell apart: audio
going flat while the sample count keeps up is a *silenced* capture, where the
timebase survives and a noise-floor detector is the right fix; the sample count
falling behind is a *stopped* capture, where the timebase does not survive and
every row after the gap is misplaced.

**5. The shape of the drift series matters, not its magnitude.** An
`AudioContext`'s real sample rate differs slightly from its nominal one, so a
steady slope is expected — 0.01% is over half a second across ninety minutes and
means nothing. **A slope is oscillator mismatch; a step is a stall.** This is why
the whole series is kept rather than a summary figure, and why nothing in the app
is allowed to reduce it to a single number.

**6. The screen wake lock is acquired, re-acquired and logged rather than
assumed.** Held from start to stop, re-acquired on `visibilitychange` because
browsers drop it when a page is hidden, and its actual state written into every
heartbeat. On iOS it is the difference between recording and not; everywhere it
is a thing that can silently fail, and an instrument does not assume.

## Options considered

**Leave the log in memory and save at stop, as now.** No change, no write during
recording. Rejected: it loses the record in exactly the case the record is for,
and the app cannot then tell a session that was killed from one nobody stopped
properly.

**Write every event to OPFS as it happens.** Simplest rule, no flush policy.
Rejected: strike events will eventually arrive several a second, and a whole-file
rewrite per event would contend with the recorder worker for the same storage
while the audio path is the thing that must never be at risk (ADR-0001).

**A separate heartbeat file.** Keeps the session log clean. Rejected: two files
to reconcile and two orderings to trust, when `SessionLog`'s sample-indexed
ordering already gives one timeline — and the heartbeat's whole value is sitting
on the same timeline as the strikes.

**Use the growing WAV as the liveness record and add nothing.** Genuinely
attractive: the file is already on disk and its length already says how much
audio arrived. Rejected because length alone cannot place the loss in time. A
recording ten minutes short is equally consistent with stopping ten minutes early
and with stalling for ten minutes in the middle, and those have different causes
and different fixes.

**Wall-clock timestamps on every event.** Rejected under ADR-0001 — the sample
index is the timeline and must stay so. The heartbeat is the single deliberate
exception: it is the one place the two clocks are compared on purpose, which is
why it is its own event kind rather than a field on the others.

## Consequences

**Easier.** A killed session now reports itself, so Tuesday needs no apparatus
beyond the app. The same instrument answers the battery manager, the screen-off
question and the silenced-versus-stopped question from one recording. And the
session list can say "this session ended unexpectedly after 47 minutes" instead
of showing a short recording that looks like a short practice.

**Harder.** There is now a writer touching OPFS during capture. It is on the main
thread and off the audio path, which is where ADR-0003 requires it to be, but it
is new contention and it wants watching on a long session.

**To revisit.** Rewriting the whole log per heartbeat is fine at a thousand
events and will not be when strikes are in it. That is the point to move to an
append-only log rather than to reduce the heartbeat rate — the heartbeat rate is
a measurement parameter and should not be traded for a storage one.
