# ST-ADR-0005 — A band's history must survive a change to the scoring model

**Status:** Accepted
**Date:** 16 September 2026
**Deciders:** Emma
**Related:** ST-ADR-0001 (instrument first), ST-ADR-0004 (declining to analyse);
`docs/the-striking-measure.md`, `docs/leads.md`, `docs/trust.md` in the project folder

## Context

The point of this app is that a band uses it week after week and gets better. That
makes the history the product, not the individual report. Emma:

> Let's say a band has been using our app to improve their striking over a couple of
> years and we change the scoring model — all that data is trashed and they lose their
> progress.

The scoring model **will** change. It has changed three times in four days: the
leverage correction at the ends of a row roughly doubled every number; the lead
measure added a figure that did not exist; capping faults per row and charging
declined rows changed the band's headline again. Each was a correction, each was
right, and each would have broken a two-year history if one had existed.

The naive protection — keep the audio — does not scale. One three-minute piece of
ringing:

| | size |
|---|---|
| wav | 17.5 MB |
| m4a | 3.0 MB |
| listing, `.json` | 43 KB |
| listing, `.rows.txt` | 8.2 KB |

A band ringing weekly, five pieces a practice, for two years is about 520 pieces:
**9.1 GB of wav, 1.6 GB of m4a, or 22 MB of listings.**

Emma's own framing, and the phrase that this record exists to make precise:

> We also need to store enough information so that we can go back and re-score old
> performances against the new model. NB "enough information" does some heavy lifting
> here.

## Decision

**1. Two version numbers, not one.** Every stored performance is stamped with a
`reader` version (audio → rows) and a `scoring` version (rows → faults). They change
independently and they are not equally recoverable, which is the substance of this
record.

**2. The stored artefact is the listing, plus a manifest.** The `.json` listing —
per-bell blow times, stroke, holes, the rhythm, the reader's own confidence — is what
is kept. Beside it a small manifest that cannot be reconstructed later:

- tower and ring, and the profile version used
- date, and what was rung (method, plain course or touch)
- who rang which bell — **optional, and partial is allowed**
- the level the band was reporting at
- the reader version, and the coverage it achieved
- a hash of the source audio

*Who rang which bell* is the field least recoverable afterwards: without it a two-year
history is about bells rather than ringers, and half its value is gone. So the capture
UI must offer it from day one — but **never require it**, and it must accept two names
and four blanks.

Three reasons it is optional rather than required, and the third is the important one.
It is friction at exactly the wrong moment, with the band stood waiting. Visitors and
learners come and go, so it is often only partly knowable. And a record of who rang
which bell, with fault counts, kept for years, is a performance record of named
individuals — which is the precise thing that makes ringers defensive, and the thing
this whole design is arranged to avoid. A band must be able to have the striking
history without the personal one.

So: attribution is the band's to give and the band's to withdraw. Deleting the names
from a stored performance must leave the striking data intact, and a history must
remain coherent when some performances carry names and some do not. Nothing in the
scoring may depend on it.

**3. Any performance can be re-scored under any scoring version, and old scoring
models stay runnable.** The striking layer is a pure function of the listing — it
reads nothing else, and that is now a constraint rather than an accident. Keeping an
old model is keeping a small module.

**4. A history states which scoring version drew it, and can be re-scored whole.**
Mixing versions on one chart is the failure this record prevents. "Re-score everything
under the current model" is the operation that preserves a band's progress across a
model change, and it must be one action.

**5. A reader change is not retrospective, and is marked rather than hidden.** The
listing freezes the reading. A better reader cannot be applied to a listing, only to
audio. So a history that spans a reader change carries a discontinuity, and the app
says so on the chart rather than drawing a smooth line through it.

**6. A history belongs to a band *and* a ring.** Emma, 16 Sep: a band that has built
up a long history cannot expect it to work at a brand new tower without calibration.
Uncommon, and it happens — a competition, an outing, a move.

Three distinct things break, and only the first is obvious:

- **The reader does not work there at all** until the tower has a profile. That is
  settled already (no cold bootstrap, 3 Sep) and is a hard stop rather than a history
  problem.
- **The ringing is not the same difficulty.** More bells, a heavier ring, a bell that
  is odd struck — all change what the same band can achieve. A history would show a
  decline that belongs entirely to the tower. The number of bells also changes the
  fault cap and the measure's own variance by place.
- **The acoustics change the coverage, and since 16 Sep coverage feeds the band's
  score.** Declined rows are charged, so a tower where the reader hears less produces
  a worse figure for identical ringing. This is the fairness problem of ST-ADR-0004's
  refusal, moved onto the space axis.

So a history is keyed on band *and* ring. Changing ring starts a new series. A
cross-ring comparison may be *shown* — a band will want to see the competition against
their practices — but it is marked, with what differs stated: the number of bells,
whether the reader was calibrated there, and the coverage achieved.

Deliberately **not** doing: normalising a score for the tower. It is an uncommon case,
the correction would be invented rather than measured, and a wrong normalisation is
worse than a marked break. Detect and say so; that is the whole fix.

**7. Keeping the audio is offered, not default, and its purpose is stated.** It buys
exactly one thing: the ability to re-read a performance when the reader improves. At
3 MB an m4a a band that wants that protection can have it; a band that does not should
not be made to carry 1.6 GB for it.

## Options considered

**Store only the computed scores.** Smallest, and the option that loses everything the
moment the model moves. Rejected — this is precisely the failure the record exists to
prevent.

**Store the audio for every performance.** Total protection, including against reader
changes. Rejected as the default on size (9.1 GB of wav or 1.6 GB of m4a for two
years, on a phone) and because it is unnecessary for the common case, which is a
scoring change. Retained as an option under decision 6.

**Store an intermediate representation richer than the listing** — the per-bell
feature map, say. Rejected twice over: it is the same order of size as the audio, and
it only helps the *reader*, which is the layer whose improvements usually change the
features too. It would be storing something large to protect against the one thing it
cannot protect against.

**Normalise scores across towers**, so a history follows a band wherever they ring.
Rejected: the correction would have to be invented, there is no data to fit it to, and
a band told their striking improved when they moved to an easier ring is being misled
by a number that looks authoritative. Marking the break costs nothing and lies about
nothing.

**Require the ringers' names**, so every history is a per-ringer history. Rejected on
all three grounds in decision 2 — friction, knowability, and that it turns a striking
record into a performance record of named people, which is what the app exists to
avoid being.

**Version the scoring model only, and treat the reader as fixed.** Simpler, and false.
The reader is the part of this project most actively under change. Pretending
otherwise puts a silent discontinuity in a band's history, which is worse than a
marked one.

**Freeze the scoring model instead.** Rejected on the evidence: three corrections in
four days, all of them right. Freezing would have locked in a measure that called the
ends of a row the best-struck places.

## Consequences

- Storage is a non-issue: 22 MB for two years of a weekly band. This decision costs
  almost nothing and is only expensive if taken late.
- The manifest is a **capture-time** requirement. Who rang what, the tower, the piece
  and the level must be collected when the recording is made. This lands on the
  capture UI before a band starts a history, not after.
- The striking layer must stay a pure function of the listing. It is today
  (`faults.py` opens one file and nothing else); this makes it a rule.
- The bar on the reader rises. A listing is only worth keeping if it will not need
  re-reading, which is Emma's own caveat — "as long as we're confident they are
  accurate and we won't need to re-evaluate them a year or two down the road". The
  reader is at 99.56% of claimed places on the labelled six-bell set and has never
  been tested on ten. **A band should not begin a history at a tower where the reader
  has not been checked by ear.**
- Coverage travels with every stored performance, because a comparison between two
  performances read to different depths is not a fair one (ST-ADR-0004's refusal,
  applied along the time axis). Since declined rows are charged, this now bites
  harder: coverage is part of the score, so a change of tower, microphone or phone
  position moves the figure without the ringing changing.
- **Three axes, three different kinds of break.** A stored performance carries a
  scoring version, a reader version and a ring. A scoring change is fully recoverable
  — re-score. A reader change is recoverable only if the audio was kept. A change of
  ring is not recoverable at all, because it is a different instrument. Each needs its
  own mark on a history and they should not be conflated in the UI.
- `.rows.txt` is not sufficient on its own: it rounds to three decimals and drops the
  reader's confidence and the rhythm. It stays the human-readable form; the `.json`
  is the record.
