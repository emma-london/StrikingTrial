/**
 * Choosing which frequencies to listen on.
 *
 * A tower profile stores, per bell, every partial that showed a useful onset
 * gain when that bell struck. It deliberately does **not** store which partials
 * to use, because that is not a property of the bell — it depends on which
 * bells are ringing.
 *
 * Eltham makes the point concretely. Its treble's nominal is 1600 Hz, exactly
 * twice the tenor's 800, so it lands on the tenor's octave nominal; the second
 * at 1500 is exactly 1.5 x 1000, landing on the sixth's superquint. Adding those
 * two bells breaks six of the eighteen partials chosen for the back six, and the
 * sixth loses all three of its. A profile that baked in "these are bell 6's
 * frequencies" would be quietly wrong every time the band rings on eight.
 *
 * So selection happens per session, once the ringing set is known.
 *
 * The score is `min(gain, margin)`: a partial must both be loud when its bell
 * strikes *and* clear of anything any other bell puts within a filter bandwidth.
 * Optimising gain alone picks the nominal, which is usually the worst choice —
 * a ring is tuned to a scale and the partial ladder is built from small whole
 * number ratios, so partials of different bells coincide by design.
 */

export interface MeasuredPartial {
  /**
   * Index into the shared frequency grid.
   *
   * A partial is stored as a bin rather than as a frequency-and-gain pair, and
   * both of those are read back from the grid and the envelope. Storing the gain
   * separately meant storing the same measurement twice, and the two copies were
   * rounded differently — a partial's gain disagreed in the third digit with the
   * envelope value the interference was computed from.
   */
  bin: number
  frequencyHz: number
  /** How far the band rises, in dB, when this bell strikes. */
  gainDb: number
}

export interface BellProfile {
  bell: number
  /** Measured from a recording; null when this bell has never been recorded. */
  nominalHz: number | null
  /** Published nominal, used by the calibration check. */
  doveNominalHz: number | null
  /** The peaks this bell can be listened to on. */
  partials: MeasuredPartial[]
  /**
   * The bell's whole measured gain curve, on the shared frequency grid.
   *
   * Interference is computed against this rather than against other bells'
   * peaks, because energy that is not a local maximum still swamps a channel —
   * a broad shoulder from a neighbouring bell interferes exactly as much as a
   * peak would. Comparing peaks to peaks over-estimates every margin.
   */
  envelope: number[]
}

export interface FrequencyGrid {
  startHz: number
  stepHz: number
  count: number
}

export interface TowerProfile {
  tower: string
  grid: FrequencyGrid
  bells: Map<number, BellProfile>
}

export interface ChosenPartial extends MeasuredPartial {
  /** Gain minus the strongest thing any other ringing bell puts nearby. */
  marginDb: number
}

export interface SelectionOptions {
  /** Half-width of the filter's leakage window, in Hz. */
  leakageHz?: number
  perBell?: number
  /** A partial must score at least this to be worth using. */
  floorDb?: number
  /** Minimum spacing between one bell's own chosen partials. */
  minSpacingHz?: number
}

export function selectPartials(
  profile: TowerProfile,
  ringing: number[],
  options: SelectionOptions = {},
): Map<number, ChosenPartial[]> {
  const { leakageHz = 20, perBell = 4, floorDb = 6, minSpacingHz = 50 } = options

  // Bells with no measurements are excluded rather than guessed at. Predicting
  // a bell's partials from the theoretical ladder is possible and tempting, and
  // it produces a confident wrong answer: on a diatonic ring the predicted sets
  // collide systematically, so the prediction cannot say which are usable.
  const usable = ringing.filter((b) => (profile.bells.get(b)?.partials.length ?? 0) > 0)

  const chosen = new Map<number, ChosenPartial[]>()
  for (const bell of usable) {
    const own = profile.bells.get(bell)!.partials
    const scored: ChosenPartial[] = own.map((partial) => ({
      ...partial,
      marginDb: partial.gainDb - interferenceAt(profile, usable, bell, partial.bin, leakageHz),
    }))

    scored.sort((a, b) => score(b) - score(a))
    const picked: ChosenPartial[] = []
    for (const partial of scored) {
      if (score(partial) < floorDb) break
      if (picked.some((p) => Math.abs(p.frequencyHz - partial.frequencyHz) <= minSpacingHz)) continue
      picked.push(partial)
      if (picked.length >= perBell) break
    }
    if (picked.length > 0) chosen.set(bell, picked)
  }
  return chosen
}

function score(partial: ChosenPartial): number {
  return Math.min(partial.gainDb, partial.marginDb)
}

/**
 * The loudest thing any other ringing bell puts within `leakageHz` of a bin.
 *
 * The window is every bin whose centre frequency is within `leakageHz` — not
 * `round(leakageHz / stepHz)` bins either side, which at this grid spacing means
 * 21.5 Hz and quietly changes which marginal partials survive.
 */
function interferenceAt(
  profile: TowerProfile,
  ringing: number[],
  exclude: number,
  centre: number,
  leakageHz: number,
): number {
  const { stepHz, count } = profile.grid
  const span = leakageHz / stepHz
  const from = Math.max(0, Math.ceil(centre - span))
  const to = Math.min(count - 1, Math.floor(centre + span))
  let worst = 0
  for (const other of ringing) {
    if (other === exclude) continue
    const envelope = profile.bells.get(other)!.envelope
    for (let i = from; i <= to; i++) {
      if (envelope[i] > worst) worst = envelope[i]
    }
  }
  return worst
}

/** Bells in the session that have no stored measurements and so cannot be heard. */
export function unmeasuredBells(profile: TowerProfile, ringing: number[]): number[] {
  return ringing.filter((b) => (profile.bells.get(b)?.partials.length ?? 0) === 0)
}

export type UnheardReason =
  /** Never recorded at this tower. Recording it is the fix. */
  | 'not-measured'
  /**
   * Measured, but every partial it has is buried under another ringing bell.
   * Recording it again will not help; ringing a different set of bells might.
   */
  | 'drowned-out'

export interface UnheardBell {
  bell: number
  reason: UnheardReason
}

/**
 * Which of the ringing bells this session cannot listen to, and why.
 *
 * ADR-0001: the app refuses to display what it cannot verify, so something has
 * to say out loud which bells are missing — otherwise a bell that is simply not
 * being heard looks exactly like a bell that is never striking, which is a
 * plausible and completely wrong thing to show a ringer.
 *
 * The two reasons want different words on screen, because they have different
 * fixes, and neither is "the app is broken".
 */
export function unheardBells(
  profile: TowerProfile,
  ringing: number[],
  chosen: Map<number, ChosenPartial[]>,
): UnheardBell[] {
  return ringing
    .filter((bell) => !chosen.has(bell))
    .map((bell) => ({
      bell,
      reason: (profile.bells.get(bell)?.partials.length ?? 0) === 0 ? 'not-measured' : 'drowned-out',
    }))
}

export function loadProfile(raw: unknown): TowerProfile {
  if (typeof raw !== 'object' || raw === null) throw new Error('tower profile is not an object')
  const { tower, bells, envelope } = raw as { tower?: unknown; bells?: unknown; envelope?: unknown }
  if (typeof tower !== 'string') throw new Error('tower profile needs a tower name')
  if (typeof bells !== 'object' || bells === null) throw new Error('tower profile has no bells')
  const grid = envelope as FrequencyGrid | undefined
  if (!grid || !Number.isFinite(grid.startHz) || !(grid.stepHz > 0) || !(grid.count > 0)) {
    throw new Error('tower profile has no usable frequency grid')
  }

  const parsed = new Map<number, BellProfile>()
  for (const [key, value] of Object.entries(bells as Record<string, unknown>)) {
    const bell = Number(key)
    if (!Number.isInteger(bell) || bell < 1) throw new Error(`bad bell number: ${key}`)
    const entry = value as { nominalHz?: unknown; doveNominalHz?: unknown; partials?: unknown }
    const env = ((entry as { envelope?: unknown }).envelope as number[]) ?? []
    if (env.length > 0 && env.length !== grid.count) {
      throw new Error(`bell ${bell} envelope has ${env.length} points, grid expects ${grid.count}`)
    }
    const partials: MeasuredPartial[] = []
    for (const bin of (entry.partials as number[]) ?? []) {
      if (!Number.isInteger(bin) || bin < 0 || bin >= grid.count) {
        throw new Error(`bell ${bell} has a partial outside the frequency grid: ${bin}`)
      }
      // The gain has to come from the envelope; a bell that offers partials
      // without one would silently score every candidate at zero.
      if (env.length === 0) throw new Error(`bell ${bell} has partials but no envelope`)
      partials.push({ bin, frequencyHz: grid.startHz + bin * grid.stepHz, gainDb: env[bin] })
    }
    parsed.set(bell, {
      bell,
      nominalHz: typeof entry.nominalHz === 'number' ? entry.nominalHz : null,
      doveNominalHz: typeof entry.doveNominalHz === 'number' ? entry.doveNominalHz : null,
      partials,
      envelope: env,
    })
  }
  if (parsed.size === 0) throw new Error('tower profile has no bells')
  return { tower, grid, bells: parsed }
}
