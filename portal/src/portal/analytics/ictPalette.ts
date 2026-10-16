/**
 * bd-97x22y.5 — the ICT dashboard's own colours, for the tabs ported from it 1 to 1 (operator, 2026-10-14: "Fully
 * 1 to 1" — her %, bars, colours and card layout; PLAN v7). ONE table: every v7 view reads it, no colour is picked on
 * the spot.
 *
 * Each colour is hers (Observations.jsx, Coaching.jsx, SectorScoreComparisonChart.jsx). Hers are used for fills,
 * bars and borders; where hers would carry TEXT on white below 4.5:1 (her green, amber, blue), the same hue's darker
 * shade (`*Text`) carries it instead, so the look is hers and every word stays readable.
 */
export const ICT = {
  /** Human observations; Section B — LP Fidelity. */
  blue: '#3B82F6',
  blueText: '#1D4ED8',
  /** The Human observation panels' border. */
  blueBorder: '#60A5FA',
  /** Digital Coach observations (Section B on the Digital Coach tab). */
  purple: '#8B5CF6',
  purpleText: '#6D28D9',
  /** Section C — Teaching Practices; the Coaching tab. */
  green: '#47BA7C',
  greenText: '#2D8A5E',
  greenTint: '#EDFDF5',
  /** Section D — Engagement; any score under LOW_SCORE. */
  amber: '#F59E0B',
  amberText: '#B45309',
  amberTint: '#FEF9EE',
  /** Coaches. */
  indigo: '#818CF8',
  indigoText: '#4F46E5',
  indigoTint: '#F0EFFE',
} as const;

/** Her ScoreCard: a score under 60 is drawn in amber, whatever its section (Observations.jsx ScoreCard isLow). */
export const LOW_SCORE = 60;
