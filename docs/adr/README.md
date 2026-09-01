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

## Outstanding

- The tracker — locating blows without labels and holding row lock — is the known
  weak component and will want its own record once an approach is settled that
  works on more than one ring.
- Whether the app takes a `ringing-lib-ts` dependency, once method-aware analysis
  arrives.
