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

## E. Native recorder, a queue, PWA consumes the queue (Emma, 19 Sep)

Emma's sharper version of B: the native recorder is uninterruptible and writes to
a queue; the PWA reads the queue and, if it is interrupted, catches up. Lag in
delivering post-row feedback is acceptable — 100 ms does not matter.

The reasoning behind it is sound and the tolerance is correctly placed. It breaks
on a part of the stack that is not obvious from the design.

**Three claims in it, and the first two hold.** A native recorder is
uninterruptible: that is the whole native path and it is well supported. A queue
is trivial — a ring buffer or a run of files inside the native app, with the
sample index on every block exactly as ADR-0003 already does.

**The third does not: a PWA cannot read that queue live.** There is no transport.

- **No shared storage.** A PWA's storage is per-origin OPFS; a native app cannot
  write into it, and a PWA cannot read arbitrary device files without a user
  gesture per file. Chrome's directory picker, which would otherwise watch a
  folder, is desktop-only.
- **A local server in the native app is refused by Apple, explicitly.** Safari and
  WKWebView do not treat `localhost` as a trustworthy origin, so an HTTPS page
  cannot open `ws://localhost` or `http://localhost` — it is mixed content and it
  is blocked. Apple's own guidance on that thread is to use `WKScriptMessage`
  instead, which means the web content must be running inside *your* WebView.
  Chrome is narrowing the same route with a Local Network Access permission
  prompt.
- **Web Bluetooth, WebUSB and Web Serial** do not exist in iOS Safari.
- **A relay over the network** needs a network, and these apps are used in stone
  boxes with no signal.

So the only transport that works is putting the web app inside the native app's
WebView — **which is option D**. And once the web app is in a WebView, the
WebView can hold the microphone itself and the queue has nothing left to do.
**The live-queue design converges on Capacitor.**

**A second problem, independent of the transport.** "The PWA catches up after an
interruption" assumes the PWA is *running*. On iOS a backgrounded web app is
suspended, not throttled — no JavaScript executes at all. It does not catch up
100 ms late; it catches up when someone picks the phone up and looks at it. For a
post-row nudge that is not lag, it is absence.

**And the part that inverts the whole idea.** On Android, what keeps a
backgrounded PWA alive *is that it holds the microphone* — that is why Chrome runs
a foreground service and shows the persistent notification. Move the microphone
into a native app and the PWA loses the exemption that was keeping it alive.
**The split can make the PWA's survival worse than not splitting at all.** Media
playback also keeps a page alive, so a page could play silence to stay running;
that is a known hack and should be named as one rather than designed around.

**What E resolves into.** Usefully, it collapses the decision rather than adding
to it:

- For **record-and-report**, E is right in instinct and heavier than the job
  needs. There is no live consumer, so there is no queue — only a file at the
  end. That is **C**, and it works today with the recorder already on the phone.
- For **live feedback**, E is not available as native-plus-PWA, because the
  transport forces a WebView. That is **D**.

So the alternatives to a pure PWA are file handoff and Capacitor, and the middle
ground collapses into one or the other. That is worth knowing before any of it is
built.

**Not established:** whether Chrome on Android currently permits an HTTPS page to
reach `ws://localhost`. Chromium has historically treated localhost as
potentially trustworthy and is now adding a permission prompt. It does not change
the conclusion, because the design needs both platforms and iOS refuses.

## What would settle it

- Tuesday's heartbeat log (ADR-0006): whether a PWA survives a pocket on Android.
  If it does, A covers the Android majority and C covers iOS, and B loses most of
  its reason.
- The attribution-confidence experiment on existing recordings: whether live
  single-channel feedback can be trusted at all. If it cannot, giving up the live
  path costs nothing and B becomes cheap.
- Whether anyone other than Emma will install two apps. Not a technical question
  and the one most likely to decide it.
