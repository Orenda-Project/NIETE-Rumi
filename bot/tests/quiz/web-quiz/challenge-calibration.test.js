'use strict';
/**
 * The monthly calibration job (web-quiz-challenge-calibration.js) PROPOSES and never decides:
 *   - passage equating links to the band reference (challenge_links rows with signed_at NULL),
 *   - maths item estimates (challenge_items estimate columns, never `status`),
 *   - withdrawals of stuck passages and operational / retire moves for items (in the run summary only).
 * Behind app_settings `web_quiz_challenge_calibration` (under `web_quiz_challenge_v2`), off by default: off, the job
 * reads its switch and nothing else. Synthetic rows only; Supabase is the faked boundary.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const crypto = require('crypto');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const Cal = require('../../../shared/services/quiz/web-quiz-challenge-calibration');

// ---------- synthetic rows ----------
const uuid = () => crypto.randomUUID();
// n values with the given mean and (population) spread: half at m - s, half at m + s
const two = (n, m, s) => Array.from({ length: n }, (_, i) => (i % 2 ? m + s : m - s));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };

function readRow(passage_id, wcpm, over = {}) {
  const { score: sc, meta: mt, ...rest } = over;
  return {
    id: uuid(), canonical_id: uuid(), exercise: 'read', lang: 'en', band: 2, passage_id, period_id: '2026-12',
    status: 'scored', mode: 'check', record: true, exposure_no: 1, helped: 'self', id_confidence: 'high',
    wcpm, score: { correct: wcpm, attempted: wcpm, stopped: false, finished_early: false, time_left: 0, ...(sc || {}) },
    meta: { draw: { band_reason: 'entry_grade' }, ...(mt || {}) },
    ...rest,
  };
}
const drawFor = (row, ref_eligible = true) => ({ draw_id: uuid(), run_id: row.id, ref_eligible, period_id: row.period_id, stop: row.exercise, lang: row.lang, band: row.band });
const drawsFor = (rows, ref = true) => rows.map((r) => drawFor(r, ref));

const REF = 'en.read.2.setA';
const P1 = 'en.read.2.kite';
const P2 = 'en.read.2.river';
const W = { lang: 'en', band: 2, windowFrom: '2026-11', windowTo: '2026-12' };

const PERIODS = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'].map((p) => {
  const [y, m] = p.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 5 * 3600 * 1000).toISOString();
  const end = new Date(Date.UTC(y, m, 1) - 5 * 3600 * 1000).toISOString();
  return { period_id: p, starts_at: start, ends_at: end, anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4', created_by: 'seed' };
});
const passage = (passage_id, over = {}) => ({
  passage_id, lang: 'en', kind: 'read', pool: 'check', band: 2, status: 'provisional', is_reference: false,
  released_at: '2026-10-31T19:00:00Z', withdrawn_at: null, withdraw_reason: null, adjustment: null, method: null,
  signed_by: null, signed_at: null, twin_of: null, bank_version: 'child-test-items-v4', ...over,
});
const REF_ROW = passage(REF, { status: 'calibrated', is_reference: true, method: 'none', adjustment: 0, bank_version: 'child-test-items-v3' });

// ---------- Rasch synthetic data ----------
function mulberry32(a) {
  return function rnd() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sig = (z) => 1 / (1 + Math.exp(-z));
const A1_FIXED = [-2.0, -1.6, -1.2, -0.8, -0.4, 0.4, 0.8, 1.2, 1.6, 2.0];
const pad = (i) => String(i).padStart(2, '0');
const anchorItems = () => A1_FIXED.map((b, k) => ({
  item_id: `anchor.A1.${pad(k + 1)}`, task: 'missing', form: 'shared', pool: 'check', anchor: true, anchor_block: 'A1', anchor_pos: k + 1,
  status: 'operational', difficulty: b, se: null, n: 0, n_right: 0, n_wrong: 0, params: {}, bank_version: 'child-test-items-v4',
}));
const tryItem = (item_id, over = {}) => ({
  item_id, task: 'missing', form: 'shared', pool: 'check', anchor: false, anchor_block: null, anchor_pos: null, status: 'provisional',
  difficulty: null, se: null, n: 0, n_right: 0, n_wrong: 0, infit: null, outfit: null, dif_lang: null, params: { seq: [1, 2, null, 4], ans: 3 },
  signed_by: null, signed_at: null, bank_version: 'child-test-items-v4', ...over,
});

/**
 * One counted warm-up row per child: the ten A1 items (true difficulty = fixed, plus `drift` on the items named)
 * and, for the children in a try-out range, one try-out item. `tryouts`: [{item_id, from, to, b, bUr?}].
 */
function warmupRows({ persons = 1000, seed = 7, drift = {}, tryouts = [] } = {}) {
  const rnd = mulberry32(seed);
  const rows = [];
  for (let p = 0; p < persons; p++) {
    const theta = -2.5 + 5 * rnd();
    const lang = p % 2 ? 'ur' : 'en';
    const items = A1_FIXED.map((b, k) => {
      const id = `anchor.A1.${pad(k + 1)}`;
      const ok = rnd() < sig(theta - (b + (drift[id] || 0)));
      return { i: k + 1, verdict: ok ? 'correct' : 'wrong', ok, reached: true };
    });
    const t = tryouts.find((x) => p >= x.from && p < x.to);
    const meta = { items };
    if (t) {
      const b = lang === 'ur' && t.bUr != null ? t.bUr : t.b;
      meta.tryout = { item_id: t.item_id, ok: rnd() < sig(theta - b) };
    }
    rows.push({
      id: uuid(), canonical_id: uuid(), exercise: 'missing', lang, period_id: '2026-12', status: 'scored', mode: 'check', record: true,
      anchor_block: 'A1', anchor_exposure_no: 1, exposure_no: 1, helped: 'self', id_confidence: 'high', score: { correct: 0, n: 10 }, meta,
    });
  }
  return rows;
}
const TRYOUTS = [
  { item_id: 'missing.x.29', from: 0, to: 29, b: 0 },
  { item_id: 'missing.x.30', from: 30, to: 60, b: 0 },
  { item_id: 'missing.x.100', from: 100, to: 200, b: 0.3 },
  { item_id: 'missing.x.dif', from: 200, to: 400, b: -1, bUr: 1.2 },
];
const TRY_REGISTRY = () => [
  ...anchorItems(),
  tryItem('missing.x.29'), tryItem('missing.x.30'), tryItem('missing.x.100'), tryItem('missing.x.dif'),
];

// =====================================================================================================
// the pure core
// =====================================================================================================
describe('calibrationSample: first-exposure, self-run, high-confidence counted readings on reference-eligible draws', () => {
  test('only check / record / exposure 1 / self / high / scored readings in the window enter; practice, helped, low, exposure 2 never', () => {
    const good = two(6, 60, 10).map((v) => readRow(P1, v));
    const never = [
      readRow(P1, 70, { mode: 'practice' }),
      readRow(P1, 70, { helped: 'helped' }),
      readRow(P1, 70, { helped: 'not_asked' }),
      readRow(P1, 70, { id_confidence: 'low' }),
      readRow(P1, 70, { id_confidence: null }),
      readRow(P1, 70, { exposure_no: 2 }),
      readRow(P1, 70, { record: false }),
      readRow(P1, 70, { period_id: '2026-10' }),
      readRow(P2, 70),
    ];
    const rows = [...good, ...never];
    const s = Cal.calibrationSample(rows, drawsFor(rows), { passageId: P1, ...W });
    expect(s.readings.map((r) => r.value).sort()).toEqual(good.map((r) => r.wcpm).sort());
    expect(s.attempted).toBe(6);
  });

  test('implausible readings stay out (wcpm > 250, the whole passage in under 15 s, too_fast); line-1 stops and 0-word reads stay in at 0; failed rows count as attempted with no value', () => {
    const rows = [
      readRow(P1, 80),
      readRow(P1, 251),
      readRow(P1, 200, { score: { finished_early: true, time_left: 46 } }),
      readRow(P1, 90, { meta: { too_fast: true } }),
      readRow(P1, 0, { score: { stopped: true, correct: 0, attempted: 7 } }),
      readRow(P1, 0, { score: { stopped: true, correct: 0, attempted: 0 }, meta: { ended: 'silent' } }),
      readRow(P1, null, { status: 'failed', score: null, meta: { reason: 'unheard' } }),
      readRow(P1, null, { status: 'served', score: null }),
    ];
    const s = Cal.calibrationSample(rows, drawsFor(rows), { passageId: P1, ...W });
    expect(s.readings.map((r) => r.value).sort((a, b) => a - b)).toEqual([0, 0, 80]);
    expect(s.attempted).toBe(4); // 3 scored in the sample + 1 failed; served is not an attempt; implausible is not a reading
    expect(s.excluded.implausible).toBe(3);
  });

  test('a reading whose draw had the reference ineligible (or no draw row) never enters', () => {
    const a = two(10, 60, 10).map((v) => readRow(P1, v));
    const b = two(10, 60, 10).map((v) => readRow(P1, v));
    const c = [readRow(P1, 60)];
    const s = Cal.calibrationSample([...a, ...b, ...c], [...drawsFor(a, true), ...drawsFor(b, false)], { passageId: P1, ...W });
    expect(s.readings).toHaveLength(10);
    expect(s.excluded.ref_ineligible).toBe(10);
    expect(s.excluded.no_draw).toBe(1);
  });

  test('listening readings carry the question score, not a words-per-minute', () => {
    const rows = [readRow('en.listen.2.setA', null, { exercise: 'listen', score: { correct: 5, n: 6 } })];
    const s = Cal.calibrationSample(rows, drawsFor(rows), { passageId: 'en.listen.2.setA', ...W });
    expect(s.readings.map((r) => r.value)).toEqual([5]);
  });
});

const sample = (vals, extra = {}) => ({ readings: vals.map((value) => ({ value, band_reason: 'entry_grade', comp: null })), band: 2, ...extra });

describe('proposeLink: floors, the 0.1 SD rule, linear past 400, never equipercentile', () => {
  test('n < 100 on either side → no proposal', () => {
    expect(Cal.proposeLink(sample(two(99, 45, 10)), sample(two(200, 50, 10)))).toEqual({ method: null, reason: 'n_floor', n_from: 99, n_to: 200 });
    expect(Cal.proposeLink(sample(two(200, 45, 10)), sample(two(98, 50, 10)))).toMatchObject({ method: null, reason: 'n_floor' });
  });

  test('n ≥ 100 on both and a real gap → mean, adjustment = reference mean − passage mean, se = sqrt(sp²/np + sr²/nr)', () => {
    const p = two(100, 45, 10); const r = two(120, 50, 10);
    const out = Cal.proposeLink(sample(p), sample(r));
    expect(out.method).toBe('mean');
    expect(out.adjustment).toBeCloseTo(5, 9);
    expect(out.se).toBeCloseTo(Math.sqrt(sd(p) ** 2 / 100 + sd(r) ** 2 / 120), 9);
    expect(out.gap_sd).toBeLessThan(-0.1);
    expect(out).toMatchObject({ n_from: 100, n_to: 120 });
  });

  test('a gap of 0.08 SD → mean with adjustment 0 ("report raw"), even past 400', () => {
    const out = Cal.proposeLink(sample(two(100, 50.8, 10)), sample(two(100, 50, 10)));
    expect(Math.abs(out.gap_sd)).toBeLessThan(0.1);
    expect(out.gap_sd).toBeCloseTo(0.08, 2);
    expect(out).toMatchObject({ method: 'mean', adjustment: 0, note: 'report raw' });
    expect(Cal.proposeLink(sample(two(400, 50.8, 10)), sample(two(400, 50, 10)))).toMatchObject({ method: 'mean', adjustment: 0 });
  });

  test('n ≥ 400 on both → linear (mean and SD); one side under 400 → mean', () => {
    const lin = Cal.proposeLink(sample(two(400, 45, 8)), sample(two(400, 50, 10)));
    expect(lin.method).toBe('linear');
    expect(lin.slope).toBeCloseTo(10 / 8, 9);
    expect(lin.intercept).toBeCloseTo(50 - (10 / 8) * 45, 9);
    expect(lin.adjustment).toBeCloseTo(5, 9);
    expect(Cal.proposeLink(sample(two(399, 45, 8)), sample(two(400, 50, 10))).method).toBe('mean');
  });

  test('comprehension proportions get a ratio; no comprehension data → null', () => {
    const withComp = (vals, prop) => ({ readings: vals.map((value) => ({ value, band_reason: 'entry_grade', comp: prop })) });
    const out = Cal.proposeLink(withComp(two(100, 45, 10), 0.5), withComp(two(100, 50, 10), 0.6));
    expect(out.comp_adjustment).toBeCloseTo(0.6 / 0.5, 9);
    expect(Cal.proposeLink(sample(two(100, 45, 10)), sample(two(100, 50, 10))).comp_adjustment).toBeNull();
  });

  test('the method is never equipercentile', () => {
    const outs = [[99, 100], [100, 100], [400, 400], [1000, 1000]].map(([a, b]) => Cal.proposeLink(sample(two(a, 40, 9)), sample(two(b, 50, 10))));
    for (const o of outs) expect([null, 'mean', 'linear']).toContain(o.method);
  });
});

describe('entryVsPromoted: band 2 only, null under 30 a side', () => {
  const mixed = (nE, mE, nP, mP, band = 2) => ({
    band,
    readings: [
      ...two(nE, mE, 10).map((value) => ({ value, band_reason: 'entry_grade' })),
      ...two(nP, mP, 10).map((value) => ({ value, band_reason: 'promoted' })),
    ],
  });
  test('a gap over 0.1 SD → entrants only', () => {
    const out = Cal.entryVsPromoted(mixed(30, 50, 30, 55));
    expect(out.sd).toBeLessThan(-0.1);
    expect(out.entrants_only).toBe(true);
  });
  test('within 0.1 SD → pooled', () => {
    expect(Cal.entryVsPromoted(mixed(40, 50, 40, 50.5))).toMatchObject({ entrants_only: false });
  });
  test('either side under 30, or a band other than 2 → null', () => {
    expect(Cal.entryVsPromoted(mixed(29, 50, 40, 60))).toBeNull();
    expect(Cal.entryVsPromoted(mixed(40, 50, 40, 60, 1))).toBeNull();
    expect(Cal.entryVsPromoted(mixed(40, 50, 40, 60, 3))).toBeNull();
  });
});

describe('referenceDrift: an escalation line past 0.3 SD, never a rule', () => {
  test('0.4 SD → escalate; 0.2 SD → not', () => {
    expect(Cal.referenceDrift(sample(two(50, 54, 10)), sample(two(150, 50, 10)))).toMatchObject({ escalate: true });
    expect(Cal.referenceDrift(sample(two(50, 52, 10)), sample(two(150, 50, 10)))).toMatchObject({ escalate: false });
    // two-sided: a reference that got 0.4 SD HARDER is escalated too
    const down = Cal.referenceDrift(sample(two(50, 46, 10)), sample(two(150, 50, 10)));
    expect(down.gap_sd).toBeLessThan(-0.3);
    expect(down).toMatchObject({ escalate: true });
  });
  test('nothing to compare → null', () => {
    expect(Cal.referenceDrift(sample([]), sample(two(10, 50, 10)))).toBeNull();
  });
});

describe('stuckShare: withdrawal proposals for stuck check passages; a reference is escalated, never withdrawn', () => {
  // attempted first-exposure counted reads of one passage: `stuck` of them line-1 stops / 0 words / failed
  const attempts = (passage_id, n, stuck, lang = 'en', band = 2) => Array.from({ length: n }, (_, i) => {
    if (i >= stuck) return readRow(passage_id, 60, { lang, band });
    if (i % 3 === 0) return readRow(passage_id, 0, { lang, band, score: { stopped: true, correct: 0 } });
    if (i % 3 === 1) return readRow(passage_id, null, { lang, band, status: 'failed', score: null, meta: { reason: 'unheard' } });
    return readRow(passage_id, 0, { lang, band, score: { stopped: true, correct: 0, attempted: 0 }, meta: { ended: 'silent' } });
  });
  const reg = [REF_ROW, passage(P1), passage(P2)];

  test('stuck > 25% at n ≥ 20 → a withdrawal proposal (stuck); at n = 19 → none', () => {
    const out = Cal.stuckShare([...attempts(P1, 20, 6), ...attempts(P2, 19, 6)], reg);
    const p1 = out.find((x) => x.passage_id === P1);
    const p2 = out.find((x) => x.passage_id === P2);
    expect(p1).toMatchObject({ n: 20, stuck: 6, share: 0.3, propose: 'withdraw', withdraw_reason: 'stuck' });
    expect(p2).toMatchObject({ n: 19, propose: null });
  });

  test('exactly 25% is not over the line', () => {
    expect(Cal.stuckShare(attempts(P1, 20, 5), reg).find((x) => x.passage_id === P1).propose).toBeNull();
  });

  test('a reference over 25% → an escalation line, no withdrawal', () => {
    const ref = Cal.stuckShare(attempts(REF, 40, 20), reg).find((x) => x.passage_id === REF);
    expect(ref.propose).toBeNull();
    expect(ref.escalation).toMatch(/reference/);
  });

  test('with ≥ 3 live passages in the cell the rule is the excess over the cell median', () => {
    const P3 = 'en.read.2.mango';
    const reg3 = [...reg, passage(P3, { status: 'calibrated' })];
    // shares: ref 0.40, P1 0.70, P2 0.45, P3 0.45 → median 0.45; P1 excess 0.25 (not over), then 0.75 → 0.30 (over)
    const base = [...attempts(REF, 20, 8), ...attempts(P2, 20, 9), ...attempts(P3, 20, 9)];
    expect(Cal.stuckShare([...base, ...attempts(P1, 20, 14)], reg3).find((x) => x.passage_id === P1)).toMatchObject({ propose: null, cell_median: 0.45 });
    expect(Cal.stuckShare([...base, ...attempts(P1, 20, 15)], reg3).find((x) => x.passage_id === P1)).toMatchObject({ propose: 'withdraw', withdraw_reason: 'stuck' });
    // P2 at 0.45 is over the raw 25% but not over the median: no withdrawal once 3 are live
    expect(Cal.stuckShare([...base, ...attempts(P1, 20, 15)], reg3).find((x) => x.passage_id === P2).propose).toBeNull();
  });
});

describe('itemResponses: per-item first-exposure responses from counted maths rows', () => {
  test('A1 rows map by position, a skipped item is wrong, an unreached item is no response, the try-out compares to its answer', () => {
    const row = {
      id: uuid(), canonical_id: 'c1', exercise: 'missing', lang: 'ur', period_id: '2026-12', status: 'scored', mode: 'check', record: true,
      anchor_block: 'A1', anchor_exposure_no: 1, helped: 'self', id_confidence: 'high',
      meta: { items: [{ i: 1, verdict: 'correct', ok: true }, { i: 2, verdict: 'none', ok: null }, { i: 3, verdict: 'wrong', ok: false, reached: false }], tryout: { item_id: 'missing.x.1', resp: 3 } },
    };
    const big = {
      id: uuid(), canonical_id: 'c1', exercise: 'bigger', lang: 'ur', period_id: '2026-12', status: 'scored', mode: 'check', record: true,
      item_set_id: 'bigger.G3.A', exposure_no: 1, helped: 'self', id_confidence: 'high', meta: { items: [{ i: 3, verdict: 'correct' }] },
    };
    const items = [tryItem('missing.x.1', { params: { seq: [1, 2, null, 4], ans: 3 } })];
    const out = Cal.itemResponses([row, big], items);
    expect(out).toEqual(expect.arrayContaining([
      { person: 'c1|2026-12', item_id: 'anchor.A1.01', x: 1, lang: 'ur' },
      { person: 'c1|2026-12', item_id: 'anchor.A1.02', x: 0, lang: 'ur' },
      { person: 'c1|2026-12', item_id: 'missing.x.1', x: 1, lang: 'ur' },
      { person: 'c1|2026-12', item_id: 'bigger.G3.A.03', x: 1, lang: 'ur' },
    ]));
    expect(out.find((r) => r.item_id === 'anchor.A1.03')).toBeUndefined();
  });

  test('second exposures, practice, helped and low-confidence rows give no responses', () => {
    const base = { id: 'r', canonical_id: 'c2', exercise: 'missing', lang: 'en', period_id: '2026-12', status: 'scored', mode: 'check', record: true, anchor_block: 'A1', anchor_exposure_no: 1, helped: 'self', id_confidence: 'high', meta: { items: [{ i: 1, verdict: 'correct', ok: true }] } };
    const rows = [{ ...base, anchor_exposure_no: 2 }, { ...base, mode: 'practice' }, { ...base, helped: 'helped' }, { ...base, id_confidence: 'low' }, { ...base, record: false }];
    expect(Cal.itemResponses(rows, [])).toEqual([]);
  });
});

describe('raschFloors: anchored on A1; estimates past 30 (8/8), operational proposals past 100, drift and misfit flags', () => {
  let out;
  beforeAll(() => {
    const rows = warmupRows({ tryouts: TRYOUTS });
    out = Cal.raschFloors(Cal.itemResponses(rows, TRY_REGISTRY()), TRY_REGISTRY());
  });

  test('29 responses → nothing; 30 with 8/8 → an estimate', () => {
    expect(out.estimates.find((e) => e.item_id === 'missing.x.29')).toBeUndefined();
    const e30 = out.estimates.find((e) => e.item_id === 'missing.x.30');
    expect(e30).toMatchObject({ n: 30 });
    expect(e30.n_right).toBeGreaterThanOrEqual(8);
    expect(e30.n_wrong).toBeGreaterThanOrEqual(8);
    expect(Number.isFinite(e30.difficulty)).toBe(true);
    expect(out.proposals.find((p) => p.item_id === 'missing.x.30')).toBeUndefined();
  });

  test('100 with fit in range → an operational proposal; the estimate is near its true difficulty', () => {
    const e = out.estimates.find((x) => x.item_id === 'missing.x.100');
    expect(e.n).toBe(100);
    expect(e.se).toBeLessThanOrEqual(0.5);
    expect(e.infit).toBeGreaterThanOrEqual(0.7); expect(e.infit).toBeLessThanOrEqual(1.3);
    expect(e.outfit).toBeGreaterThanOrEqual(0.7); expect(e.outfit).toBeLessThanOrEqual(1.3);
    expect(e.pt_measure).toBeGreaterThan(0.2);
    expect(Math.abs(e.difficulty - 0.3)).toBeLessThan(0.6);
    expect(out.proposals).toEqual(expect.arrayContaining([expect.objectContaining({ item_id: 'missing.x.100', propose: 'operational' })]));
  });

  test('language DIF over 1.0 logit → a retire proposal', () => {
    const e = out.estimates.find((x) => x.item_id === 'missing.x.dif');
    expect(e.dif_lang).toBeGreaterThan(1.0);
    expect(out.proposals).toEqual(expect.arrayContaining([expect.objectContaining({ item_id: 'missing.x.dif', propose: 'retire', reason: 'dif' })]));
    expect(out.proposals.find((p) => p.item_id === 'missing.x.dif' && p.propose === 'operational')).toBeUndefined();
  });

  test('anchors are never estimated or proposed; without drift none is unanchored', () => {
    expect(out.estimates.filter((e) => e.item_id.startsWith('anchor.'))).toEqual([]);
    expect(out.proposals.filter((p) => p.item_id.startsWith('anchor.'))).toEqual([]);
    expect(out.unanchored).toEqual([]);
  });

  test('an A1 item drifting 0.6 logit → flagged unanchored (and freed in the estimation), the others stay anchored', () => {
    const rows = warmupRows({ persons: 3000, seed: 11, drift: { 'anchor.A1.04': 0.6 } });
    const d = Cal.raschFloors(Cal.itemResponses(rows, anchorItems()), anchorItems());
    expect(d.unanchored.map((u) => u.item_id)).toEqual(['anchor.A1.04']);
    expect(d.unanchored[0].drift).toBeGreaterThan(0.5);
    expect(d.relink).toBe(false);
  });

  test('a provisional A2 candidate needs 150, not 100', () => {
    const rows = warmupRows({ tryouts: [{ item_id: 'anchor.A2.01', from: 0, to: 120, b: 0.3 }] });
    const reg = [...anchorItems(), tryItem('anchor.A2.01', { task: 'bigger' })];
    const r = Cal.raschFloors(Cal.itemResponses(rows, reg), reg);
    expect(r.estimates.find((e) => e.item_id === 'anchor.A2.01')).toMatchObject({ n: 120 });
    expect(r.proposals.find((p) => p.item_id === 'anchor.A2.01' && p.propose === 'operational')).toBeUndefined();
  });
});

// =====================================================================================================
// the job through the faked database
// =====================================================================================================
const ON = [
  { key: 'web_quiz_challenge', value: true },
  { key: 'web_quiz_challenge_v2', value: true },
  { key: 'web_quiz_challenge_calibration', value: true },
];
const NOW = new Date('2027-01-02T03:00:00Z');
let db; let fake;
function setup(extra = {}) {
  db = {
    app_settings: [...ON],
    challenge_periods: PERIODS.map((p) => ({ ...p })),
    challenge_passages: [REF_ROW, passage(P1), passage(P2)].map((p) => ({ ...p })),
    challenge_items: [],
    challenge_links: [],
    challenge_draws: [],
    web_quiz_challenge_runs: [],
    ...extra,
  };
  fake = makeFake(db);
  Object.assign(supabase, fake);
}
const addReads = (rows, ref = true) => { db.web_quiz_challenge_runs.push(...rows); db.challenge_draws.push(...drawsFor(rows, ref)); };
const runs = (pid, vals, over) => vals.map((v) => readRow(pid, v, over));
const statusWrites = () => fake.calls.filter((c) => c.op === 'update' && c.payload && Object.prototype.hasOwnProperty.call(c.payload, 'status'));
const passageWrites = () => fake.calls.filter((c) => c.table === 'challenge_passages' && c.op !== 'select');
const summaryEvents = () => logEvent.mock.calls.filter(([name]) => name === 'web_quiz.ch_calibration_run');

beforeEach(() => { jest.clearAllMocks(); });

describe('runMonthly: the switch', () => {
  test('switch OFF → one read of the switch, nothing else read, nothing written, no event', async () => {
    setup({ app_settings: [{ key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_v2', value: true }] });
    addReads(runs(P1, two(120, 45, 10)));
    addReads(runs(REF, two(120, 50, 10)));
    const out = await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    expect(out).toMatchObject({ ran: false, reason: 'switch_off' });
    expect(fake.calls).toEqual([{ table: 'app_settings', op: 'select', payload: null }]);
    expect(db.challenge_links).toEqual([]);
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('the parent switch OFF → nothing written either (the child switch alone does not run the job)', async () => {
    setup({ app_settings: [{ key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_calibration', value: true }] });
    addReads(runs(P1, two(120, 45, 10)));
    addReads(runs(REF, two(120, 50, 10)));
    const out = await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    expect(out).toMatchObject({ ran: false, reason: 'switch_off' });
    expect(fake.calls.every((c) => c.table === 'app_settings' && c.op === 'select')).toBe(true);
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('runMonthly: link proposals', () => {
  test('calibrates only on draws where the reference was eligible: n_from counts only those', async () => {
    setup();
    addReads(runs(P1, two(110, 45, 10)), true);
    addReads(runs(P1, two(40, 45, 10)), false); // same readings, reference was already read: excluded
    addReads(runs(P2, two(150, 45, 10)), false); // identical sample, every draw reference-ineligible: no row
    addReads(runs(REF, two(120, 50, 10)), true);
    const out = await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    expect(out.ran).toBe(true);
    expect(db.challenge_links).toHaveLength(1);
    const link = db.challenge_links[0];
    expect(link).toMatchObject({
      from_passage: P1, to_passage: REF, lang: 'en', band: 2, design: 'random_groups', window_from: '2026-11', window_to: '2026-12',
      n_from: 110, n_to: 120, ref_eligible_only: true, method: 'mean', proposed_by: 'calibration-job', signed_by: null, signed_at: null,
    });
    expect(link.adjustment).toBeCloseTo(5, 9);
    expect(out.links.find((l) => l.passage_id === P2)).toMatchObject({ method: null, reason: 'n_floor', n_from: 0 });
  });

  test('n < 100 → no row; n ≥ 100 both → mean; 0.08 SD → adjustment 0; n ≥ 400 both → linear', async () => {
    setup({ challenge_passages: [REF_ROW, passage(P1), passage(P2), passage('en.read.2.mango')].map((p) => ({ ...p })) });
    addReads(runs(P1, two(99, 45, 10)));
    addReads(runs(P2, two(100, 45, 10)));
    addReads(runs('en.read.2.mango', two(100, 50.8, 10)));
    addReads(runs(REF, two(100, 50, 10)));
    await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    const by = Object.fromEntries(db.challenge_links.map((l) => [l.from_passage, l]));
    expect(by[P1]).toBeUndefined();
    expect(by[P2]).toMatchObject({ method: 'mean', n_from: 100, n_to: 100 });
    expect(by['en.read.2.mango']).toMatchObject({ method: 'mean', adjustment: 0 });

    setup();
    addReads(runs(P1, two(400, 45, 8)));
    addReads(runs(REF, two(400, 50, 10)));
    await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    expect(db.challenge_links).toHaveLength(1);
    expect(db.challenge_links[0]).toMatchObject({ method: 'linear', n_from: 400, n_to: 400 });
  });

  test('practice, helped, low-confidence and second-exposure rows never enter a sample', async () => {
    setup();
    addReads(runs(P1, two(60, 45, 10)));
    addReads(runs(P1, two(60, 45, 10), { mode: 'practice' }));
    addReads(runs(P1, two(60, 45, 10), { helped: 'helped' }));
    addReads(runs(P1, two(60, 45, 10), { id_confidence: 'low' }));
    addReads(runs(P1, two(60, 45, 10), { exposure_no: 2 }));
    addReads(runs(REF, two(120, 50, 10)));
    const out = await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    expect(db.challenge_links).toEqual([]);
    expect(out.links.find((l) => l.passage_id === P1)).toMatchObject({ reason: 'n_floor', n_from: 60 });
  });

  test('band 2: entrants and promoted readers more than 0.1 SD apart → the proposal is on entrants only and says so', async () => {
    setup();
    addReads(runs(P1, two(110, 45, 10)));
    addReads(runs(P1, two(40, 60, 10), { meta: { draw: { band_reason: 'promoted' } } }));
    addReads(runs(REF, two(120, 50, 10)));
    const out = await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    expect(db.challenge_links).toHaveLength(1);
    expect(db.challenge_links[0].n_from).toBe(110);
    expect(db.challenge_links[0].entry_vs_promoted_sd).toBeLessThan(-0.1);
    expect(out.links.find((l) => l.passage_id === P1)).toMatchObject({ entrants_only: true });
  });

  test('a second run in the same period proposes nothing new (one open proposal per passage per window)', async () => {
    setup();
    addReads(runs(P1, two(110, 45, 10)));
    addReads(runs(REF, two(120, 50, 10)));
    await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    expect(db.challenge_links).toHaveLength(1);
  });

  test('reference drift past 0.3 SD against the prior quarter → an escalation line, nothing written for it', async () => {
    setup();
    addReads(runs(REF, two(60, 54, 10)));
    addReads(runs(REF, two(120, 50, 10), { period_id: '2026-10' }));
    const out = await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    expect(out.escalations).toEqual(expect.arrayContaining([expect.objectContaining({ passage_id: REF, kind: 'reference_drift' })]));
    expect(db.challenge_links).toEqual([]);
  });
});

describe('runMonthly: withdrawals and item estimates are proposals; statuses never move', () => {
  const stuckRows = (pid, n, stuck) => Array.from({ length: n }, (_, i) => (i < stuck
    ? readRow(pid, null, { status: 'failed', score: null, meta: { reason: 'unheard' } })
    : readRow(pid, 60)));

  test('stuck > 25% at n ≥ 20 → a withdrawal proposal; n = 19 → none; a reference → escalation; the passage row is untouched', async () => {
    setup();
    addReads(stuckRows(P1, 20, 6));
    addReads(stuckRows(P2, 19, 6));
    addReads(stuckRows(REF, 30, 12));
    const before = JSON.parse(JSON.stringify(db.challenge_passages));
    const out = await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    expect(out.withdrawals).toEqual([expect.objectContaining({ passage_id: P1, withdraw_reason: 'stuck', n: 20, stuck: 6 })]);
    expect(out.escalations).toEqual(expect.arrayContaining([expect.objectContaining({ passage_id: REF, kind: 'reference_stuck' })]));
    expect(db.challenge_passages).toEqual(before);
    expect(passageWrites()).toEqual([]);
    const [, ev] = summaryEvents()[0];
    expect(ev.withdrawals_proposed).toBe(1);
  });

  test('item estimates are written for provisional/operational items only, status untouched; the operational proposal is in the summary', async () => {
    const reg = [...TRY_REGISTRY(), tryItem('missing.x.retired', { status: 'retired' }), tryItem('missing.x.draft', { status: 'draft' })].map((r) => ({ ...r }));
    const rows = warmupRows({ tryouts: [...TRYOUTS, { item_id: 'missing.x.retired', from: 400, to: 450, b: 0 }, { item_id: 'missing.x.draft', from: 450, to: 500, b: 0 }] });
    setup({ challenge_items: reg, web_quiz_challenge_runs: rows });
    const out = await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    const it = Object.fromEntries(db.challenge_items.map((r) => [r.item_id, r]));
    expect(it['missing.x.29']).toMatchObject({ difficulty: null, n: 0, status: 'provisional' });
    expect(it['missing.x.30']).toMatchObject({ n: 30, status: 'provisional' });
    expect(Number.isFinite(it['missing.x.30'].difficulty)).toBe(true);
    expect(it['missing.x.100']).toMatchObject({ n: 100, status: 'provisional', signed_by: null, signed_at: null });
    for (const k of ['difficulty', 'se', 'infit', 'outfit']) expect(Number.isFinite(it['missing.x.100'][k])).toBe(true);
    expect(it['missing.x.retired']).toMatchObject({ difficulty: null, n: 0, status: 'retired' });
    expect(it['missing.x.draft']).toMatchObject({ difficulty: null, n: 0, status: 'draft' });
    for (const a of anchorItems()) expect(it[a.item_id]).toMatchObject({ difficulty: a.difficulty, se: null, n: 0, status: 'operational' });
    expect(out.item_proposals).toEqual(expect.arrayContaining([expect.objectContaining({ item_id: 'missing.x.100', propose: 'operational' })]));
    const [, ev] = summaryEvents()[0];
    expect(ev.items_estimated).toBe(3);
    expect(ev.reasons.operational).toBe(1);
    expect(statusWrites()).toEqual([]);
  });

  test('never moves a status without a signature: no update payload carrying `status`, no write to challenge_passages, ever', async () => {
    const rows = warmupRows({ tryouts: TRYOUTS });
    setup({ challenge_items: TRY_REGISTRY().map((r) => ({ ...r })), web_quiz_challenge_runs: rows });
    addReads(runs(P1, two(110, 45, 10)));
    addReads(stuckRows(P2, 40, 30));
    addReads(runs(REF, two(120, 50, 10)));
    const out = await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    expect(out.links.length + out.withdrawals.length + out.item_proposals.length).toBeGreaterThan(2);
    expect(statusWrites()).toEqual([]);
    expect(passageWrites()).toEqual([]);
    const writes = fake.calls.filter((c) => c.op !== 'select');
    expect(new Set(writes.map((c) => `${c.table}:${c.op}`))).toEqual(new Set(['challenge_links:insert', 'challenge_items:update']));
    for (const l of db.challenge_links) expect(l).toMatchObject({ signed_by: null, signed_at: null });
    for (const c of writes.filter((x) => x.table === 'challenge_items')) {
      expect(Object.keys(c.payload).sort()).toEqual(['dif_lang', 'difficulty', 'infit', 'n', 'n_right', 'n_wrong', 'outfit', 'se', 'updated_at']);
    }
  });

  test('one summary event per run, counts only, no child id in it', async () => {
    setup();
    const p1 = runs(P1, two(110, 45, 10));
    addReads(p1);
    addReads(runs(REF, two(120, 50, 10)));
    await Cal.runMonthly({ period_id: '2026-12', now: NOW });
    expect(summaryEvents()).toHaveLength(1);
    const [, ev] = summaryEvents()[0];
    expect(Object.keys(ev).sort()).toEqual(['cells', 'drift_flags', 'items_estimated', 'period_id', 'proposals', 'reasons', 'w', 'withdrawals_proposed']);
    expect(ev.w).toBe('s');
    expect(ev).toMatchObject({ period_id: '2026-12', cells: 1, proposals: 1, withdrawals_proposed: 0, items_estimated: 0, drift_flags: 0 });
    const text = JSON.stringify(ev);
    for (const r of p1) { expect(text).not.toContain(r.canonical_id); expect(text).not.toContain(r.id); }
  });

  test('a period that is not in challenge_periods → nothing written, the summary says why', async () => {
    setup();
    addReads(runs(P1, two(110, 45, 10)));
    addReads(runs(REF, two(120, 50, 10)));
    const out = await Cal.runMonthly({ period_id: '2027-05', now: NOW });
    expect(out).toMatchObject({ ran: false, reason: 'period_unknown' });
    expect(db.challenge_links).toEqual([]);
    expect(summaryEvents()[0][1].reasons).toMatchObject({ period_unknown: 1 });
  });
});
