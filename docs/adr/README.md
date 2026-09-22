# Architecture Decision Records — Striking Trial

Format, numbering and lifecycle follow the family convention; see the
`ringing-apps` skill's `references/adr.md`. Records are numbered per repo, so the
next free number here is whatever follows the highest below. Cite records in this
repo as `ST-ADR-NNNN` when discussing them alongside the library's series
(`RL-ADR-NNNN`) or the app kit's (`RAK-NNNN`).

Each record carries Status, Date, Deciders, Related, Context, Decision, **Options
Considered** and Consequences. The options section is not optional — it is what
stops a decision being relitigated once the reasoning has faded.

Never delete or rewrite a superseded record. Mark it, link forward, and note the
supersession in the index below so someone scanning it can see what is still live
without opening every file.

## Index

| # | Title | Status | In short |
|---|---|---|---|
| [0001](ADR-0001-instrument-first.md) | Striking Trial is a data-collection instrument first | Accepted | Recording is independent of analysis and must never be at risk from it; everything is logged in the audio sample domain; the app refuses to display what it cannot verify. Built on the family stack, no `ringing-lib-ts` dependency yet. |
| [0002](ADR-0002-dsp-core.md) | The DSP core is plain TypeScript, shared by the worklet and Node | Accepted (placement partially superseded by 0003) | One implementation, no WASM, no I/O, block-size agnostic. Correctness anchored to the validated Python reference, not to its own output. Its placement of the DSP *in the AudioWorklet* is superseded by ADR-0003; everything else stands. |
| [0003](ADR-0003-capture-topology.md) | Capture in the worklet, analysis in a worker, recording in a third thread | Accepted | The audio callback captures only and has no imports; a recorder worker writes to OPFS; an analysis worker runs the DSP. A detector failure cannot reach the recording. The sample index originates in the worklet and travels with every block. |
| [0004](ADR-0004-declining-to-analyse.md) | Two ways of saying nothing, and never guessing instead | Accepted; **8 dB threshold withdrawn** | Makes ADR-0001's refusal concrete. "Not locked on" and "too rough to analyse" are separate states with separate messages — measured across nine recordings they barely correlate (r = −0.29). Striking quality is measured directly. The position-lead threshold was withdrawn the same day — it has since accepted two wrong answers at +8.1 and +10.4 dB. Where the two disagree, refusal wins. |

| [0005](ADR-0005-scoring-model-versioning.md) | A band's history must survive a change to the scoring model | Accepted | Three stamps on every stored performance — scoring version, reader version, ring — and three different kinds of break: a scoring change is fully recoverable by re-scoring, a reader change only if the audio was kept, a change of ring not at all. The stored artefact is the `.json` listing plus a capture-time manifest; 22 MB for two years against 9.1 GB of wav. Who rang which bell is offered from day one and never required — a years-long performance record of named individuals is the thing the app exists to avoid being. Old scoring models stay runnable; a history is re-scorable whole and keyed on band *and* ring. || [0006](ADR-0006-capture-liveness.md) | A session must leave evidence when it is killed | Accepted | The log was written only at `stop()`, so a session killed mid-practice lost its record — the failure we most need to measure destroyed its own evidence. Now: a heartbeat every few seconds carrying sample index, wall clock, their difference, visibility and wake-lock state; the log flushed to OPFS on every heartbeat; a clean stop recorded explicitly, so a log with no `ended` event *is* a session that died. Drift separates a *silenced* capture (timebase survives) from a *stopped* one (it does not). Read the shape, not the magnitude: a slope is oscillator mismatch, a step is a stall. |
| [0007](ADR-0007-where-the-recorder-lives.md) | Where the recorder lives | **Draft** | Should the recorder be native and the analysis a PWA? The axis is right — capture has a hard real-time requirement and a hostile platform story, analysis has neither — but splitting them across processes gives up the live path, which is a bigger decision than the packaging it arrives as. Notes a cheaper variant nobody had costed: the native recorder already exists (Samsung Voice Recorder), so the PWA importing a file it did not record gets the same architecture with no second app and no app store, and de-risks a scarce ringing night. Settled by Tuesday's heartbeat log and by whether the live path is worth keeping. |
| [0008](ADR-0008-android-primary.md) | Android is the primary platform | Accepted | Design questions are settled on what works on Android; iOS is best-effort and gets no workaround budget. Taken because treating both as binding let the more restrictive platform set the architecture for the other — three designs were proposed and abandoned in two days, none for any reason to do with ringing. Android-only features ship. iOS is not declared unsupported: record-and-report with the screen awake works there today, as does file import. The limitations are written up in `docs/ios-platform-limitations.md` and going to Apple; filing them is the response, engineering around them is not. |
| [0009](ADR-0009-ios-by-import.md) | What iOS users get: record elsewhere, analyse here | Accepted | iOS users record in any phone recorder and import the file; the PWA decodes it and runs the same chain. Not a reduced product — everything this project has validated is post-hoc analysis of a file, and ADR-0005 makes the striking layer a pure function of the listing, so the report is identical. Voice Memos is uninterruptible, so an iPhone pocket recording may beat Android in-app capture; iOS loses liveness, not quality. Ships on Android too. The codec risk raised in this record was **measured and withdrawn the same day** (`docs/codec-test.md`): Voice Memos' Compressed default is ~64 kbps and reads at 100% row and place agreement, and every recording this project has analysed was already 160 kbps AAC. Suggest Lossless, never require it; warn only below ~48 kbps. Cover is required at import, never defaulted. |


## Outstanding

- The tracker — locating blows without labels and holding row lock — is the known
  weak component and will want its own record once an approach is settled that
  works on more than one ring.
- **The blow/gap split is the top open problem**, ahead of the tracker. Only the
  whole-pull period is well constrained by the rhythm; the split between blow and
  gap is not, and which of two equally good fits the search lands on is close to
  arbitrary — a re-encode of the same audio flipped it. It is behind ADR-0004's
  withdrawn threshold, behind a partial-selection failure, and behind two
  unexplained low-confidence cases. Four attempted fixes have failed.
- Whether the app takes a `ringing-lib-ts` dependency, once method-aware analysis
  arrives.
