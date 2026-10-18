'use strict';
/**
 * The period labels on the weekly health numbers (web-quiz-strip.js):
 *   - October 2026 is a short first period: every month-to-date line (cells_n30, anchor_retest_gap) carries the note
 *     "October (from 17 Oct; v3 forms; no pool)", so it is never read as a full month;
 *   - check runs written with no period (no period row on the tier) are counted, so a 0 in a month-to-date line is
 *     never read as "no children": line period_missing (value = such runs, n = the week's check runs) and its note.
 * Any other period with every run on a period: the rows and notes are byte-identical to what the strip wrote before
 * these labels existed (web-quiz-strip-period.golden.json, the same input).
 * Faked boundaries only: Supabase (the in-memory fake that applies filters), Redis (down) and the logger.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Strip = require('../../../shared/services/quiz/web-quiz-strip');
const GOLDEN = require('./web-quiz-strip-period.golden.json');

const OCT = { week: '2026-W42', now: Date.parse('2026-10-19T06:00:00Z'), at: '2026-10-14T08:00:00Z', period: '2026-10' };
const NOV = { week: '2026-W46', now: Date.parse('2026-11-16T06:00:00Z'), at: '2026-11-11T08:00:00Z', period: '2026-11' };
const OCT_NOTE = 'October (from 17 Oct; v3 forms; no pool)';
const MONTH_LINES = ['cells_n30', 'anchor_retest_gap'];

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';   // a test child ("<Name> Testwala")

let n = 0;
const run = (p, extra) => {
  n += 1;
  return {
    id: `run-${n}`, student_id: extra.canonical_id, exercise: 'read', grade: 3, lang: 'ur', status: 'scored', created_at: p.at,
    mode: 'check', bank_version: 'v3', form: 'G3', period_id: p.period, exposure_no: 1, band: 2, id_src: 'roster_pick',
    id_confidence: 'high', homonym_in_list: false, helped: 'self', record: true, meta: {}, score: { correct: 30, n: 10 }, ...extra,
  };
};
const world = (p) => ({
  web_quiz_challenge_runs: [
    run(p, { canonical_id: A }),
    run(p, { canonical_id: B, exercise: 'bigger', anchor_block: 'M2', anchor_exposure_no: 1, score: { correct: 7, n: 10 } }),
    run(p, { canonical_id: C, anchor_block: 'M2', exercise: 'bigger', anchor_exposure_no: 1, score: { correct: 5, n: 10 } }),
    run(p, { canonical_id: A, exercise: 'bigger', anchor_block: 'M2', anchor_exposure_no: 2, score: { correct: 9, n: 10 } }),
    run(p, { canonical_id: B, mode: 'practice' }),
  ],
  web_quiz_strip_weekly: [], child_rungs: [], message_ledger: [], app_settings: [],
  students: [A, B, C].map((id, i) => ({ id, student_name: `${['Ali', 'Bilal', 'Sana'][i]} Sample`, list_id: 'list-1', merged_into: null, status: 'active' }))
    .concat([{ id: T, student_name: 'Hina Testwala', list_id: null, merged_into: null, status: 'active' }]),
});
// A check run served where the tier had no period row: period_id NULL, record NULL.
const noPeriod = (p, extra) => run(p, { period_id: null, record: null, ...extra });

let db;
const install = (input) => {
  db = input;
  Object.assign(supabase, makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } }));
};
const rowsOut = () => db.web_quiz_strip_weekly.map((r) => ({ week: r.week, line: r.line, cell: r.cell, value: r.value, n: r.n, computed_at: r.computed_at }));
const line = (name, cell = '') => db.web_quiz_strip_weekly.find((r) => r.line === name && r.cell === cell);
const strip = (p) => Strip.weeklyStrip({ week: p.week, now: p.now });

afterEach(() => { jest.clearAllMocks(); n = 0; });

describe('October 2026: a short first period, labelled on every month-to-date line', () => {
  test('cells_n30 and anchor_retest_gap carry the October note; the values are unchanged', async () => {
    install(world(OCT));
    const out = await strip(OCT);
    expect(db.web_quiz_strip_weekly.some((r) => r.line === 'cells_n30')).toBe(true);
    expect(db.web_quiz_strip_weekly.some((r) => r.line === 'anchor_retest_gap')).toBe(true);
    for (const l of MONTH_LINES) expect(out.notes[l]).toBe(OCT_NOTE);
    expect(Strip.PERIOD_NOTES['2026-10']).toBe(OCT_NOTE);
    expect(out.notes).not.toHaveProperty('period_missing');
  });

  test('the note is there with no counted reading yet (a 0 month still says what month it is)', async () => {
    install({ ...world(OCT), web_quiz_challenge_runs: [] });
    const out = await strip(OCT);
    expect(db.web_quiz_strip_weekly.some((r) => r.line === 'cells_n30')).toBe(false);
    for (const l of MONTH_LINES) expect(out.notes[l]).toBe(OCT_NOTE);
  });

  test('students unreadable skips the month-to-date lines: no note on a skipped line', async () => {
    install(world(OCT));
    const realFrom = supabase.from;
    supabase.from = (t) => {
      const q = realFrom(t);
      if (t === 'students') q.then = (res) => Promise.resolve({ data: null, error: { code: '42501', message: 'denied' } }).then(res);
      return q;
    };
    const out = await strip(OCT);
    expect(out.skipped).toEqual(expect.arrayContaining(MONTH_LINES));
    for (const l of MONTH_LINES) expect(out.notes).not.toHaveProperty(l);
  });
});

describe('period missing: check runs written without a period', () => {
  test('counted on the week: value = check runs with no period, n = the week\'s check runs; practice and test children out', async () => {
    const w = world(OCT);
    w.web_quiz_challenge_runs.push(
      noPeriod(OCT, { canonical_id: A }),
      noPeriod(OCT, { canonical_id: C, status: 'failed' }),
      noPeriod(OCT, { canonical_id: B, mode: 'practice' }),             // practice: not a check run
      noPeriod(OCT, { canonical_id: T }),                               // a test child: out
      noPeriod(OCT, { canonical_id: A, created_at: '2026-10-11T08:00:00Z' }),   // the week before: out
    );
    install(w);
    const out = await strip(OCT);
    expect(line('period_missing')).toMatchObject({ value: 2, n: 6 });
    expect(out.notes.period_missing).toBe('period missing: 2 runs written without a period');
  });

  test('every run without a period: the month-to-date lines read nothing, and the line says why', async () => {
    install({ ...world(OCT), web_quiz_challenge_runs: world(OCT).web_quiz_challenge_runs.map((r) => ({ ...r, period_id: null, record: null })) });
    const out = await strip(OCT);
    expect(db.web_quiz_strip_weekly.some((r) => r.line === 'cells_n30')).toBe(false);
    expect(line('period_missing')).toMatchObject({ value: 4, n: 4 });
    expect(out.notes.period_missing).toBe('period missing: 4 runs written without a period');
  });
});

describe('golden: any other period, every run on a period', () => {
  test('November: rows and notes byte-identical to before; no October note, no period_missing', async () => {
    install(world(NOV));
    const out = await strip(NOV);
    // every row the golden holds, unchanged and in the same order; the too-fast warm-up line is new beside them
    expect(rowsOut().filter((r) => r.line !== 'rapid')).toEqual(GOLDEN.rows);
    const notes = { ...out.notes };
    delete notes.rapid;
    expect(notes).toEqual(GOLDEN.notes);
    expect(out.skipped).toEqual(GOLDEN.skipped);
    expect(rowsOut().some((r) => r.line === 'cells_n30')).toBe(true);
    expect(rowsOut().some((r) => r.line === 'period_missing')).toBe(false);
  });

  test('November, the new too-fast warm-up rows: the three anchor check rows, none marked, none all right', async () => {
    install(world(NOV));
    const out = await strip(NOV);
    expect(rowsOut().filter((r) => r.line === 'rapid').map(({ cell, value, n: k }) => ({ cell, value, n: k }))).toEqual([
      { cell: 'G23|ur|numbers', value: 0, n: 3 },
      { cell: 'G23|ur|numbers|all_right', value: 0, n: 3 },
    ]);
    expect(out.notes.rapid).toBe(Strip.LINE_NOTES.rapid);
  });
});
