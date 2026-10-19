'use strict';
/**
 * The class link page's switches kept warm (app_settings web_quiz_page_warm, default off). Each page switch has its own
 * 30 s cache and its own read, and the page awaits them one after another: on a process whose caches went cold (no
 * class link for half a minute), a class code's page made 32 reads in 27 waits (production's switches), and the fast
 * page (web_quiz_fast, read never waited for) was off for that first answer. On, the page starts every page switch's
 * own read together beside the code's read, and decides the fast page after them; this module's own switch is kept
 * fresh by a 20 s touch (one read) once it has read on, and is never waited for. Every read takes READ_MS at the
 * boundary and gets a WAVE.
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
function seed(warm) {
  db = F.db({ codeClass: F.CLS_A });
  db.app_settings = [...PROD.filter((r) => r.key !== 'web_quiz_fixture_rule'), { key: 'quiz_teacher_home', value: true }, { key: 'web_quiz_link_together', value: true }];
  if (warm !== undefined) db.app_settings.push({ key: 'web_quiz_page_warm', value: warm });
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
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'page-warm-secret', PORTAL_URL: 'https://portal.example.test' }; });
afterAll(() => { process.env = SAVED; });
const mask = (s) => s.replace(/"(st|resume_st)":"[^"]+"/g, '"$1":"*"');

// A process whose page switch caches are all cold but this module's own switch (kept fresh by its touch): the class
// code's page, measured; then the same page again, warm.
async function cold(warm) {
  jest.resetModules();
  seed(warm);
  let PageWarm = null;
  try { PageWarm = require('../../../shared/services/quiz/web-quiz-page-warm'); } catch (_) { PageWarm = null; }
  if (PageWarm) { await PageWarm.flag(); PageWarm.stop(); }
  const WQ = require('../../../shared/services/quiz/web-quiz.service');
  const ans = async () => { try { return mask(JSON.stringify(await WQ.getQuiz('AB12CD'))); } catch (e) { return `ERR ${e.status} ${JSON.stringify(e.body || e.message)}`; } };
  reads = []; doneMax = 0;
  const first = { ans: await ans(), waves: doneMax, reads: reads.length };
  await settle();
  reads = []; doneMax = 0;
  const again = { ans: await ans(), waves: doneMax, reads: reads.length };
  await settle();
  return { first, again };
}

describe('a class code\'s page on a process whose switch caches went cold', () => {
  test('on: the first answer is the warm answer (the fast page included), at least 14 waits fewer (the switches in one wait)', async () => {
    const off = await cold();
    const on = await cold(true);
    console.log(`cold page: off ${off.first.waves} waves / ${off.first.reads} reads -> on ${on.first.waves} / ${on.first.reads}; warm ${on.again.waves} / ${on.again.reads}`);
    expect(JSON.parse(off.again.ans).fast).toBe(true);
    expect(JSON.parse(off.first.ans).fast).toBeUndefined(); // today: the cold first answer misses the fast page
    expect(on.first.ans).toEqual(off.again.ans);
    expect(on.again.ans).toEqual(off.again.ans);
    expect(off.first.waves).toBeGreaterThanOrEqual(20);
    expect(on.first.waves).toBeLessThanOrEqual(off.first.waves - 14);
    // every page switch's read in the first wait, beside nothing else
    expect(on.first.reads).toBeLessThanOrEqual(off.first.reads + 6);
    expect(on.again.waves).toBeLessThanOrEqual(off.again.waves);
  });
});

describe('off', () => {
  test.each([['the string true', 'true'], ['1', 1], ['false', false]])('%s: not on; the same waves, reads and answers as no row', async (_n, value) => {
    const before = await cold();
    const odd = await cold(value);
    expect([odd.first.ans, odd.first.waves, odd.again.ans, odd.again.waves]).toEqual([before.first.ans, before.first.waves, before.again.ans, before.again.waves]);
    expect(odd.first.reads).toBeLessThanOrEqual(before.first.reads + 1);
  });
});

describe('its own switch', () => {
  test('never waited for: cold is off and starts one read; then on, kept by a touch that re-reads it; JSON true only', async () => {
    jest.resetModules();
    seed(true);
    const PageWarm = require('../../../shared/services/quiz/web-quiz-page-warm');
    reads = [];
    expect(PageWarm.onNow()).toBe(false);
    expect(PageWarm.onNow()).toBe(false);
    await settle();
    expect(reads.filter((r) => r.t === 'app_settings')).toHaveLength(1);
    expect(PageWarm.onNow()).toBe(true);
    reads = [];
    await PageWarm.tick();
    expect(reads.filter((r) => r.t === 'app_settings')).toHaveLength(1);
    expect(PageWarm.onNow()).toBe(true);
    db.app_settings = db.app_settings.filter((r) => r.key !== 'web_quiz_page_warm');
    await PageWarm.tick();
    expect(PageWarm.onNow()).toBe(false);
    PageWarm.stop();
  });
});
