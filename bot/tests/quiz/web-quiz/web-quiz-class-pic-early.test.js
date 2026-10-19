'use strict';
/**
 * A class link's picture facts start beside the page's own reads (app_settings web_quiz_class_pic_early, default off;
 * read from the hub's switch cache only, so a cold cache is off and adds no read). The page of a teacher's class code
 * (getQuiz) names its WhatsApp picture (art.teach, web-quiz-class-pic.js) only after everything else, and the picture's
 * facts re-read the code, then the quiz, then the hand-out's class (three more reads, one after another), then the
 * teacher's own classes: on a code no one opened in the last minute that is six waits after the page's own. On (with
 * the fast first page), the facts start once the code is known, take the code row the page resolved and the class the
 * page's identity already works out, and are awaited where today's code asks for them. The answers are the same, byte
 * for byte; only the waits go. Every read takes READ_MS at the boundary and gets a WAVE.
 *
 * Earlier header (the shared harness, from the link-together rows): a class link's own reads start together (app_settings web_quiz_link_together, default off; read from the hub's
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
const NEW_SC = '33333333-3333-4333-8333-3333333333aa';
function seed(opts, early) {
  db = F.db(opts);
  db.app_settings.push({ key: 'web_quiz_fast', value: true }, { key: 'quiz_teacher_home', value: true }, { key: 'web_quiz_link_together', value: true });
  if (early !== undefined) db.app_settings.push({ key: 'web_quiz_class_pic_early', value: early });
  // a second class code of the same teacher and quiz, never opened: the code a class opens for the first time
  db.quiz_share_codes.push({ ...db.quiz_share_codes[0], id: NEW_SC, code: 'NW34EF', created_at: new Date().toISOString() });
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

// The page of a code opened before (settings and that code warm), then the page of the code never opened, measured.
const mask = (s) => s.replace(/"(st|resume_st)":"[^"]+"/g, '"$1":"*"');
async function page(opts, value) {
  jest.resetModules();
  seed(opts, value);
  const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
  Flags.prime(db.app_settings);
  const WQ = require('../../../shared/services/quiz/web-quiz.service');
  const ans = async (fn) => { try { return mask(JSON.stringify(await fn())); } catch (e) { return `ERR ${e.status} ${JSON.stringify(e.body || e.message)}`; } };
  await ans(() => WQ.getQuiz('AB12CD'));
  await settle();
  Flags.prime(db.app_settings);
  reads = []; doneMax = 0;
  const a = await ans(() => WQ.getQuiz('NW34EF'));
  const out = { ans: a, waves: doneMax, reads: reads.length };
  await settle();
  return out;
}

const CASES = [['the code names its class', { codeClass: F.CLS_A }], ['two classes of the teacher', { codeClass: null, classes: 'two' }], ['the teacher\'s one class', { codeClass: null, classes: 'one' }]];

describe.each(CASES)('a new class code, %s', (name, opts) => {
  test('on: the page answers byte for byte the same; never more waits or reads', async () => {
    const before = await page(opts);
    const on = await page(opts, true);
    console.log(`${name}: ${before.waves} waves / ${before.reads} reads -> ${on.waves} / ${on.reads}`);
    expect(on.ans).toEqual(before.ans);
    expect(on.waves).toBeLessThanOrEqual(before.waves);
    expect(on.reads).toBeLessThanOrEqual(before.reads);
  });
});

describe('the code names its class (the picture is drawn): fewer waits', () => {
  test('on: the page carries the class picture as off does, at least four waves and two reads less', async () => {
    const before = await page({ codeClass: F.CLS_A });
    const on = await page({ codeClass: F.CLS_A }, true);
    expect(JSON.parse(before.ans).art.teach).toBeTruthy();
    expect(on.ans).toEqual(before.ans);
    expect(on.waves).toBeLessThanOrEqual(before.waves - 4);
    expect(on.reads).toBeLessThanOrEqual(before.reads - 2);
  });
});

describe('off', () => {
  test.each([['the string true', 'true'], ['1', 1], ['an object', { on: true }]])('%s: not on; the same waves, reads and answer as no row', async (_n, value) => {
    const before = await page({ codeClass: F.CLS_A });
    const odd = await page({ codeClass: F.CLS_A }, value);
    expect([odd.ans, odd.waves, odd.reads]).toEqual([before.ans, before.waves, before.reads]);
  });
});

describe('pin', () => {
  test('the hub\'s batched settings read names the key; JSON true only; the cache only (cold is off)', () => {
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    expect(Flags.KEYS).toContain('web_quiz_class_pic_early');
    Flags._resetCache();
    expect(Flags.nowOf('classPicEarly')).toBe(false);
    Flags.prime([{ key: 'web_quiz_class_pic_early', value: true }]);
    expect(Flags.nowOf('classPicEarly')).toBe(true);
    Flags._resetCache();
    Flags.prime([{ key: 'web_quiz_class_pic_early', value: 'true' }]);
    expect(Flags.nowOf('classPicEarly')).toBe(false);
  });
});
