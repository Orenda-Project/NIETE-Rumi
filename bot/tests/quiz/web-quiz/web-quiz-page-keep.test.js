'use strict';
/**
 * The page switches kept in one read (app_settings web_quiz_page_keep, with web_quiz_page_warm; default off). Each page
 * switch reader has its own 30 s cache and its own read: on a process that was quiet for longer than that, a class
 * code's page made ~16 settings reads (all in its first wait with page_warm on). With page_keep on, page_warm's own
 * touch reads every key those readers named in ONE read every 10 s and hands them the rows: the page after the quiet
 * makes no settings read and draws the warm answer. Off (any value but JSON true, or page_warm off), every reader
 * reads as with page_warm alone. Every read takes READ_MS at the boundary and gets a WAVE.
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
// production's switches (read-only snapshot from the replica, 19 Oct): values only, no ids but the fixture rule's
const PROD = [{"key": "quiz_author_gates_v2", "value": true}, {"key": "quiz_join_early_tap", "value": true}, {"key": "quiz_join_fast", "value": true}, {"key": "quiz_join_wait_word", "value": true}, {"key": "quiz_maker_page", "value": true}, {"key": "quiz_one_door", "value": true}, {"key": "quiz_report_fold_by_child", "value": true}, {"key": "quiz_student_join", "value": true}, {"key": "quiz_teacher_home", "value": true}, {"key": "quiz_teacher_home_paged", "value": true}, {"key": "quiz_teacher_stories_stale_words", "value": true}, {"key": "web_quiz_adventure_look", "value": true}, {"key": "web_quiz_back_nav", "value": true}, {"key": "web_quiz_bind_way_back", "value": true}, {"key": "web_quiz_brotli", "value": true}, {"key": "web_quiz_card_fast", "value": true}, {"key": "web_quiz_card_ready", "value": true}, {"key": "web_quiz_card_v3", "value": true}, {"key": "web_quiz_challenge", "value": true}, {"key": "web_quiz_challenge_items", "value": true}, {"key": "web_quiz_challenge_keep_audio", "value": true}, {"key": "web_quiz_challenge_listen", "value": true}, {"key": "web_quiz_challenge_missing", "value": true}, {"key": "web_quiz_challenge_option_audio", "value": true}, {"key": "web_quiz_challenge_questions", "value": true}, {"key": "web_quiz_challenge_read_guard", "value": true}, {"key": "web_quiz_challenge_realtime", "value": true}, {"key": "web_quiz_challenge_record", "value": true}, {"key": "web_quiz_challenge_story_voice", "value": true}, {"key": "web_quiz_challenge_sweeper", "value": true}, {"key": "web_quiz_challenge_trail", "value": true}, {"key": "web_quiz_child_quiz_home", "value": true}, {"key": "web_quiz_class_doors", "value": true}, {"key": "web_quiz_db_deadline", "value": true}, {"key": "web_quiz_door_dedupe", "value": true}, {"key": "web_quiz_doors_prefetch", "value": true}, {"key": "web_quiz_early_unlock", "value": true}, {"key": "web_quiz_edge_learn", "value": true}, {"key": "web_quiz_enabled", "value": true}, {"key": "web_quiz_events_v3", "value": true}, {"key": "web_quiz_face_lite", "value": true}, {"key": "web_quiz_fast", "value": true}, {"key": "web_quiz_fixture_rule", "value": {"student_lists": [], "teachers": ["c30c79f1-0c6c-41bc-9909-bc60d1297e48", "d85abd76-4998-4710-bfc8-43e1d046bb99"]}}, {"key": "web_quiz_fold_retry", "value": true}, {"key": "web_quiz_go_link_lang", "value": true}, {"key": "web_quiz_grade_change", "value": true}, {"key": "web_quiz_home_button", "value": true}, {"key": "web_quiz_home_inline", "value": true}, {"key": "web_quiz_home_preload", "value": true}, {"key": "web_quiz_home_v3", "value": true}, {"key": "web_quiz_hub", "value": true}, {"key": "web_quiz_hub_child_memo", "value": true}, {"key": "web_quiz_hub_door", "value": true}, {"key": "web_quiz_hub_early_kid", "value": true}, {"key": "web_quiz_hub_fanout", "value": true}, {"key": "web_quiz_hub_roster_warm", "value": true}, {"key": "web_quiz_hub_waves2", "value": true}, {"key": "web_quiz_identity", "value": "v2"}, {"key": "web_quiz_identity_canon", "value": true}, {"key": "web_quiz_install_prompt", "value": true}, {"key": "web_quiz_invite_ask", "value": "on"}, {"key": "web_quiz_items_v2", "value": true}, {"key": "web_quiz_juice", "value": true}, {"key": "web_quiz_library", "value": true}, {"key": "web_quiz_link_home", "value": true}, {"key": "web_quiz_list_states", "value": true}, {"key": "web_quiz_live_meter", "value": "sky"}, {"key": "web_quiz_live_read_v3", "value": true}, {"key": "web_quiz_look_after", "value": true}, {"key": "web_quiz_lr_repeat", "value": true}, {"key": "web_quiz_minify", "value": true}, {"key": "web_quiz_next_offer", "value": true}, {"key": "web_quiz_old_link_redirect", "value": true}, {"key": "web_quiz_one_button", "value": true}, {"key": "web_quiz_one_voice", "value": {"kbps": 32, "loudness_lufs": -21, "voices": {"en": {"name": "Reyna", "provider": "soniox", "voice": "Reyna"}, "ur": {"name": "Reyna", "provider": "soniox", "voice": "Reyna"}}}}, {"key": "web_quiz_page_lang", "value": true}, {"key": "web_quiz_read_feedback", "value": true}, {"key": "web_quiz_readalong", "value": true}, {"key": "web_quiz_remember_column", "value": true}, {"key": "web_quiz_return_lang", "value": true}, {"key": "web_quiz_rewatch_done", "value": true}, {"key": "web_quiz_rich_telemetry", "value": true}, {"key": "web_quiz_roster_id", "value": true}, {"key": "web_quiz_server_timing", "value": true}, {"key": "web_quiz_share_card_a", "value": true}, {"key": "web_quiz_share_data", "value": true}, {"key": "web_quiz_share_joined", "value": true}, {"key": "web_quiz_share_link_lang", "value": true}, {"key": "web_quiz_share_short", "value": true}, {"key": "web_quiz_share_v4", "value": true}, {"key": "web_quiz_stories", "value": true}, {"key": "web_quiz_stories_polish", "value": true}, {"key": "web_quiz_stories_slow_gaps", "value": true}, {"key": "web_quiz_stories_steady", "value": true}, {"key": "web_quiz_stories_teacher", "value": true}, {"key": "web_quiz_story_warm", "value": true}, {"key": "web_quiz_teachers", "value": "all"}, {"key": "web_quiz_ur_polish", "value": true}, {"key": "web_quiz_video_shelf", "value": true}, {"key": "web_quiz_videos_ur_titles", "value": true}, {"key": "web_quiz_videos_v3", "value": true}, {"key": "web_quiz_wait_home", "value": true}, {"key": "web_quiz_wait_hops", "value": true}, {"key": "web_quiz_wait_ux", "value": true}];
let reads = [];
let doneMax = 0;
let db = null;
let failSettings = false;
function seed({ warm = true, keep, kind = 'class' } = {}) {
  db = F.db({ codeClass: kind === 'loose' ? null : F.CLS_A });
  if (kind === 'ur') { db.quiz_share_codes[0].language = 'ur'; db.quizzes[0].language = 'ur'; }
  db.app_settings = [...PROD.filter((r) => r.key !== 'web_quiz_fixture_rule'), { key: 'web_quiz_link_together', value: true }];
  if (warm !== undefined) db.app_settings.push({ key: 'web_quiz_page_warm', value: warm });
  if (keep !== undefined) db.app_settings.push({ key: 'web_quiz_page_keep', value: keep });
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
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'page-keep-secret', PORTAL_URL: 'https://portal.example.test' }; failSettings = false; });
afterAll(() => { process.env = SAVED; });
const mask = (s) => s.replace(/"(st|resume_st)":"[^"]+"/g, '"$1":"*"');
const settingsReads = () => reads.filter((r) => r.t === 'app_settings').length;

// A process that has served one class page, then was quiet for 75 s (every 30 s reader cache stale) with page_warm's
// touch running through the quiet; then the page again (measured), and once more right after (warm).
async function quiet(opts = {}, { during } = {}) {
  jest.resetModules();
  seed(opts);
  const PageWarm = require('../../../shared/services/quiz/web-quiz-page-warm');
  await PageWarm.flag();
  PageWarm.stop();
  const WQ = require('../../../shared/services/quiz/web-quiz.service');
  const ans = async () => { try { return mask(JSON.stringify(await WQ.getQuiz('AB12CD'))); } catch (e) { return `ERR ${e.status} ${JSON.stringify(e.body || e.message)}`; } };
  const served = await ans();
  await settle();
  const realNow = Date.now.bind(Date);
  let skew = 0;
  const spy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
  try {
    for (const step of [10, 20, 30, 40, 50, 60, 70, 75]) {
      skew = step * 1000;
      if (during) during(step);
      reads = []; doneMax = 0;
      await PageWarm.tick();
      PageWarm.stop();
      failSettings = false; // a failing table, only for the touch's own read
    }
    const tickReads = settingsReads();
    await settle();
    reads = []; doneMax = 0;
    const first = { ans: await ans(), waves: doneMax, reads: reads.length, settings: settingsReads() };
    await settle();
    reads = []; doneMax = 0;
    const again = { ans: await ans(), waves: doneMax, reads: reads.length, settings: settingsReads() };
    await settle();
    return { served, first, again, tickReads };
  } finally { spy.mockRestore(); PageWarm.stop(); }
}

describe('page_keep on: the page after a quiet spell reads no switch', () => {
  test.each([['a class code', 'class'], ['a loose code', 'loose'], ['an Urdu code', 'ur']])('%s: 0 settings reads, the warm answer, no more waits than with page_warm alone; the touch is one read', async (_n, kind) => {
    const warmOnly = await quiet({ kind });
    const kept = await quiet({ keep: true, kind });
    console.log(`${kind} after 75 s quiet: page_warm alone ${warmOnly.first.waves} waves / ${warmOnly.first.reads} reads (${warmOnly.first.settings} settings) -> with page_keep ${kept.first.waves} / ${kept.first.reads} (${kept.first.settings}); warm ${kept.again.waves} / ${kept.again.reads}`);
    expect(warmOnly.first.settings).toBeGreaterThanOrEqual(10);
    expect(kept.first.settings).toBe(0);
    expect(kept.first.ans).not.toMatch(/^ERR/);
    expect(kept.first.ans).toEqual(warmOnly.again.ans);
    expect(kept.first.ans).toEqual(kept.served);
    expect(kept.first.waves).toBeLessThanOrEqual(warmOnly.first.waves);
    expect(kept.first.reads).toBeLessThanOrEqual(warmOnly.first.reads - 10);
    expect(kept.tickReads).toBe(1);
  });
});

describe('page_keep on: a fresh process', () => {
  test('the first page after a quiet spell, with no page served before it, reads only the switches no page warm-up names', async () => {
    const run = async (opts) => {
      jest.resetModules();
      seed(opts);
      const PageWarm = require('../../../shared/services/quiz/web-quiz-page-warm');
      await PageWarm.flag();
      PageWarm.stop();
      await settle();
      const WQ = require('../../../shared/services/quiz/web-quiz.service');
      const realNow = Date.now.bind(Date);
      let skew = 0;
      const spy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
      try {
        for (const step of [10, 20, 30, 40, 50, 60, 70, 75]) { skew = step * 1000; await PageWarm.tick(); PageWarm.stop(); }
        await settle();
        reads = []; doneMax = 0;
        const ans = mask(JSON.stringify(await WQ.getQuiz('AB12CD')));
        return { ans, settings: settingsReads() };
      } finally { spy.mockRestore(); PageWarm.stop(); }
    };
    const warmOnly = await run({});
    const kept = await run({ keep: true });
    expect(kept.ans).toEqual(warmOnly.ans);
    expect(kept.settings).toBeLessThanOrEqual(warmOnly.settings - 10);
  });
});

describe('page_keep off', () => {
  test.each([['no row', undefined], ['the string true', 'true'], ['1', 1], ['false', false]])('%s: the same answers, waves and reads as page_warm alone', async (_n, value) => {
    const warmOnly = await quiet({});
    const odd = await quiet({ keep: value });
    expect([odd.first.ans, odd.first.waves, odd.first.reads, odd.again.ans, odd.again.reads]).toEqual([warmOnly.first.ans, warmOnly.first.waves, warmOnly.first.reads, warmOnly.again.ans, warmOnly.again.reads]);
  });

  test('page_warm off: page_keep on does nothing (no touch, every reader reads)', async () => {
    const off = await quiet({ warm: false });
    const keepOnly = await quiet({ warm: false, keep: true });
    expect([keepOnly.first.ans, keepOnly.first.waves, keepOnly.first.reads]).toEqual([off.first.ans, off.first.waves, off.first.reads]);
    expect(keepOnly.first.settings).toBeGreaterThanOrEqual(10);
  });
});

describe('page_keep on: a switch flipped in the table', () => {
  test('reaches the page through the next touch (the kept rows are the table\'s, never older than 15 s)', async () => {
    const before = await quiet({ keep: true });
    expect(JSON.parse(before.first.ans).fast).toBe(true);
    const flipped = await quiet({ keep: true }, { during: (step) => { if (step === 40) db.app_settings = db.app_settings.filter((r) => r.key !== 'web_quiz_fast'); } });
    expect(JSON.parse(flipped.first.ans).fast).toBeUndefined();
    expect(flipped.first.settings).toBe(0);
  });

  test('kept rows older than 15 s are never handed out: each reader reads for itself', async () => {
    jest.resetModules();
    seed({ keep: true });
    const PageWarm = require('../../../shared/services/quiz/web-quiz-page-warm');
    await PageWarm.flag();
    PageWarm.stop();
    const WQ = require('../../../shared/services/quiz/web-quiz.service');
    await WQ.getQuiz('AB12CD');
    await settle();
    await PageWarm.tick();
    PageWarm.stop();
    const realNow = Date.now.bind(Date);
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 45 * 1000);
    try {
      reads = []; doneMax = 0;
      const page = mask(JSON.stringify(await WQ.getQuiz('AB12CD')));
      expect(page).not.toMatch(/^ERR/);
      expect(settingsReads()).toBeGreaterThanOrEqual(10);
    } finally { spy.mockRestore(); PageWarm.stop(); }
  });

  test('a failed touch read keeps nothing: the page reads as with page_warm alone, the real door', async () => {
    const warmOnly = await quiet({});
    const failed = await quiet({ keep: true }, { during: (step) => { failSettings = step >= 50; } });
    failSettings = false;
    expect(failed.first.ans).not.toMatch(/^ERR/);
    expect(failed.first.settings).toBeGreaterThanOrEqual(10);
    expect(failed.first.ans).toEqual(warmOnly.first.ans);
  });
});

describe('the kept rows themselves', () => {
  // The one read is handed out for 15 s at most, half of a switch's own 30 s cache: at 15 s every reader reads for
  // itself, so a switch flipped in the table is never answered from the kept rows after that.
  test('handed out until 15 s old, never at 15 s or later, never before they were read; only for keys the read asked', async () => {
    jest.resetModules();
    const Snap = require('../../../shared/services/settings/settings-snapshot');
    const read = jest.fn(async () => ({ data: [{ key: 'k1', value: 'table' }], error: null }));
    const t0 = 1_000_000;
    Snap.take([{ key: 'k1', value: 'kept' }, { key: 'k2', value: true }], ['k1', 'k2', 'k3'], t0);
    await expect(Snap.rows(['k1', 'k3'], read, t0 + 14_999)).resolves.toEqual({ data: [{ key: 'k1', value: 'kept' }], error: null });
    await expect(Snap.row('k3', read, t0 + 1)).resolves.toEqual({ data: null, error: null }); // asked, no row: no row
    expect(read).not.toHaveBeenCalled();
    expect(Snap.FRESH_MS).toBeLessThan(30 * 1000);
    await expect(Snap.rows(['k1'], read, t0 + 15_000)).resolves.toEqual({ data: [{ key: 'k1', value: 'table' }], error: null });
    await expect(Snap.row('k1', read, t0 - 1)).resolves.toEqual({ data: [{ key: 'k1', value: 'table' }], error: null });
    await expect(Snap.rows(['k1', 'k4'], read, t0 + 1)).resolves.toEqual({ data: [{ key: 'k1', value: 'table' }], error: null });
    expect(read).toHaveBeenCalledTimes(3);
    expect(Snap.keys()).toEqual(expect.arrayContaining(['k1', 'k3', 'k4']));
  });

  test('a reader that changes what it was handed never changes the kept rows', async () => {
    jest.resetModules();
    const Snap = require('../../../shared/services/settings/settings-snapshot');
    Snap.take([{ key: 'k1', value: { a: 1 } }], ['k1'], 5);
    const one = await Snap.row('k1', async () => null, 6);
    one.data.value.a = 2;
    expect((await Snap.row('k1', async () => null, 7)).data.value).toEqual({ a: 1 });
  });
});
