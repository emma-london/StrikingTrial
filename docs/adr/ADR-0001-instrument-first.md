# ADR-0001 — Striking Trial is a data-collection instrument first

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Emma, Claude
- **Related:** ADR-0002 (DSP core placement)

## Context

A day of analysis established that real-time striking detection is possible:
97–100% bell attribution and ~14 ms timing on a light six, 87–96% on the hardest
heavy twelve available. It also established that the **tracker** — locating blows
without labels and holding row lock across a touch — is not reliable. Two
implementations each work on the ring they were built for and fail on the other.

Tower time is the binding constraint. Emma reaches a tower once or twice a week;
a wasted practice costs days. Towers are also stone boxes with no usable data
connection, and the ringer using this app is sitting out rather than ringing, so
they can watch but not operate it.

The other constraint is one this project has already been bitten by, three times
in a day. **A wrong answer here looks exactly like a right one.** Rows of numbers
and bell indicators render perfectly plausibly whether or not the underlying
calibration is sound. Every one of the three errors was found by a human noticing
a number looked odd, not by any check in the pipeline.

## Decision

**The app's first duty is to bring home the audio.** Analysis is secondary and
may fail without the trip being wasted.

Three things follow, and they are the load-bearing part of this record:

1. **Recording is independent of analysis.** Capture writes to storage on a path
   that shares no state with the detector. A detector crash, a calibration
   failure or a tracker losing lock must not be able to interrupt or corrupt the
   recording. Everything the app computes is derived from audio it has already
   safely stored.

2. **Everything is logged in the audio sample domain, not wall-clock.** Detection
   events, session markers and user feedback taps all carry a sample index. An
   offline re-run of a later algorithm can then be diffed against what the phone
   actually decided, exactly aligned. Wall-clock timestamps drift against the
   audio clock and make that diff worthless.

3. **The app refuses to display what it cannot verify.** Before any per-bell
   output is shown, the calibration is checked by computing onset gain at each
   bell's published nominal for each detected slot and confirming the maximum
   lands on the diagonal. If it does not, the app shows that it is not confident
   rather than showing bells and rows. Confident nonsense is worse than a blank
   panel, because it is what gets believed and acted on.

Built on the family stack: Vite, React, TypeScript, Vitest, an installable PWA
with a real service worker, deployed to GitHub Pages at `/StrikingTrial/`, using
the shared design tokens. See the `ringing-apps` skill.

**No `ringing-lib-ts` dependency yet.** The trial app has no method logic — it
detects and displays. Adding the dependency before there is anything to import
buys nothing and couples the app to a release cycle it does not need. This will
change when method-aware analysis arrives; that is a later ADR.

## Options considered

**Analysis-first, recording as a by-product.** The obvious shape for an app whose
point is detection, and how most audio apps are built. Rejected because it makes
the most valuable output — a labelled recording — hostage to the least reliable
component. With one tower visit a week, a detector crash that also loses the
audio costs a week.

**Wall-clock timestamps.** Simpler, and adequate for showing something live.
Rejected because the whole value of the archive is re-running future algorithms
against it and comparing with what the phone did. That comparison needs sample
alignment; a few tens of milliseconds of clock drift destroys it, and the drift
is invisible until you rely on it.

**Show detections always, with a confidence number beside them.** Considered
seriously — more information is usually better, and Emma explicitly asked for the
row display knowing the tracker is unreliable. Rejected as the *default* because
a confidence figure next to a plausible-looking row is not read; the row is. The
compromise adopted: the display is built and shown, but the diagonal check gates
it, and lock loss is displayed as a state rather than degraded silently.

**Native app for guaranteed raw audio access.** Rejected: measurement showed the
detector is essentially unaffected by AGC, noise suppression, or band-limiting to
3.4 kHz, because calibration runs through the same capture chain as operation and
the partial selection adapts. The signal-quality argument for going native
evaporated, and Emma's toolchain and the rest of the family are TypeScript.

## Consequences

**Easier.** Every practice produces a usable artefact regardless of how the
analysis behaves. The archive accumulates test cases, so algorithm work stops
being gated on tower access. Offline-first falls out of the family conventions
rather than needing separate thought.

**Harder.** Two storage paths to keep correct rather than one. The sample-domain
discipline has to be maintained everywhere, including in the UI layer where
wall-clock is the natural thing to reach for. The calibration gate means the app
will sometimes show nothing while appearing to work, which needs designing so it
reads as a considered state and not as a bug.

**To revisit.** Once the tracker is dependable on more than one ring, the gate
becomes less load-bearing and the balance between showing and withholding should
be reconsidered. Revisit also when method-aware analysis arrives and the library
dependency starts to earn its place.
