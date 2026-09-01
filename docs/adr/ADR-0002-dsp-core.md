# ADR-0002 — The DSP core is plain TypeScript, shared by the worklet and Node

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Emma, Claude
- **Related:** ADR-0001

## Context

The detector is a bank of narrowband channels: for each bell, three or four
partials extracted by causal complex demodulation — multiply by a complex
exponential, low-pass with a causal Butterworth, take the magnitude — summed into
one envelope per bell, then a rise-over-baseline onset function and a feature
vector for identification.

Measured cost is about 792 floating-point operations per input sample for twelve
bells at four partials: 17.5 MFLOP/s at 22.05 kHz, under 1% of one phone core.
Compute is not a constraint. The constraint is *fidelity between environments*.

The algorithm will be iterated on for months against an archive of recordings,
while also running live on a phone. If the offline harness and the phone are two
implementations, every discrepancy between them costs a tower visit to diagnose —
and with one visit a week, that is the most expensive kind of bug this project
can have. Today's work produced three errors, all of which took a human noticing
an odd number to find; a second implementation is a fourth place for that class
of error to hide.

## Decision

**One DSP implementation, in plain TypeScript, with no environment-specific
code.** It lives in `src/logic/dsp/`, takes and returns typed arrays, and does no
I/O — no `AudioContext`, no `fetch`, no DOM.

That single module is used in three places without modification:

- inside an `AudioWorkletProcessor` on the phone, fed 128-sample blocks
- in Vitest, fed fixture arrays
- in a Node replay script, fed decoded WAV, for re-running the archive

**No WASM.** The arithmetic is IIR filtering and magnitudes; a hand-written
TypeScript loop over `Float32Array` is comfortably fast enough at 17.5 MFLOP/s,
and WASM would add a build step, a debugging boundary, and a second language for
a speedup nobody needs.

**Block-size agnostic and state-carrying.** Every stage holds its state
explicitly and processes any block length, because the worklet delivers 128
samples and the tests deliver whole files. A stage that only works at one block
size will pass every test and fail in the tower.

**Correctness is anchored to the Python.** The existing Python prototype is the
reference implementation, validated against BReNDA's strike times on real
recordings. The TypeScript is tested against fixture vectors generated from it —
filter impulse and step responses, envelope traces, onset times on real audio —
rather than against its own output. Per the family's testing rules, a snapshot of
what the TypeScript currently produces would prove nothing.

## Options considered

**Rust or C compiled to WASM.** The conventional answer for real-time audio DSP,
and genuinely faster. Rejected: the speed is not needed, and it would put the
part of the system most in need of rapid iteration behind a compile step and a
language boundary. It also splits debugging across two toolchains at the exact
point where today's bugs have all been subtle numerical ones.

**Keep Python as the offline harness and write TypeScript separately for the
phone.** The path of least immediate effort, since the Python already works.
Rejected for the reason in Context: two implementations of a numerically fiddly
algorithm will diverge, and the divergence will be discovered in a tower.

**Use the Web Audio graph's own `BiquadFilterNode` for the filterbank.** Native,
fast, no code. Rejected: the node gives no access to its internal state, cannot
be run outside a browser, and its coefficient computation is not specified to the
precision needed to reproduce a run offline. It would make the phone and the
harness structurally incapable of agreeing.

**A worklet that posts raw audio to the main thread for analysis.** Simpler than
running DSP in the worklet. Rejected: it puts the detector on a thread that
garbage-collects and renders, and dropped blocks corrupt the sample-domain
timeline that ADR-0001 depends on.

## Consequences

**Easier.** An algorithm change is one edit, tested offline against the archive
and shipped to the phone with no port. The Node replay script and the phone
cannot disagree, so a discrepancy between a tower session and an offline re-run
means real audio differences rather than an implementation gap.

**Harder.** The DSP is written in a language with no numeric array idioms, so it
is loops over `Float32Array` and reads more verbosely than the Python. Filter
coefficients must be computed rather than lifted from SciPy, and that computation
is itself something to test.

**To revisit.** If a future stage genuinely needs more compute — a
simultaneous-onset fit across all bells, say — measure first, and only then
consider WASM for that stage alone rather than for the whole core.
