'use strict';
/**
 * A dry run of the weekly health numbers (web-quiz-strip.js weeklyStrip): a caller may pass `sink`, a function that
 * receives the exact rows (and `now`) the strip would write, and then nothing is written to any table. With no sink
 * the strip writes as before: the golden file holds, for the same input, the rows the strip table ends with and every
 * query the run made (reads and writes) before the sink existed; both must stay byte-identical.
 * scripts/web-quiz/strip-dry.js runs it by hand and prints the rows as JSON lines, counts only.
 * Faked boundaries only: Supabase (the in-memory fake that applies filters, wrapped in the strict-columns check), Redis
 * (down) and the logger.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));

const { makeFake } = require('./fake-supabase');
const { strictFrom } = require('./strict-columns');
const supabase = require('../../../shared/config/supabase');
const Strip = require('../../../shared/services/quiz/web-quiz-strip');
const Dry = { main: (...a) => require('../../../../scripts/web-quiz/strip-dry').main(...a) };   // loaded when a test runs it
const GOLDEN = require('./web-quiz-strip-dry.golden.json');

const WEEK = '2026-W42';                          // Mon 12 Oct – Sun 18 Oct 2026, PKT
const NOW = Date.parse('2026-10-19T06:00:00Z');
const STRICT = ['message_ledger', 'child_bind_codes', 'child_phone_bindings', 'web_quiz_challenge_runs'];
const WRITES = ['insert', 'update', 'upsert', 'delete'];

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const T = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';   // a test child ("<Name> Testwala")

let n = 0;
const run = (extra) => {
  n += 1;
  return {
    id: `run-${n}`, student_id: extra.canonical_id, exercise: 'read', grade: 3, lang: 'ur', status: 'scored', created_at: '2026-10-14T08:00:00Z',
    mode: 'check', form: 'G3', period_id: '2026-10', exposure_no: 1, band: 2, id_src: 'roster_pick', id_confidence: 'high',
    homonym_in_list: false, helped: 'self', record: true, meta: {}, score: { correct: 30 }, ...extra,
  };
};
const led = (day, trigger, count, capped) => ({
  day, trigger, class_id: null, initiated: 'user', recipient: 'family', count, usd: count * 0.015, capped,
});

/** The fixed input: real children, a test child, sends, save codes, a binding, and one strip row already there. */
const world = () => ({
  web_quiz_challenge_runs: [
    run({ canonical_id: A }),
    run({ canonical_id: B, helped: 'helped', class_id: 'cls-1' }),
    run({ canonical_id: C, status: 'failed' }),
    run({ canonical_id: D, mode: 'practice' }),
    run({ canonical_id: T }),
  ],
  web_quiz_strip_weekly: [
    { week: WEEK, line: 'plays', cell: 'check', value: 99, n: 99, computed_at: '2026-10-12T06:00:00.000Z' },   // replaced on a write
    { week: WEEK, line: 'lamps_settled_day', cell: '2026-10-13', value: 2, n: 5, computed_at: '2026-10-13T06:00:00.000Z' },
  ],
  child_rungs: [],
  app_settings: [],
  classes: [], class_teachers: [], class_enrollments: [],   // read (empty); the fake would add them on a read
  students: [
    { id: A, student_name: 'Amna Example', list_id: null }, { id: B, student_name: 'Bilal Example', list_id: null },
    { id: C, student_name: 'Sana Example', list_id: null }, { id: D, student_name: 'Zara Example', list_id: null },
    { id: T, student_name: 'Hina Testwala', list_id: null },
  ],
  message_ledger: [led('2026-10-12', 'home_reply', 5, 2), led('2026-10-13', 'bind_reply', 3, 1)],
  child_bind_codes: [
    { code: 'SAVE-AAAA2', canonical_id: A, device_ref: null, minted_at: '2026-10-13T08:00:00Z', expires_at: '2026-10-13T09:00:00Z', used_at: '2026-10-13T08:10:00Z', outcome: 'bound' },
  ],
  child_phone_bindings: [
    { id: 'b1', canonical_id: A, phone_norm: 'synthetic-phone', phone_tomb: 'f'.repeat(32), via: 'save', confirmed_at: '2026-10-13T08:10:00Z',
      bound_at: '2026-10-13T08:10:00Z', expires_at: '2027-03-31T18:59:59Z', revoked_at: null, revoked_by: null, code_id: 'SAVE-AAAA2' },
  ],
});

let db;
let queries;
/** Install the fake; every query the run makes is recorded as `table.method(args)…` in the order it ran. */
const install = (input) => {
  db = input;
  queries = [];
  const fake = makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } });
  const strict = strictFrom(fake.from, STRICT, { web_quiz_challenge_runs: ['meta->>audio_key'] });
  Object.assign(supabase, fake, {
    from: (t) => {
      const b = strict(t);
      const chain = [t];
      const proxy = new Proxy(b, {
        get(target, k) {
          const v = target[k];
          if (k === 'then') { queries.push(chain.join('.')); return v; }
          if (typeof v !== 'function') return v;
          return (...args) => {
            chain.push(`${String(k)}(${JSON.stringify(args)})`);
            const r = v.apply(target, args);
            return r === target ? proxy : r;
          };
        },
      });
      return proxy;
    },
  });
};
const isWrite = (q) => WRITES.some((w) => q.includes(`.${w}(`));
/** The rows the write path wrote, in the order it wrote them (each row is updated first: one update query per row). */
const writtenInOrder = (qs, rows) => qs.filter((q) => q.startsWith('web_quiz_strip_weekly.update(')).map((q) => {
  const [, line] = /\.eq\(\["line",("[^"]*")\]\)/.exec(q);
  const [, cell] = /\.eq\(\["cell",("[^"]*")\]\)/.exec(q);
  const r = rows.find((x) => x.line === JSON.parse(line) && x.cell === JSON.parse(cell));
  return { week: r.week, line: r.line, cell: r.cell, value: r.value, n: r.n };
});
const stripRows = () => db.web_quiz_strip_weekly.map((r) => ({ week: r.week, line: r.line, cell: r.cell, value: r.value, n: r.n, computed_at: r.computed_at }));

afterEach(() => { jest.clearAllMocks(); n = 0; });

describe('weeklyStrip with no sink: the write path as before', () => {
  test('golden: the strip table and every query made (reads and writes) are byte-identical', async () => {
    install(world());
    const out = await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(stripRows()).toEqual(GOLDEN.rows);
    expect(queries).toEqual(GOLDEN.queries);
    expect(out).toEqual(GOLDEN.out);
  });
});

describe('weeklyStrip with a sink: a run that writes nothing', () => {
  test('0 writes to any table; the sink gets exactly the rows (and now) the default path writes; the same reads, in order', async () => {
    install(world());
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    const wrote = writtenInOrder(queries, stripRows());
    expect(wrote).toEqual(writtenInOrder(GOLDEN.queries, GOLDEN.rows));
    const defaultReads = queries.filter((q) => !isWrite(q));

    install(world());
    const before = JSON.stringify(db);
    const got = [];
    const sink = jest.fn(async (lines, now) => { got.push(...lines); expect(now).toBe(NOW); });
    const out = await Strip.weeklyStrip({ week: WEEK, now: NOW, sink });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(queries.filter(isWrite)).toEqual([]);
    expect(JSON.stringify(db)).toBe(before);
    expect(got).toEqual(wrote);
    expect(got.length).toBeGreaterThan(10);
    expect(out).toEqual(GOLDEN.out);
    expect(queries).toEqual(defaultReads);
  });
});

describe('scripts/web-quiz/strip-dry.js', () => {
  const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };
  const capture = () => {
    const out = { stdout: '', stderr: '' };
    return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
  };

  test('--week prints one JSON line per row (week, line, cell, value, n) and a last line of counts and skipped names; writes nothing', async () => {
    install(world());
    const before = JSON.stringify(db);
    const { out, io } = capture();
    const code = await Dry.main({ argv: ['--week', WEEK], env: ENV, io, now: NOW });
    expect(code).toBe(0);
    expect(queries.filter(isWrite)).toEqual([]);
    expect(JSON.stringify(db)).toBe(before);
    const printed = out.stdout.trim().split('\n').map((l) => JSON.parse(l));
    const rows = printed.slice(0, -1);
    const last = printed[printed.length - 1];
    rows.forEach((r) => expect(Object.keys(r)).toEqual(['week', 'line', 'cell', 'value', 'n']));
    expect(rows).toEqual(writtenInOrder(GOLDEN.queries, GOLDEN.rows));
    expect(last).toEqual({ week: WEEK, lines: rows.length, skipped: GOLDEN.out.skipped, wrote: 0 });
    // counts only: never an id or a name
    expect(out.stdout + out.stderr).not.toMatch(/aaaaaaaa|bbbbbbbb|eeeeeeee|run-\d|Example|Testwala|synthetic-phone|SAVE-|example\.supabase/);
  });

  test('no --week: the current ISO week (PKT), named on stderr', async () => {
    install(world());
    const { out, io } = capture();
    const code = await Dry.main({ argv: [], env: ENV, io, now: Date.parse('2026-10-16T10:00:00Z') });
    expect(code).toBe(0);
    expect(out.stderr).toMatch(/2026-W42/);
    expect(JSON.parse(out.stdout.trim().split('\n').pop()).week).toBe('2026-W42');
    expect(queries.filter(isWrite)).toEqual([]);
  });

  test('a malformed week or no env: exit 2, nothing read or written', async () => {
    install(world());
    let c = capture();
    expect(await Dry.main({ argv: ['--week', '2026-42'], env: ENV, io: c.io, now: NOW })).toBe(2);
    expect(c.out.stdout).toBe('');
    c = capture();
    expect(await Dry.main({ argv: ['--week', WEEK], env: {}, io: c.io, now: NOW })).toBe(2);
    expect(c.out.stdout).toBe('');
    expect(queries).toEqual([]);
  });
});
