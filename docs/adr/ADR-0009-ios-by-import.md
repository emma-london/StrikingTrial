# ADR-0009 — What iOS users get: record elsewhere, analyse here

- **Status:** Accepted. **The codec risk in this record is withdrawn, 22 Sep** —
  measured, and Voice Memos' default reads at 100%. See `docs/codec-test.md`.
- **Date:** 2026-09-19
- **Deciders:** Emma, Claude
- **Related:** ADR-0001 (instrument first — lossless archive), ADR-0005 (the
  striking layer is a pure function of the listing), ADR-0007 (where the recorder
  lives — this accepts its option C, for iOS), ADR-0008 (Android primary)

## Context

ADR-0008 made Android primary. Many ringers use iPhones, and ADR-0007 established
that iOS gives an installed web app no background capture and no route to a native
helper. The question is what an iPhone user gets.

Framing it as a "lower quality alternative" understates it, and the reason is
worth stating plainly because it changes what gets built.

**Everything this project has validated is post-hoc analysis of a file.** 99.56%
place agreement against BReNDA, the striking measure reproducing Emma's withheld
2 Sep ranking at +1.000, the Striking Report, Blow by Blow — every one of those
reads a recording that already exists. The live path is the unproven half. So
analysis-by-import is not a reduced version of the product; it is the part of the
product that works, delivered later.

And because ADR-0005 requires the striking layer to be a pure function of the
listing, **the report an iPhone user sees is identical, not degraded** — same
rows, same per-bell figures, same stroke split, same levels, same best stretch.

There is also an inversion worth noticing. Voice Memos is a native app with the
background audio mode; it cannot be killed by a battery manager and it does not
lose the microphone when the screen locks. An Android PWA can be killed and might
be. **So an iPhone recording from a pocket may be more reliable than Android
in-app capture.** iOS loses liveness. It does not obviously lose quality.

## Decision

**iOS users record in any recorder on the phone and import the file into the PWA,
which analyses it and shows the same report.**

1. **The PWA accepts an audio file** and decodes it with `decodeAudioData`, which
   handles AAC/m4a in both Safari and Chrome. It then runs the existing chain.
2. **The import form requires the facts the filename does not carry** — tower,
   bells ringing, and *whether the tenor covers*. Cover is **required, never
   defaulted**: `beam-cover-defect.md` cost a day to a default standing in for a
   fact nobody wrote down, and an import form is exactly where that happens again.
3. **The same path ships on Android**, not as a fallback but because it is how you
   analyse a recording made by anybody — including the whole-evening captures this
   project already works from — and because it is Tuesday's insurance if in-app
   capture dies in a pocket.
4. **It works on a desktop browser too**, with no install, which is where a tower
   captain is most likely to actually read a report.

## The codec risk — raised here, and withdrawn the same day

**This section originally claimed that Voice Memos' Compressed default was "AAC
at a low mono bitrate" and that the import path therefore reintroduced the lossy
audio ADR-0001 rejected. That was an unchecked assumption and it was wrong.**

Voice Memos' Compressed setting is about **64 kbps mono at 48 kHz**, and measured
on `260901_Beverley_6` it reads at **100% row and 100% place agreement** against
BReNDA, costing 2.5 ms of band RMS — the same order as `biascheck.py`'s own 5.5 ms
agreement floor. And every recording this project has ever analysed is already
compressed AAC, at 160 kbps from Samsung Voice Recorder. The question this section
raised had been answered by the project's own existence.

What stands in its place, from `docs/codec-test.md`:

- **Suggest Lossless, never require it.** Free accuracy for anyone who wants it;
  not a gate, and the app must not refuse a Compressed recording.
- **A warning below roughly 48 kbps**, because the import path takes a file from
  anywhere — one a messaging app re-encoded, an old recorder, a low-rate voice
  note. Silent above that.
- ADR-0001's objection was to `MediaRecorder` choosing the codec and bitrate for
  us, which ADR-0003 already settles by writing PCM from the worklet. It was never
  an argument against reading a file a phone recorder made.

## Options considered

**Nothing for iOS.** Rejected: the analysis works on a file, so withholding it
would be a choice rather than a limitation.

**A native iOS recorder of our own.** ADR-0007's option B. Rejected for now: App
Store review, a second app to install and maintain, and Voice Memos already does
the job. Revisit only if the capture manifest or format control turn out to
matter more than the cost.

**In-app capture on iOS with the screen awake and a wake lock.** Works, and stays
— it is the path for someone sitting out who can leave the phone visible. Rejected
as *the* iOS answer because it requires a spare person watching a screen, which a
band does not have.

**Ask users to convert to WAV before importing.** Rejected: it puts a desktop
step in front of volunteers. Better to decode whatever they have and be honest
about what it can support.

## Consequences

**Easier.** One analysis chain serves both platforms and the desktop. The iOS
story is a sentence — record, import, read the report — with no install required
at all. And a recording from anyone, on anything, becomes analysable, which is
where most of this project's future test data will come from.

**Harder.** The capture-time manifest becomes a form, and a form is where a wrong
cover flag gets entered. Codec quality becomes a thing the app has to judge and
talk about. And two paths into the analysis means two places the metadata can be
wrong.

**To revisit.** If the transcode experiment shows Compressed AAC is unusable and
users will not change the setting, this record weakens sharply and ADR-0007's
option B comes back — not for liveness, but simply to control the format.
