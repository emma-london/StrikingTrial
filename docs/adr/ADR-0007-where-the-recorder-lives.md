# ADR-0007 — Where the recorder lives

- **Status:** Draft — partly settled. **Option C is accepted for iOS by
  ADR-0009**; the live-path question that decides option B remains open.
- **Date:** 2026-09-19
- **Deciders:** Emma, Claude
- **Related:** ADR-0001 (instrument first), ADR-0003 (capture topology), ADR-0006
  (capture liveness), `../../../docs/platform-question.md`

## Context

`platform-question.md` established that a PWA cannot hold the microphone in the
background on iOS and probably can on Android, and that the native mechanisms
that would fix it — `UIBackgroundModes: audio`, a `microphone` foreground
service — are unavailable to a web app by construction.

Emma's question, 19 Sep: **should the recorder be native and the analysis stay a
PWA**, on the grounds that analysis tolerates lag and capture does not?

The reasoning is right and it is the correct axis to split on. Capture has a hard
real-time requirement and a hostile platform story; analysis has neither. Putting
each where it is comfortable is the obvious move.

What this record is for is the part underneath it: **splitting the recorder out
of the browser is a decision to give up live analysis**, and that is a larger
decision than the packaging it arrives as. If the microphone is in one process
and the DSP in another, there is no live path — no bell indicator, no in-touch
feedback, no report going up as the band stands down. ADR-0003's whole topology
exists to carry a capture-time sample index from the worklet to the analysis
worker, and across a process boundary that index becomes an offset in a file.

There is also a cheaper version of the same architecture that nobody has costed:
**the native recorder already exists.** Emma records on Samsung Voice Recorder
today, it is exempt from the battery manager that is the Android risk, and it has
held 1h30 without trouble. The two-tier split does not require the native tier to
be *ours*.

## Options considered

**A. PWA only.** One app, no app stores, install by visiting a URL — the family's
whole deploy story. Live analysis stays possible because the microphone and the
DSP are in the same process. Costs: no pocket on iOS ever; probably a pocket on
Android, unmeasured until Tuesday.

**B. Our own native recorder plus the analysis PWA.** Pocket and locked screen on
both platforms, and a capture-time manifest (tower, bells, cover, who rang what —
ST-ADR-0005) collected at the moment of recording where it is most accurate.
Costs: two apps a ringer must install and we must keep in step; App Store review
including the 2.5.4 conversation about background audio for recording; Play Store
review; a signing and release cadence per change, against the PWA's push-and-done.
And the live path goes.

**C. The analysis PWA imports a file from whatever recorder the phone already
has.** Same architecture as B with the native tier already shipped by Samsung or
Apple. Pocket and locked screen work today on both platforms. No second app, no
stores, no release cadence. Costs: the capture manifest is typed into the PWA at
import rather than captured live, the audio format and sample rate are the other
app's choice, and the live path goes.

**D. A native shell around the same web app (Capacitor).** One codebase, one
install, background capture, live path intact. Costs: both app stores, and the
GitHub Pages deploy story is gone. Noted in `platform-question.md` as the escape
hatch; a bigger change than it looks and not required by anything yet.

## Where this points, pending Tuesday

**A and C are not alternatives, and doing both is small.** The PWA already records
(ADR-0003) and already reads WAV (`src/logic/audio/wav.ts`); accepting a file it
did not record itself is a file input and a decode path, not an architecture.
Doing it has a specific, immediate value beyond the design: **it de-risks
Tuesday.** If the PWA dies in Emma's pocket, she falls back to Voice Recorder and
imports the file, and a scarce ringing night still produces a recording instead of
a null result. Ringing nights being scarce is the constraint that started this.

**C is B's interface, so C first is not a dead end.** An analysis PWA that reads a
recording it did not make has exactly the same seam whether the recorder is
Samsung's or ours. If we later want the capture manifest or control of the format
badly enough to pay for an app store, B is an upgrade behind an interface that is
already there and already exercised.

**So the real question B has to answer is not "should the recorder be native" but
"is the live path worth keeping".** That is item 2 on the project's list and it is
open on design grounds — the ringer's 500–800 ms window, what a ringer can absorb
mid-pull, and the attribution-confidence measurement that has not been done. B
should not be taken while that is open, because B decides it by accident.

## What would settle it

- Tuesday's heartbeat log (ADR-0006): whether a PWA survives a pocket on Android.
  If it does, A covers the Android majority and C covers iOS, and B loses most of
  its reason.
- The attribution-confidence experiment on existing recordings: whether live
  single-channel feedback can be trusted at all. If it cannot, giving up the live
  path costs nothing and B becomes cheap.
- Whether anyone other than Emma will install two apps. Not a technical question
  and the one most likely to decide it.
