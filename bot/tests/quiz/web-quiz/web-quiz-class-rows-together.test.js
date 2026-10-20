'use strict';
/**
 * A class link's class rows start together (app_settings web_quiz_class_rows_together, default off; read from the hub's
 * switch cache only, so a cold cache is off and adds no read). With identity v2 the class link page (getQuiz) and a
 * child's start (startSession) work out the hand-out's class (resolveQuizClass), then read that class's children
 * (loadClassRoster, its own 30 s cache). Today, once the class's id is known, its row, then its list, then its children
 * (enrolments and lists, then the children) are read one after another. On: the row and the list are read together,
 * the children start as soon as the class's id is known, and a teacher's classes and their lists are read together.
 * The answers are the same, byte for byte; only the waits go. Every read takes READ_MS at the boundary and gets a WAVE,
 * 1 + the highest wave of the reads already finished when it started.
 *
 * Supabase, SQS, Redis and WhatsApp are the boundaries; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => true, setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');

const READ_MS = 8;
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';
let reads = [];
let doneMax = 0;
let db = null;
function seed(opts, rows, { link = true } = {}) {
  db = F.db(opts);
  db.app_settings.push({ key: 'web_quiz_fast', value: true });
  if (link) db.app_settings.push({ key: 'web_quiz_link_together', value: true });
  if (rows !== undefined) db.app_settings.push({ key: 'web_quiz_class_rows_together', value: rows });
  const fake = makeFake(db);
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    b.then = (res, rej) => {
      const rec = { t, wave: doneMax + 1 };
      reads.push(rec);
      return new Promise((r) => setTimeout(r, READ_MS)).then(() => { doneMax = Math.max(doneMax, rec.wave); return then.call(b, (x) => x); }).then(res, rej);
    };
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}
const settle = () => new Promise((r) => setTimeout(r, 12 * READ_MS));

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'class-rows-secret', PORTAL_URL: 'https://portal.example.test' }; });
afterAll(() => { process.env = SAVED; });

const mask = (s) => s.replace(/"(st|resume_st)":"[^"]+"/g, '"$1":"*"').replace(/"child":\{"chip":"[0-9a-f]{16}","first":"([^"]*)","animal":"[a-z]+"\}/g, '"child":{"chip":"*","first":"$1","animal":"*"}').replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g, (u) => (JSON.stringify(F).includes(u) ? u : '<id>'));
// The page and two starts, each asked twice (the second measured): `cold` forgets the class's children before the
// measured ask (the roster's own 30 s cache ran out), else they are warm from the first ask.
async function run(opts, value, { cold = false, link = true } = {}) {
  jest.resetModules();
  seed(opts, value, { link });
  const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
  Flags.prime(db.app_settings);
  const WQ = require('../../../shared/services/quiz/web-quiz.service');
  const IdRoster = require('../../../shared/services/quiz/web-quiz-identity-roster');
  const ans = async (fn) => { try { return mask(JSON.stringify(await fn())); } catch (e) { return `ERR ${e.status} ${JSON.stringify(e.body || e.message)}`; } };
  const out = {};
  const calls = {
    page: () => WQ.getQuiz('AB12CD'),
    start: () => WQ.startSession({ code: 'AB12CD', device_ref: DEVICE, new: { name: 'Ayesha Testwala' } }),
    newKid: () => WQ.startSession({ code: 'AB12CD', device_ref: DEVICE, new: { name: 'Gulnaz Testwala', force: true } }),
  };
  for (const [name, fn] of Object.entries(calls)) {
    await ans(fn);
    Flags.prime(db.app_settings);
    await settle();
    if (cold) { IdRoster._forgetClass(F.CLS_A); IdRoster._forgetClass(F.CLS_B); }
    reads = []; doneMax = 0;
    const a = await ans(fn);
    out[name] = { ans: a, waves: doneMax, reads: reads.length };
    await settle();
  }
  return out;
}

const CASES = [['the code names its class', { codeClass: F.CLS_A }], ['two classes of the teacher', { codeClass: null, classes: 'two' }], ['the teacher\'s one class', { codeClass: null, classes: 'one' }]];

describe.each(CASES)('identity v2, %s', (name, opts) => {
  test.each([['children warm', false], ['children cold', true]])('on, %s: the page and the starts answer byte for byte the same; the waits never longer; no more reads', async (_w, cold) => {
    const before = await run(opts, undefined, { cold });
    const on = await run(opts, true, { cold });
    for (const k of ['page', 'start', 'newKid']) {
      console.log(`${name}${cold ? ' (children cold)' : ''} ${k}: ${before[k].waves} waves / ${before[k].reads} reads -> ${on[k].waves} / ${on[k].reads}`);
      expect([k, on[k].ans]).toEqual([k, before[k].ans]);
      expect([k, on[k].waves <= before[k].waves]).toEqual([k, true]);
      expect([k, on[k].reads <= before[k].reads]).toEqual([k, true]);
    }
  });
});

describe('the code names its class: fewer waits', () => {
  test('children warm: the page waits at least one wave less (the row and the list together)', async () => {
    const before = await run({ codeClass: F.CLS_A });
    const on = await run({ codeClass: F.CLS_A }, true);
    expect(on.page.waves).toBeLessThanOrEqual(before.page.waves - 1);
  });
  test('children cold: the page and a start wait at least two waves less (the children start with the row)', async () => {
    const before = await run({ codeClass: F.CLS_A }, undefined, { cold: true });
    const on = await run({ codeClass: F.CLS_A }, true, { cold: true });
    expect(on.page.waves).toBeLessThanOrEqual(before.page.waves - 2);
    expect(on.start.waves).toBeLessThanOrEqual(before.start.waves - 2);
  });
  test('without link_together too: the same answers, never longer', async () => {
    const before = await run({ codeClass: F.CLS_A }, undefined, { cold: true, link: false });
    const on = await run({ codeClass: F.CLS_A }, true, { cold: true, link: false });
    for (const k of ['page', 'start', 'newKid']) {
      expect([k, on[k].ans]).toEqual([k, before[k].ans]);
      expect([k, on[k].waves <= before[k].waves - (k === 'page' ? 2 : 0)]).toEqual([k, true]);
    }
  });
});

describe('the teacher\'s classes: their rows and lists together', () => {
  test('two classes, children warm: the page waits at least one wave less', async () => {
    const before = await run({ codeClass: null, classes: 'two' });
    const on = await run({ codeClass: null, classes: 'two' }, true);
    expect(on.page.waves).toBeLessThanOrEqual(before.page.waves - 1);
  });
});

describe('off', () => {
  test.each([['the string true', 'true'], ['1', 1], ['false', false]])('%s: not on; the same waves, reads and answers as no row', async (_n, value) => {
    for (const opts of [{ codeClass: F.CLS_A }, { codeClass: null, classes: 'two' }]) {
      const before = await run(opts, undefined, { cold: true });
      const odd = await run(opts, value, { cold: true });
      for (const k of ['page', 'start', 'newKid']) expect([k, odd[k].ans, odd[k].waves, odd[k].reads]).toEqual([k, before[k].ans, before[k].waves, before[k].reads]);
    }
  });
});

describe('pin', () => {
  test('the hub\'s batched settings read names the key; JSON true only; the cache only (cold is off)', () => {
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    expect(Flags.KEYS).toContain('web_quiz_class_rows_together');
    Flags._resetCache();
    expect(Flags.nowOf('classRows')).toBe(false);
    Flags.prime([{ key: 'web_quiz_class_rows_together', value: true }]);
    expect(Flags.nowOf('classRows')).toBe(true);
    Flags._resetCache();
    Flags.prime([{ key: 'web_quiz_class_rows_together', value: 'true' }]);
    expect(Flags.nowOf('classRows')).toBe(false);
  });
});
