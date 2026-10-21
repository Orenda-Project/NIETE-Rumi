'use strict';
/**
 * The share follow-ups on a page whose language is not its lesson's (app_settings web_quiz_share_page_lang, JSON true only,
 * from the hub's switch cache; default off): the page answer says `share_page_lang: true`, and the page puts its own
 * language on the challenge link, has Jugnu's end line speak it, compares a replay with the child's own first try and keeps
 * the end confetti behind the card (wq.js). It is read from the hub's cache only: on adds no read. Off (any value but JSON
 * true), every read and answer is today's.
 *
 * Supabase, SQS, Redis and WhatsApp are the boundaries; every first-party module on the path runs for real. Every read
 * takes READ_MS and gets a WAVE (one more than the latest wave that had answered when it started).
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
const KEY = 'web_quiz_share_page_lang';
// the page switches as sandbox and production run them (values only)
const ON = ['web_quiz_adventure_look', 'web_quiz_back_nav', 'web_quiz_card_v3', 'web_quiz_challenge', 'web_quiz_class_doors', 'web_quiz_enabled',
  'web_quiz_fast', 'web_quiz_hub', 'web_quiz_juice', 'web_quiz_link_home', 'web_quiz_link_together', 'web_quiz_class_rows_together',
  'web_quiz_rich_telemetry', 'web_quiz_share_v4', 'web_quiz_ur_polish', 'web_quiz_page_warm', 'web_quiz_page_keep'].map((key) => ({ key, value: true }));
const BASE = [...ON, { key: 'web_quiz_identity', value: 'v2' }, { key: 'web_quiz_invite_ask', value: 'on' }, { key: 'web_quiz_teachers', value: 'all' }];
const CH = 'FR13ND'; // the fixture's challenge code: kid 1's, under the class code AB12CD

let reads = [];
let doneMax = 0;
let db = null;
let failIf = null; // (table, cols) => true: that read answers an error
function seed({ fold: early, lang = 'en', parent = 'kept', played = true } = {}) {
  db = F.db({ sessions: played ? [F.done('s-ch-1', F.kid(1), 'Ayesha Testwala', 4, 1), F.done('s-ch-0', F.kid(1), 'Ayesha Testwala', 2, 0.5)] : [] });
  if (lang === 'ur') {
    db.quiz_share_codes.forEach((c) => { c.language = 'ur'; });
    db.quizzes[0].language = 'ur';
    db.students.find((k) => k.id === F.kid(1)).student_name_urdu = 'عائشہ ٹیسٹ والا';
  }
  if (parent === 'gone') db.quiz_share_codes = db.quiz_share_codes.filter((c) => c.code !== 'AB12CD');
  db.app_settings = [...BASE];
  if (early !== undefined) db.app_settings.push({ key: KEY, value: early });
  const fake = makeFake(db);
  const from = (t) => {
    const b = fake.from(t);
    const select = b.select;
    let cols = '';
    b.select = (c, ...rest) => { cols = String(c || ''); return select.call(b, c, ...rest); };
    const then = b.then;
    b.then = (res, rej) => {
      const rec = { t, cols, wave: doneMax + 1 };
      reads.push(rec);
      if (failIf && failIf(t, cols)) return new Promise((r) => setTimeout(r, READ_MS)).then(() => ({ data: null, error: { message: 'down' } })).then(res, rej);
      return new Promise((r) => setTimeout(r, READ_MS)).then(() => { doneMax = Math.max(doneMax, rec.wave); return then.call(b, (x) => x); }).then(res, rej);
    };
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}
const settle = () => new Promise((r) => setTimeout(r, 12 * READ_MS));

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'page-lang-secret', PORTAL_URL: 'https://portal.example.test' }; failIf = null; });
afterAll(() => { process.env = SAVED; });
const mask = (s) => s.replace(/"(st|resume_st)":"[^"]+"/g, '"$1":"*"');
const nonSettings = () => reads.filter((r) => r.t !== 'app_settings');

// A warm process (it has served the class link and the challenge link), then `code` measured.
async function warmOpen(opts = {}, code = CH, { fail } = {}) {
  jest.resetModules();
  seed(opts);
  const PageWarm = require('../../../shared/services/quiz/web-quiz-page-warm');
  const WQ = require('../../../shared/services/quiz/web-quiz.service');
  const ans = async (c) => { try { return mask(JSON.stringify(await WQ.getQuiz(c))); } catch (e) { return `ERR ${e.status} ${JSON.stringify(e.body || e.message)}`; } };
  try {
    await PageWarm.flag();
    await ans('AB12CD'); await settle();
    await ans(code); await settle();
    await ans(code); await settle();
    failIf = fail || null;
    reads = []; doneMax = 0;
    const out = await ans(code);
    const r = { ans: out, waves: doneMax, reads: reads.length, data: nonSettings().length, codeReads: reads.filter((x) => x.t === 'quiz_share_codes').length };
    failIf = null;
    await settle();
    return r;
  } finally { PageWarm.stop(); }
}

describe('web_quiz_share_page_lang: the page answer says to follow the page language in its share follow-ups', () => {
  test.each([['English', 'en'], ['Urdu', 'ur']])('%s class link, on: share_page_lang: true, no extra read; otherwise the same answer', async (_n, lang) => {
    const today = await warmOpen({ lang }, 'AB12CD');
    const on = await warmOpen({ fold: true, lang }, 'AB12CD');
    expect(today.ans).not.toMatch(/^ERR/);
    expect(JSON.parse(today.ans)).not.toHaveProperty('share_page_lang');
    const a = JSON.parse(on.ans);
    expect(a.share_page_lang).toBe(true);
    delete a.share_page_lang;
    expect(JSON.stringify(a)).toEqual(today.ans);
    expect(on.reads).toBe(today.reads);
  });
  test('a friend\'s challenge link, on: share_page_lang: true too', async () => {
    const on = await warmOpen({ fold: true });
    expect(JSON.parse(on.ans).share_page_lang).toBe(true);
  });
  test.each([[false], ['true'], [1], [null]])('off (%p): today\'s answer, byte for byte', async (v) => {
    const today = await warmOpen({}, 'AB12CD');
    const off = await warmOpen({ fold: v }, 'AB12CD');
    expect(off.ans).toEqual(today.ans);
  });
});
