'use strict';
/**
 * Proven confidence on the weekly health numbers (web-quiz-strip.js, web-quiz-provenance.js). A run row's
 * id_confidence = 'high' is trusted only when the student row proves it: the canonical student is on a roster list
 * (list_id) or joined to a roster row (merged_into). Two provenance-drift counts sit beside the lines, each should
 * read 0: high rows of an unproven child (high_unproven), and rows written homonym_in_list = false although the
 * child's list holds another active child with the same canonical first name (homonym_missed). Counts only.
 * Faked boundaries only: Supabase (the in-memory fake that applies filters), the logger and Redis. Invented names.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logToFile, logError } = require('../../../shared/utils/logger');
const Strip = require('../../../shared/services/quiz/web-quiz-strip');
// required inside the tests, so each test reports on its own while the module is missing
const P = () => require('../../../shared/services/quiz/web-quiz-provenance');

const WEEK = '2026-W42';                                   // Mon 12 Oct – Sun 18 Oct 2026, PKT
const IN = '2026-10-14T08:00:00Z';
const NOW = Date.parse('2026-10-19T06:00:00Z');
const RUNS = 'web_quiz_challenge_runs';
const id = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const ROSTER = id('a');                                    // on a list
const LOOSE = id('b');                                     // on no list, not merged (a forced new)
const MERGED = id('c');                                    // loose, but joined to a roster row
const HINA1 = id('d'); const HINA2 = id('e'); const HINA_SOLO = id('f');
const L1 = 'list-1'; const L2 = 'list-2'; const L3 = 'list-3';

const student = (sid, name, extra = {}) => ({ id: sid, student_name: name, list_id: null, merged_into: null, status: 'active', ...extra });
const students = () => [
  student(ROSTER, 'Ali Sample', { list_id: L1 }),
  student(LOOSE, 'Bilal Sample'),
  student(MERGED, 'Sana Sample', { merged_into: ROSTER }),
  student(HINA1, 'Hina Sample', { list_id: L2 }),
  student(HINA2, 'Hina Bano Sample', { list_id: L2 }),
  student(HINA_SOLO, 'Hina Sample', { list_id: L3 }),
  student(id('9'), 'Hina Sample', { list_id: L3, status: 'archived' }),      // not active: no homonym
];

let n = 0;
const run = (extra) => {
  n += 1;
  return {
    id: `run-${n}`, student_id: extra.canonical_id, exercise: 'read', grade: 3, lang: 'ur', status: 'scored', created_at: IN,
    mode: 'check', bank_version: 'v3', form: 'G3', period_id: '2026-10', exposure_no: 1, band: 2,
    id_src: 'hub_chip', id_confidence: 'high', homonym_in_list: false, helped: 'self', record: true, meta: {}, score: { correct: 30 },
    ...extra,
  };
};

let db;
const install = (runs, extra = {}) => {
  db = { [RUNS]: runs, web_quiz_strip_weekly: [], child_rungs: [], message_ledger: [], students: students(), ...extra };
  Object.assign(supabase, makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } }));
};
const line = (name, cell = '') => db.web_quiz_strip_weekly.find((r) => r.line === name && r.cell === cell);

afterEach(() => { jest.clearAllMocks(); n = 0; });

describe('cells at n = 30 trust proven confidence only', () => {
  test('a loose child with high rows is not counted and adds to high_unproven; merged and roster children count', async () => {
    install([
      run({ canonical_id: LOOSE }), run({ canonical_id: LOOSE, exercise: 'listen' }),
      run({ canonical_id: MERGED }),
      run({ canonical_id: ROSTER }),
    ]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('cells_n30', 'G23|ur|reading')).toMatchObject({ value: 2, n: 2 });         // ROSTER + MERGED
    expect(line('provenance_drift', 'high_unproven')).toMatchObject({ value: 2, n: 4 });   // LOOSE's two rows
  });

  test('the same child once merged is counted and adds 0', async () => {
    install([run({ canonical_id: LOOSE })], {
      students: students().map((s) => (s.id === LOOSE ? { ...s, merged_into: ROSTER } : s)),
    });
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('cells_n30', 'G23|ur|reading')).toMatchObject({ value: 1, n: 1 });
    expect(line('provenance_drift', 'high_unproven')).toMatchObject({ value: 0, n: 1 });
  });

  test('a roster child is counted; a low row of a roster child is still not', async () => {
    install([run({ canonical_id: ROSTER }), run({ canonical_id: HINA_SOLO, id_confidence: 'low' })]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('cells_n30', 'G23|ur|reading')).toMatchObject({ value: 1, n: 1 });
    expect(line('provenance_drift', 'high_unproven')).toMatchObject({ value: 0, n: 2 });
  });

  test('the anchor retest gate drops an unproven child\'s rows too', async () => {
    const anc = (k, ok, extra = {}) => run({ canonical_id: ROSTER, exercise: 'missing', anchor_block: 'A1', anchor_exposure_no: k, score: { correct: ok, n: 10, reached: 10 }, ...extra });
    install([anc(1, 10), anc(1, 12), anc(2, 14), anc(2, 16), anc(2, 40, { canonical_id: LOOSE }), anc(1, 0, { canonical_id: LOOSE })]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    const l = line('anchor_retest_gap', 'G23|ur|numbers|A1');
    expect(l.n).toBe(4);
    expect(l.value).toBeCloseTo(4 / Math.SQRT2, 6);
  });
});

describe('homonym_missed: rows written homonym_in_list = false on a list with another active same-first-name child', () => {
  test('two active Hinas on one list, a row for one of them with false → 1', async () => {
    install([run({ canonical_id: HINA1 })]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('provenance_drift', 'homonym_missed')).toMatchObject({ value: 1, n: 1 });
  });

  test('the same row written with true → 0', async () => {
    install([run({ canonical_id: HINA1, homonym_in_list: true })]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('provenance_drift', 'homonym_missed')).toMatchObject({ value: 0, n: 1 });
  });

  test('a single active Hina on her list (an archived one beside her) → 0', async () => {
    install([run({ canonical_id: HINA_SOLO })]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('provenance_drift', 'homonym_missed')).toMatchObject({ value: 0, n: 1 });
  });

  test('only v2 rows (id_src set) are checked: n counts them, a row without id_src is not', async () => {
    install([run({ canonical_id: HINA1 }), run({ canonical_id: HINA2, id_src: null }), run({ canonical_id: LOOSE, id_src: null })]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('provenance_drift', 'homonym_missed')).toMatchObject({ value: 1, n: 1 });
    expect(line('provenance_drift', 'high_unproven')).toMatchObject({ value: 0, n: 1 });
  });
});

describe('students table missing or unreadable', () => {
  const failStudents = (error) => {
    const realFrom = supabase.from;
    supabase.from = (t) => {
      if (t !== 'students') return realFrom(t);
      const q = {};
      ['select', 'in', 'eq', 'is', 'gt', 'order', 'limit'].forEach((m) => { q[m] = () => q; });
      q.then = (res, rej) => Promise.resolve({ data: null, error }).then(res, rej);
      return q;
    };
  };

  test('the two drift lines are skipped and logged (code only), never a throw; other lines stay', async () => {
    install([run({ canonical_id: ROSTER }), run({ canonical_id: HINA1 })]);
    failStudents({ code: '42P01', message: 'relation "students" does not exist' });
    const out = await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('provenance_drift', 'high_unproven')).toBeUndefined();
    expect(line('provenance_drift', 'homonym_missed')).toBeUndefined();
    expect(line('plays', 'check')).toMatchObject({ value: 2 });
    expect(out.skipped).toEqual(expect.arrayContaining(['provenance_drift']));
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(expect.any(String), { what: 'students', code: '42P01' });
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/skipped/), expect.objectContaining({ skipped: expect.arrayContaining(['provenance_drift']) }));
  });

  test('driftCounts on a read error is null, not a throw', async () => {
    install([]);
    failStudents({ code: 'XX000', message: 'boom' });
    await expect(P().driftCounts([run({ canonical_id: ROSTER })])).resolves.toBeNull();
  });
});

describe('the helper', () => {
  test('provenHigh: the column says high AND the student is on a list or merged', () => {
    const { provenHigh } = P();
    const s = new Map([
      [ROSTER, { list_id: L1, merged_into: null, status: 'active', first: 'ali' }],
      [MERGED, { list_id: null, merged_into: ROSTER, status: 'merged', first: 'sana' }],
      [LOOSE, { list_id: null, merged_into: null, status: 'active', first: 'bilal' }],
    ]);
    expect(provenHigh({ canonical_id: ROSTER, id_confidence: 'high' }, s)).toBe(true);
    expect(provenHigh({ canonical_id: MERGED, id_confidence: 'high' }, s)).toBe(true);
    expect(provenHigh({ student_id: ROSTER, canonical_id: null, id_confidence: 'high' }, s)).toBe(true);
    expect(provenHigh({ canonical_id: LOOSE, id_confidence: 'high' }, s)).toBe(false);
    expect(provenHigh({ canonical_id: ROSTER, id_confidence: 'low' }, s)).toBe(false);
    expect(provenHigh({ canonical_id: id('7'), id_confidence: 'high' }, s)).toBe(false);   // no student row
    expect(provenHigh({ canonical_id: ROSTER, id_confidence: 'high' }, null)).toBe(false);
    expect(typeof P().PROOF_RULE).toBe('string');
  });

  test('loadStudents reads in chunks of at most 200 ids and returns the folded first name, not the name', async () => {
    const many = Array.from({ length: 450 }, (_, i) => student(`s-${String(i).padStart(4, '0')}`, 'Muhammad Hamza Testwala', { list_id: L1 }));
    install([], { students: many });
    const realFrom = supabase.from;
    const sizes = [];
    supabase.from = (t) => {
      const q = realFrom(t);
      if (t !== 'students') return q;
      const realIn = q.in;
      q.in = (c, vs) => { sizes.push(vs.length); return realIn(c, vs); };
      return q;
    };
    const got = await P().loadStudents(many.map((s) => s.id));
    expect(got.size).toBe(450);
    expect(sizes.every((k) => k <= 200)).toBe(true);
    expect(sizes.length).toBe(3);
    expect(got.get('s-0000')).toEqual({ list_id: L1, merged_into: null, status: 'active', first: 'hamza' });
  });

  test('loadListMates counts active students by folded first name per list', async () => {
    install([]);
    const mates = await P().loadListMates([L2, L3]);
    expect(mates.get(L2).get('hina')).toBe(2);
    expect(mates.get(L3).get('hina')).toBe(1);
  });
});
