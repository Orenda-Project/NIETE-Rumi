'use strict';
/**
 * A class link's own reads start together (app_settings web_quiz_link_together, default off; read from the hub's
 * switch cache only, so a cold cache is off and adds no read). With identity v2 the class link page (getQuiz) and a
 * child's start (startSession) work out the hand-out's class (resolveQuizClass) in three steps, each read after the one
 * before: the code's own class, then the quiz's list, then the teacher's classes. On, the three steps' first reads start
 * at once and are still used in their order (a step that answers ends it, as today); the page hands in the quiz row it
 * reads anyway. The answers are the same, byte for byte; only the waits go. Every read takes READ_MS at the boundary
 * and gets a WAVE, 1 + the highest wave of the reads already finished when it started.
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
function seed(opts, link) {
  db = F.db(opts);
  db.app_settings.push({ key: 'web_quiz_fast', value: true });
  if (link !== undefined) db.app_settings.push({ key: 'web_quiz_link_together', value: link });
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
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'link-together-secret', PORTAL_URL: 'https://portal.example.test' }; });
afterAll(() => { process.env = SAVED; });

// The page and a start, warm (the second ask, as on a live process), each with its waves and reads.
// Signed tokens carry fresh ids and times, and a new child's chip and animal come from their fresh id: masked.
const mask = (s) => s.replace(/"(st|resume_st)":"[^"]+"/g, '"$1":"*"').replace(/"child":\{"chip":"[0-9a-f]{16}","first":"([^"]*)","animal":"[a-z]+"\}/g, '"child":{"chip":"*","first":"$1","animal":"*"}').replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g, (u) => (JSON.stringify(F).includes(u) ? u : '<id>'));
async function link(opts, value) {
  jest.resetModules();
  seed(opts, value);
  const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
  Flags.prime(db.app_settings);
  const WQ = require('../../../shared/services/quiz/web-quiz.service');
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
    reads = []; doneMax = 0;
    const a = await ans(fn);
    out[name] = { ans: a, waves: doneMax, reads: reads.length };
    await settle();
  }
  return out;
}

const CASES = [['the code names its class', { codeClass: F.CLS_A }], ['two classes of the teacher', { codeClass: null, classes: 'two' }], ['the teacher\'s one class', { codeClass: null, classes: 'one' }]];

describe.each(CASES)('identity v2, %s', (name, opts) => {
  test('on: the page and the starts answer byte for byte the same; the waits never longer', async () => {
    const before = await link(opts);
    const on = await link(opts, true);
    for (const k of ['page', 'start', 'newKid']) {
      console.log(`${name} ${k}: ${before[k].waves} waves / ${before[k].reads} reads -> ${on[k].waves} / ${on[k].reads}`);
      expect([k, on[k].ans]).toEqual([k, before[k].ans]);
      expect([k, on[k].waves <= before[k].waves]).toEqual([k, true]);
      // a step that answers early leaves the later steps' started reads unused: at most two more
      expect([k, on[k].reads <= before[k].reads + 2]).toEqual([k, true]);
    }
  });
});

describe('the teacher\'s classes (no class on the code): fewer waves', () => {
  test.each([['two classes', 'two'], ['one class', 'one']])('%s: the page and a new child\'s start each wait at least two waves less', async (_n, classes) => {
    const before = await link({ codeClass: null, classes });
    const on = await link({ codeClass: null, classes }, true);
    expect(on.page.waves).toBeLessThanOrEqual(before.page.waves - 2);
    expect(on.newKid.waves).toBeLessThanOrEqual(before.newKid.waves - 2);
  });
});

describe('off', () => {
  test.each([['the string true', 'true'], ['1', 1], ['an object', { on: true }]])('%s: not on; the same waves, reads and answers as no row', async (_n, value) => {
    const before = await link({ codeClass: null, classes: 'two' });
    const odd = await link({ codeClass: null, classes: 'two' }, value);
    for (const k of ['page', 'start', 'newKid']) expect([k, odd[k].ans, odd[k].waves, odd[k].reads]).toEqual([k, before[k].ans, before[k].waves, before[k].reads]);
  });
});

describe('pin', () => {
  test('the hub\'s batched settings read names the key; JSON true only; the cache only (cold is off)', () => {
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    expect(Flags.KEYS).toContain('web_quiz_link_together');
    expect(Flags.LINK_TOGETHER_KEY).toBe('web_quiz_link_together');
    Flags._resetCache();
    expect(Flags.linkTogetherNow()).toBe(false);
    Flags.prime([{ key: 'web_quiz_link_together', value: true }]);
    expect(Flags.linkTogetherNow()).toBe(true);
    Flags._resetCache();
    Flags.prime([{ key: 'web_quiz_link_together', value: 'true' }]);
    expect(Flags.linkTogetherNow()).toBe(false);
  });
});
