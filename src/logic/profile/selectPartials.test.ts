import { describe, expect, it } from 'vitest'
import eltham from './eltham.json'
import { loadProfile, selectPartials, unheardBells } from './selectPartials'

/**
 * `reference` in `eltham.json` is a **regression pin, not an oracle**. It is the
 * same selection rule written a second time, in `prototype/makeprofile.py`,
 * computed from the values that script stores. It catches this code changing its
 * answer when nobody meant it to; it cannot catch the rule being wrong, because
 * both sides implement the same rule. What says the rule is any good is the
 * striking accuracy it produced on the Eltham recording, measured in the Python
 * prototype.
 *
 * Two things it does establish, both learned the hard way. It compares **bins**,
 * not rounded frequencies, so a disagreement is a disagreement rather than a
 * display artefact. And it is regenerable — `makeprofile.py` rebuilds the profile
 * and the reference together from the measured spectrum, so when the two sides
 * differ it is possible to find out why. The first version of this fixture was a
 * shell one-liner that was not kept, and a mismatch in the leakage window
 * (±21.5 Hz against ±20) was mistaken for a rounding problem for some time.
 */

const PROFILE = loadProfile(eltham)

describe('selectPartials', () => {
  it('reproduces the reference selection for the back six', () => {
    const chosen = selectPartials(PROFILE, [3, 4, 5, 6, 7, 8])
    for (const [bell, expected] of Object.entries(eltham.reference.backSix)) {
      const got = chosen.get(Number(bell))
      expect(got, `bell ${bell}`).toBeDefined()
      expect(got!.map((p) => p.bin), `bell ${bell}`).toEqual(expected.map(([bin]) => bin))
      expect(got!.map((p) => Math.round(p.marginDb * 100) / 100), `bell ${bell} margins`).toEqual(
        expected.map(([, , margin]) => margin),
      )
    }
  })

  it('reproduces the reference selection for a different set of bells', () => {
    // The point of recomputing per session: a different ringing set is a
    // different problem, not the same answer with rows removed.
    const chosen = selectPartials(PROFILE, [5, 6, 7, 8])
    for (const [bell, expected] of Object.entries(eltham.reference.backFour)) {
      expect(chosen.get(Number(bell))!.map((p) => p.bin), `bell ${bell}`).toEqual(
        expected.map(([bin]) => bin),
      )
    }
  })

  it('changes its answer when the set of bells changes', () => {
    // The justification for recomputing per session. If this ever stops being
    // true, the recompute is unnecessary and should go.
    const six = selectPartials(PROFILE, [3, 4, 5, 6, 7, 8])
    const four = selectPartials(PROFILE, [5, 6, 7, 8])
    const differing = [5, 6, 7, 8].filter(
      (bell) =>
        JSON.stringify(six.get(bell)!.map((p) => p.frequencyHz)) !==
        JSON.stringify(four.get(bell)!.map((p) => p.frequencyHz)),
    )
    expect(differing.length).toBeGreaterThan(0)
  })

  it('never gives two bells the same frequency', () => {
    // Two bells listening on one partial cannot tell each other apart, and the
    // failure looks like a plausible confusion rather than a bug.
    const chosen = selectPartials(PROFILE, [3, 4, 5, 6, 7, 8])
    const seen: { bell: number; hz: number }[] = []
    for (const [bell, partials] of chosen) {
      for (const p of partials) {
        for (const other of seen) {
          if (other.bell !== bell) {
            expect(Math.abs(other.hz - p.frequencyHz), `bell ${bell} vs ${other.bell}`).toBeGreaterThan(20)
          }
        }
        seen.push({ bell, hz: p.frequencyHz })
      }
    }
  })

  it('reports bells it has no measurements for rather than inventing any', () => {
    // Eltham's front two have never been recorded. Guessing their partials from
    // the ladder would produce a confident, wrong answer — exactly the failure
    // this project keeps meeting.
    const chosen = selectPartials(PROFILE, [1, 2, 3, 4, 5, 6, 7, 8])
    expect(chosen.has(1)).toBe(false)
    expect(chosen.has(2)).toBe(false)
    expect(chosen.get(8)).toBeDefined()
  })

  it('drops a bell whose every partial is buried, rather than listening on noise', () => {
    // No Eltham bell is floor-limited, so without this the floor could be deleted
    // and every other test would still pass — checked by mutation.
    //
    // Two bells, three bins. The quiet one has a partial that is loud in its own
    // right but sits under the loud one, so its margin is negative: exactly the
    // case where a channel would report the wrong bell with confidence.
    const grid = { startHz: 1000, stepHz: 5, count: 3 }
    const profile = loadProfile({
      tower: 'X',
      envelope: grid,
      bells: {
        '1': { partials: [1], envelope: [0, 30, 0] },
        '2': { partials: [1], envelope: [0, 20, 0] },
      },
    })
    const chosen = selectPartials(profile, [1, 2])
    expect(chosen.has(1)).toBe(true)
    expect(chosen.has(2)).toBe(false)
    expect(unheardBells(profile, [1, 2], chosen)).toEqual([{ bell: 2, reason: 'drowned-out' }])

    // Ring only the quiet bell and it is perfectly audible. Which is the whole
    // argument for choosing partials per session rather than storing them.
    const alone = selectPartials(profile, [2])
    expect(alone.get(2)!.map((p) => p.bin)).toEqual([1])
  })

  it('tells a bell that was never recorded apart from one that is drowned out', () => {
    // They look identical on screen — a bell with no indicator — and have
    // completely different fixes: record it, versus ring a different set.
    const chosen = selectPartials(PROFILE, [1, 2, 3, 4, 5, 6, 7, 8])
    expect(unheardBells(PROFILE, [1, 2, 3, 4, 5, 6, 7, 8], chosen)).toEqual([
      { bell: 1, reason: 'not-measured' },
      { bell: 2, reason: 'not-measured' },
    ])
  })

  it('orders each bell best-margin first', () => {
    // The channel sums whatever it is given, so if fewer partials are wanted the
    // caller takes a prefix. That only works if the best come first.
    for (const partials of selectPartials(PROFILE, [3, 4, 5, 6, 7, 8]).values()) {
      const margins = partials.map((p) => p.marginDb)
      expect(margins).toEqual([...margins].sort((a, b) => b - a))
    }
  })
})

describe('loadProfile', () => {
  it('rejects a profile with an unusable partial list', () => {
    const grid = { startHz: 350, stepHz: 5.383, count: 3 }
    const bell = (partials: unknown, envelope: unknown = [1, 2, 3]) => ({
      tower: 'X',
      envelope: grid,
      bells: { '1': { partials, envelope } },
    })
    // A bin off the end of the grid reads `undefined` as a gain and scores NaN,
    // which sorts as "not better than anything" and silently drops the partial.
    expect(() => loadProfile(bell([3]))).toThrow(/grid/i)
    expect(() => loadProfile(bell([-1]))).toThrow(/grid/i)
    expect(() => loadProfile(bell([1.5]))).toThrow(/grid/i)
    // Partials with no envelope would score every candidate against nothing.
    expect(() => loadProfile(bell([1], []))).toThrow(/envelope/i)
    expect(() => loadProfile({ tower: 'X', envelope: grid, bells: {} })).toThrow(/no bells/i)
    expect(() => loadProfile({ tower: 'X', bells: { '1': { partials: [] } } })).toThrow(/grid/i)
    // An envelope of the wrong length would silently misalign every margin.
    expect(() => loadProfile(bell([], [1, 2]))).toThrow(/envelope/i)
    expect(() => loadProfile(null)).toThrow()
  })
})
