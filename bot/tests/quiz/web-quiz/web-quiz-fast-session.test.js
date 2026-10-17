'use strict';
/**
 * Fast quiz start (app_settings web_quiz_fast, default off): startSession runs the child's earlier-finish lookup beside
 * the session insert, and the steps after the insert (the code's use count, the quiz's source for the join event, the
 * teacher's report schedule, the pick record, the shown name) together; a returning page's three lookups run together.
 * Supabase is the boundary and is faked with a fixed delay per read; every first-party module on the path runs for real.
 *
 * Off: the answer is exactly today's (golden recorded before the change). On: the same answer, more reads in flight at once.
 * Volatile fields: `st` is a signed token holding the generated session id and an expiry clock; it is compared as its
 * kind, device and code only (sid and exp stripped). A typed new child's chip and animal come from the generated
 * student id: checked against the inserted row, then replaced by a placeholder.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => store.delete(k)),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');

const GOLDEN = path.join(__dirname, 'web-quiz-fast-session.golden.json');
const READ_MS = 25;
const DEV = 'SessionPhoneDeviceRef1';

let fake;
let inflight = 0;
let maxInflight = 0;
let WQ;
let T;

// Every read, write and rpc takes READ_MS and is counted while in flight (a Supabase round trip).
const slow = (p) => {
  inflight += 1; maxInflight = Math.max(maxInflight, inflight);
  return new Promise((r) => setTimeout(r, READ_MS)).then(() => { inflight -= 1; return p(); });
};
function seed({ fast = false, v2 = true, lang = 'ur', sessions = [] } = {}) {
  const db = F.db({ flag: v2 ? 'v2' : null, sessions });
  db.quiz_share_codes.forEach((c) => { c.language = lang; });
  db.students.forEach((s) => { if (s.id === F.kid(1)) s.student_name_urdu = 'عائشہ ٹیسٹ والا'; });
  db.app_settings.push({ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true });
  if (fast) db.app_settings.push({ key: 'web_quiz_fast', value: true });
  fake = makeFake(db);
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    b.then = (res, rej) => slow(() => then.call(b, (x) => x)).then(res, rej);
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: (n, a) => slow(() => fake.rpc(n, a)) });
}

const SAVED = { ...process.env };
async function fresh(opts) {
  jest.resetModules();
  seed(opts);
  WQ = require('../../../shared/services/quiz/web-quiz.service');
  T = require('../../../shared/services/quiz/web-quiz-token');
  // The switch is read in the background (never waited for); let its first read land before a measured call.
  require('../../../shared/services/quiz/web-quiz-fast').on();
  await new Promise((r) => setTimeout(r, 3 * READ_MS));
}
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'fast-session-secret' };
  inflight = 0; maxInflight = 0;
});
afterAll(() => { process.env = SAVED; });

const stable = (out) => {
  const o = JSON.parse(JSON.stringify(out));
  if (o.st) { const { k, d, sc } = T.verify(o.st, 's') || {}; o.st = { k, d, sc }; }
  return o;
};
const chip = (n) => T.chipId(F.SC, F.kid(n));
const call = async (body) => {
  try { return stable(await WQ.startSession({ code: 'AB12CD', device_ref: DEV, ...body })); } catch (e) { return { status: e.status, body: e.body }; }
};

/** The answers this file pins: a remembered class child (Urdu name, pick record), a typed new child, and a resumed page. */
async function answers(fast) {
  const out = {};
  // A class child who finished once on this phone: not counted again, Urdu first name, the pick recorded.
  await fresh({ fast, sessions: [F.done('p1', F.kid(1), 'Ayesha Testwala', 4, 3, { device_ref: DEV })] });
  out.chip = await call({ chip: chip(1), via: 'name' });
  // A typed new child on a code with no class identity (today's path), English.
  await fresh({ fast, v2: false, lang: 'en' });
  out.typed = await call({ new: { name: 'Omar Testwala', cls: '4', force: true }, via: 'new' });
  // The new child's id is generated by the insert: the chip and animal are checked against that row, then named.
  const made = fake.db.students.find((s) => s.student_name === 'Omar Testwala');
  expect(out.typed.child).toEqual({ chip: T.chipId(F.SC, made.id), first: 'Omar', animal: T.animalFor(made.id) });
  out.typed.child = { ...out.typed.child, chip: '<the new child>', animal: '<the new child>' };
  // A returning page: its own open session, one answer in, a finish elsewhere earlier.
  await fresh({ fast, sessions: [F.done('p2', F.kid(1), 'Ayesha Testwala', 3, 5, { device_ref: 'OtherPhoneDeviceRef22' })] });
  const first = await WQ.startSession({ code: 'AB12CD', device_ref: DEV, chip: chip(1), via: 'name' });
  const sid = T.verify(first.st, 's').sid;
  fake.db.quiz_answers.push({ session_id: sid, question_id: '99999991-9999-4999-8999-999999999999', selected_option: 'B', is_correct: true });
  out.resume = await call({ resume_st: first.st, chip: chip(1) });
  return out;
}

test('switch off: the answers are today\'s, byte for byte (golden)', async () => {
  const out = await answers(false);
  expect(out.chip.counted).toBe(false);
  expect(out.resume.resume.answered).toHaveLength(1);
  if (!fs.existsSync(GOLDEN)) fs.writeFileSync(GOLDEN, `${JSON.stringify(out, null, 1)}\n`);
  expect(JSON.stringify(out, null, 1)).toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd());
});

test('switch on: the answers are exactly the switch-off answers', async () => {
  const off = await answers(false);
  const on = await answers(true);
  expect(on).toEqual(off);
});

/** The most reads in flight at once during one start of a remembered class child (caches warmed by a first start). */
async function peak(fast, body) {
  await fresh({ fast, sessions: [F.done('p1', F.kid(1), 'Ayesha Testwala', 4, 3, { device_ref: DEV })] });
  await WQ.startSession({ code: 'AB12CD', device_ref: DEV, chip: chip(1), via: 'name' });
  maxInflight = 0;
  const out = await WQ.startSession({ code: 'AB12CD', device_ref: DEV, ...body() });
  return { n: maxInflight, out };
}

test('switch on: the earlier-finish lookup runs beside the insert, and the steps after it run together', async () => {
  const off = await peak(false, () => ({ chip: chip(1), via: 'name' }));
  const on = await peak(true, () => ({ chip: chip(1), via: 'name' }));
  expect(on.n).toBeGreaterThan(off.n);
  expect(on.n).toBeGreaterThanOrEqual(4);
});

test('switch on: a returning page\'s three lookups run together', async () => {
  const run = async (fast) => {
    await fresh({ fast });
    const first = await WQ.startSession({ code: 'AB12CD', device_ref: DEV, chip: chip(1), via: 'name' });
    maxInflight = 0;
    await WQ.startSession({ code: 'AB12CD', device_ref: DEV, resume_st: first.st, chip: chip(1) });
    return maxInflight;
  };
  const off = await run(false);
  const on = await run(true);
  expect(on).toBeGreaterThan(off);
  expect(on).toBeGreaterThanOrEqual(3);
});

test('switch on: the session row, the use count, the join event and the pick are each written once', async () => {
  await fresh({ fast: true });
  await WQ.startSession({ code: 'AB12CD', device_ref: DEV, chip: chip(1), via: 'name' });
  const { logEvent } = require('../../../shared/utils/structured-logger');
  const redis = require('../../../shared/services/cache/railway-redis.service');
  logEvent.mockClear(); redis.set.mockClear();
  const before = fake.db.quiz_sessions.length;
  const uses = fake.db.quiz_share_codes[0].uses_count || 0;
  await WQ.startSession({ code: 'AB12CD', device_ref: DEV, chip: chip(1), via: 'name' });
  expect(fake.db.quiz_sessions.length).toBe(before + 1);
  expect(fake.db.quiz_share_codes[0].uses_count).toBe(uses + 1);
  const names = logEvent.mock.calls.map((c) => c[0]);
  ['quiz_funnel.child_joined', 'web_quiz.identity_resolved', 'web_quiz.id_pick', 'web_quiz.session_started']
    .forEach((n) => expect(names.filter((x) => x === n)).toHaveLength(1));
  // The pick is recorded before the start is logged, as today.
  expect(names.indexOf('web_quiz.id_pick')).toBeLessThan(names.indexOf('web_quiz.session_started'));
  expect(redis.set.mock.calls.filter(([k]) => String(k).startsWith('wq:pick:') || String(k).includes('pick')).length).toBeGreaterThan(0);
});

test('switch on: a failed insert fails the start as today, writes nothing after it, and leaves nothing unhandled', async () => {
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  try {
    await fresh({ fast: true });
    await WQ.startSession({ code: 'AB12CD', device_ref: DEV, chip: chip(1), via: 'name' });
    const supabase = require('../../../shared/config/supabase');
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'quiz_sessions') return b;
      const insert = b.insert;
      b.insert = () => { insert.call(b, {}); b.then = (res, rej) => slow(() => ({ data: null, error: { message: 'down' } })).then(res, rej); return b; };
      return b;
    };
    const uses = fake.db.quiz_share_codes[0].uses_count || 0;
    const out = await call({ chip: chip(1), via: 'name' });
    expect(out).toEqual({ status: 502, body: { error: 'db_unavailable' } });
    expect(fake.db.quiz_share_codes[0].uses_count || 0).toBe(uses);
    await new Promise((r) => setTimeout(r, 4 * READ_MS));
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});
