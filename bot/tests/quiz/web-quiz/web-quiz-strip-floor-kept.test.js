'use strict';
/**
 * floor_kept_aligned / <lang> on the weekly health numbers (web-quiz-strip.js, computed in web-quiz-strip-lines.js):
 * of the week's kept failed check reads (exercise 'read', mode 'check', record true, status 'failed'), test children
 * left out, those that heard fewer words than the floor (meta.stt_words < max(3, ceil(0.1 × the passage's tokens)))
 * yet matched at least one passage word (meta.align_correct ≥ 1): a chance match on a noisy recording keeps the record.
 * The passage tokens come from challenge_passages in one read, only when there is a failed row to look up.
 * Faked boundaries only: Supabase (the in-memory fake that applies filters), Redis (down) and the logger.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Strip = require('../../../shared/services/quiz/web-quiz-strip');
const Lines = require('../../../shared/services/quiz/web-quiz-strip-lines');

const WEEK = '2026-W42';                          // Mon 12 Oct – Sun 18 Oct 2026, PKT
const NOW = Date.parse('2026-10-19T06:00:00Z');
const RUNS = 'web_quiz_challenge_runs';
const kid = (i) => `stu-${i}`;
const T = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';   // a test child ("<Name> Testwala")

let n = 0;
const run = (extra) => {
  n += 1;
  return {
    id: `run-${n}`, student_id: extra.canonical_id, exercise: 'read', grade: 3, lang: 'ur', status: 'scored', created_at: '2026-10-14T08:00:00Z',
    mode: 'check', form: 'G3', period_id: '2026-10', exposure_no: 1, band: 2, id_src: 'roster_pick', id_confidence: 'high',
    homonym_in_list: false, helped: 'self', record: true, meta: {}, score: { correct: 0 }, passage_id: 'ur.read.2.setA', ...extra,
  };
};
// a kept failed check read: the record stays, nothing was credited
const kept = (child, meta, extra = {}) => run({ canonical_id: child, status: 'failed', meta, ...extra });

const PASSAGES = [
  { passage_id: 'ur.read.2.setA', lang: 'ur', tokens: 60 },     // floor max(3, 6) = 6
  { passage_id: 'en.read.1.setA', lang: 'en', tokens: 20 },     // floor max(3, 2) = 3
  { passage_id: 'ur.read.3.setB', lang: 'ur', tokens: null },   // tokens unknown
];

let db;
let passageReads;
const install = (runs, extra = {}) => {
  db = {
    [RUNS]: runs, web_quiz_strip_weekly: [], child_rungs: [], message_ledger: [], app_settings: [], challenge_passages: PASSAGES.map((p) => ({ ...p })),
    students: [{ id: T, student_name: 'Hina Testwala', list_id: null }],
    ...extra,
  };
  const fake = makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } });
  passageReads = [];
  Object.assign(supabase, fake, {
    from: (t) => {
      const b = fake.from(t);
      if (t !== 'challenge_passages') return b;
      const read = { select: null, in: null };
      passageReads.push(read);
      const select = b.select; const inFn = b.in;
      b.select = (cols, o) => { read.select = cols; return select(cols, o); };
      b.in = (c, vs) => { read.in = [c, [...vs]]; return inFn(c, vs); };
      return b;
    },
  });
};
const line = (name, cell = '') => db.web_quiz_strip_weekly.find((r) => r.line === name && r.cell === cell);
const lines = (name) => db.web_quiz_strip_weekly.filter((r) => r.line === name);
const strip = () => Strip.weeklyStrip({ week: WEEK, now: NOW });

afterEach(() => { jest.clearAllMocks(); n = 0; });

describe('floor_kept_aligned / <lang>: kept failed reads under the heard-words floor that matched a passage word', () => {
  test('the floor is the scorer\'s: max(3, ceil(10 % of the tokens))', () => {
    expect(Lines.FLOOR_MIN).toBe(3);
    expect(Lines.FLOOR_SHARE).toBe(0.1);
  });

  test('value = under the floor with align ≥ 1; n = the kept failed check reads; everything else left out', async () => {
    install([
      // count: 2 heard on a 60-token passage (floor 6), 1 matched
      kept(kid(1), { stt_words: 2, align_correct: 1 }),
      kept(kid(2), { stt_words: 5, align_correct: 3 }),
      // in n, not in value
      kept(kid(3), { stt_words: 2, align_correct: 0 }),                       // matched nothing
      kept(kid(4), { stt_words: 6, align_correct: 2 }),                       // at the floor: heard enough
      kept(kid(5), { stt_words: 40, align_correct: 1 }),                      // well above the floor
      kept(kid(6), {}),                                                       // nothing recorded: 0 heard, 0 matched
      // out of both
      run({ canonical_id: kid(7), meta: { stt_words: 2, align_correct: 1 } }),                               // scored
      kept(kid(8), { stt_words: 2, align_correct: 1 }, { record: false }),                                  // not kept
      kept(kid(9), { stt_words: 2, align_correct: 1 }, { mode: 'practice' }),                               // practice
      kept(kid(10), { stt_words: 2, align_correct: 1 }, { exercise: 'listen' }),                            // not a read
      kept(T, { stt_words: 2, align_correct: 1 }),                                                          // a test child
      kept(kid(11), { stt_words: 2, align_correct: 1, test: true }),                                        // a row the serve marked as a test
      kept(kid(12), { stt_words: 2, align_correct: 1 }, { created_at: '2026-10-11T08:00:00Z' }),            // the week before
      kept(kid(13), { stt_words: 2, align_correct: 1 }, { created_at: '2026-10-19T08:00:00Z' }),            // the week after
    ]);
    const out = await strip();
    expect(line('floor_kept_aligned', 'ur')).toMatchObject({ value: 2, n: 6 });
    expect(lines('floor_kept_aligned')).toHaveLength(1);
    expect(out.skipped).not.toContain('floor_kept_aligned');
    expect(out.notes).not.toHaveProperty('floor_kept_aligned');
  });

  test('one cell per language, each on its own passage\'s floor; a language with no kept failed read prints no row', async () => {
    install([
      kept(kid(1), { stt_words: 2, align_correct: 1 }),                                            // ur: 2 < 6
      kept(kid(2), { stt_words: 2, align_correct: 1 }, { lang: 'en', passage_id: 'en.read.1.setA' }),   // en: 2 < 3
      kept(kid(3), { stt_words: 3, align_correct: 1 }, { lang: 'en', passage_id: 'en.read.1.setA' }),   // en: 3 = floor 3
      run({ canonical_id: kid(4), lang: 'xx', meta: { stt_words: 2, align_correct: 1 } }),          // scored only
    ]);
    await strip();
    expect(line('floor_kept_aligned', 'ur')).toMatchObject({ value: 1, n: 1 });
    expect(line('floor_kept_aligned', 'en')).toMatchObject({ value: 1, n: 2 });
    expect(lines('floor_kept_aligned').map((r) => r.cell)).toEqual(['en', 'ur']);
  });

  test('the passages are read once, for the ids the kept failed rows name', async () => {
    install([
      kept(kid(1), { stt_words: 2, align_correct: 1 }),
      kept(kid(2), { stt_words: 2, align_correct: 1 }),
      kept(kid(3), { stt_words: 2, align_correct: 1 }, { lang: 'en', passage_id: 'en.read.1.setA' }),
      run({ canonical_id: kid(4), passage_id: 'ur.read.9.setZ' }),                                  // scored: not looked up
    ]);
    await strip();
    expect(passageReads).toHaveLength(1);
    expect(passageReads[0].select).toBe('passage_id, tokens');
    expect(passageReads[0].in[0]).toBe('passage_id');
    expect([...passageReads[0].in[1]].sort()).toEqual(['en.read.1.setA', 'ur.read.2.setA']);
  });

  test('a row whose passage has no tokens counts in n, not in value, and the line says how many', async () => {
    install([
      kept(kid(1), { stt_words: 2, align_correct: 1 }),
      kept(kid(2), { stt_words: 1, align_correct: 1 }, { passage_id: 'ur.read.3.setB' }),   // tokens null
      kept(kid(3), { stt_words: 1, align_correct: 1 }, { passage_id: 'ur.read.0.gone' }),   // no passage row
      kept(kid(4), { stt_words: 1, align_correct: 1 }, { passage_id: null }),               // no passage named
    ]);
    const out = await strip();
    expect(line('floor_kept_aligned', 'ur')).toMatchObject({ value: 1, n: 4 });
    expect(out.notes.floor_kept_aligned).toBe('tokens unknown for 3 rows');
  });

  test('no kept failed read: no passage read and no row', async () => {
    install([
      run({ canonical_id: kid(1), meta: { stt_words: 2, align_correct: 1 } }),
      kept(kid(2), { stt_words: 2, align_correct: 1 }, { record: false }),
    ]);
    const out = await strip();
    expect(passageReads).toHaveLength(0);
    expect(lines('floor_kept_aligned')).toEqual([]);
    expect(out.skipped).not.toContain('floor_kept_aligned');
  });

  test('the runs read failing skips only this line, named in skipped', async () => {
    install([kept(kid(1), { stt_words: 2, align_correct: 1 })]);
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== RUNS) return b;
      const eq = b.eq;
      b.eq = (c, v) => {
        if (c === 'status' && v === 'failed') b.then = (res) => Promise.resolve({ data: null, error: { code: 'XX000', message: 'boom' } }).then(res);
        return eq(c, v);
      };
      return b;
    };
    const out = await strip();
    expect(lines('floor_kept_aligned')).toEqual([]);
    expect(out.skipped).toContain('floor_kept_aligned');
    expect(line('sent', 'capped')).toBeDefined();
  });

  test('the passages read failing skips only this line, named in skipped', async () => {
    install([kept(kid(1), { stt_words: 2, align_correct: 1 })]);
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'challenge_passages') b.then = (res) => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }).then(res);
      return b;
    };
    const out = await strip();
    expect(lines('floor_kept_aligned')).toEqual([]);
    expect(out.skipped).toContain('floor_kept_aligned');
    expect(line('sent', 'capped')).toBeDefined();
  });
});
