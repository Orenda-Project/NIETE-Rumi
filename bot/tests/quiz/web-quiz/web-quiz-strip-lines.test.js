'use strict';
/**
 * Two more line sets on the weekly health numbers (web-quiz-strip.js, computed in web-quiz-strip-lines.js):
 *   - recognised_without_typing / <first|le7|gt7>: children with a scored check run in the week, by the days from
 *     their previous run (any mode) to their latest one; value = recognised without typing, n = the bucket;
 *   - kept_audio_all: under keep-all, the readings with a recording that still name a kept object;
 * Faked boundaries only: Supabase (the in-memory fake that applies filters), Redis (down) and the logger.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Strip = require('../../../shared/services/quiz/web-quiz-strip');

const WEEK = '2026-W42';                          // Mon 12 Oct – Sun 18 Oct 2026, PKT
const NOW = Date.parse('2026-10-19T06:00:00Z');
const RUNS = 'web_quiz_challenge_runs';
const kid = (i) => `stu-${i}`;
const KEY = (r) => `child-voice/sandbox/kept/2026-10-01/${r}/read-1700000000000.webm`;

let n = 0;
const run = (extra) => {
  n += 1;
  return {
    id: `run-${n}`, student_id: extra.canonical_id, exercise: 'read', grade: 3, lang: 'ur', status: 'scored', created_at: '2026-10-14T08:00:00Z',
    mode: 'check', form: 'G3', period_id: '2026-10', exposure_no: 1, band: 2, id_src: 'roster_pick', id_confidence: 'high',
    homonym_in_list: false, helped: 'self', record: true, meta: {}, score: { correct: 30 }, ...extra,
  };
};

let db;
const install = (runs, extra = {}) => {
  db = { [RUNS]: runs, web_quiz_strip_weekly: [], child_rungs: [], message_ledger: [], ...extra };
  Object.assign(supabase, makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } }));
};
const line = (name, cell = '') => db.web_quiz_strip_weekly.find((r) => r.line === name && r.cell === cell);
const lines = (name) => db.web_quiz_strip_weekly.filter((r) => r.line === name);
const strip = () => Strip.weeklyStrip({ week: WEEK, now: NOW });

afterEach(() => { jest.clearAllMocks(); n = 0; });

describe('recognised_without_typing by days since the last visit', () => {
  test('first / le7 / gt7 from the previous run of any mode; value = recognised, n = children in the bucket', async () => {
    install([
      // first: no earlier run at all; recognised (roster pick)
      run({ canonical_id: kid(1) }),
      // first: typed (not recognised)
      run({ canonical_id: kid(2), id_src: 'typed_new' }),
      // le7: a practice run three days before the week's run (inside the week); remembered
      run({ canonical_id: kid(3), mode: 'practice', created_at: '2026-10-12T08:00:00Z' }),
      run({ canonical_id: kid(3), id_src: 'remembered', created_at: '2026-10-15T08:00:00Z' }),
      // le7: an earlier run before the week (5 days before), latest typed: in the bucket, not recognised
      run({ canonical_id: kid(4), created_at: '2026-10-09T08:00:00Z', status: 'failed' }),
      run({ canonical_id: kid(4), id_src: 'forced_new' }),
      // le7: the LATEST run of the week decides (hub_chip), not the earlier typed one an hour before it
      run({ canonical_id: kid(5), id_src: 'typed_new', created_at: '2026-10-13T08:00:00Z' }),
      run({ canonical_id: kid(5), id_src: 'hub_chip', created_at: '2026-10-13T09:00:00Z' }),
      // gt7: phone_bound, last seen 8 days before; a legacy row with no canonical id is the same child by student_id
      { id: 'legacy-6', student_id: kid(6), exercise: 'bigger', status: 'scored', created_at: '2026-10-06T08:00:00Z', meta: {} },
      run({ canonical_id: kid(6), id_src: 'phone_bound' }),
      // not a child of the line: practice only in the week
      run({ canonical_id: kid(7), mode: 'practice' }),
      // gt7: last seen 20 days before, typed: in the bucket, not recognised
      run({ canonical_id: kid(9), created_at: '2026-09-24T08:00:00Z' }),
      run({ canonical_id: kid(9), id_src: 'typed_new' }),
      // first: an earlier run past the look-back (40 days) does not count
      run({ canonical_id: kid(8), created_at: '2026-09-04T08:00:00Z' }),
      run({ canonical_id: kid(8) }),
    ]);
    await strip();
    expect(line('recognised_without_typing', 'first')).toMatchObject({ value: 2, n: 3 });
    expect(line('recognised_without_typing', 'le7')).toMatchObject({ value: 2, n: 3 });
    expect(line('recognised_without_typing', 'gt7')).toMatchObject({ value: 1, n: 2 });
  });

  test('the earlier-run read is chunked: 450 children never send more than 200 ids in one list', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => run({ canonical_id: kid(1000 + i) }));
    install(rows);
    await strip();
    expect(line('recognised_without_typing', 'first')).toMatchObject({ value: 450, n: 450 });
    expect(supabase.calls.some((c) => c.overflow)).toBe(false);
  });

  test('the earlier-run read failing skips only this line, named in skipped', async () => {
    install([run({ canonical_id: kid(1) })]);
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== RUNS) return b;
      const inFn = b.in;
      b.in = (c, vs) => { if (c === 'mode') return inFn(c, vs); b.then = (res) => Promise.resolve({ data: null, error: { code: 'XX000', message: 'boom' } }).then(res); return inFn(c, vs); };
      return b;
    };
    const out = await strip();
    expect(lines('recognised_without_typing')).toEqual([]);
    expect(out.skipped).toContain('recognised_without_typing');
    expect(line('plays', 'check')).toMatchObject({ value: 1 });
  });
});

describe('kept_audio_all under keep-all', () => {
  test('of scored check / practice readings with a recording in 90 days, those naming a kept object', async () => {
    install([
      run({ canonical_id: kid(1), meta: { audio_key: KEY('a') } }),
      run({ canonical_id: kid(2), mode: 'practice', meta: { audio_key: KEY('b') } }),
      run({ canonical_id: kid(3), meta: { audio_kept: false } }),                         // plain key deleted, switch on
      run({ canonical_id: kid(4), meta: { audio_key: null, audio_purged_on: '2026-10-16' } }),   // purged since
      run({ canonical_id: kid(5), meta: {} }),                                              // switch off: no trace
      run({ canonical_id: kid(6), status: 'failed', meta: { audio_key: KEY('c') } }),       // not scored
      run({ canonical_id: kid(7), mode: 'class_round', meta: { audio_key: KEY('d') } }),    // not check / practice
      run({ canonical_id: kid(8), created_at: '2026-07-01T08:00:00Z', meta: { audio_key: KEY('e') } }),   // past 90 days
    ]);
    await strip();
    expect(line('kept_audio_all')).toMatchObject({ value: 2, n: 4 });
  });

  test('the three kept lines stay as they were (golden)', async () => {
    install([run({ canonical_id: kid(1), meta: { audio_key: KEY('a') } })]);
    await strip();
    expect(line('kept_audio_keys')).toMatchObject({ value: 1, n: 0 });
    expect(line('kept_audio_match')).toMatchObject({ value: 0, n: 1 });
    expect(line('kept_audio_oldest_d')).toMatchObject({ n: 1 });
  });
});
