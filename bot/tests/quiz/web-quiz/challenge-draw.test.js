'use strict';
/**
 * The Challenge draw's pure core (web-quiz-challenge-draw.js): bands, the eligible set, the w1 weights, the seeded
 * pick, the fallback, the record decided at serve, the exposure counters, the period, the bigger set and the try-out
 * item; plus the one-record-rule helper trailStateFor through the in-memory Supabase stand-in.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const { guardColumns } = require('./registry-columns');   // a select naming a column the table lacks is 42703
const supabase = require('../../../shared/config/supabase');
const { logError } = require('../../../shared/utils/logger');
const D = require('../../../shared/services/quiz/web-quiz-challenge-draw');

const NOW = new Date('2026-11-03T14:12:09Z');
const P = (id, extra = {}) => ({ passage_id: id, lang: 'ur', kind: 'read', band: 2, pool: 'check', status: 'calibrated', is_reference: false, released_at: '2026-10-31T19:00:00Z', withdrawn_at: null, twin_of: null, ...extra });
const REF = P('ur.read.2.setA', { is_reference: true });
const SEED = '9c4f0b7e2a6d41f3b8e5c2a7d9f1e3b6';
const wOf = (list) => Object.fromEntries(list.map((x) => [x.id, x.w]));
const sum = (list) => list.reduce((a, x) => a + x.w, 0);

beforeEach(() => { jest.clearAllMocks(); D.__reset(); });

describe('bands per fixed grade', () => {
  test('entry band: grades 2 and 3 → 1, grades 4 and 5 → 2; ceiling 2 / 3; anything else null', () => {
    expect([1, 2, 3, 4, 5, 6, null].map(D.entryBand)).toEqual([null, 1, 1, 2, 2, null, null]);
    expect([2, 3, 4, 5].map(D.ceilingBand)).toEqual([2, 2, 3, 3]);
    expect([2, 3, 4, 5, 1].map(D.gradeBand)).toEqual(['G23', 'G23', 'G45', 'G45', null]);
  });

  test('first counted read: entry_grade at the entry band', () => {
    expect(D.drawBand({ fixedGrade: 3, openBand: null, lastCountedRead: null })).toEqual({ band: 1, band_reason: 'entry_grade', open_band: 1 });
    expect(D.drawBand({ fixedGrade: 5, openBand: null, lastCountedRead: null })).toEqual({ band: 2, band_reason: 'entry_grade', open_band: 2 });
  });

  test('a line-1 stop on the last counted read draws one band lower (grade 5 → band 1, line1_drop); grade 2 stays at 1 (floor)', () => {
    const stop = { exercise: 'read', status: 'scored', score: { stopped: true }, meta: {} };
    expect(D.drawBand({ fixedGrade: 5, openBand: 2, lastCountedRead: stop })).toEqual({ band: 1, band_reason: 'line1_drop', open_band: 2 });
    expect(D.drawBand({ fixedGrade: 2, openBand: 1, lastCountedRead: stop })).toEqual({ band: 1, band_reason: 'floor', open_band: 1 });
  });

  test('0 words (unheard, or silent with the mic proven) is a drop too; an ordinary read is not', () => {
    expect(D.isLine1OrZero({ exercise: 'read', status: 'failed', meta: { reason: 'unheard' } })).toBe(true);
    expect(D.isLine1OrZero({ exercise: 'read', status: 'scored', score: { stopped: true }, meta: { ended: 'silent', mic_check: 'level_ok' } })).toBe(true);
    // the mic word alone decides (no stopped flag, no stop line): the check's word, and its older spelling on rows from before
    expect(D.isLine1OrZero({ exercise: 'read', status: 'scored', score: {}, meta: { ended: 'silent', mic_check: 'level_ok' } })).toBe(true);
    expect(D.isLine1OrZero({ exercise: 'read', status: 'scored', score: {}, meta: { ended: 'silent', mic_check: 'pass' } })).toBe(true);
    expect(D.isLine1OrZero({ exercise: 'read', status: 'scored', score: { stopped: false, correct: 3 }, meta: { ended: 'silent', mic_check: 'none' } })).toBe(false);
    expect(D.isLine1OrZero({ exercise: 'read', status: 'scored', score: { stopped: false, correct: 40 }, meta: {} })).toBe(false);
  });

  test('micHeard: the level check passed, in either spelling', () => {
    expect(D.micHeard('level_ok')).toBe(true);
    expect(D.micHeard('pass')).toBe(true);
    for (const v of ['silent', 'none', null, undefined, '', 'PASS']) expect(D.micHeard(v)).toBe(false);
  });

  test('promoted (the reading rung opened the upper band) → +1; never above the ceiling', () => {
    expect(D.drawBand({ fixedGrade: 3, openBand: 2, lastCountedRead: null })).toEqual({ band: 2, band_reason: 'promoted', open_band: 2 });
    expect(D.drawBand({ fixedGrade: 3, openBand: 3, lastCountedRead: null })).toEqual({ band: 2, band_reason: 'promoted', open_band: 2 });
    expect(D.drawBand({ fixedGrade: 4, openBand: 3, lastCountedRead: null })).toEqual({ band: 3, band_reason: 'promoted', open_band: 3 });
  });

  test('the last counted read is the newest final record row of the read stop (any period)', () => {
    const rows = [
      { id: 'a', exercise: 'read', status: 'scored', mode: 'check', record: true, score: { stopped: true }, meta: {}, created_at: '2026-11-02T00:00:00Z' },
      { id: 'b', exercise: 'read', status: 'scored', mode: 'practice', record: false, score: { stopped: false }, meta: {}, created_at: '2026-11-04T00:00:00Z' },
      { id: 'c', exercise: 'bigger', status: 'scored', mode: 'check', record: true, score: {}, meta: {}, created_at: '2026-11-05T00:00:00Z' },
    ];
    expect(D.lastCountedRead(rows).id).toBe('a');
  });
});

describe('the eligible set (ITEMS §5.2)', () => {
  const reg = [
    REF,
    P('ur.read.2.kite', { status: 'provisional' }),
    P('ur.read.2.draft', { status: 'reviewed' }),
    P('ur.read.2.later', { status: 'provisional', released_at: '2026-12-01T00:00:00Z' }),
    P('ur.read.2.gone', { withdrawn_at: '2026-11-01T00:00:00Z' }),
    P('ur.read.2.prac', { pool: 'practice', status: 'reviewed' }),
    P('ur.read.1.low', { band: 1 }),
    P('en.read.2.setA', { lang: 'en', is_reference: true }),
    P('ur.listen.2.setA', { kind: 'listen', is_reference: true }),
  ];

  test('pool, kind, lang, band, status, released, not withdrawn; the reference first', () => {
    const E = D.eligible({ rows: reg, seenIds: new Set(), kind: 'read', lang: 'ur', band: 2, now: NOW });
    expect(E.map((r) => r.passage_id)).toEqual(['ur.read.2.setA', 'ur.read.2.kite']);
  });

  test('never re-serve: a run row of any status or mode on the passage removes it', () => {
    const E = D.eligible({ rows: reg, seenIds: new Set(['ur.read.2.setA']), kind: 'read', lang: 'ur', band: 2, now: NOW });
    expect(E.map((r) => r.passage_id)).toEqual(['ur.read.2.kite']);
  });

  test('twins are excluded together, both ways', () => {
    const twins = [REF, P('ur.listen.2.setA', { kind: 'listen', is_reference: true, twin_of: 'ur.read.2.setA' }), P('ur.listen.2.x', { kind: 'listen' })];
    // heard the listening twin → its read passage is gone
    expect(D.eligible({ rows: twins, seenIds: new Set(['ur.listen.2.setA']), kind: 'read', lang: 'ur', band: 2, now: NOW })).toEqual([]);
    // read the passage → its listening twin is gone
    expect(D.eligible({ rows: twins, seenIds: new Set(['ur.read.2.setA']), kind: 'listen', lang: 'ur', band: 2, now: NOW }).map((r) => r.passage_id)).toEqual(['ur.listen.2.x']);
  });

  test('a row\'s served id: its passage or set, else (a row from before the provenance columns) the Set A id', () => {
    expect(D.rowServedId({ exercise: 'read', lang: 'ur', passage_id: 'ur.read.1.x' })).toBe('ur.read.1.x');
    expect(D.rowServedId({ exercise: 'read', lang: 'en', grade: 3 })).toBe('en.read.2.setA');
    expect(D.rowServedId({ exercise: 'listen', lang: 'ur', grade: 3 })).toBe('ur.listen.2.setA');
    expect(D.rowServedId({ exercise: 'bigger', lang: 'en', grade: 5 })).toBe('bigger.G5.A');
    expect(D.rowServedId({ exercise: 'missing', lang: 'en', grade: 2, anchor_block: 'A1', mode: 'check' })).toBe(null);
  });
});

describe('weights w1 (ITEMS §5.3)', () => {
  test('reference + 1 provisional = 0.85 / 0.15', () => {
    const w = wOf(D.weigh([REF, P('p1', { status: 'provisional' })]));
    expect(w['ur.read.2.setA']).toBeCloseTo(0.85, 12);
    expect(w.p1).toBeCloseTo(0.15, 12);
  });

  test('reference + 2 provisional = 0.70 / 0.15 / 0.15', () => {
    const list = D.weigh([REF, P('p1', { status: 'provisional' }), P('p2', { status: 'provisional' })]);
    expect(list.map((x) => x.w)).toEqual([expect.closeTo(0.7, 12), expect.closeTo(0.15, 12), expect.closeTo(0.15, 12)]);
    expect(Math.abs(sum(list) - 1)).toBeLessThan(1e-9);
  });

  test('reference + 2 calibrated = 0.35 / 0.325 / 0.325', () => {
    const list = D.weigh([REF, P('c1'), P('c2')]);
    expect(list.map((x) => x.w)).toEqual([expect.closeTo(0.35, 12), expect.closeTo(0.325, 12), expect.closeTo(0.325, 12)]);
  });

  test('reference ineligible: its mass goes pro rata to the rest (provisional 0.15 : calibrated 0.25 each, renormalised)', () => {
    const list = D.weigh([P('p1', { status: 'provisional' }), P('c1'), P('c2')]);
    const w = wOf(list);
    expect(w.p1).toBeCloseTo(0.15 / 0.65, 12);
    expect(w.c1).toBeCloseTo(0.25 / 0.65, 12);
    expect(Math.abs(sum(list) - 1)).toBeLessThan(1e-9);
  });

  test('a third provisional is never in E: capped at two, logged web_quiz.ch_pool_overfull', () => {
    const list = D.weigh([REF, P('p1', { status: 'provisional' }), P('p2', { status: 'provisional' }), P('p3', { status: 'provisional' })]);
    expect(list.map((x) => x.id)).toEqual(['ur.read.2.setA', 'p1', 'p2']);
    expect(Math.abs(sum(list) - 1)).toBeLessThan(1e-9);
    expect(logError).toHaveBeenCalledWith('web_quiz.ch_pool_overfull', expect.objectContaining({ dropped: ['p3'], max: 2 }));
  });

  test('an unknown weights version throws', () => {
    expect(() => D.weigh([REF], 'w9')).toThrow(/weights/);
  });
});

describe('the seeded pick and the draw outcomes', () => {
  test('the pick is a pure function of the seed; p is the served id\'s weight', () => {
    const list = D.weigh([REF, P('p1', { status: 'provisional' })]);
    const a = D.pick(list, SEED);
    expect(D.pick(list, SEED)).toEqual(a);
    expect(a.p).toBeCloseTo(wOf(list)[a.id], 12);
    // over many seeds both ids are drawn, near their weights
    const n = 4000; let ref = 0;
    for (let k = 0; k < n; k += 1) if (D.pick(list, k.toString(16).padStart(8, '0') + '0'.repeat(24)).id === 'ur.read.2.setA') ref += 1;
    expect(ref / n).toBeGreaterThan(0.8);
    expect(ref / n).toBeLessThan(0.9);
  });

  test('served: the full log shape', () => {
    const d = D.drawPassage({ rows: [REF, P('p1', { status: 'provisional' })], seenIds: new Set(), kind: 'read', lang: 'ur', band: 2, band_reason: 'entry_grade', now: NOW, seed: SEED });
    expect(d).toMatchObject({ outcome: 'served', band: 2, band_reason: 'entry_grade', eligible_n: 2, ref_eligible: true, weights_v: 'w1', seed: SEED });
    expect(d.served_id).toBe(d.id);
    expect(d.eligible.map((x) => x.id)).toEqual(['ur.read.2.setA', 'p1']);
  });

  test('lower band: band 2 exhausted → band 1, fallback_exhausted; never band 3 for a band-2 child', () => {
    const rows = [REF, P('ur.read.1.ref01', { band: 1, is_reference: true }), P('ur.read.3.ref01', { band: 3, is_reference: true })];
    const d = D.drawPassage({ rows, seenIds: new Set(['ur.read.2.setA']), kind: 'read', lang: 'ur', band: 2, band_reason: 'entry_grade', now: NOW, seed: SEED });
    expect(d).toMatchObject({ outcome: 'lower_band', band: 1, band_reason: 'fallback_exhausted', id: 'ur.read.1.ref01', p: 1, eligible_n: 1, ref_eligible: true });
  });

  test('on its way: nothing unseen at band 1', () => {
    const d = D.drawPassage({ rows: [P('ur.read.1.ref01', { band: 1, is_reference: true })], seenIds: new Set(['ur.read.1.ref01']), kind: 'read', lang: 'ur', band: 1, band_reason: 'floor', now: NOW, seed: SEED });
    expect(d).toEqual({ outcome: 'on_its_way', band: 1, band_reason: 'floor', id: null, served_id: null, p: null, eligible: [], eligible_n: 0, ref_eligible: false, weights_v: 'w1', seed: null });
  });

  test('on its way after one fallback (band 2 and band 1 both exhausted); never two bands down', () => {
    const d = D.drawPassage({ rows: [REF], seenIds: new Set(['ur.read.2.setA']), kind: 'read', lang: 'ur', band: 3, band_reason: 'entry_grade', now: NOW, seed: SEED });
    expect(d).toMatchObject({ outcome: 'on_its_way', band: 2, band_reason: 'fallback_exhausted' });
  });
});

describe('record at serve, exposure counters, the period', () => {
  test('record = check, not on its way, not already counted this period', () => {
    expect(D.recordAtServe({ mode: 'check', outcome: 'served', countedThisPeriod: false })).toBe(true);
    expect(D.recordAtServe({ mode: 'check', outcome: 'lower_band', countedThisPeriod: false })).toBe(true);
    expect(D.recordAtServe({ mode: 'check', outcome: 'served', countedThisPeriod: true })).toBe(false);
    expect(D.recordAtServe({ mode: 'practice', outcome: 'served', countedThisPeriod: false })).toBe(false);
    expect(D.recordAtServe({ mode: 'check', outcome: 'on_its_way', countedThisPeriod: false })).toBe(false);
  });

  test('counted this period: a record row of this stop in this period, unless it was served and left', () => {
    const rows = [{ exercise: 'read', period_id: '2026-11', record: true, status: 'scored' }];
    expect(D.countedThisPeriod(rows, 'read', '2026-11')).toBe(true);
    expect(D.countedThisPeriod([{ ...rows[0], status: 'scoring' }], 'read', '2026-11')).toBe(true);
    expect(D.countedThisPeriod([{ ...rows[0], status: 'served' }], 'read', '2026-11')).toBe(false);
    expect(D.countedThisPeriod([{ ...rows[0], status: 'abandoned' }], 'read', '2026-11')).toBe(false);
    expect(D.countedThisPeriod(rows, 'read', '2026-12')).toBe(false);
    expect(D.countedThisPeriod(rows, 'listen', '2026-11')).toBe(false);
  });

  test('exposure_no counts every row of the passage or set; anchor_exposure_no counts check rows of the block only', () => {
    const rows = [
      { exercise: 'bigger', item_set_id: 'bigger.G3.A', status: 'abandoned', mode: 'practice' },
      { exercise: 'bigger', lang: 'en', grade: 3 },  // a row from before the provenance columns: Set A
      { exercise: 'missing', anchor_block: 'A1', mode: 'check', status: 'served' },
      { exercise: 'missing', anchor_block: 'A1', mode: 'practice', status: 'scored' },
      { exercise: 'missing', anchor_block: 'A1', mode: 'check', status: 'scored' },
    ];
    expect(D.exposureNo(rows, 'bigger.G3.A')).toBe(3);
    expect(D.exposureNo(rows, 'bigger.G5.A')).toBe(1);
    expect(D.anchorExposureNo(rows, 'A1')).toBe(3);
    expect(D.anchorExposureNo(rows, 'A2')).toBe(1);
    expect(D.anchorServesAny(rows, 'A1')).toBe(4);   // every mode and status
    expect(D.anchorServesAny(rows, 'A2')).toBe(1);
  });

  test('anchor serves before the provenance columns: a pre-v2 missing row is one A1 serve, G5 full and G3 partial', () => {
    const v2 = { exercise: 'missing', anchor_block: 'A1', mode: 'check', status: 'scored' };
    const pre = (extra) => ({ exercise: 'missing', lang: 'en', status: 'scored', ...extra });
    // the form from row.form, else meta.form, else the row's grade (2-3 → G3, 4-5 → G5)
    expect(D.anchorPrev2([pre({ grade: 5 })], 'A1')).toEqual({ full: 1, partial: 0 });
    expect(D.anchorPrev2([pre({ grade: 2 })], 'A1')).toEqual({ full: 0, partial: 1 });
    expect(D.anchorPrev2([pre({ grade: 3, form: 'G5' })], 'A1')).toEqual({ full: 1, partial: 0 });
    expect(D.anchorPrev2([pre({ grade: 5, meta: { form: '3' } })], 'A1')).toEqual({ full: 0, partial: 1 });
    expect(D.anchorPrev2([pre({ grade: 1 }), pre({ grade: null })], 'A1')).toEqual({ full: 0, partial: 0 });   // no known form: not counted
    // only 'missing' rows with no mode, and only for A1
    expect(D.anchorPrev2([pre({ grade: 5, exercise: 'bigger' }), pre({ grade: 5, mode: 'practice' })], 'A1')).toEqual({ full: 0, partial: 0 });
    expect(D.anchorPrev2([pre({ grade: 5 })], 'A2')).toEqual({ full: 0, partial: 0 });
    expect(D.anchorServesAny([pre({ grade: 5 }), pre({ grade: 3 }), v2], 'A1')).toBe(4);
    expect(D.anchorServesAny([pre({ grade: 5 })], 'A2')).toBe(1);
    expect(D.anchorExposureNo([pre({ grade: 5 })], 'A1')).toBe(1);
  });

  test('periodIdFor reads the periods table: [starts_at, ends_at)', () => {
    const periods = [
      { period_id: '2026-11', starts_at: '2026-10-31T19:00:00Z', ends_at: '2026-11-30T19:00:00Z' },
      { period_id: '2026-12', starts_at: '2026-11-30T19:00:00Z', ends_at: '2026-12-31T19:00:00Z' },
    ];
    expect(D.periodIdFor(new Date('2026-10-31T19:00:00Z'), periods)).toBe('2026-11');
    expect(D.periodIdFor(new Date('2026-11-30T18:59:59Z'), periods)).toBe('2026-11');
    expect(D.periodIdFor(new Date('2026-11-30T19:00:00Z'), periods)).toBe('2026-12');
    expect(D.periodIdFor(new Date('2027-01-05T00:00:00Z'), periods)).toBe(null);
  });
});

describe('the bigger set and the try-out item', () => {
  test('the period\'s set maps to the launch pool; an exposed set is served as practice', () => {
    expect(D.biggerSetFor('G3', '2026-11', new Set())).toEqual({ item_set_id: 'bigger.G3.A', period_set: 'bigger.G3.2026-11', practice: false });
    expect(D.biggerSetFor('G5', '2026-12', new Set(['bigger.G5.A']))).toEqual({ item_set_id: 'bigger.G5.A', period_set: 'bigger.G5.2026-12', practice: true });
  });

  test('try-out: provisional only, A2 candidates first, seeded', () => {
    const items = [
      { item_id: 'anchor.A1.01', status: 'operational' },
      { item_id: 'clone.x', status: 'provisional' },
      { item_id: 'anchor.A2.01', status: 'provisional', anchor_block_candidate: 'A2' },
      { item_id: 'anchor.A2.02', status: 'provisional', anchor_block_candidate: 'A2' },
    ];
    const t = D.tryoutItem(items, SEED);
    expect(['anchor.A2.01', 'anchor.A2.02']).toContain(t.item_id);
    expect(D.tryoutItem(items, SEED)).toEqual(t);
    expect(D.tryoutItem([items[0], items[1]], SEED).item_id).toBe('clone.x');
    expect(D.tryoutItem([items[0]], SEED)).toBe(null);
  });
});

describe('trailStateFor: this period\'s record rows, one implementation for the menu', () => {
  const CID = '11111111-2222-4333-8444-555555555555';
  test('served and final per stop, in Trail order, from record rows of this period only', async () => {
    const db = { web_quiz_challenge_runs: [
      { id: 'row1', student_id: CID, canonical_id: CID, exercise: 'missing', status: 'scored', mode: 'check', record: true, period_id: '2026-11', created_at: '2026-11-02T00:00:00Z' },
      { id: 'row2', student_id: CID, canonical_id: CID, exercise: 'read', status: 'served', mode: 'check', record: true, period_id: '2026-11', created_at: '2026-11-02T00:01:00Z', passage_id: 'en.read.1.ref01' },
      { id: 'row3', student_id: CID, canonical_id: CID, exercise: 'listen', status: 'scored', mode: 'practice', record: false, period_id: '2026-11', created_at: '2026-11-02T00:02:00Z' },
      { id: 'row4', student_id: CID, canonical_id: CID, exercise: 'bigger', status: 'scored', mode: 'check', record: true, period_id: '2026-10', created_at: '2026-10-02T00:02:00Z' },
    ] };
    Object.assign(supabase, guardColumns(makeFake(db)));
    // passage_id: the record row's passage for the menu's title (null before the draw and on the item stops)
    expect(await D.trailStateFor(CID, '2026-11')).toEqual([
      { stop: 'missing', served: true, record_row_final: true, passage_id: null },
      { stop: 'read', served: true, record_row_final: false, passage_id: 'en.read.1.ref01' },
      { stop: 'listen', served: false, record_row_final: false, passage_id: null },
      { stop: 'bigger', served: false, record_row_final: false, passage_id: null },
    ]);
  });

  test('logDraw never throws: a failed insert is logged and the serve goes on', async () => {
    Object.assign(supabase, { from: () => ({ insert: () => Promise.resolve({ error: { code: '42P01', message: 'relation "challenge_draws" does not exist' } }) }) });
    await expect(D.logDraw({ draw_id: 'x' })).resolves.toBe(false);
    expect(logError).toHaveBeenCalledWith('web_quiz.ch_draw_log_failed', expect.objectContaining({ code: '42P01' }));
  });
});
