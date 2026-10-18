'use strict';
/**
 * The too-fast perfect warm-ups on the weekly health numbers (web-quiz-strip.js, line `rapid`): of the week's scored
 * check rows that are the record and carry an anchor block, per cell (band × language × ladder):
 *   rapid / <cell>            value = rows the serve marked meta.quality = 'rapid_perfect'; n = the cell's rows
 *   rapid / <cell>|all_right  value = rows with every warm-up item right (score.correct = score.n = 10); n = the same
 * A test child's rows are dropped first (the one fixture rule, web-quiz-fixture.js), then the quality is read, so a
 * test child's too-fast row never enters either count. The all-right share has no earlier figure to compare with:
 * the result's notes say it is a watch only.
 * Faked boundaries only: Supabase (the in-memory fake that applies filters), Redis (down) and the logger.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Strip = require('../../../shared/services/quiz/web-quiz-strip');

const WEEK = '2026-W46';                          // Mon 9 Nov – Sun 15 Nov 2026, PKT
const AT = '2026-11-11T08:00:00Z';
const NOW = Date.parse('2026-11-16T06:00:00Z');
const CELL = 'G23|ur|numbers';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const T = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';   // a test child ("<Name> Testwala")

let n = 0;
/** A scored record check row of the A1 warm-up (the missing-number block): 10 items, `ok` of them right. */
const warm = (child, ok, extra = {}) => {
  n += 1;
  return {
    id: `run-${n}`, student_id: child, canonical_id: child, exercise: 'missing', grade: 3, lang: 'ur', status: 'scored', created_at: AT,
    mode: 'check', bank_version: 'v3', form: 'G3', period_id: '2026-11', exposure_no: 1, band: 2, id_src: 'roster_pick',
    id_confidence: 'high', homonym_in_list: false, helped: 'self', record: true, anchor_block: 'A1', anchor_exposure_no: 1,
    meta: {}, score: { correct: ok, correct_5s: ok, n: 10, stopped: false, reached: 10 }, ...extra,
  };
};
const RAPID = { quality: 'rapid_perfect' };
const students = () => [A, B, C, D].map((id, i) => ({ id, student_name: `${['Ali', 'Bilal', 'Sana', 'Zara'][i]} Sample`, list_id: 'list-1', merged_into: null, status: 'active' }))
  .concat([{ id: T, student_name: 'Hina Testwala', list_id: null, merged_into: null, status: 'active' }]);

let db;
const install = (runs) => {
  db = { web_quiz_challenge_runs: runs, web_quiz_strip_weekly: [], child_rungs: [], message_ledger: [], app_settings: [], students: students() };
  Object.assign(supabase, makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } }));
};
const line = (name, cell = '') => db.web_quiz_strip_weekly.find((r) => r.line === name && r.cell === cell);
const rapidRows = () => db.web_quiz_strip_weekly.filter((r) => r.line === 'rapid').map(({ cell, value, n: k }) => ({ cell, value, n: k }));
const strip = () => Strip.weeklyStrip({ week: WEEK, now: NOW });
// one too-fast 10/10, one 10/10 at a reading pace, one 7/10: the three anchor record check rows of one cell
const three = () => [warm(A, 10, { meta: RAPID }), warm(B, 10), warm(C, 7)];

afterEach(() => { jest.clearAllMocks(); n = 0; });

describe('rapid: too-fast perfect warm-ups per cell', () => {
  test('three anchor record check rows in one cell: rapid 1 of 3, all right 2 of 3; the all-right share noted as a watch', async () => {
    install(three());
    const out = await strip();
    expect(line('rapid', CELL)).toMatchObject({ value: 1, n: 3 });
    expect(line('rapid', `${CELL}|all_right`)).toMatchObject({ value: 2, n: 3 });
    expect(rapidRows()).toHaveLength(2);
    expect(out.notes.rapid).toBe('all_right: no prior; watch only');
  });

  test('a test child\'s too-fast 10/10 in the same cell never enters: value and n unchanged (the fixture rule first)', async () => {
    install(three());
    await strip();
    const alone = rapidRows();

    n = 0;
    install([
      ...three(),
      warm(T, 10, { meta: RAPID }),                       // a "<Name> Testwala" child
      warm(D, 10, { meta: { ...RAPID, test: true } }),    // a row the serve marked as a test child's
    ]);
    await strip();
    expect(rapidRows()).toEqual(alone);
    expect(line('rapid', CELL)).toMatchObject({ value: 1, n: 3 });
    expect(line('rapid', `${CELL}|all_right`)).toMatchObject({ value: 2, n: 3 });
    expect(line('fixtures_excluded')).toMatchObject({ value: 2 });
  });

  test('practice and class rows, rows not the record, unscored rows and rows with no anchor block never enter', async () => {
    install([
      ...three(),
      warm(D, 10, { meta: RAPID, mode: 'practice', record: false }),
      warm(D, 10, { meta: RAPID, mode: 'class', record: false }),
      warm(D, 10, { meta: RAPID, record: false }),
      warm(D, 10, { meta: RAPID, record: null }),
      warm(D, 10, { meta: RAPID, status: 'failed' }),
      warm(D, 10, { meta: RAPID, anchor_block: null }),
      warm(D, 10, { meta: RAPID, created_at: '2026-11-08T08:00:00Z' }),   // the week before
    ]);
    await strip();
    expect(line('rapid', CELL)).toMatchObject({ value: 1, n: 3 });
    expect(line('rapid', `${CELL}|all_right`)).toMatchObject({ value: 2, n: 3 });
  });

  test('cells are band × language × ladder: a reading warm-up and an English row each get their own cell', async () => {
    install([
      ...three(),
      warm(D, 10, { exercise: 'read', meta: RAPID }),
      warm(D, 10, { lang: 'en' }),
    ]);
    await strip();
    expect(line('rapid', CELL)).toMatchObject({ value: 1, n: 3 });
    expect(line('rapid', 'G23|ur|reading')).toMatchObject({ value: 1, n: 1 });
    expect(line('rapid', 'G23|ur|reading|all_right')).toMatchObject({ value: 1, n: 1 });
    expect(line('rapid', 'G23|en|numbers')).toMatchObject({ value: 0, n: 1 });
    expect(line('rapid', 'G23|en|numbers|all_right')).toMatchObject({ value: 1, n: 1 });
  });

  test('no anchor record check row in the week: no rapid row and no rapid note', async () => {
    install([warm(A, 10, { anchor_block: null, exercise: 'read' })]);
    const out = await strip();
    expect(rapidRows()).toEqual([]);
    expect(out.notes).not.toHaveProperty('rapid');
  });

  test('no new read and no new write: the queries are the reads made without the anchor rows, plus one upsert per new row', async () => {
    const record = () => {
      const qs = [];
      const realFrom = supabase.from;
      supabase.from = (t) => { qs.push(t); return realFrom(t); };
      return qs;
    };
    install(three().map((r) => ({ ...r, anchor_block: null, meta: {} })));
    const before = record();
    await strip();
    const without = before.filter((t) => t !== 'web_quiz_strip_weekly').length;

    n = 0;
    install(three());
    const after = record();
    await strip();
    expect(after.filter((t) => t !== 'web_quiz_strip_weekly').length).toBe(without);
    // the strip table: one update + one insert per row written, and the two reads of its own daily rows
    const rowsWritten = db.web_quiz_strip_weekly.length;
    expect(after.filter((t) => t === 'web_quiz_strip_weekly').length).toBe(2 * rowsWritten + 2);
  });
});
