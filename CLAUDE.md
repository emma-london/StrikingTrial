# Striking Trial — working notes

Read the `ringing-apps` skill first for the family-wide conventions. This file
is only what is specific to this app.

## Read the ADRs before changing anything structural

`docs/adr/ADR-0001` is the one that shapes everything: recording is independent
of analysis and must never be at risk from it, everything is timestamped in the
audio sample domain rather than wall-clock, and the app refuses to display what
it cannot verify. `ADR-0002` covers why the DSP is plain TypeScript with no WASM
and no I/O.

## The domain trap this app exists inside

**A wrong answer looks exactly like a right one.** A lit bell indicator and a row
of numbers are equally plausible whether the calibration beneath them is sound or
one blow out of alignment. During the analysis that led to this app, three
separate errors — a mis-set calibration window, an under-calibrated profile, and
a grid misaligned by exactly one blow — all produced confident, plausible output
and were all caught by a human noticing that a number looked wrong.

Two consequences to hold on to:

- **A self-consistent check proves nothing.** The identification test that missed
  the one-blow misalignment asked whether slot *n* classified as slot *n*, which
  is true under any global relabelling. Anchor checks to something outside the
  pipeline's own output.
- **The diagonal check is that anchor.** Compute the onset gain at each bell's
  published nominal for each detected slot, and confirm the maximum lands on the
  diagonal. It needs only Dove's nominals, it costs a few lines, and it caught
  every one of the three errors on its first outing. It gates any per-bell
  display; do not let a change route around it.

Note the failure modes it distinguishes, because they have different fixes: one
slot pointing at a neighbour is a local confusion; several slots sharing a
constant offset is a phase error; a growing offset is drift.

## The DSP core

`src/logic/dsp/` is pure computation — no `AudioContext`, no `fetch`, no DOM — so
the same code runs in the AudioWorklet, in Vitest, and in offline replay. Keep it
that way; an import of anything browser-specific in there breaks the property the
whole testing approach depends on.

Every stage carries its state explicitly and processes any block length. The
worklet delivers 128 samples; tests deliver whole files. **A stage that only
works at one block size passes every other test and fails in a tower** — there is
a block-size invariance test for each stage and new stages need one too.

Everything is `Float64Array` internally. The cutoffs are very low relative to the
sample rate (20 Hz at 22.05 kHz is 0.0018 of Nyquist), which puts the filter
poles close to the unit circle where Float32 loses meaningful precision.

## Tests here are anchored to the Python, not to themselves

`fixtures.json` is generated from SciPy and from the Python prototype that was
validated against BReNDA's strike times on real recordings. Regenerating it from
this code's own output would turn every test into a snapshot and destroy the
point of them.

Two lessons already paid for in this repo:

- **Assert relative error, not absolute, across a response that spans orders of
  magnitude.** The first version of the impulse-response test compared 64 samples
  with an absolute tolerance. At a 20 Hz cutoff the response is still ~1e-9 after
  64 samples — shorter than the filter's ~176-sample time constant — so a filter
  with no pre-warping at all passed. Mutation-checking found it.
- **Round fixtures to significant digits, not decimal places.** `round(v, 10)` on
  an envelope value of 3e-7 leaves 5e-11 of error, which swamps a 1e-6 relative
  tolerance and produces a failure that looks like a real disagreement.

Mutation-check anything numerical: break the implementation deliberately, confirm
the test goes red for the right reason, revert. It has already caught one test in
this repo that looked solid and wasn't.

## Commands

```bash
npm run dev         # dev server on :5182 (5173 Call Change, 5181 Methodical)
npm test
npm run build       # tsc -b type-checks the tests too, then vite build
npm run lint
```

## Three threads, and which one must never break

ADR-0003: the AudioWorklet captures only (Int16 conversion, sample index,
transfer out), a recorder worker writes WAV to OPFS, and an analysis worker runs
the DSP. The audio callback has no imports and no dependencies so nothing about
the build can stop it running, and a detector failure cannot reach the recording.

**The sample index originates in the worklet** and travels with every block.
Nothing downstream recounts — that is what keeps the recording and the event log
aligned when a message is delayed or dropped.

## Browser plumbing is a manual device check

`src/logic/audio/capture.ts`, the worklet, and the workers are not unit-tested:
jsdom has no AudioWorklet, no OPFS sync access handles and no getUserMedia, so a
passing test there would be false confidence. They are verified by running the
production build in Chromium with a fake audio device:

```bash
npm run build && npx vite preview --port 4321 --strictPort
# then drive it with Playwright using
#   --use-fake-ui-for-media-stream
#   --use-fake-device-for-media-stream
#   --use-file-for-fake-audio-capture=<a real ringing wav>%noloop
```

That test is worth keeping in the habit: it feeds a genuine Eltham recording
through getUserMedia, the worklet and the worker, pulls the WAV back out of OPFS
and checks the bells' partials are present at the right levels. It caught nothing
yet, but it is the only check that covers the path the whole app depends on.

## Not yet built

The tower profile store, the live bell indicator, the row display, and the
tracker. The tracker is the known-unreliable piece — two implementations each
work on the ring they were built for and fail on the other — so treat any row
output as provisional until that changes.
