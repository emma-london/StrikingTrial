# ADR-0004 — Two ways of saying nothing, and never guessing instead

- **Status:** Accepted; **the 8 dB threshold is withdrawn** — see §Correction
- **Date:** 2026-09-02 (corrected the same day)
- **Deciders:** Emma, Claude
- **Related:** ADR-0001 (makes concrete its "refuses to display what it cannot verify")

## Correction, same day

The decision below stands. **The number does not.**

When this was written, the position lead had never accepted a wrong answer: nine
genuine locks at 5.8 dB and above, twenty-seven negatives at 6.7 and below. Two
further cases have since come in above the proposed 8 dB threshold and been
wrong:

- a re-encoded copy of a recording that had been read correctly, identified a
  blow out at **+8.1 dB**;
- a recording under a different onset-detector setting, wrong at **+10.4 dB**.

So the gate does produce false accepts, and the specific claim in §Consequences —
"seven of eight accepted, none of the negatives" — was true of the sample and is
not true of the mechanism. No threshold on this signal is safe until the cause
below is fixed. Until then the app should not display per-bell output on the
strength of the position lead alone.

The cause is the one §Consequences already named as unexplained: only the
whole-pull period is well determined by the rhythm, and the split between blow
period and handstroke gap is not. Two fits with the same whole pull match the
onsets about equally well, and which one the search lands on is close to
arbitrary — a re-encode of the same audio was enough to flip it, from 317 ms +
159 ms to 295 ms + 398 ms. Both explain the timing; one is right.

Four attempts to resolve it have failed, all recorded in `prototype/phase.py`:
narrowing the gap ratio to the measured range (made two recordings confidently
wrong), scoring the predicted gap for silence (9/9 to 7/9), robust re-fitting
after snapping to onsets (no material change), and tuning the onset refractory
period (changes which recordings break, not whether they break). Four failures
against one cause is evidence about the approach, not the parameters.

Two things follow. This is now the **top open problem**, ahead of the tracker,
because a wrong grid poisons everything downstream — it was also behind the
partial-selection failure described in `night-two-validated.md`. And any future
threshold has to be validated against deliberately perturbed inputs — re-encodes,
trims, different detector settings — not only against different recordings, since
both false accepts came from perturbation rather than from new ringing.

## Context

ADR-0001 says the app refuses to display what it cannot verify. It does not say
what verification consists of, or what the app shows instead. Nine labelled
recordings — Eltham's back six, two nights, seven methods — now make both
answerable, and they show the question has two parts, not one.

**The app can fail to identify the bells.** The row phase is chosen by lining each
position in the opening rounds up with its own bell's published nominal. That
choice can be confident or barely-there, and the difference is measurable before
anything is displayed: take the alignments grouped by position-within-row, and see
how far the winning group beats the next. Across the nine, that lead is 12.5–15.9
dB where the ringing is ordinary, and 0.0–6.7 dB in 27 controls run mid-touch
where there are no rounds to find at all.

**The ringing can be too rough to be worth analysing, independently of that.** One
of the nine was a beginners' piece — people going wrong repeatedly, bells clashing
even in rounds, unreliable handstroke leads. It measures worst of the nine on
every count: 79.7 ms RMS deviation from each row's fitted grid (26.6% of a blow),
a 1.6% clash rate against 0.1–0.2% for the good pieces, and 113 ms of variability
in the handstroke gap. Emma's judgement, given independently and before seeing
these numbers, was that striking that bad is not reasonable to analyse and the app
should give up.

These two are not the same thing and do not track each other. The correlation
between striking roughness and identification confidence across the nine is only
r = −0.29. The recording with the *best* striking of all nine is also the one the
identification gate is least sure about.

There is one more reason to separate them. The striking-quality ranking these
measures produce was checked against Emma's own, formed before she saw it and
withheld deliberately so the test would be blind. They agreed, including on which
of two attempts at the same method was the better. That is the only check in this
project so far anchored to something outside both the pipeline and BReNDA, and it
is evidence about the striking measure specifically — not about the identification
confidence, which nothing external has yet corroborated.

## Decision

**1. Two refusal states, never merged into one.**

- *Not locked on* — the app cannot say which bell is which. Cause: it could not
  find rounds, or found them ambiguously. What a ringer can do: ring some rounds,
  or check the right bells are selected.
- *Too rough to analyse* — the app knows which bell is which, and the striking is
  outside the range where per-blow feedback means anything. What a ringer can do:
  nothing about the app; the answer is about the ringing.

They have different causes and different remedies, so they get different words on
screen. Collapsing them into one "no data" state would tell a band their app is
broken when it is working perfectly.

**2. Identification is gated on the position lead**, measured before any display,
and the app shows per-bell output only above the threshold.

**3. Striking quality is measured directly**, not inferred from identification
confidence: RMS deviation from each row's fitted grid, clash rate, and handstroke
gap variability. All three need only the blow grid, which the app already has, and
no labels.

**4. Where the two disagree, refusal wins.** Declining a correct answer costs a
ringer one touch of feedback. Accepting a wrong one puts a plausible, confident,
false row on the screen — the failure mode this whole project is organised
around, and the one a ringer cannot detect by looking.

## Options considered

**Always display, with a confidence indicator.** Simple, and it keeps the app
useful on marginal ringing. Rejected: a wrong answer looks exactly like a right
one, and a confidence badge does not stop someone reading the row underneath it.
The three errors during the feasibility analysis were all caught by a human
noticing a number looked wrong — a ringer in a tower has no such opportunity.

**One combined quality score.** Fewer concepts. Rejected: the two states have
different causes, different remedies and different messages, and the data says
they barely correlate. A single number would average an identification failure
together with good ringing and report something true of neither.

**Gate on BReNDA-style confidence.** BReNDA emits a per-blow confidence and it is
a reasonable signal. Rejected because it is not available: it comes from an
offline analysis with the whole recording in hand, which is the thing this app
exists not to require.

**Use the diagonal check as the gate.** It was the anchor throughout the
feasibility work and caught every error. Rejected because it now *picks* the row
phase, so it can no longer also validate it — a check you optimise cannot fail
informatively. This is why the position lead, which is a property of the
optimisation landscape rather than of the chosen answer, is used instead.

**Let the striking-quality measure gate identification too.** Tempting, given the
beginners' piece was worst on both. Rejected on the evidence: r = −0.29, and the
best-struck recording of the nine is among the least confidently identified.

## Consequences

**The app will sometimes decline ringing it could have analysed.** On the nine, a
threshold of 8 dB accepts seven of the eight worth analysing. The one it turns
away has the best striking of the set — a correct answer refused. That is the
asymmetry in §Decision 4 working as intended, and it is the cost of it.

**Beginners get no per-blow feedback on their worst ringing.** Deliberate, and
Emma's call. Wrong feedback is worse than none, and "too rough to analyse" is
itself information a band can act on — provided the app says that rather than
failing silently, which is what §Decision 1 exists to guarantee.

**The thresholds are provisional and must not be read as settled.** They come from
one band, at one tower, on two nights, and the 8 dB figure is quoted against the
same nine recordings it was chosen on. They want re-measuring on another tower and
another band before they are trusted, and the handstroke gap in particular varies
more than the textbook "one blow's worth" — measured 0.68 to 1.03 of a blow across
this band alone, and Emma notes it is often smaller than a blow in practice.

**One thing is unexplained and should not be tidied away.** The best-struck
recording's low identification confidence has the same mechanical signature as the
beginners' piece — a fitted handstroke gap well above the true one — without the
bad ringing to justify it. The blow/gap split is under-determined by the current
fit: only their sum, the whole-pull period, is well constrained. Two attempts to
resolve it (narrowing the allowed gap range to the measured one; scoring the
predicted gap for silence) each made the phase *worse* across the set, one of them
producing a confidently wrong answer. Better onset precision is the likely fix.
Until then this record's threshold is doing work that a better grid fit should be
doing instead.

**To revisit** when the tracker is settled, and when a second tower exists. If the
blow/gap split becomes determinable, the identification threshold should be
re-derived rather than carried over — it is calibrated against a weakness, and
removing the weakness changes what it means.
