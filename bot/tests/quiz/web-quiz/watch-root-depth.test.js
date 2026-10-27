'use strict';
/**
 * The watch root (app_settings VALUE web_quiz_watch_root) BY ANCESTRY, for the readers that tested only the root's
 * direct children: the quiz page's chips (the page, the typed-name card, `me()`, the class roster) and the school
 * league. A class-less child's watch code copies the root's teacher, and so does every code minted under it: the
 * child's lesson code, a friend's code, a friend's friend's code. None of them is that teacher's class.
 *
 * ONE seeded fixture, every reader: the watch side is out, the class side (a class code's own 4-deep chain and its
 * friend codes) is in. With no VALUE, every reader answers as today (the golden rows).
 * Supabase, SQS, Redis and WhatsApp are the faked boundaries. Invented children only.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    get: jest.fn(async (k) => keys.get(k) || null),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Schools = require('../../../shared/services/quiz/web-quiz-schools');

const ROOT_T = '11111111-1111-4111-8111-222222222222';   // the root's teacher (School Bravo)
const OTHER_T = '11111111-1111-4111-8111-111111111111';  // another school's teacher (School Alpha)
const QUIZ = '22222222-2222-4222-8222-222222222222';
const id = (s) => `33333333-3333-4333-8333-${s.padStart(12, '0')}`;
const ROOT = id('777777777777');
// the class side: a class code, its lesson chain four deep, a friend code and a friend's friend code
const SC = id('c0'); const CL1 = id('c1'); const CL2 = id('c2'); const CL3 = id('c3'); const CL4 = id('c4');
const CF = id('cf'); const CFF = id('cff');
// the watch side: a watch code, its lesson code, a friend code, a friend's friend code
const WA = id('a0'); const WL = id('a1'); const WF = id('af'); const WFF = id('aff');
const ALPHA = id('99');
const kid = (s) => `44444444-4444-4444-8444-${s.padStart(12, '0')}`;
const BILAL = kid('b'); const DANISH = kid('d'); const ESHA = kid('e');
const ZARA = kid('a'); const SANA = kid('5'); const FARIS = kid('f'); const GUL = kid('9');

const future = '2099-12-31T00:00:00.000Z';
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const code = (cid, c, extra = {}) => ({
  id: cid, code: c, quiz_id: QUIZ, video_id: null, teacher_user_id: ROOT_T, teacher_name: 'Nadia Testwala', topic: 'Parts of a plant',
  language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, created_at: ago(40), ...extra,
});
const sess = (sid, sc, k, name, h, extra = {}) => ({
  id: sid, quiz_id: QUIZ, share_code_id: sc, student_id: k, student_name: name, user_id: null, status: 'completed', student_class: '3',
  correct_answers: 1, total_questions_answered: 2, mastery_percentage: 100, completed_at: ago(h), created_at: ago(h), invited_by_student_id: null, ...extra,
});

let fake;
function seed({ root = true, resetLeague = true } = {}) {
  fake = makeFake({
    app_settings: root ? [{ key: 'web_quiz_watch_root', value: JSON.stringify(ROOT) }] : [],
    schools: [
      { id: 'SA', name: 'School Alpha', region: 'Sector One', is_active: true, is_probable_test: false },
      { id: 'SB', name: 'School Bravo', region: 'Sector Two', is_active: true, is_probable_test: false },
    ],
    users: [{ id: ROOT_T, school_id: 'SB' }, { id: OTHER_T, school_id: 'SA' }],
    quiz_share_codes: [
      code(ROOT, 'ROOT01', { active: false, expires_at: null, created_at: ago(300) }),
      code(SC, 'AB12CD'),
      code(CL1, 'CLESS1', { parent_share_code_id: SC }),
      code(CL2, 'CLESS2', { parent_share_code_id: CL1 }),
      code(CL3, 'CLESS3', { parent_share_code_id: CL2 }),
      code(CL4, 'CLESS4', { parent_share_code_id: CL3 }),
      code(CF, 'CFRND1', { parent_share_code_id: SC, invited_by_student_id: BILAL }),
      code(CFF, 'CFRND2', { parent_share_code_id: CF, invited_by_student_id: ESHA }),
      code(WA, 'WATCHA', { parent_share_code_id: ROOT }),
      code(WL, 'WLESS1', { parent_share_code_id: WA }),
      code(WF, 'WFRND1', { parent_share_code_id: WA, invited_by_student_id: ZARA }),
      code(WFF, 'WFRND2', { parent_share_code_id: WF, invited_by_student_id: FARIS }),
      code(ALPHA, 'ALPHA1', { teacher_user_id: OTHER_T }),
    ],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    quiz_questions: [1, 2].map((n) => ({
      id: `9999999${n}-9999-4999-8999-999999999999`, quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n,
      question_text: `Question ${n}`, option_a: 'Root', option_b: 'Leaf', option_c: 'Stem', option_d: null, correct_option: 'B', media: {},
    })),
    quiz_sessions: [
      sess('s-b', SC, BILAL, 'Bilal Testwala', 9),
      sess('s-d', CL4, DANISH, 'Danish Testwala', 8),
      sess('s-e', CF, ESHA, 'Esha Testwala', 7, { invited_by_student_id: BILAL }),
      sess('s-a', WA, ZARA, 'Zara Testwala', 6),
      sess('s-5', WL, SANA, 'Sana Testwala', 5),
      sess('s-f', WF, FARIS, 'Faris Testwala', 4, { invited_by_student_id: ZARA }),
      sess('s-9', WFF, GUL, 'Gul Testwala', 3, { invited_by_student_id: FARIS }),
    ],
    students: [],
    student_lists: [],
    quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../../shared/services/quiz/web-quiz-identity-roster')._resetCache();
  if (resetLeague) Schools._reset();
}

const SAVED = { ...process.env };
// The league counts the PKT week from Monday 00:00, and the seeded finishes are hours old: on the real clock a
// Monday-morning run (00:00-09:00 PKT) drops them. A fixed mid-week moment (Wed 10:00 PKT); only Date is faked,
// so timers, ticks and microtasks stay real. Declared before the seeding beforeEach so the seed reads this clock.
const NOW = Date.parse('2026-10-07T05:00:00Z');
const NOT_DATE = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
  'setTimeout', 'clearTimeout', 'Temporal'];
beforeEach(() => { jest.useFakeTimers({ now: NOW, doNotFake: NOT_DATE }); });
afterEach(() => { jest.useRealTimers(); });
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  redis.__keys.clear();
  jest.clearAllMocks();
  require('../../../shared/services/quiz/web-quiz-roster')._resetCache();
  seed();
});
afterAll(() => { process.env = SAVED; });

const chipsOf = async (c) => (await WQ.classChips(await WQ.resolveCode(c))).map((x) => x.first).sort();
const WATCH_NAMES = /Zara|Sana|Faris|Gul/;
const CLASS_NAMES = /Bilal|Danish|Esha/;

describe('the quiz page\'s chips: a class code\'s pool never takes a code under the watch root', () => {
  test('the class code: its own chain in (Danish, four deep), a watch child\'s lesson code out (Sana)', async () => {
    expect(await chipsOf('AB12CD')).toEqual(['Bilal', 'Danish']);
  });
  test('the class code\'s four-deep lesson code and its friend codes keep the class pool', async () => {
    expect(await chipsOf('CLESS4')).toEqual(['Bilal', 'Danish']);
    expect(await chipsOf('CFRND1')).toEqual(['Bilal', 'Danish']);
    expect(await chipsOf('CFRND2')).not.toEqual(expect.arrayContaining(['Zara', 'Sana']));
  });
});

describe('a code under a watch code is no class: only its own players, never the root teacher\'s class', () => {
  test.each([
    ['a watch child\'s lesson code', 'WLESS1'],
    ['a friend code under a watch code', 'WFRND1'],
    ['a friend\'s friend code', 'WFRND2'],
  ])('%s', async (_what, c) => {
    const names = (await chipsOf(c)).join(' ');
    expect(names).not.toMatch(CLASS_NAMES);
  });

  test('the page of a friend code under a watch code draws no class child and names no class', async () => {
    const out = await WQ.getQuiz('WFRND1');
    expect(JSON.stringify(out.cls)).not.toMatch(CLASS_NAMES);
    expect(out.cls.label).toBeNull();
  });

  test('the typed-name card on a friend code under a watch code offers no class child', async () => {
    const got = await WQ.startSession({ code: 'WFRND1', new: { name: 'Bilal Testwala' } }).catch((e) => e);
    const body = (got && got.body) || {};
    expect(JSON.stringify(body.candidates || [])).not.toMatch(CLASS_NAMES);
    expect(['is_this_you', 'maybe_you']).not.toContain(body.error);
    // never joined to the root class's child of the same name
    expect(fake.db.quiz_sessions.filter((x) => x.student_id === BILAL).map((x) => x.id)).toEqual(['s-b']);
  });

  test('me() on a friend code under a watch code answers nothing for a class child\'s chip', async () => {
    const ctx = await WQ.resolveCode('WFRND1');
    const out = await WQ.me({ code: 'WFRND1', chips: [T.chipId(ctx.shareCodeId, BILAL), T.chipId(ctx.shareCodeId, DANISH)] });
    expect(JSON.stringify(out)).not.toMatch(CLASS_NAMES);
    expect(out.history).toEqual([]);
  });
});

describe('the school league: a finish under the watch root credits no school, at any depth', () => {
  test('School Bravo counts its class chain (Bilal, Danish, Esha) and none of the watch side', async () => {
    const b = await Schools.board('ALPHA1', { now: Date.now() });
    expect(b.rows.find((r) => r.name === 'School Bravo')).toEqual(expect.objectContaining({ kids: 3 }));
  });
  test('the VALUE written while the league holds its codes: the next board (a minute on) already leaves the watch side out', async () => {
    seed({ root: false });
    const t0 = Date.now();
    expect((await Schools.board('ALPHA1', { now: t0 })).rows.find((r) => r.name === 'School Bravo')).toEqual(expect.objectContaining({ kids: 7 }));
    seed({ root: true, resetLeague: false });   // the settings read sees the VALUE; the league's code map is still warm
    const b = await Schools.board('ALPHA1', { now: t0 + 2 * 60 * 1000 });
    expect(b.rows.find((r) => r.name === 'School Bravo')).toEqual(expect.objectContaining({ kids: 3 }));
  });
});

describe('the walk itself (watch-root.js underWatchRoot): fail closed', () => {
  const { underWatchRoot } = require('../../../shared/services/quiz/watch-root');
  const rows = (pairs) => pairs.map(([cid, p]) => ({ id: cid, parent_share_code_id: p }));
  const reader = (all) => jest.fn(async (ids) => all.filter((r) => ids.includes(r.id)));

  test('the root, a child, a grandchild are under; a class chain is not; parents outside the list are read', async () => {
    const all = rows([['r', null], ['w', 'r'], ['l', 'w'], ['f', 'l'], ['c', null], ['c1', 'c'], ['c2', 'c1']]);
    const read = reader(all);
    const under = await underWatchRoot(rows([['r', null], ['f', 'l'], ['c2', 'c1']]), 'r', read);
    expect([...under].sort()).toEqual(['f', 'r']);
    expect(read).toHaveBeenCalled();
  });
  test('a loop is under (fail closed)', async () => {
    const all = rows([['x', 'y'], ['y', 'x']]);
    expect([...(await underWatchRoot(rows([['x', 'y']]), 'r', reader(all)))]).toEqual(['x']);
  });
  test('a chain past the cap is under (fail closed)', async () => {
    const all = rows(Array.from({ length: 80 }, (_, i) => [`n${i}`, i === 79 ? null : `n${i + 1}`]));
    expect([...(await underWatchRoot(rows([['n0', 'n1']]), 'r', reader(all)))]).toEqual(['n0']);
  });
  test('a failed read is under (fail closed); a parent that no longer exists is not', async () => {
    const boom = jest.fn(async () => { throw new Error('db down'); });
    expect([...(await underWatchRoot(rows([['a', 'gone']]), 'r', boom))]).toEqual(['a']);
    expect([...(await underWatchRoot(rows([['a', 'gone']]), 'r', reader([])))]).toEqual([]);
  });
  test('no root: nothing is under and nothing is read', async () => {
    const read = reader([]);
    expect([...(await underWatchRoot(rows([['a', 'b']]), null, read))]).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('a failed settings read may hide a root: the page\'s readers fail closed', () => {
  function failSettings() {
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'app_settings') b.then = (res, rej) => Promise.resolve({ data: null, error: { message: 'db down' } }).then(res, rej);
      return b;
    };
    require('../../../shared/services/quiz/web-quiz-identity-roster')._resetCache();
  }
  test('a class code shows only its own players (never the teacher\'s other codes)', async () => {
    failSettings();
    expect(await chipsOf('AB12CD')).toEqual(['Bilal']);
    expect(await chipsOf('WFRND1')).not.toEqual(expect.arrayContaining(['Bilal']));
  });
  test('the league answers no board rather than a count that may credit a class-less child', async () => {
    failSettings();
    await expect(Schools.board('ALPHA1', { now: Date.now() })).rejects.toMatchObject({ status: 502 });
  });
  test('the league answers no board on a failed settings read even while its code map is warm', async () => {
    seed({ root: false });
    const t0 = Date.now();
    await Schools.board('ALPHA1', { now: t0 });   // the map is built (no VALUE yet)
    seed({ root: true, resetLeague: false });
    failSettings();
    await expect(Schools.board('ALPHA1', { now: t0 + 2 * 60 * 1000 })).rejects.toMatchObject({ status: 502 });
  });
  // One failed settings read, then a good one, inside ONE chips call: the pool never takes a code of the other side.
  test.each([['AB12CD', WATCH_NAMES], ['CLESS4', WATCH_NAMES], ['WFRND1', CLASS_NAMES], ['WLESS1', CLASS_NAMES]])('%s: a blip then a good read pools nothing of the other side', async (c, other) => {
    const ctx = await WQ.resolveCode(c);
    require('../../../shared/services/quiz/web-quiz-identity-roster')._resetCache();
    let n = 0;
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'app_settings' && n++ === 0) b.then = (res, rej) => Promise.resolve({ data: null, error: { message: 'db down' } }).then(res, rej);
      return b;
    };
    const names = (await WQ.classChips(ctx)).map((x) => x.first);
    expect(names.join(' ')).not.toMatch(other);
  });
});

describe('a code read that answers {error} (not a throw) fails closed', () => {
  function failCodeReads() {
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'quiz_share_codes') return b;
      const inn = b.in;
      b.in = (col, vs) => {
        const q = inn(col, vs);
        if (col === 'id') q.then = (res, rej) => Promise.resolve({ data: null, error: { message: 'db down' } }).then(res, rej);
        return q;
      };
      return b;
    };
  }
  test('the page: a class code keeps the watch side out when the parent read answers {error}', async () => {
    const ctx = await WQ.resolveCode('AB12CD');
    failCodeReads();
    expect((await WQ.classChips(ctx)).map((x) => x.first).join(' ')).not.toMatch(WATCH_NAMES);
  });
  test('the league: no board, never a count that credits the watch side', async () => {
    failCodeReads();
    await expect(Schools.board('ALPHA1', { now: Date.now() })).rejects.toMatchObject({ status: 502 });
  });
});

describe('GOLDEN: no watch root set, every reader answers as today', () => {
  beforeEach(() => seed({ root: false }));
  test('a class code pools every non-invited code of the teacher, the watch side included, as today', async () => {
    expect(await chipsOf('AB12CD')).toEqual(['Bilal', 'Danish', 'Sana', 'Zara']);
  });
  test('a friend code under the old watch code pools the teacher\'s codes, as today', async () => {
    expect(await chipsOf('WFRND1')).toEqual(['Bilal', 'Danish', 'Sana', 'Zara']);
    expect(await chipsOf('WLESS1')).toEqual(['Bilal', 'Danish', 'Sana', 'Zara']);
  });
  test('School Bravo counts every finish on its teacher\'s codes, as today', async () => {
    const b = await Schools.board('ALPHA1', { now: Date.now() });
    expect(b.rows.find((r) => r.name === 'School Bravo')).toEqual(expect.objectContaining({ kids: 7 }));
  });
});

/**
 * Settings reads with NO watch root set (OFF reads exactly what the page read before the switch existed). The chips read exactly as before this change. The league
 * now reads the root setting on a load whose code map is warm (before, only when the load met a new code): that read
 * is what lets it fail closed and rebuild its map after the root changes. It rides the page's 30 s settings cache,
 * so it is one named `watchRootState` read when that cache is cold and none when it is warm.
 * `named` counts the reads made inside `watchRootState`; total − named is the base's own count on the same load.
 */
describe('READS: no watch root set, settings reads as before plus the league\'s one named read', () => {
  const IdR = require('../../../shared/services/quiz/web-quiz-identity-roster');
  const reads = () => fake.calls.filter((c) => c.table === 'app_settings').length;
  let real; let named;
  beforeEach(() => {
    seed({ root: false });
    real = IdR.watchRootState; named = 0;
    IdR.watchRootState = async (...a) => { const n = reads(); try { return await real(...a); } finally { named += reads() - n; } };
  });
  afterEach(() => { IdR.watchRootState = real; });

  test('the class chips read as before: 1 read cold, 0 warm', async () => {
    const ctx = await WQ.resolveCode('AB12CD');
    let n = reads(); await WQ.classChips(ctx); const cold = reads() - n;
    n = reads(); await WQ.classChips(ctx); const warm = reads() - n;
    expect(cold).toBe(1);
    expect(warm).toBe(0);
  });
  test('the league, code map warm, settings cache cold: the base\'s 0 + 1 named watchRootState read', async () => {
    const t0 = Date.now();
    await Schools.board('ALPHA1', { now: t0 });   // the code map is warm, no new code finishes after this
    IdR._resetCache();                              // the 30 s settings cache has run out; no page read in between
    named = 0;
    const n = reads(); await Schools.board('ALPHA1', { now: t0 + 61 * 1000 }); const total = reads() - n;
    expect(total - named).toBe(0);   // the base: a warm map with no new code read no settings
    expect(named).toBe(1);
    expect(total).toBe(1);
  });
  test('the league, code map warm, settings cache warm (a page read within 30 s): 0 reads', async () => {
    const t0 = Date.now();
    await Schools.board('ALPHA1', { now: t0 });
    IdR._resetCache(); await IdR.identityMode();   // another page in the process read settings just now
    const n = reads(); await Schools.board('ALPHA1', { now: t0 + 61 * 1000 });
    expect(reads() - n).toBe(0);
  });
});
