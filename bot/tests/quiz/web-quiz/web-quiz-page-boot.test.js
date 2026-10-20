'use strict';
/**
 * The page switches warmed when the process starts (app_settings web_quiz_page_boot, with web_quiz_page_warm; default
 * off). page_warm only learns it is on from a child's page, so on a fresh process (every deploy) the first child's page
 * read every page switch one by one (~20 settings reads) and the second child's page carried page_warm's own first
 * read and its first touch (~19). With page_boot on, the bot reads the switch once as it starts and, when page_warm is
 * on too, runs page_warm's read and touch then, plus the three page switches the touch does not name: the first page
 * on the new process reads no switch at all. Off (any value but JSON true, or page_warm off), the start makes that one
 * read and nothing else, and every page is today's.
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

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');

const READ_MS = 8;
// the page switches as sandbox and production run them (values only)
const ON = ['web_quiz_adventure_look', 'web_quiz_back_nav', 'web_quiz_card_fast', 'web_quiz_card_ready', 'web_quiz_card_v3', 'web_quiz_challenge',
  'web_quiz_class_doors', 'web_quiz_closed_lang', 'web_quiz_db_deadline', 'web_quiz_enabled', 'web_quiz_fast', 'web_quiz_hub', 'web_quiz_juice',
  'web_quiz_library', 'web_quiz_link_home', 'web_quiz_link_together', 'web_quiz_rich_telemetry', 'web_quiz_server_timing', 'web_quiz_share_link_lang',
  'web_quiz_share_v4', 'web_quiz_stories', 'web_quiz_ur_polish'].map((key) => ({ key, value: true }));
const BASE = [...ON, { key: 'web_quiz_identity', value: 'v2' }, { key: 'web_quiz_invite_ask', value: 'on' }, { key: 'web_quiz_teachers', value: 'all' }];

let reads = [];
let doneMax = 0;
let failSettings = false;
function seed({ boot, warm = true, keep = true, kind = 'class' } = {}) {
  const db = F.db({ codeClass: kind === 'loose' ? null : F.CLS_A });
  if (kind === 'ur') { db.quiz_share_codes[0].language = 'ur'; db.quizzes[0].language = 'ur'; }
  db.app_settings = [...BASE];
  if (warm !== undefined) db.app_settings.push({ key: 'web_quiz_page_warm', value: warm });
  if (keep !== undefined) db.app_settings.push({ key: 'web_quiz_page_keep', value: keep });
  if (boot !== undefined) db.app_settings.push({ key: 'web_quiz_page_boot', value: boot });
  const fake = makeFake(db);
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    b.then = (res, rej) => {
      const rec = { t, wave: doneMax + 1 };
      reads.push(rec);
      if (t === 'app_settings' && failSettings) return new Promise((r) => setTimeout(r, READ_MS)).then(() => ({ data: null, error: { message: 'down' } })).then(res, rej);
      return new Promise((r) => setTimeout(r, READ_MS)).then(() => { doneMax = Math.max(doneMax, rec.wave); return then.call(b, (x) => x); }).then(res, rej);
    };
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}
const settle = () => new Promise((r) => setTimeout(r, 12 * READ_MS));

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'page-boot-secret', PORTAL_URL: 'https://portal.example.test' }; failSettings = false; });
afterAll(() => { process.env = SAVED; });
const mask = (s) => s.replace(/"(st|resume_st)":"[^"]+"/g, '"$1":"*"');
const settingsReads = () => reads.filter((r) => r.t === 'app_settings').length;

// A fresh process: the start (boot() when `boot` is true), then the first page (measured), then a second page.
async function fresh(opts = {}, { start = true, failStart = false } = {}) {
  jest.resetModules();
  seed(opts);
  const PageWarm = require('../../../shared/services/quiz/web-quiz-page-warm');
  const WQ = require('../../../shared/services/quiz/web-quiz.service');
  const ans = async () => { try { return mask(JSON.stringify(await WQ.getQuiz('AB12CD'))); } catch (e) { return `ERR ${e.status} ${JSON.stringify(e.body || e.message)}`; } };
  try {
    reads = []; doneMax = 0;
    failSettings = failStart;
    let booted;
    if (start) booted = await PageWarm.boot();
    await settle();
    failSettings = false;
    const startReads = settingsReads();
    reads = []; doneMax = 0;
    const first = { ans: await ans(), waves: doneMax, reads: reads.length, settings: settingsReads() };
    await settle();
    reads = []; doneMax = 0;
    const second = { ans: await ans(), waves: doneMax, reads: reads.length, settings: settingsReads() };
    await settle();
    return { booted, startReads, first, second };
  } finally { PageWarm.stop(); }
}

describe('page_boot on (with page_warm + page_keep): the first page on a fresh process', () => {
  // Today the first page on a fresh process is drawn without the fast page (its switch is not known yet); with the start
  // warmed, the first page is already the warm page today's second child gets.
  test.each([['a class code', 'class'], ['a loose code', 'loose'], ['an Urdu code', 'ur']])('%s: 0 settings reads, the warm answer, fewer waits', async (_n, kind) => {
    const today = await fresh({ kind }, { start: false });
    const booted = await fresh({ boot: true, kind });
    console.log(`${kind} fresh process, 1st page: today ${today.first.waves} waves / ${today.first.reads} reads (${today.first.settings} settings), 2nd ${today.second.reads} (${today.second.settings}) -> page_boot ${booted.first.waves} / ${booted.first.reads} (${booted.first.settings}), 2nd ${booted.second.reads} (${booted.second.settings}); start ${booted.startReads} reads`);
    expect(today.first.settings).toBeGreaterThanOrEqual(10);
    expect(booted.booted).toBe(true);
    expect(booted.first.ans).not.toMatch(/^ERR/);
    expect(JSON.parse(today.first.ans).fast).toBeUndefined();
    expect(JSON.parse(today.second.ans).fast).toBe(true);
    expect(booted.first.ans).toEqual(today.second.ans);
    expect(booted.second.ans).toEqual(today.second.ans);
    expect(booted.first.settings).toBe(0);
    expect(booted.second.settings).toBe(0);
    expect(booted.first.waves).toBeLessThan(today.first.waves);
    expect(booted.first.reads).toBeLessThanOrEqual(today.first.reads - 10);
  });

  test('page_keep off: the start still warms every page switch, so a page within their 30 s reads none', async () => {
    const today = await fresh({ keep: undefined }, { start: false });
    const booted = await fresh({ boot: true, keep: undefined });
    expect(booted.first.ans).toEqual(today.second.ans);
    expect(booted.first.settings).toBe(0);
  });
});

describe('page_boot off: the start reads the one switch and nothing else; every page is today\'s', () => {
  test.each([['no row', undefined], ['the string true', 'true'], ['1', 1], ['false', false]])('%s', async (_n, value) => {
    const today = await fresh({}, { start: false });
    const off = await fresh({ boot: value });
    expect(off.booted).toBe(false);
    expect(off.startReads).toBe(1);
    expect([off.first.ans, off.first.waves, off.first.reads, off.second.ans, off.second.reads]).toEqual([today.first.ans, today.first.waves, today.first.reads, today.second.ans, today.second.reads]);
  });

  test('page_warm off: page_boot on does nothing more than its one read', async () => {
    const today = await fresh({ warm: false }, { start: false });
    const off = await fresh({ warm: false, boot: true });
    expect(off.booted).toBe(false);
    expect(off.startReads).toBe(1);
    expect([off.first.ans, off.first.waves, off.first.reads]).toEqual([today.first.ans, today.first.waves, today.first.reads]);
  });

  test('a failed start read: no throw, off, and the pages are today\'s', async () => {
    const today = await fresh({}, { start: false });
    const failed = await fresh({ boot: true }, { failStart: true });
    expect(failed.booted).toBe(false);
    expect(failed.first.ans).toEqual(today.first.ans);
    expect(failed.second.ans).toEqual(today.second.ans);
  });
});

describe('the bot starts it', () => {
  test('startServer() calls page_warm boot() without waiting for it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../whatsapp-bot.js'), 'utf8');
    const body = src.slice(src.indexOf('function startServer()'), src.indexOf('return app.listen(', src.indexOf('function startServer()')));
    expect(body).toMatch(/require\('\.\/shared\/services\/quiz\/web-quiz-page-warm'\)\.boot\(\)\.catch\(/);
  });
});
