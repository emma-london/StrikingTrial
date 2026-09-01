# Striking Trial

Records tower bell ringing and analyses the striking — which bell struck, and
when — from audio alone, on an ordinary phone, in real time.

Part of the [ringing apps](https://github.com/emma-london) family, alongside
[Methodical](https://emma-london.github.io/MethodicalApp/) and
[Call Change Trainer](https://emma-london.github.io/CallChangeTrainer/).

**Status: early. Nothing is deployed yet.** The signal-processing core is built
and tested; capture and the displays are in progress. The name says "trial"
because that is what this is — an instrument for collecting data and finding out
whether the approach holds up in real towers.

## What it is for

Existing striking analysis — [HawkEar](https://hawkear.app/) and
[BReNDA](https://brenda.oekrice.com/) — works on a recording after the event.
This aims to do it live, so a ringer sitting out can see whether the app agrees
with what they just heard, and so a band could eventually get feedback within
the touch rather than afterwards.

The immediate job is narrower: go to a practice, record everything, and find out
how much of the analysis survives contact with a real ringing chamber.

## How it works

Each bell is identified by three or four of its **partials** — not its nominal,
which is usually the worst choice. A ring is tuned to a scale and a bell's
partials sit at near-fixed ratios to its nominal, so partials of different bells
land on top of each other by design: at Eltham the 4th's nominal is exactly the
tenor's superquint, because 8 to 4 is a fifth. What matters is *margin* — how far
a partial clears anything any other bell produces nearby — and selecting on
measured margin puts every bell on a different rung of the ladder.

Each chosen partial becomes a narrowband envelope by complex demodulation. A bell
striking shows up as a rise in its own channels. Timing comes from the rise;
identity comes from the pattern across all channels.

Two facts about change ringing then do more work than any signal processing: a
bell cannot strike twice in a row, so a row is a permutation and is solved as
one; and physics limits a bell to moving at most one place between rows, which
links the rows into a sequence. Together those take per-blow attribution from
about 96% to 100% on a clean touch.

Measured on real recordings against BReNDA's strike times: ~14 ms timing IQR and
97–100% attribution on a light six, 87–96% on a heavy twelve.

## Development

```bash
npm install
npm run dev         # dev server on :5182
npm test            # run the suite once
npm run test:watch  # while developing
npm run build       # type-check (incl. tests) + production build
npm run lint
```

Node 22+ — pinned in `.nvmrc`, declared in `engines`, read by CI from
`.nvmrc`. `.npmrc` sets `engine-strict=true` so a wrong Node fails at install
with a clear message rather than deep inside a dependency later.

## Layout

| Path | What is there |
|---|---|
| `src/logic/dsp/` | The signal-processing core. No I/O, no DOM, no `AudioContext` — the same code runs in the AudioWorklet, in tests, and in offline replay. |
| `docs/adr/` | Architecture decision records. Read `ADR-0001` first; it explains why recording is built before analysis and kept independent of it. |

## A note on the tests

The fixtures in `src/logic/dsp/fixtures.json` come from SciPy and from a Python
prototype validated against BReNDA's strike times on real recordings. They are an
external oracle — the tests check this code against something known to be true,
not against what it happens to produce.

That matters more here than usual. In this domain **a wrong answer looks exactly
like a right one**: a bell indicator lighting up and a row of numbers render
perfectly plausibly whether or not the calibration underneath is sound. Three
separate errors during the analysis phase were all caught by a human noticing a
figure looked odd, not by any automatic check. Hence `ADR-0001`'s rule that the
app refuses to display what it cannot verify.
