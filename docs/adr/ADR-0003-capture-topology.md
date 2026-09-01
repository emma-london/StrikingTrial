# ADR-0003 — Capture in the worklet, analysis in a worker, recording in a third thread

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Emma, Claude
- **Related:** ADR-0001, ADR-0002 (partially supersedes: §Decision's placement of the DSP)

## Context

ADR-0002 said the DSP core would run "inside an `AudioWorkletProcessor` on the
phone". Building it surfaced two things that were not considered when that was
written.

First, an `AudioWorklet` module is loaded by URL into a separate global scope
with its own module graph. Importing the DSP into it is possible but couples the
most safety-critical component in the app — the one that must never stop
recording — to bundler configuration and to module support in the worklet scope.

Second, and more importantly: ADR-0001 requires that a detector failure cannot
interrupt recording. If both live in the same worklet callback, a throw in the
detector is a throw in the audio callback. Even wrapped in `try`/`catch`, they
share a thread, a stack and a time budget, and the audio thread is the one place
in the browser where overrunning has immediate, unrecoverable consequences.

ADR-0002 did consider a worklet that "posts raw audio to the main thread for
analysis" and rejected it, correctly — the main thread renders and collects
garbage, and dropped blocks would corrupt the sample timeline. But it did not
consider posting to a *dedicated worker*, which has neither problem.

## Decision

Three threads, with the audio thread doing as little as possible:

1. **The AudioWorklet captures only.** It converts each 128-sample block to
   16-bit PCM, tags it with a running sample index, and posts it. No filtering,
   no detection, no allocation beyond the block it transfers. It has no imports,
   so nothing about the build can stop it running.
2. **A recorder worker writes to storage.** It appends PCM to an OPFS file
   through a synchronous access handle and patches the WAV header on close. It
   receives blocks directly and shares no state with anything else.
3. **An analysis worker runs the DSP.** It receives the same blocks, runs the
   unchanged core from `src/logic/dsp/`, and posts events back. If it dies, the
   other two are untouched and the session still produces a complete recording
   and log.

**The sample index originates in the worklet** and travels with every block.
Both consumers use it rather than counting for themselves, so a dropped or
delayed block cannot desynchronise the recording from the events.

ADR-0002's substantive decisions are unaffected: one DSP implementation, plain
TypeScript, no WASM, no I/O, block-size agnostic, tested against the Python. Only
*which thread it runs on* changes.

## Options considered

**DSP inside the audio worklet, as ADR-0002 said.** Lowest latency and no message
passing. Rejected on ADR-0001 grounds: it puts the component most likely to fail
on the thread least able to tolerate failure, and the latency it saves is
irrelevant — the budget is a 2-second row against a 165 ms target.

**Everything on the main thread.** Simplest. Rejected as in ADR-0002: rendering
and GC on the same thread as sample-accurate work.

**One worker for both recording and analysis.** Fewer moving parts. Rejected
because it re-creates the coupling this record exists to remove — a detector that
blocks or throws would sit between the audio and the disk.

**`MediaRecorder` for the recording path, worklet only for analysis.** Attractive:
the browser handles the file entirely. Rejected in ADR-0001 — Opus in WebM is
lossy, and there is no guarantee a decoded sample lines up with the index the
detector saw, which is the property the archive exists to provide.

## Consequences

**Easier.** The audio callback is trivial and hard to break. Analysis can be
killed and restarted mid-session without touching the recording. The analysis
worker is an ordinary module, so it is debuggable and testable like any other,
unlike worklet scope.

**Harder.** Three threads and two message channels to keep correct, and PCM
blocks are transferred rather than shared, so ownership has to be deliberate.
Analysis latency now depends on worker scheduling rather than being bounded by
the audio callback — acceptable given the budget, but it means an end-to-end
latency figure has to be measured on a real device rather than reasoned about.

**To revisit.** If a future stage genuinely needs sample-accurate feedback inside
the audio callback — a click track marking a bell's target slot, say — that stage
alone moves into the worklet, not the whole detector.
