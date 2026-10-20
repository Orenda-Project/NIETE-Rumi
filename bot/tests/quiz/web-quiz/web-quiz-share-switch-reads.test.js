'use strict';
/**
 * The two share switches add no read to a child's quiz page (app_settings web_quiz_share_ur_stack and
 * web_quiz_share_name_bidi, default OFF). The page answer's `name_bidi` and the challenger's name on an Urdu page come
 * from the hub's switch cache only (nowOf('nameBidi')); the Urdu stack is a picture switch, read in the card switches'
 * one read that the picture already makes. So on the Urdu class link and the Urdu friend's challenge link, cold (a fresh
 * process, nothing warmed) and warm, the reads are today's with each key absent, OFF or ON (the counts below were
 * recorded on the base, before either switch existed).
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
function seed({ settings = [], lang = 'ur', parent = 'kept', played = true } = {}) {
  db = F.db({ sessions: played ? [F.done('s-ch-1', F.kid(1), 'Ayesha Testwala', 4, 1), F.done('s-ch-0', F.kid(1), 'Ayesha Testwala', 2, 0.5)] : [] });
  if (lang === 'ur') {
    db.quiz_share_codes.forEach((c) => { c.language = 'ur'; });
    db.quizzes[0].language = 'ur';
    db.students.find((k) => k.id === F.kid(1)).student_name_urdu = 'عائشہ ٹیسٹ والا';
  }
  if (parent === 'gone') db.quiz_share_codes = db.quiz_share_codes.filter((c) => c.code !== 'AB12CD');
  db.app_settings = [...BASE];
  db.app_settings.push(...settings);
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
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'share-switch-reads-secret', PORTAL_URL: 'https://portal.example.test' }; failIf = null; });
afterAll(() => { process.env = SAVED; });
const mask = (s) => s.replace(/"(st|resume_st)":"[^"]+"/g, '"$1":"*"');
const nonSettings = () => reads.filter((r) => r.t !== 'app_settings');


// The reads one answer makes, recorded on the base (171bab4e94) with this file's own seed.
const TODAY = { cold: { CLS: 28, CH: 21 }, warm: { CLS: 12, CH: 11 } };
const CODE = { CLS: 'AB12CD', CH };

async function open({ settings = [], code, warm }) {
  jest.resetModules();
  seed({ settings });
  const PageWarm = require('../../../shared/services/quiz/web-quiz-page-warm');
  const WQ = require('../../../shared/services/quiz/web-quiz.service');
  const ans = async (c) => { try { return mask(JSON.stringify(await WQ.getQuiz(c))); } catch (e) { return `ERR ${e.status} ${JSON.stringify(e.body || e.message)}`; } };
  try {
    if (warm) {
      await PageWarm.flag();
      await ans('AB12CD'); await settle();
      await ans(code); await settle();
      await ans(code); await settle();
    }
    reads = []; doneMax = 0;
    const out = await ans(code);
    const r = { ans: out, reads: reads.length, settingsReads: reads.filter((x) => x.t === 'app_settings').length };
    await settle();
    return r;
  } finally { PageWarm.stop(); }
}

const BOTH = (value) => [{ key: 'web_quiz_share_ur_stack', value }, { key: 'web_quiz_share_name_bidi', value }];
const CASES = [];
for (const temp of ['cold', 'warm']) for (const link of ['CLS', 'CH']) CASES.push([temp, link]);

describe('the Urdu quiz page: the share switches add no read', () => {
  test.each(CASES)('%s, %s link: absent, OFF and ON make today\'s reads', async (temp, link) => {
    const warm = temp === 'warm';
    const absent = await open({ code: CODE[link], warm });
    const off = await open({ code: CODE[link], warm, settings: BOTH(false) });
    const on = await open({ code: CODE[link], warm, settings: BOTH(true) });
    console.log(`reads ${temp} ${link}: absent ${absent.reads} (${absent.settingsReads} settings), off ${off.reads}, on ${on.reads}`);
    expect(absent.ans).not.toMatch(/^ERR/);
    if (TODAY[temp][link] != null) expect(absent.reads).toBe(TODAY[temp][link]);
    expect(off.reads).toBe(absent.reads);
    expect(on.reads).toBe(absent.reads);
    expect(off.ans).toEqual(absent.ans);
  });
  test('warm, ON: the friend\'s link answer says name_bidi and keeps the list\'s Urdu spelling of the challenger', async () => {
    const on = await open({ code: CH, warm: true, settings: BOTH(true) });
    const a = JSON.parse(on.ans);
    expect(a.name_bidi).toBe(true);
    expect(a.challenge.first).toBe('عائشہ');
    const off = JSON.parse((await open({ code: CH, warm: true })).ans);
    expect(off).not.toHaveProperty('name_bidi');
    delete a.name_bidi;
    expect(a).toEqual(off);
  });
});
