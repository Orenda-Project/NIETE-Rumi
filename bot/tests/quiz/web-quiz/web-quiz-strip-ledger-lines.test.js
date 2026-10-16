'use strict';
/**
 * Two more line sets on the weekly health numbers (web-quiz-strip.js, computed in web-quiz-strip-lines.js):
 *   - sent / capped: of the week's sends on the ledger (message_ledger, Σ count), the replies the per-phone daily cap
 *     refused (Σ capped);
 *   - bind_funnel / codes and bind_funnel / bound: of the save codes minted in the week (child_bind_codes), those
 *     used, and those that made a binding still active at the week's cut (child_phone_bindings.code_id). The
 *     denominator is codes, never events. A test child's codes never count (web-quiz-fixture.js).
 * Faked boundaries only: Supabase (the in-memory fake that applies filters, wrapped in the strict-columns check so an
 * unknown column fails as PostgREST does), Redis (down) and the logger. The golden file holds what the strip wrote
 * before these lines existed, for the same input: those rows must stay byte-identical.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));

const { makeFake } = require('./fake-supabase');
const { strictFrom } = require('./strict-columns');
const supabase = require('../../../shared/config/supabase');
const Strip = require('../../../shared/services/quiz/web-quiz-strip');
const GOLDEN = require('./web-quiz-strip-ledger-lines.golden.json');

const WEEK = '2026-W42';                          // Mon 12 Oct – Sun 18 Oct 2026, PKT (days 2026-10-12 … 2026-10-18)
const NOW = Date.parse('2026-10-19T06:00:00Z');
const END = '2026-10-18T19:00:00.000Z';           // the week's cut (Monday 00:00 PKT)
const NEW_LINES = ['sent', 'bind_funnel', 'implausible', 'floor_kept_aligned'];
const READ_COLS = 'id, student_id, canonical_id, class_id, lang, meta, created_at';   // the implausible line's own read
const FLOOR_COLS = 'id, student_id, canonical_id, class_id, lang, passage_id, meta, created_at';   // the floor_kept_aligned line's own read
const STRICT = ['message_ledger', 'child_bind_codes', 'child_phone_bindings', 'web_quiz_challenge_runs'];

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const T = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff';   // a child known only by a run row marked as a test   // a test child ("<Name> Testwala")

let n = 0;
const run = (extra) => {
  n += 1;
  return {
    id: `run-${n}`, student_id: extra.canonical_id, exercise: 'read', grade: 3, lang: 'ur', status: 'scored', created_at: '2026-10-14T08:00:00Z',
    mode: 'check', form: 'G3', period_id: '2026-10', exposure_no: 1, band: 2, id_src: 'roster_pick', id_confidence: 'high',
    homonym_in_list: false, helped: 'self', record: true, meta: {}, score: { correct: 30 }, ...extra,
  };
};
const led = (day, trigger, count, capped, extra = {}) => ({
  day, trigger, class_id: null, initiated: 'user', recipient: trigger.startsWith('teacher') ? 'teacher' : 'family', count, usd: count * 0.015, capped, ...extra,
});
const code = (c, child, minted, extra = {}) => ({
  code: `JUGNU-${c}`, canonical_id: child, device_ref: null, minted_at: minted,
  expires_at: new Date(Date.parse(minted) + 3600e3).toISOString(), used_at: null, outcome: null, ...extra,
});
const bind = (id, child, codeId, extra = {}) => ({
  id, canonical_id: child, phone_norm: 'synthetic-phone', phone_tomb: 'f'.repeat(32), via: 'save', confirmed_at: '2026-10-14T09:00:00Z',
  bound_at: '2026-10-14T09:00:00Z', expires_at: '2027-03-31T18:59:59Z', revoked_at: null, revoked_by: null, code_id: codeId, ...extra,
});

/** The fixed input of the golden (and of the readable cases). */
const world = () => ({
  web_quiz_challenge_runs: [
    run({ canonical_id: A }),
    run({ canonical_id: B, helped: 'helped', class_id: 'cls-1' }),
    run({ canonical_id: C, status: 'failed', exercise: 'read' }),
    run({ canonical_id: D, mode: 'practice' }),
  ],
  web_quiz_strip_weekly: [],
  child_rungs: [],
  app_settings: [],
  students: [
    { id: A, student_name: 'Amna Example', list_id: null }, { id: B, student_name: 'Bilal Example', list_id: null },
    { id: C, student_name: 'Sana Example', list_id: null }, { id: D, student_name: 'Zara Example', list_id: null },
    { id: T, student_name: 'Hina Testwala', list_id: null },
  ],
  message_ledger: [
    led('2026-10-12', 'home_reply', 5, 2),
    led('2026-10-13', 'bind_reply', 3, 1),
    led('2026-10-18', 'guest_reply', 0, 4),                 // a day where every reply was refused: a capped-only row
    led('2026-10-15', 'class_link', 2, 0, { initiated: 'user', recipient: 'teacher', class_id: 'cls-1' }),
    led('2026-10-11', 'home_reply', 7, 9),                  // the Sunday before the week
    led('2026-10-19', 'home_reply', 1, 6),                  // the Monday after
  ],
  child_bind_codes: [
    code('AAAA2', A, '2026-10-13T08:00:00Z', { used_at: '2026-10-13T08:10:00Z', outcome: 'bound' }),        // used, bound, active
    code('BBBB2', B, '2026-10-13T09:00:00Z', { used_at: '2026-10-13T09:05:00Z', outcome: 'max_kids' }),     // used, refused
    code('CCCC2', C, '2026-10-14T09:00:00Z'),                                                              // never used
    code('DDDD2', D, '2026-10-15T09:00:00Z', { used_at: '2026-10-15T09:01:00Z', outcome: 'bound' }),        // bound, undone in the week
    code('AAAA3', A, '2026-10-18T18:30:00Z', { used_at: '2026-10-18T19:20:00Z', outcome: 'bound' }),        // minted in, used after the cut
    code('TTTT2', T, '2026-10-14T10:00:00Z', { used_at: '2026-10-14T10:01:00Z', outcome: 'bound' }),        // a test child: out
    code('AAAA4', A, '2026-10-11T08:00:00Z', { used_at: '2026-10-11T08:01:00Z', outcome: 'bound' }),        // minted before the week
  ],
  child_phone_bindings: [
    bind('b1', A, 'JUGNU-AAAA2'),
    bind('b2', D, 'JUGNU-DDDD2', { phone_norm: null, revoked_at: '2026-10-16T00:00:00Z', revoked_by: 'page_undo' }),
    bind('b3', A, 'JUGNU-AAAA3', { bound_at: '2026-10-18T19:20:00Z' }),                                    // bound after the cut
    bind('b4', T, 'JUGNU-TTTT2'),
    bind('b5', A, 'JUGNU-AAAA4', { bound_at: '2026-10-11T08:01:00Z' }),
    bind('b6', B, null),                                                                                   // made before code_id
  ],
});

let db;
let fake;
/**
 * Install the fake. `fail(table, sel, ins)` → an error object makes that read answer it (sel: the select string,
 * ins: the column of an .in() filter), as PostgREST does for a table or column not there yet.
 */
const install = (input, fail = () => null) => {
  db = input;
  fake = makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } });
  // a json path filter is not a column name: the kept-audio read's own path is admitted as written
  const strict = strictFrom(fake.from, STRICT, { web_quiz_challenge_runs: ['meta->>audio_key'] });
  Object.assign(supabase, fake, {
    from: (t) => {
      const b = strict(t);
      const st = { sel: '', ins: null };
      const proxy = new Proxy(b, {
        get(target, k) {
          const v = target[k];
          if (k === 'then') {
            const err = fail(t, st.sel, st.ins);
            return err ? (res, rej) => Promise.resolve({ data: null, error: err }).then(res, rej) : v;
          }
          if (typeof v !== 'function') return v;
          return (...args) => {
            if (k === 'select' && typeof args[0] === 'string') st.sel = args[0];
            if (k === 'in') st.ins = args[0];
            const r = v.apply(target, args);
            return r === target ? proxy : r;
          };
        },
      });
      return proxy;
    },
  });
};
const MISSING_TABLE = (t) => ({ code: '42P01', message: `relation "${t}" does not exist` });
const MISSING_COL = (c) => ({ code: '42703', message: `column ${c} does not exist` });

const stripRows = () => db.web_quiz_strip_weekly.map((r) => ({ week: r.week, line: r.line, cell: r.cell, value: r.value, n: r.n, computed_at: r.computed_at }));
const existing = () => stripRows().filter((r) => !NEW_LINES.includes(r.line));
const line = (name, cell = '') => db.web_quiz_strip_weekly.find((r) => r.line === name && r.cell === cell);
const lines = (name) => db.web_quiz_strip_weekly.filter((r) => r.line === name);
const strip = () => Strip.weeklyStrip({ week: WEEK, now: NOW });

afterEach(() => { jest.clearAllMocks(); n = 0; });

describe('sent / capped from the ledger', () => {
  test("value = the week's refusals at the per-phone cap (Σ capped), n = the week's sends (Σ count); other weeks out", async () => {
    install(world());
    await strip();
    expect(line('sent', 'capped')).toMatchObject({ value: 7, n: 10 });
    expect(Strip.weekBounds(WEEK).end).toBe(END);
  });

  test('the ledger read pages: more than a page of rows is all counted', async () => {
    const rows = Array.from({ length: 1205 }, (_, i) => led('2026-10-14', 'class_round', 1, i % 2,
      { initiated: 'bot', recipient: 'teacher', class_id: `0000${String(i).padStart(4, '0')}-0000-4000-8000-000000000000` }));
    install({ ...world(), message_ledger: rows });
    await strip();
    expect(line('sent', 'capped')).toMatchObject({ value: 602, n: 1205 });
  });

  test('the capped column not there yet: only this line is skipped, named in skipped; the send lines stay', async () => {
    install(world(), (t, sel) => (t === 'message_ledger' && /capped/.test(sel) ? MISSING_COL('message_ledger.capped') : null));
    const out = await strip();
    expect(lines('sent')).toEqual([]);
    expect(out.skipped).toContain('sent');
    expect(out.skipped).not.toContain('sends');
    expect(line('sends_total')).toMatchObject({ value: 10, n: 10 });
  });
});

describe('bind_funnel: save codes minted in the week', () => {
  test('codes: value = used, n = minted (test children out); bound: active bindings at the cut made by those codes', async () => {
    install(world());
    await strip();
    // minted in the week, real children: AAAA2, BBBB2, CCCC2, DDDD2, AAAA3 → 5; used: all but CCCC2 → 4
    expect(line('bind_funnel', 'codes')).toMatchObject({ value: 4, n: 5 });
    // AAAA2's binding only: DDDD2's was undone in the week, AAAA3's was bound after the cut
    expect(line('bind_funnel', 'bound')).toMatchObject({ value: 1, n: 5 });
  });

  test('a test child is out by the shared fixture rule (a configured seed list too), not only by name', async () => {
    const w = world();
    w.app_settings = [{ key: 'web_quiz_fixture_rule', value: { student_lists: ['seed-list-1'] } }];
    w.students.find((s) => s.id === A).list_id = 'seed-list-1';
    install(w);
    await strip();
    expect(line('bind_funnel', 'codes')).toMatchObject({ value: 2, n: 3 });   // BBBB2, CCCC2, DDDD2
    expect(line('bind_funnel', 'bound')).toMatchObject({ value: 0, n: 3 });
  });

  test('the bindings read is chunked: 450 codes never send more than 200 in one list', async () => {
    const kids = Array.from({ length: 450 }, (_, i) => `1${String(i).padStart(7, '0')}-0000-4000-8000-000000000000`);
    const codes = kids.map((k, i) => code(`Z${String(i).padStart(4, '0')}`, k, '2026-10-14T08:00:00Z',
      { used_at: '2026-10-14T08:01:00Z', outcome: 'bound' }));
    const binds = kids.map((k, i) => bind(`z${i}`, k, `JUGNU-Z${String(i).padStart(4, '0')}`));
    install({ ...world(), students: [], child_bind_codes: codes, child_phone_bindings: binds });
    await strip();
    expect(line('bind_funnel', 'codes')).toMatchObject({ value: 450, n: 450 });
    expect(line('bind_funnel', 'bound')).toMatchObject({ value: 450, n: 450 });
    expect(fake.calls.some((c) => c.overflow)).toBe(false);
  });

  test('the bindings read failing skips only the bound line; the codes line stays', async () => {
    install(world(), (t, sel, ins) => (t === 'child_phone_bindings' && ins === 'code_id' ? MISSING_COL('child_phone_bindings.code_id') : null));
    const out = await strip();
    expect(line('bind_funnel', 'codes')).toMatchObject({ value: 4, n: 5 });
    expect(line('bind_funnel', 'bound')).toBeUndefined();
    expect(out.skipped).toContain('bind_funnel_bound');
    expect(line('replies_per_bound_child')).toBeDefined();
  });
});

describe('golden: the lines that were there stay byte-identical', () => {
  test('the new inputs unreadable: the old rows exactly as before, the new lines named in skipped', async () => {
    install(world(), (t, sel) => {
      if (t === 'child_bind_codes') return MISSING_TABLE(t);
      if (t === 'message_ledger' && /capped/.test(sel)) return MISSING_COL('message_ledger.capped');
      if (t === 'web_quiz_challenge_runs' && sel === READ_COLS) return MISSING_COL('web_quiz_challenge_runs.meta');
      if (t === 'web_quiz_challenge_runs' && sel === FLOOR_COLS) return MISSING_COL('web_quiz_challenge_runs.passage_id');
      return null;
    });
    const out = await strip();
    expect(stripRows()).toEqual(GOLDEN.lines);
    expect(out.skipped).toEqual([...GOLDEN.skipped, ...NEW_LINES, 'cold_clips']);
    expect(out.lines).toBe(GOLDEN.lines.length);
  });

  test('the new inputs readable: the old rows exactly as before, the new lines after them', async () => {
    install(world());
    const out = await strip();
    expect(existing()).toEqual(GOLDEN.lines);
    expect(out.skipped).toEqual([...GOLDEN.skipped, 'cold_clips']);
    expect(stripRows().slice(GOLDEN.lines.length).map((r) => `${r.line} / ${r.cell}`)).toEqual(['sent / capped', 'bind_funnel / codes', 'bind_funnel / bound',
      'implausible / ur', 'implausible / ur|no_speech', 'implausible / ur|low_stt_support', 'implausible / ur|no_aligned_words', 'implausible / ur|low_story_confidence',
      'floor_kept_aligned / ur']);
  });

  test('the new inputs readable and empty: value 0, n 0 on each new line', async () => {
    install({ ...world(), message_ledger: [], child_bind_codes: [], child_phone_bindings: [] });
    const out = await strip();
    expect(line('sent', 'capped')).toMatchObject({ value: 0, n: 0 });
    expect(line('implausible', 'ur')).toMatchObject({ value: 0, n: 2 });   // two scored check reads, none marked
    expect(line('bind_funnel', 'codes')).toMatchObject({ value: 0, n: 0 });
    expect(line('bind_funnel', 'bound')).toMatchObject({ value: 0, n: 0 });
    expect(out.skipped).not.toEqual(expect.arrayContaining(['sent']));
    expect(out.skipped).not.toEqual(expect.arrayContaining(['bind_funnel']));
  });
});

describe('implausible / <lang>: scored check reads the scorer marked implausible', () => {
  const marked = (child, flags, extra = {}) => run({ canonical_id: child, meta: { quality: 'implausible', flags, record_lost: 'implausible' }, record: false, ...extra });

  test('per language: value = marked, n = scored check reads (any record), with a cell per reason; test children out', async () => {
    const w = world();
    w.web_quiz_challenge_runs.push(
      marked(A, ['no_speech']),
      marked(B, ['some_model_flag', 'low_stt_support']),
      marked(C, ['low_story_confidence'], { lang: 'en' }),
      run({ canonical_id: C, lang: 'en' }),
      run({ canonical_id: C, lang: 'en', record: false }),                       // any record: still in n
      marked(D, []),                                                              // no reason given
      marked(T, ['no_speech']),                                                   // a test child: out
      marked(F, ['no_speech'], { meta: { quality: 'implausible', flags: ['no_speech'], test: true } }),   // a row the serve marked as a test: out
      marked(A, ['no_speech'], { status: 'failed' }),                            // not scored: out
      marked(A, ['no_speech'], { mode: 'practice' }),                            // not a check: out
      marked(A, ['no_speech'], { exercise: 'listen' }),                          // not a read: out
      marked(A, ['no_speech'], { created_at: '2026-10-11T08:00:00Z' }),          // the week before: out
    );
    install(w);
    await strip();
    // ur: A, B (plain) + A, B, D marked = 5 reads; 3 marked
    expect(line('implausible', 'ur')).toMatchObject({ value: 3, n: 5 });
    expect(line('implausible', 'ur|no_speech')).toMatchObject({ value: 1, n: 5 });
    expect(line('implausible', 'ur|low_stt_support')).toMatchObject({ value: 1, n: 5 });
    expect(line('implausible', 'ur|no_aligned_words')).toMatchObject({ value: 0, n: 5 });
    expect(line('implausible', 'ur|low_story_confidence')).toMatchObject({ value: 0, n: 5 });
    expect(line('implausible', 'ur|not_given')).toMatchObject({ value: 1, n: 5 });
    expect(line('implausible', 'en')).toMatchObject({ value: 1, n: 3 });
    expect(line('implausible', 'en|low_story_confidence')).toMatchObject({ value: 1, n: 3 });
    expect(line('implausible', 'en|not_given')).toBeUndefined();
  });

  test('the read failing skips only this line, named in skipped', async () => {
    install(world(), (t, sel) => (t === 'web_quiz_challenge_runs' && sel === READ_COLS ? MISSING_COL('x') : null));
    const out = await strip();
    expect(lines('implausible')).toEqual([]);
    expect(out.skipped).toContain('implausible');
    expect(line('sent', 'capped')).toBeDefined();
  });
});

describe('cold clips at the last warm: not measured, no store', () => {
  test('no table holds the clip warm run, so no row is written; the line is named in skipped with its note', async () => {
    install(world());
    const out = await strip();
    expect(lines('cold_clips')).toEqual([]);
    expect(out.skipped).toContain('cold_clips');
    expect(out.notes.cold_clips).toBe(Strip.LINE_NOTES.cold_clips);
    expect(Strip.LINE_NOTES.cold_clips).toMatch(/^not measured: no store/);
  });
});

describe('the note beside recognised_without_typing', () => {
  test('printed with the line: class-link homonym picks read as high until the fix lands; values unchanged', async () => {
    install(world());
    const out = await strip();
    expect(Strip.LINE_NOTES.recognised_without_typing).toBe('homonym picks through the class link read as high until the class-link pick fix lands');
    expect(out.notes.recognised_without_typing).toBe(Strip.LINE_NOTES.recognised_without_typing);
    expect(out.notes.sends).toBe(Strip.LINE_NOTES.sends);
    expect(existing()).toEqual(GOLDEN.lines);
  });

  test('no line, no note: the earlier-run read failing leaves the note out', async () => {
    install(world(), (t, sel, ins) => (t === 'web_quiz_challenge_runs' && ins === 'canonical_id' ? MISSING_COL('x') : null));
    const out = await strip();
    expect(lines('recognised_without_typing')).toEqual([]);
    expect(out.notes).not.toHaveProperty('recognised_without_typing');
  });
});
