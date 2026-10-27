'use strict';
/**
 * The kid's Challenge on the web quiz ("<mascot>'s Challenge"): short self-run exercises from the child-test
 * battery (item-bank v3), played on the phone. Two are built:
 *
 *   bigger  "Which is bigger?"  ma.discrimination — 10 pairs, a tap each, 10 s per pair; EGMA's stop rule
 *                               (4 wrong in a row) is applied again here, whatever the phone says.
 *   read    "Read aloud"        <lang>.story — 60 s on the mic, uploaded by presigned PUT straight to R2 and
 *                               scored by the child-test story scorer (scoring/tasks/story.js, unchanged):
 *                               wcpm = correct / (60 − time_left) × 60 (EGRA Toolkit §10.3); nothing right in
 *                               line 1 auto-stops (score 0).
 *
 * Who the kid is: a hub token {k:'h', ids:[student…]} (+ the kid chip when the phone holds several children),
 * or, until the hub lands everywhere, a quiz session token `st` (its quiz_sessions.student_id). Never a list
 * of classmates. Each exercise load mints a challenge token {k:'c', sid, ex, r, exp 2 h}; r is the run id.
 *
 * A child's recording is scored and forgotten: it goes to the private child-voice/<env>/ prefix, is deleted
 * after scoring (or a failed scoring), and only numbers are stored. Under `web_quiz_challenge_keep_audio` (for
 * calibrating the scorers) it is uploaded to child-voice/<env>/kept/<YYYY-MM-DD>/<run>/ instead and KEPT, private,
 * with its key on the run row (meta.audio_key); it leaves only by the purge (scripts/quiz/purge-kept-child-voice.js).
 *
 * Results live in web_quiz_challenge_runs (one row per finished run; migration web_quiz_challenge.sql) —
 * child_test_sessions cannot hold a run with no draw and no coach. While the table is absent the run is
 * still scored and answered (kept in this process), and the miss is logged.
 *
 * Behind app_settings `web_quiz_challenge` (fails closed). Grades 2-3 play the G3 form, 4-5 the G5 form.
 *
 * Read aloud, live (app_settings `web_quiz_challenge_realtime`, off unless true): the page streams the microphone to
 * Soniox real-time with a temporary key minted here for that one run (liveKey; web-quiz-soniox-live.js), so the words
 * light up as the child reads and the words-a-minute show the moment the reading ends. The same recording still comes
 * up the usual way and the story scorer's count stays the number of record; the page's live count is kept beside it
 * (meta.live, four numbers). The mint is the reading's start: it inserts the run (status 'scoring', meta.phase 'live':
 * the table's CHECK allows only scoring/scored/failed), counted by both caps.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const r2 = require('../../storage/r2');
const T = require('./web-quiz-token');
const Tel = require('./web-quiz-telemetry');
const { WqError } = require('./web-quiz.service');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { LANGUAGE_OFFER } = require('../../config/languages');
const Budget = require('./web-quiz-challenge-budget');
const Flags = require('./web-quiz-hub-flags');
const Measure = require('./web-quiz-measure-events');
// The Trail page v2 (web_quiz_challenge_v2 and its children): {} / null with v2 off, so today's paths are untouched.
const TrailPage = require('./web-quiz-trail-page');
// Fast pages (app_settings web_quiz_fast, default off; read without waiting): independent lookups run together.
const Fast = require('./web-quiz-fast');
// Live reading v3 (web_quiz_live_read_v3): {} with the switch off, so today's payloads are untouched.
const LiveReadV3 = () => require('./web-quiz-live-read-v3');
// a grown-up's preview link (web_quiz_practice_play): its games are served and scored there, kept nowhere
const PracticeCh = () => require('./web-quiz-practice-challenge');

const FLAG_KEY = 'web_quiz_challenge';
const LIVE_FLAG_KEY = 'web_quiz_challenge_realtime';
const QA_FLAG_KEY = 'web_quiz_challenge_questions';
const LISTEN_FLAG_KEY = 'web_quiz_challenge_listen';
// The record rules, each its own switch (off ⇒ today's rows, byte for byte):
//   _record     the first scored attempt is the record (attempt_no / exposure_no / counted on the row, the menu and
//               the class results read the first), the clock is the server's (the scorer's clock from the first
//               word, elapsed from the token's mint), a reading the child ended early is incomplete, never a
//               words-per-minute, and nothing on the menu is a number
//   _read_guard the page's read screen: a local microphone check before the minute, no Done, "too hard" only after
//               the first line's window, how the reading ended (sent as ended / read_s / mic_check)
//   _items      per-item verdicts and timings on the row — numbers only, never a word heard
const RECORD_FLAG_KEY = 'web_quiz_challenge_record';
const GUARD_FLAG_KEY = 'web_quiz_challenge_read_guard';
const ITEMS_FLAG_KEY = 'web_quiz_challenge_items';
// Keep the readings (private, one prefix, dated) instead of deleting them after scoring; off ⇒ scored and deleted.
const KEEP_FLAG_KEY = 'web_quiz_challenge_keep_audio';
// The trail (each exercise a stop on a map, a finish badge on a stop's first counted play, replays under a practice
// banner) and "Missing number" (keypad, EGMA's missing-number task). Each is effective only with _record: the badge
// and the practice banner both read the first-attempt record.
const TRAIL_FLAG_KEY = 'web_quiz_challenge_trail';
const MISSING_FLAG_KEY = 'web_quiz_challenge_missing';
// Listen and answer: each answer option read aloud in the quiz voice, with its own play button (a child who cannot
// read the options can still answer); off ⇒ the options are printed only.
const OPTION_AUDIO_FLAG_KEY = 'web_quiz_challenge_option_audio';
const QA_MAX = 3;
// Never shown to a child as an option (the page's no-test-words rule, Urdu and English).
// "I don't know" is never offered as an option (it is in some rubrics' reject lists as a non-answer).
const NOT_AN_ANSWER = /معلوم نہیں|نہیں معلوم|پتا نہیں|پتہ نہیں|\bdon'?t know\b|\bnot sure\b/i;
const NO_TEST_WORDS = /\b(test|tests|testing|egra|egma|assessment|exam)\b|ٹیسٹ|امتحان|جائزہ|اسیسمنٹ/i;
const TABLE = 'web_quiz_challenge_runs';
// The states a run reaches once the child has played it. 'served' (written when an exercise is served) and 'abandoned'
// (served, never played) are not plays: the counts below never see them (migration web_quiz_challenge_runs_v2.sql).
const PLAYED = ['scoring', 'scored', 'failed'];
const FLAG_TTL_MS = 30 * 1000;
const PER_ITEM_S = 10;
const READ_SECS = 60;
const MAX_BYTES = 3 * 1024 * 1024;
// The upload URL lives for the longest take (60 s) plus slack: it is minted when the recording stops.
const PUT_TTL_S = 3 * 60;
const CLIP_TTL_S = 6 * 60 * 60;
const WAIT_MS = 5000;
const READS_PER_DAY = 10;
// per process per Pakistan day (RULING #121): the mascot's 16 lines, the stories and question prompts, and Listen's
// ~27 answer options; the allowance returns at the next PKT day so a long-lived process is never cold for good
const MAX_CLIP_RECORDINGS = 128;
const AUDIO_TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

const fail = (status, error, extra = {}) => { throw new WqError(status, { error, ...extra }); };

// The child-test battery (item bank + scorer) is required on use, never at load: the web quiz boots without it,
// and a deployment that did not carry it answers a named 503 'unavailable' here instead of failing to start.
function childTest({ scorer = false } = {}) {
  try {
    const out = { Bank: require('../child-test/item-bank'), Common: require('../child-test/scoring/tasks/common') };
    // The story scorer (STT + listening call) only when a recording is scored.
    if (scorer) Object.assign(out, { media: require('../child-test/scoring/media'), scoreTask: require('../child-test/scoring/tasks').scoreTask });
    return out;
  } catch (e) {
    logError('web_quiz.ch_unavailable', { error: String(e && e.message || e).slice(0, 120) });
    return fail(503, 'unavailable');
  }
}

// The exercises built so far, in menu order. The other five of the battery are added here as they ship.
const EXERCISES = Object.freeze([
  { id: 'bigger', mins: 2, task: () => 'ma.discrimination' },
  { id: 'missing', mins: 2, task: () => 'ma.missing' },
  { id: 'read', mins: 2, task: (lang) => `${lang}.story`, mic: true },
  { id: 'listen', mins: 2, task: (lang) => `${lang}.listening` },
]);
const byId = (id) => EXERCISES.find((e) => e.id === id) || null;

// Names and the mascot's lines live in the string catalog (ux-strings.js, keys wqCh*), both languages.
const KEY = { bigger: 'Bigger', missing: 'Missing', read: 'Read', listen: 'Listen' };
const PART_KEY = { intro: 'Intro', start: 'Start', stop: 'Stop', done: 'Done' };
const nameOf = (ex, lang) => resolveUx(`wqCh${KEY[ex]}Name`, { language: lang });
const lineOf = (ex, part, lang) => resolveUx(`wqCh${KEY[ex]}${PART_KEY[part]}`, { language: lang });
const PARTS = ['intro', 'start', 'stop', 'done'];
// The quiz's one voice per language (web-quiz-voice.js QUIZ_VOICE), pinned per call: never a fallback provider.
const { quizVoice, voiceTag, voiceOfTag, setIdOf, STORY_VOICE } = require('./web-quiz-voice');
const OneVoice = require('./web-quiz-one-voice-flag');
OneVoice.keepFresh();   // clipKey names its voice at once: the switch is read in the background, never on a child's request
const AudioStore = require('./web-quiz-audio-store');

const nowIso = () => new Date().toISOString();
const langOf = (v) => (LANGUAGE_OFFER.includes(v) ? v : null);
// ONE grade or nothing: a band ("3-5", "1/2") is not a grade, and its first digit is never read as one.
const gradeNum = (v) => {
  const t = String(v == null ? '' : v);
  if (/\d+\s*[-–/,&]\s*\d+/.test(t) || (t.match(/\d+/g) || []).length !== 1) return null;
  return Number(t.match(/\d+/)[0]) || null;
};
const r2Env = () => process.env.CHILD_TEST_R2_ENV || process.env.RAILWAY_ENVIRONMENT || 'local';
const isMissingTable = (e) => !!e && (e.code === '42P01' || /does not exist|schema cache/i.test(String(e.message || '')));

// ── state kept in this process: the flag cache, runs being scored, runs stored nowhere else ──────────────
let flagCache = null;
let liveCache = null;
let qaCache = null;
let listenCache = null;
const RUNS = new Map();          // runId → { status, result, promise }
const clipKnown = new Map();     // key → true (exists) | number (missing, checked at)
const clipRecording = new Set();
let clipsRecorded = 0;
let clipsDay = null;   // the Pakistan day clipsRecorded counts; another day → the allowance is back
/** Recordings made this Pakistan day (the counter returns to 0 on a new day). */
function clipsRecordedOn(now = Date.now()) {
  const day = AudioStore.pkDay(now);
  if (clipsDay !== day) { clipsDay = day; clipsRecorded = 0; }
  return clipsRecorded;
}

const settingCache = new Map();  // key → { v, at } for the record switches
const settingReads = new Map();  // key → the read in flight (web_quiz_games_together: one read of a switch at a time)
const SETTING_TTL_MS = 30 * 1000;

function __reset() { flagCache = null; liveCache = null; qaCache = null; listenCache = null; settingCache.clear(); Budget._reset(); LiveReadV3()._reset(); RUNS.clear(); clipKnown.clear(); clipRecording.clear(); clipRefused.clear(); storyVoice = false; clipsRecorded = 0; clipsDay = null; Draw().__reset(); TrailPage._reset(); }

/**
 * An app_settings switch, true only when its value reads true (fails closed), cached for 30 s.
 * strict: true only for the JSON value true (a string 'true' is off), as the child-page switches read.
 */
async function settingOn(key, { strict = false } = {}) {
  const ck = strict ? `${key}\u0000strict` : key;
  const c = settingCache.get(ck);
  if (c && Date.now() - c.at < SETTING_TTL_MS) return c.v;
  if (settingReads.has(ck)) return settingReads.get(ck);
  if (require('./web-quiz-hub-flags').nowOf('gamesTogether')) {
    const p = settingRead(key, ck, strict).finally(() => settingReads.delete(ck));
    settingReads.set(ck, p);
    return p;
  }
  return settingRead(key, ck, strict);
}
async function settingRead(key, ck, strict) {
  let v = false;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', key);
    if (error) throw new Error(error.message || 'app_settings read failed');
    v = !!(data && data[0] && (strict ? data[0].value === true : isTrue(data[0].value)));
  } catch (e) {
    logError('web_quiz.ch_setting_read_failed', { key, error: String(e && e.message || e).slice(0, 120) });
    v = false;
  }
  settingCache.set(ck, { v, at: Date.now() });
  return v;
}
const recordOn = () => settingOn(RECORD_FLAG_KEY);
const readGuardOn = () => settingOn(GUARD_FLAG_KEY);
const itemsOn = () => settingOn(ITEMS_FLAG_KEY);
const keepAudioOn = () => settingOn(KEEP_FLAG_KEY);
const trailOn = () => settingOn(TRAIL_FLAG_KEY);
const missingOn = () => settingOn(MISSING_FLAG_KEY);
// "Hear it again" on the kind card of a read that certified nothing (default off, JSON true only): the live v3 read's
// payload says zero_listen, and a read run's token may ask for its passage's timings once it settled as not a reading
const ZERO_LISTEN_FLAG_KEY = 'web_quiz_zero_read_listen';
const zeroListenOn = () => settingOn(ZERO_LISTEN_FLAG_KEY, { strict: true });
// ── challenge v2 switches (web_quiz_challenge_v2 → _period, _pool); each read on its own, each child only under _v2 ──
//   _v2      the provenance columns on every new run row (inserted when served), the server ch_start's fields
//   _period  the record rule "one record per canonical child × stop × PKT calendar month" (read-side)
//   _pool    the child-visible draw: the A1 warm-up, the band draw, the lower-band fallback, "on its way",
//            the period's bigger set, the silent try-out item
//   (no switch) under _pool the counted draw (mode 'check') takes only sourced passages: provenance published_calibrated
//            or reviewer_levelled (ITEMS §8.1, RULING #105 (iii)) — a property of the data, never of a switch; generated
//            passages stay practice and Story Time stock
const V2_FLAG_KEY = 'web_quiz_challenge_v2';
const PERIOD_FLAG_KEY = 'web_quiz_challenge_period';
const POOL_FLAG_KEY = 'web_quiz_challenge_pool';
const v2On = () => settingOn(V2_FLAG_KEY);
const periodOn = () => settingOn(PERIOD_FLAG_KEY);
const poolOn = () => settingOn(POOL_FLAG_KEY);
// Story Time (SPEC §1 web_quiz_challenge_story, child of _v2): the route reads room/pid only when this is on
const STORY_FLAG_KEY = 'web_quiz_challenge_story';
const storyOn = async () => (await v2On()) && settingOn(STORY_FLAG_KEY);
const rulesOf = async ({ fast = false } = {}) => {
  if (fast) {
    // Fast pages: every rule switch is read at once (each a 30 s cached app_settings read); a child switch whose parent
    // is off is read and set aside, so the rules are exactly the one-by-one answer.
    const [record, v2, guard, items, trail, missing, period, pool] = await Promise.all([
      recordOn(), v2On(), readGuardOn(), itemsOn(), trailOn(), missingOn(), periodOn(), poolOn()]);
    return { record, guard, items, trail: record && trail, missing: record && missing, v2, period: v2 && period, pool: v2 && pool };
  }
  const record = await recordOn();
  const v2 = await v2On();
  const head = { record, guard: await readGuardOn(), items: await itemsOn(), trail: record && (await trailOn()), missing: record && (await missingOn()),
    v2, period: v2 && (await periodOn()) };
  return { ...head, pool: v2 && (await poolOn()) };
};
const optionAudioOn = () => settingOn(OPTION_AUDIO_FLAG_KEY);
// The payload says only which rules are on (nothing when none is: today's payload).
const ruleFlags = (rules) => ({ ...(rules.record ? { record: true } : {}), ...(rules.guard ? { guard: true } : {}), ...(rules.items ? { items: true } : {}), ...(rules.v2 ? { v2: true } : {}) });

// ── grade-1 form (web_quiz_challenge_g1 under web_quiz_challenge_v2; both off ⇒ grade 1 is not_eligible, as today) ──
// One counted stop, 'numbers' (dots → numeral, anchor block G1A). Its serve, served row, record rule and scoring live in
// web-quiz-challenge-grade1.js; this file only routes a grade-1 child there (formFor, who, menu, exercise, submit).
// `viaOf`, `notHomeAttempt` and `classWeekOn` read the v2 section's VIA map, round/practice rule and class-week key at
// call time (they are declared further down).
const Grade1 = require('./web-quiz-challenge-grade1').withDeps({ settingOn, insertRun: (row) => insertRun(row), fail, bank: () => childTest().Bank,
  viaOf: (v) => VIA[v] || v || null, notHomeAttempt: (r) => notHomeAttempt(r), classWeekOn: () => classWeekOpen('class_link'),
  canonOnForRecord: () => canonOnForRecord(),
  afterFinish: async (runId, studentId) => { await measureOutcome(runId); await renewBindings(studentId); } });
// The one ch_start writer (every stop, the grade-1 form included): through the measurement envelope under events v2.
async function emitChStart(startEv, run, studentId) {
  logEvent('web_quiz.ch_start', (await Flags.eventsV2On()) ? Measure.chStart(startEv, run, studentId) : startEv);
}
// ── end grade-1 form ──

// The read guard's page copy, from the catalog (both languages). The page fills `{words}` with the words read.
const COPY_KEYS = { stuck: 'wqChStuck', incomplete: 'wqChIncomplete', micSay: 'wqChMicSay', micHeard: 'wqChMicHeard', micSilent: 'wqChMicSilent', stopAsk: 'wqChStopAsk', wholeMinute: 'wqChWholeMinute' };
const copyFor = (lang) => Object.fromEntries(Object.entries(COPY_KEYS).map(([k, key]) => [k, resolveUx(key, { language: lang, params: { words: '{words}' } })]));
// The trail's page copy and the keypad's lines (both languages). The page fills {name} {done} {total} {n}.
const TRAIL_KEYS = { title: 'wqChTrailTitle', sub: 'wqChTrailSub', allDone: 'wqChTrailAllDone', badge: 'wqChTrailBadge', next: 'wqChTrailNext', mic: 'wqChTrailMic', needsMic: 'wqChTrailNeedsMic', micWait: 'wqChTrailMicWait', other: 'wqChTrailOther', back: 'wqChTrailBack', practice: 'wqChTrailPractice', stopDone: 'wqChTrailStopDone', missAsk: 'wqChMissingAsk', missYes: 'wqChMissingYes', missWas: 'wqChMissingWas', missSkip: 'wqChMissingSkip', micAgain: 'wqChTrailMicAgain', helpAsk: 'wqChHelpAsk', helpNo: 'wqChHelpNo', helpYes: 'wqChHelpYes' };
// "On your own, or with help?" as the page sends it: true, false, or not asked (null). Never a default.
// (the Trail v2 page sends 'helped' / 'self'; anything else is not asked)
const helpedOf = (v) => (v === true || v === 'helped' ? true : (v === false || v === 'self' ? false : null));
const trailCopy = (lang) => Object.fromEntries(Object.entries(TRAIL_KEYS).map(([k, key]) => [k, resolveUx(key, { language: lang, params: { name: '{name}', done: '{done}', total: '{total}', n: '{n}' } })]));

// A test child ("<Name> Testwala"): the row says so, so no filter has to guess.
const { isTestName } = require('./web-quiz-fixture');

function isTrue(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { /* plain string */ } }
  return x === true || (typeof x === 'string' && x.trim().toLowerCase() === 'true');
}

async function challengeOn(now = Date.now()) {
  if (flagCache && now - flagCache.at < FLAG_TTL_MS) return flagCache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', FLAG_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    flagCache = { at: now, on: !!(data && data[0]) && isTrue(data[0].value) };
  } catch (e) {
    logToFile('⚠️ web quiz challenge: flag lookup failed — off', { error: e.message });
    flagCache = { at: now, on: false };
  }
  return flagCache.on;
}

/** The live read-aloud's switch: only `true` turns it on; anything else, or a failed read, is today's upload path. */
async function liveOn(now = Date.now()) {
  if (liveCache && now - liveCache.at < FLAG_TTL_MS) return liveCache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', LIVE_FLAG_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    liveCache = { at: now, on: !!(data && data[0]) && isTrue(data[0].value) };
  } catch (e) {
    logToFile('⚠️ web quiz challenge: live flag lookup failed — off', { error: e.message });
    liveCache = { at: now, on: false };
  }
  return liveCache.on;
}

/** Questions after Read aloud: only `true` turns them on; anything else, or a failed read, is off. */
async function questionsOn(now = Date.now()) {
  if (qaCache && now - qaCache.at < FLAG_TTL_MS) return qaCache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', QA_FLAG_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    qaCache = { at: now, on: !!(data && data[0]) && isTrue(data[0].value) };
  } catch (e) {
    logToFile('⚠️ web quiz challenge: questions flag lookup failed — off', { error: e.message });
    qaCache = { at: now, on: false };
  }
  return qaCache.on;
}

/** "Listen and answer": only `true` turns it on; anything else, or a failed read, is off. */
async function listenOn(now = Date.now()) {
  if (listenCache && now - listenCache.at < FLAG_TTL_MS) return listenCache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', LISTEN_FLAG_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    listenCache = { at: now, on: !!(data && data[0]) && isTrue(data[0].value) };
  } catch (e) {
    logToFile('⚠️ web quiz challenge: listen flag lookup failed — off', { error: e.message });
    listenCache = { at: now, on: false };
  }
  return listenCache.on;
}

/** The chip a hub page sends for one of the phone's children (not reversible): the hub's own, T.chipId('h', id). */
function kidChip(studentId) {
  return T.chipId('h', studentId);
}

// ── who is playing ─────────────────────────────────────────────────────────────────────────────────────

// A pick counts for this visit only: stamped (`at`, ms) within the last 30 minutes. A pick written before the store
// stamped `at` still counts.
const VISIT_MS = 30 * 60 * 1000;

/**
 * This visit's pick of a hub child (web-quiz-bind-page.pickFor: the chip tap on this device, VISIT_MS). The pick store is
 * written only under web_quiz_identity_canon, so with that switch off every ?kid= is today's; the module absent → no pick.
 */
async function kidPickedHere(studentId, device) {
  let B = null;
  try { B = require('./web-quiz-bind-page'); } catch (_) { return false; }
  // canon off: no pick store; under _v2 a row would still be written as that child (and burn an unseen passage), so a
  // ?kid= on a token of more than one child is refused there too (the chip tap is the way in); _v2 off: today's
  if (!(await B.canonOn())) return !(await v2On());
  const canonicalId = (await require('./web-quiz-identity-roster').canonicalStudentId(studentId)) || studentId;
  const pick = await B.pickFor({ canonicalId, device });
  return Boolean(pick && (pick.at == null || Date.now() - Number(pick.at) < VISIT_MS));
}

async function entryOf(token, kid, device) {
  if (!T.secret()) fail(503, 'web_quiz_off');
  const h = T.verify(token, 'h');
  if (h) {
    const ids = (Array.isArray(h.ids) ? h.ids : []).filter((x) => typeof x === 'string').slice(0, 4);
    if (!ids.length) { require('./web-quiz-practice-play').refused('challenge', token); fail(401, 'bad_token'); }
    let hit = ids[0];
    if (kid) {
      hit = ids.find((id) => kidChip(id) === kid);
      if (!hit) fail(401, 'bad_token');
      // swap two children: with more than one remembered child, ?kid= must be the chip tapped on THIS phone
      if (ids.length > 1 && !(await kidPickedHere(hit, device))) fail(400, 'pick_kid');
    } else if (ids.length > 1) fail(400, 'pick_kid');
    // A forwarded hub link opens nothing as the child: only the phone the link is bound to
    // (or one THIS child played on) gets their results or a run (web-quiz-hub-device deviceTrusted).
    const trust = await require('./web-quiz-hub-device').deviceTrusted(token, device);
    if (!trust.ok || !trust.ids.includes(String(hit))) fail(403, 'other_device');
    // Standing class link: the pick's facts ride the hub token's `cl` claim to the run row (insertRun); absent today.
    // A hub token the Jugnu card minted (signed src 'cd'): the run is the card's, via quiz_card (VIA.quiz).
    return { studentId: hit, via: h.src === 'cd' ? 'quiz' : 'hub', ...(h.src === 'cl' && h.cl ? { cl: h.cl } : {}) };
  }
  // ── class round (web_quiz_class_round): a round turn token plays as the child whose turn is open, only during that turn ──
  const rt = T.verify(token, 'r');
  if (rt) return (await require('./web-quiz-class-round').entryOf(rt)) || fail(401, 'bad_token');
  const s = T.verify(token, 's');
  if (s && s.sid) {
    const { data: row, error } = await supabase.from('quiz_sessions').select('id, student_id, share_code_id, quiz_id').eq('id', s.sid).maybeSingle();
    if (error) fail(502, 'db_unavailable');
    if (!row || !row.student_id) fail(401, 'bad_token');
    return { studentId: row.student_id, via: 'quiz', shareCodeId: row.share_code_id, quizId: row.quiz_id };
  }
  return fail(401, 'bad_token');
}

/**
 * The child's grade (the same sources the hub reads): the class the child is enrolled in, then the old class list, then the class the child gave themself, then their newest quiz session's
 * class, then that quiz's grade. Most quiz children are LOOSE students rows (no list, no enrolment). A band is
 * unknown, never its first digit.
 */
async function gradeInfo(entry, { fast = false } = {}) {
  // Inside a hub answer with web_quiz_hub_child_memo on, the child's rows are that answer's shared read (else read here).
  const ChildRows = require('./web-quiz-hub-child-rows');
  const kidRead = () => ChildRows.read('students', [entry.studentId], 'id, list_id, self_reported_class, student_name', () => supabase.from('students').select('id, list_id, self_reported_class, student_name').eq('id', entry.studentId).maybeSingle(), { single: true });
  // Fast pages: the enrolment and the child's row need only the child's id, so they are read together.
  const kidP = fast ? Fast.early(Promise.resolve(kidRead())) : null;
  const { data: enr } = await ChildRows.read('class_enrollments', [entry.studentId], 'id, class_id, student_id, is_active', () => supabase.from('class_enrollments').select('id, class_id, student_id, is_active')
    .eq('student_id', entry.studentId).eq('is_active', true));
  const { data: kid, error: kidErr } = await (kidP || kidRead());
  // A refused read (a column that is not there, a pooler error) is logged at error level: silently falling through
  // to the next grade source is how a wrong column name once passed every test.
  if (kidErr) logError('web_quiz.ch_student_read_failed', { code: kidErr.code || null, error: String(kidErr.message || kidErr).slice(0, 160) });
  const name = (kid && kid.student_name) || null;
  if (enr && enr.length) {
    const { data: cls } = await supabase.from('classes').select('id, grade_code').eq('id', enr[0].class_id).maybeSingle();
    const g = cls && gradeNum(String(cls.grade_code || '').replace(/^grade_/, ''));
    if (g) return { grade: g, source: 'enrolment', name };
  }
  if (kid && kid.list_id) {
    const { data: list } = await ChildRows.read('student_lists', [kid.list_id], 'id, class_name', () => supabase.from('student_lists').select('id, class_name').eq('id', kid.list_id).maybeSingle(), { single: true });
    const g = list && gradeNum(list.class_name);
    if (g) return { grade: g, source: 'list', name };
  }
  if (kid && gradeNum(kid.self_reported_class)) return { grade: gradeNum(kid.self_reported_class), source: 'self', name };
  let quizId = entry.quizId || null;
  const { data: sessions } = await supabase.from('quiz_sessions').select('id, quiz_id, student_class, created_at')
    .eq('student_id', entry.studentId).order('created_at', { ascending: false }).limit(1);
  const last = sessions && sessions[0];
  if (last && gradeNum(last.student_class)) return { grade: gradeNum(last.student_class), source: 'session', name };
  if (!quizId && last) quizId = last.quiz_id;
  if (quizId) {
    const { data: q } = await supabase.from('quizzes').select('id, grade').eq('id', quizId).maybeSingle();
    return { grade: q ? gradeNum(q.grade) : null, source: q ? 'quiz' : null, name };
  }
  return { grade: null, source: null, name };
}

/** The grade alone (the row's `grade`); `gradeInfo` also says where it came from. */
async function gradeOf(entry) {
  return (await gradeInfo(entry)).grade;
}

/** The maths form for a grade: 2-3 ⇒ '3', 4-5 ⇒ '5', 1 ⇒ '1' only with `g1` (the grade-1 switches on); else not eligible. */
function formFor(grade, { g1 = false } = {}) {
  if (grade === 1 && g1 === true) return '1';
  if (grade === 2 || grade === 3) return '3';
  if (grade === 4 || grade === 5) return '5';
  return null;
}

/**
 * The ONE eligibility rule every Jugnu door uses (the serve's who(), the hub tile, the scorecard card): the form for
 * a child's grade, the grade-1 switches read here so no caller can leave them out. Off, or unreadable ⇒ today's
 * formFor(grade): grade 1 has no form. Never throws.
 */
async function formForChild(grade) {
  let g1 = false;
  if (grade === 1) {
    try { g1 = (await Grade1.on()) === true; } catch (_) { g1 = false; }
  }
  return formFor(grade, { g1 });
}

async function languageOf(entry, asked) {
  const l = langOf(asked);
  if (l) return l;
  let shareCodeId = entry.shareCodeId || null;
  if (!shareCodeId) {
    const { data } = await supabase.from('quiz_sessions').select('id, share_code_id, created_at')
      .eq('student_id', entry.studentId).order('created_at', { ascending: false }).limit(1);
    shareCodeId = data && data[0] && data[0].share_code_id;
  }
  if (shareCodeId) {
    const { data: sc } = await supabase.from('quiz_share_codes').select('id, language').eq('id', shareCodeId).maybeSingle();
    if (sc && langOf(sc.language)) return sc.language;
  }
  return clampLanguage(null);
}

async function who(token, { kid, lang, device } = {}, { fast = false, early = null } = {}) {
  if (!(await challengeOn())) fail(503, 'challenge_off');
  const entry = await entryOf(token, kid, device);
  // Fast pages: a caller's own lookups that need only the child start here, beside the grade and the language.
  if (early) early(entry);
  // Fast pages: the child's language needs only the entry, so it is read beside the grade (and set aside when the
  // child is not eligible, as today's answer is then the refusal).
  const langP = fast ? Fast.early(languageOf(entry, lang)) : null;
  const gi = await gradeInfo(entry, { fast });
  // grade-1 form: formForChild reads its switches for a grade-1 child only (off ⇒ null ⇒ not_eligible, as today)
  const form = await formForChild(gi.grade);
  if (!form) fail(403, 'not_eligible');
  return { ...entry, grade: gi.grade, gradeSource: gi.source, test: isTestName(gi.name), form, lang: await (langP || languageOf(entry, lang)) };
}

// ── runs (stored) ─────────────────────────────────────────────────────────────────────────────────────

async function storedRuns(studentId) {
  const { data, error } = await supabase.from('web_quiz_challenge_runs').select('id, exercise, status, score, wcpm, created_at, scored_at')
    .eq('student_id', studentId).order('created_at', { ascending: false }).limit(50);
  if (error) {
    if (!isMissingTable(error)) logToFile('⚠️ web quiz challenge: runs read failed', { error: error.message });
    return [];
  }
  return data || [];
}

function storeFailed(runId, error) {
  logError('web_quiz.challenge_store_failed', { runId, missingTable: isMissingTable(error), error: String(error.message || '').slice(0, 200) });
}

// Every runs insert: 'stored' | 'duplicate' (23505) | 'unstored'. A record row answered 23505 (a second record of the
// stop this period, under the record unique index) is stored as practice instead (meta.record_lost) and returns
// 'practice': the one home of that rule (the v2 and grade-1 serves follow it).
async function insertRun(row) {
  // Standing class link (web_quiz_class_link): a run started from a class-link pick writes its v2 columns; else none.
  const open = RUNS.get(row.id);
  if (open && open.cl) Object.assign(row, require('./web-quiz-class-link').runColumns(open.cl, row.student_id), row.canonical_id ? { canonical_id: row.canonical_id } : {});
  const { error } = await supabase.from('web_quiz_challenge_runs').insert(row);
  if (!error) return 'stored';
  if (error.code === '23505' && row && row.record === true) {
    const stored = await insertRun({ ...row, record: false, mode: 'practice', meta: { ...(row.meta || {}), record_lost: 'duplicate' } });
    logEvent('web_quiz.ch_record_duplicate', { w: 's', stop: row.exercise, period_id: row.period_id || null, stored });
    return stored === 'stored' ? 'practice' : stored;
  }
  if (error.code === '23505') return 'duplicate';
  storeFailed(row.id, error);
  return 'unstored';
}

async function updateRun(id, patch) {
  const { error } = await supabase.from('web_quiz_challenge_runs').update(patch).eq('id', id);
  if (error && !isMissingTable(error)) storeFailed(id, error);
}

/**
 * Events v2 (web_quiz_events_v2): the measurement event of a run just stored as scored (m_result) or failed (m_lost),
 * read back from the row as written. Only a v2 row (mode set) has one; with the switch off nothing is read. Never throws.
 */
async function measureOutcome(id) {
  await require('./web-quiz-rungs').onRecordFinal(id, { questionsLeft: readQuestionsLeft }).catch(() => null); // the lamps (web_quiz_challenge_rungs; off ⇒ no query)
  try {
    if (!(await Flags.eventsV2On())) return;
    const { data: row, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (!error && row) Measure.emitOutcome(row);
  } catch (e) {
    logToFile('⚠️ web quiz challenge: measurement event not logged', { error: String((e && e.message) || e).slice(0, 120) });
  }
}

async function storedRun(id) {
  const { data, error } = await supabase.from('web_quiz_challenge_runs').select('id, exercise, lang, status, score, wcpm, meta, mode, record').eq('id', id).maybeSingle();
  return error ? null : data;
}

/**
 * A run's meta has more than one writer (the checked score, each tap's meta.comp), on any replica. Each write is
 * built from a fresh read and lands only if meta is still what was read (jsonb equality), else it is rebuilt from
 * a new read, so neither writer puts back a stale copy of the other's keys. `build(row)` returns the patch.
 * Returns the row as written, or null (no row, a store error, or still contended after the retries).
 * `force`: a write that must never be dropped (the checked score) is, after the retries, written unconditionally
 * from the last read — today's last-writer-wins, now only as the last resort.
 */
const META_TRIES = 5;
async function updateRunMeta(id, build, { force = false } = {}) {
  let last = null;
  for (let i = 0; i < META_TRIES; i += 1) {
    const cur = await storedRun(id);
    if (!cur) return null;
    last = cur;
    const patch = build(cur);
    const q = supabase.from('web_quiz_challenge_runs').update(patch).eq('id', id);
    const { data, error } = await (cur.meta == null ? q.is('meta', null) : q.eq('meta', JSON.stringify(cur.meta))).select('id');
    if (error) {
      if (!isMissingTable(error)) storeFailed(id, error);
      return null;
    }
    if (data && data.length) return { ...cur, ...patch };
  }
  logError('web_quiz.challenge_meta_contended', { runId: id, tries: META_TRIES, forced: force });
  if (!force || !last) return null;
  const patch = build(last);
  await updateRun(id, patch);
  return { ...last, ...patch };
}

// ── clips: the mascot's lines, recorded once per env in the quiz voice ───────────────────────────────

// quiz-audio/<env>/challenge/<lang>/<exercise>/<part>-<voiceTag>-<hash8>.ogg — the quiz clips' own scheme and bucket.
// With one voice per quiz (web-quiz-one-voice-flag.js, as last read) the tag names the storybook voice's exact rendering
// (web-quiz-voice.js STORY_VOICE), never the voice the plan gives the quiz lines.
// A one-voice clip's key names the plan's rate when it is not the default 64 kb/s ("-k32"), so a clip made at another
// rate is never served as this one (and the pre-flip check counts it missing); a 64 kb/s key is unchanged.
// app_settings `web_quiz_challenge_story_voice` (default off, JSON true only): with one voice off, the challenge's clips
// still take the storybook voice, at the one-voice rate: the keys the one-voice plan names, so one checked set serves
// both. The quiz lines keep today's voice. Read in the background (as the one-voice switch): never on a child's request.
const STORY_VOICE_FLAG_KEY = 'web_quiz_challenge_story_voice';
const STORY_CLIP_PLAN = OneVoice.normalize({ voices: { en: STORY_VOICE.en, ur: STORY_VOICE.ur }, kbps: 32 });
let storyVoice = false;
async function storyVoiceOn() {
  storyVoice = await settingOn(STORY_VOICE_FLAG_KEY, { strict: true });
  return storyVoice;
}
// The plan the challenge's clips follow: the one-voice plan when it is on, else the storybook voice when this switch is.
function clipPlan() {
  storyVoiceOn().catch(() => null);
  return OneVoice.currentPlan() || (storyVoice ? STORY_CLIP_PLAN : null);
}

function clipKey(ex, part, lang, text) {
  // A language the plan leaves out keeps today's voice and today's key (web-quiz-one-voice-flag.js forQuiz); a language
  // it names takes the storybook voice (STORY_VOICE), whatever voice the plan gives the quiz lines.
  const plan = OneVoice.forQuiz(clipPlan(), null, lang);
  const one = plan ? STORY_VOICE[lang] || null : null;
  const rate = one && plan.kbps && plan.kbps !== 64 ? `-k${plan.kbps}` : '';
  return AudioStore.clipKey({ quizId: 'challenge', lang, qid: ex, part, voice: one ? `${setIdOf(one)}${rate}` : voiceTag(lang), text });
}

const KEY_VOICE = /-([a-z]{2}-[a-z0-9]+(?:-[0-9a-f]{6})?)(?:-k(\d+))?-[0-9a-f]{8}\.ogg$/;

// The voice a clip's key names (its tag), so a clip is always recorded in the voice its key says; else the quiz voice.
function voiceOfKey(key, lang) {
  const m = KEY_VOICE.exec(String(key || ''));
  return (m && voiceOfTag(m[1], clipPlan())) || quizVoice(lang);
}

// The rate a clip's key names, else 64.
function kbpsOfKey(key) {
  const m = KEY_VOICE.exec(String(key || ''));
  return (m && Number(m[2])) || 64;
}

// With one voice per quiz, in a language the plan voices, nothing is recorded on the fly (a paid call at an unknown
// moment): a long clip (a listening story, a Story Time read-along: read slowly with pauses, each take checked before
// it is stored) never; a short line only by the pre-flip batch (`batch`, scripts/quiz/one-voice-missing-keys.js
// --record-short). A refusal is logged once per key per process with `web_quiz.ch_clip_ungated_refused`.
const LONG_KEY = /\/(listen|read)\/story-[^/]*\.ogg$/;
const PART_OF_KEY = /\/challenge\/[^/]+\/([^/]+)\/(.+?)-(?:sx|el|oa)-/;
const clipRefused = new Set();
function refused(key, lang, batch) {
  const plan = OneVoice.forQuiz(clipPlan(), null, lang);   // a language the plan leaves out: today's recorder
  if (!plan) return false;
  const long = LONG_KEY.exec(String(key || ''));
  // the storybook-voice switch alone (one voice off): a short line is recorded on the fly, as today's voice's lines are
  if (!long && (batch || !OneVoice.currentPlan())) return false;
  if (!clipRefused.has(key)) {
    clipRefused.add(key);
    const m = long ? [null, long[1], 'story'] : PART_OF_KEY.exec(String(key || '')) || [null, null, null];
    logEvent('web_quiz.ch_clip_ungated_refused', { lang, ex: m[1], part: m[2], plan: plan.sig });
  }
  return true;
}

// → the voice's result ({ audio, durationSec, … }) once the clip is stored, else null (capped, busy, refused or failed).
// With one voice per quiz the Urdu words the voice misreads are respelled for it (web-quiz-ur-say.js); the key is the
// screen text's. `level`: (audio) → audio, applied before the clip is stored (the batch levels to the plan's loudness).
async function recordClip(key, text, lang, now = Date.now(), { batch = false, level = null } = {}) {
  if (refused(key, lang, batch)) return null;
  if (clipRecording.has(key) || clipsRecordedOn(now) >= MAX_CLIP_RECORDINGS) return null;
  clipRecording.add(key);
  clipsRecorded += 1;
  try {
    const tts = require('../tts');
    const v = voiceOfKey(key, lang);
    const said = OneVoice.forQuiz(clipPlan(), null, lang) && String(lang).startsWith('ur') ? require('./web-quiz-ur-say').sayOf(text) : text;
    // The provider and voice pinned per call, no fallback: a clip that cannot be made in this voice stays missing.
    const out = await tts.synthesize({
      text: said, language: lang, useCase: 'reading', site: 'web_quiz_challenge', provider: v.provider, voice: v.voice,
      // the one voice: its model, settings and the key's rate, asked of the provider (its own bytes, never re-encoded)
      ...(v.model ? { model: v.model, voiceSettings: v.settings, outputFormat: `opus_48000_${kbpsOfKey(key)}` } : {}),
    });
    if (level) out.audio = await level(out.audio);
    await r2.uploadBuffer(out.audio, key, 'audio/ogg', { bucket: AudioStore.quizAudioBucket() });
    clipKnown.set(key, true);
    logEvent('web_quiz.ch_clip_recorded', { lang, provider: out.provider, voice: out.voice, audioSec: Math.round((out.durationSec || 0) * 10) / 10, chars: [...String(text)].length, costUsd: clipCostUsd(out) });
    return out;
  } catch (e) {
    logError('web_quiz.ch_clip_failed', { lang, error: String(e && e.message || e).slice(0, 200) });
    return null;
  } finally {
    clipRecording.delete(key);
  }
}

// What a clip cost: Soniox bills by audio time ($0.722 an hour, as tts/index.js); null for a provider billed otherwise.
const SONIOX_USD_PER_AUDIO_S = 0.722 / 3600;
function clipCostUsd(out) {
  return out && out.provider === 'soniox' ? Math.round((out.durationSec || 0) * SONIOX_USD_PER_AUDIO_S * 1e6) / 1e6 : null;
}

async function clipUrl(key, text, lang) {
  const known = clipKnown.get(key);
  let exists = known === true;
  if (!exists && !(typeof known === 'number' && Date.now() - known < 10 * 60 * 1000)) {
    try { exists = !!(await r2.headObject(key, { bucket: AudioStore.quizAudioBucket() })).exists; } catch (_) { exists = false; }
    clipKnown.set(key, exists ? true : Date.now());
  }
  if (!exists) {
    recordClip(key, text, lang);   // in the background; this kid sees the line, the next one also hears it
    return null;
  }
  try {
    return (await r2.presignKey(key, CLIP_TTL_S, { bucket: AudioStore.quizAudioBucket() })) || null;
  } catch (_) { return null; }
}

/** The listening story in the quiz voice (recorded once per env; null until it exists, and asking starts it). */
async function storyClip(lang, drawnText = null) {
  let text = drawnText;
  if (!text) try { text = (childTest().Bank.getTaskSpec({ grade: 3, set: 'A', task: `${lang}.listening` }).story || {}).text; } catch (_) { text = null; }
  if (!text) return null;
  return clipUrl(clipKey('listen', 'story', lang, text), text, lang);
}

/** Story Time read-along: a story read aloud in the quiz voice (the listening story's scheme, exercise 'read'). */
function readAlongClip(lang, text) {
  return text ? clipUrl(clipKey('read', 'story', lang, text), text, lang) : null;
}

/** Jugnu's own lines of every exercise in `lang` ({ ex, part, text }: intro, start, stop, done), for the pre-flip check. */
function exerciseLines(lang) {
  return EXERCISES.flatMap((e) => PARTS.map((part) => ({ ex: e.id, part, text: lineOf(e.id, part, lang) }))).filter((l) => l.text);
}

async function clipsFor(ex, lang) {
  const out = {};
  await Promise.all(PARTS.map(async (part) => {
    const text = lineOf(ex, part, lang);
    out[part] = { text, url: await clipUrl(clipKey(ex, part, lang, text), text, lang) };
  }));
  return Object.fromEntries(PARTS.map((p) => [p, out[p]]));
}

// ── E: the menu ───────────────────────────────────────────────────────────────────────────────────────

function lastOf(run) {
  if (!run) return null;
  const s = run.score || {};
  return run.exercise === 'read' ? { correct: s.correct, wcpm: run.wcpm, stopped: !!s.stopped } : { correct: s.correct, n: s.n };
}

// Under the record rule a scored reading the child ended early (no `ended` on the row: written before the rule)
// is read as incomplete: done on the menu, never a number in the class results.
function legacyIncomplete(r) {
  const s = (r && r.score) || {};
  return r.exercise === 'read' && r.status === 'scored' && s.finished_early === false && !s.stopped
    && Number(r.meta && r.meta.duration_s) < READ_SECS - 5;
}

// A class round turn (via the round, whatever its mode) and a practice play never use up the child's own attempt at a
// stop; a row written before the runs provenance columns (mode and via null) counts as it always did.
const notHomeAttempt = (r) => !!r && (r.via === 'class_round' || r.mode === 'practice' || r.mode === 'class_round');

// A runs read that names a column this tier does not have (PostgREST 42703: web_quiz_challenge_runs_v2.sql not applied)
// fails CLOSED: the caller refuses instead of reading "no runs" and claiming a first attempt. Logged once per read with
// step (s serve, m menu, f finish) and the server's writer mark w 's'. The missing-table path (isMissingTable) is unchanged.
const isMissingColumn = (e) => !!e && e.code === '42703';
const runsReadFailed = (error, step) => { logError('web_quiz.ch_runs_read_failed', { code: error.code, step, w: 's' }); return true; };

// The child's runs oldest first, by their own query (storedRuns keeps the newest 50: the first attempt would fall
// out of it). Counted here = a scored run, or an incomplete reading (the minute was begun and the window passed),
// that is the child's own attempt (notHomeAttempt).
async function countedRuns(studentId) {
  const { data, error } = await supabase.from(TABLE).select('id, exercise, status, score, wcpm, lang, meta, created_at, scored_at, via, mode')
    .eq('student_id', studentId).order('created_at', { ascending: true }).limit(5000);
  if (isMissingColumn(error)) return Object.assign([], { readFailed: runsReadFailed(error, 'm') });
  if (error) {
    if (!isMissingTable(error)) logToFile('⚠️ web quiz challenge: runs read failed', { error: error.message });
    return [];
  }
  return (data || []).filter((r) => (r.status === 'scored' || (r.status === 'failed' && r.meta && r.meta.reason === 'incomplete')) && !notHomeAttempt(r));
}

/** attempt_no = 1 + this child's own scored runs of the task (a reading: in this language; no round turn or practice
 * play, notHomeAttempt); exposure_no counts every row. */
async function attemptInfo(studentId, exercise, lang, { except = null, step = 's' } = {}) {
  let qb = supabase.from(TABLE).select('id, status, lang, via, mode').eq('student_id', studentId).eq('exercise', exercise).in('status', PLAYED);
  if (exercise === 'read' && lang) qb = qb.eq('lang', lang);
  const { data, error } = await qb.order('created_at', { ascending: true }).limit(5000);
  if (isMissingColumn(error)) return { attempt_no: null, exposure_no: null, readFailed: runsReadFailed(error, step) };
  const rows = (error ? [] : data || []).filter((r) => r.id !== except);
  const scored = rows.filter((r) => r.status === 'scored' && !notHomeAttempt(r)).length;
  return { attempt_no: scored + 1, exposure_no: rows.length + 1 };
}

// Which run of the child's day this is (any exercise, any status, last 24 h), for order effects.
async function sequenceNo(studentId, except = null) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from(TABLE).select('id').eq('student_id', studentId).in('status', PLAYED).gte('created_at', since);
  return (error ? [] : data || []).filter((r) => r.id !== except).length + 1;
}

/** What the record rule stamps on a row at insert: attempt, exposure, counted, where the grade came from, test. */
async function provenance(studentId, exercise, lang, run, { except = null } = {}) {
  const { readFailed, ...a } = await attemptInfo(studentId, exercise, lang, { except, step: 'f' });
  // counted: under v2 the row's own mode and record (a round, a replay or a story is never counted, RULING #116); else the first scored attempt, as today
  // A run with a mode (a served row read back after a redeploy emptied the memory) follows its mode too: never counted unless a check record.
  const counted = run.v2 || run.mode != null ? run.mode === 'check' && run.record === true : a.attempt_no === 1;
  return { ...a, ...(readFailed ? { runs_read_failed: true } : {}), counted, grade_source: run.gradeSource || null, test: !!run.test, sequence_n: await sequenceNo(studentId, except) };
}

async function menu(token, { kid, lang, device } = {}) {
  // a grown-up's preview link (web_quiz_practice_play): the grade's games, served from the bank, kept nowhere
  { const pr = await PracticeCh().hubOf(token); if (pr) return PracticeCh().menu(pr, { lang }); }
  // keep my place: a deep link with >= 2 children on this phone and no tap asks "Whose turn?" first (identity canon switch).
  { const B = require('./web-quiz-bind-page'); if (await B.canonOn()) { const ask = await B.whoseTurn({ hub: token, kid, device, lang }); if (ask) return ask; } }
  const fast = Fast.on();
  // Fast pages: the card's no_class (the child home on) needs only the child, so it starts as soon as the child is known.
  let noClassP = null;
  const early = fast ? (e) => { noClassP = Fast.early(require('./web-quiz-hub-door').noClassField(e.studentId)); } : null;
  const w = await who(token, { kid, lang, device }, { fast, early });
  // Fast pages: the rule switches are read beside the events switch (set aside for a grade-1 child, as today).
  const rulesP = fast ? Fast.early(rulesOf({ fast })) : null;
  // EVENTS §0.1: the server copy carries the writer's mark under events v2; off, today's event byte for byte
  logEvent('web_quiz.ch_open', { via: w.via, grade: w.grade, ...((await Flags.eventsV2On()) ? { w: 's' } : {}) });
  if (w.form === Grade1.FORM) return Grade1.menu(w);   // grade-1 form: its one stop
  const rules = await (rulesP || rulesOf());
  // Fast pages: the menu's lookups need only the child and the rules, so they start together and are awaited where
  // today's code reads them. The listening story's clip (asking for it may start a recording) still waits for the
  // runs check, as today.
  const pre = fast ? {
    runs: Fast.early(rules.record ? countedRuns(w.studentId) : storedRuns(w.studentId).then((rs) => rs.filter((r) => r.status === 'scored'))),
    readOk: Fast.early(Budget.readOpen()),
    listen: Fast.early(listenOn()),
    trail: rules.period ? Fast.early(periodTrail(w)) : null,
    rt: Fast.early(Tel.flag()),
    ui: Fast.early(require('./web-quiz-ur-polish').ui()),
    juice: Fast.early(require('./web-quiz-juice').field()),
    bits: Fast.early(TrailPage.bits({ studentId: w.studentId, device, lang: w.lang })),
    lr3: Fast.early(LiveReadV3().forMenu()),
    no_class: noClassP,
  } : null;
  const got = (key, start) => (pre ? pre[key] : start());
  const runs = await got('runs', async () => (rules.record ? countedRuns(w.studentId) : (await storedRuns(w.studentId)).filter((r) => r.status === 'scored')));
  if (runs.readFailed) fail(503, 'unavailable');   // fail closed: a missing provenance column (isMissingColumn)
  // Today's read-aloud cap reached (web-quiz-challenge-budget.js): "Which is bigger?" only until Pakistan midnight.
  const readOk = await got('readOk', () => Budget.readOpen());
  // "Listen and answer" only once its story is recorded (asking for it starts the recording): never silence to listen to
  const listenOk = (await got('listen', () => listenOn())) && !!(await storyClip(w.lang));
  // challenge v2: under _period a stop is done from THIS period's record row (trailStateFor); under _pool the Trail order
  const trailNow = rules.period ? await got('trail', () => periodTrail(w)) : null;
  const menuOut = {
    form: `G${w.form}`,
    lang: w.lang,
    exercises: (rules.pool ? TRAIL_ORDER.map(byId) : EXERCISES).filter((e) => !w.round || ROUND_GAMES.includes(e.id)).filter((e) => (e.id !== 'read' || readOk) && (e.id !== 'listen' || listenOk) && (e.id !== 'missing' || rules.missing)).map((e) => {
      const last = runs.find((r) => r.exercise === e.id) || null;
      // a round turn: done = stored for THIS turn (the round state), never a home run
      const done = w.round ? (w.roundGames || []).includes(e.id) : (trailNow ? trailNow.find((t) => t.stop === e.id).record_row_final : !!last);
      // the record rule: done from the first counted run, and the menu is not a report — no number on it.
      // On the trail that same first counted run, of any outcome (stopped, incomplete), is the stop's badge.
      return { id: e.id, name: nameOf(e.id, w.lang), mins: e.mins, done, last: rules.record ? null : lastOf(last),
        ...(rules.trail ? { badge: done, ...(e.mic ? { mic: true } : {}) } : {}), ...(rules.pool && e.id === 'missing' ? { anchor_block: 'A1' } : {}),
        // the served passage's child-facing title on its stop (RULING #100(a)(2)); nothing before the draw
        ...(rules.pool && trailNow && (e.id === 'read' || e.id === 'listen') ? menuTitle(trailNow.find((t) => t.stop === e.id)) : {}) };
    }),
    ...(rules.record ? { record: true } : {}),
    ...(rules.trail ? { trail: true, trail_copy: trailCopy(w.lang) } : {}),
    // a round turn is served only under _v2 (exercise() refuses it 409 without), so the hand-back card is drawn only then
    ...(w.round && rules.v2 ? { round_turn: true } : {}),
    // Whether the page sends its page-session events (wq-tel.js).
    rt: await got('rt', () => Tel.flag()),
    ...((await got('ui', () => require('./web-quiz-ur-polish').ui())) ? { ui: require('./web-quiz-ur-polish').lite({ ur2: true }) } : {}),
    // the sound + motion kit (web-quiz-juice.js): named only when on
    ...((await got('juice', () => require('./web-quiz-juice').field())) ? { juice: true } : {}),
    ...(await got('bits', () => TrailPage.bits({ studentId: w.studentId, device, lang: w.lang }))),
    ...(await got('lr3', () => LiveReadV3().forMenu())),   // live reading v3: the page loads its component (off ⇒ nothing)
    // the child home on: a child with no class shares with "Share" (web-quiz-hub-door.js; off ⇒ nothing)
    ...(await got('no_class', () => require('./web-quiz-hub-door').noClassField(w.studentId))),
  };
  // the read-along player's preload (web_quiz_ra_preload): a cached answer, never waited for; off ⇒ the menu untouched
  return require('./web-quiz-ra-preload').mark(menuOut);
}

// ── E: one exercise ───────────────────────────────────────────────────────────────────────────────────

async function exercise(token, ex, { kid, lang, device } = {}) {
  // a grown-up's preview link (web_quiz_practice_play): the game is served from the bank, no run row (Story Time's room too)
  { const pr = await PracticeCh().hubOf(token); if (pr) return PracticeCh().exercise(pr, ex, { lang, room: (arguments[2] || {}).room, passageId: (arguments[2] || {}).passageId }); }
  // keep my place: a deep link with >= 2 children on this phone and no tap asks "Whose turn?" first (identity canon switch).
  { const B = require('./web-quiz-bind-page'); if (await B.canonOn()) { const ask = await B.whoseTurn({ hub: token, kid, device, lang }); if (ask) return ask; } }
  const def = byId(ex);
  // grade-1 form: 'numbers' exists only with its switches on; a grade-1 child gets only that stop (else 404 as today)
  if (!def && !(ex === Grade1.EXERCISE && (await Grade1.on()))) fail(404, 'not_found');
  const fast = Fast.on();
  const w = await who(token, { kid, lang, device }, { fast });
  if (w.round && !ROUND_GAMES.includes(ex)) fail(404, 'not_found'); // class round: the tap games only
  if (w.form === Grade1.FORM || !def) {   // grade-1 form: served there; its ch_start leaves by the one call site below
    const g1 = await Grade1.exercise(w, ex, { device, mode: (arguments[2] || {}).mode });
    await emitChStart(g1.startEv, g1.run, w.studentId);
    return g1.payload;
  }
  // Fast pages: the day's reading cap, the listening switch and the rule switches are read together, then checked in
  // today's order (each a read only).
  const gate = fast ? {
    readOk: ex === 'read' ? Fast.early(Budget.readOpen()) : null,
    listen: ex === 'listen' ? Fast.early(listenOn()) : null,
    rules: Fast.early(rulesOf({ fast })),
  } : null;
  if (ex === 'read' && !(await (gate ? gate.readOk : Budget.readOpen()))) fail(429, 'enough_for_today');
  if (ex === 'listen' && !(await (gate ? gate.listen : listenOn()))) fail(503, 'listen_off');
  const rules = await (gate ? gate.rules : rulesOf());
  if (ex === 'missing' && !rules.missing) fail(503, 'missing_off');
  // fail closed before anything is served: the runs read names a column this tier lacks (isMissingColumn); under _v2
  // the serve's own read answers "on its way" instead (serveV2)
  let attempt = null;
  if (!rules.v2 && (rules.record || rules.trail) && (attempt = await attemptInfo(w.studentId, ex, ex === 'read' ? w.lang : null)).readFailed) fail(503, 'unavailable');
  // Story Time: a practice story by id (room/pid reach here only with web_quiz_challenge_story on); served under _pool
  // only, and a story room never falls back to a check serve
  const storyAsk = (arguments[2] || {}).room === 'story' && (ex === 'read' || ex === 'listen');
  if (storyAsk && !rules.pool) fail(400, 'story_pid');
  const { Bank } = childTest();
  const task = def.task(w.lang);
  let spec = Bank.getTaskSpec({ grade: Number(w.form), set: 'A', task });
  // challenge v2: what is served (drawn under _pool) and its row, decided before the token; "on its way" serves nothing
  // class round: the turn's mode (decided by the server from the position) and the round's class go to the serve,
  // which is the one writer of the row; a round needs _v2 and plays each game once per term
  if (w.round && (!rules.v2 || !(await require('./web-quiz-class-round').claimFor(w.round, w.studentId, ex)))) fail(409, 'already_done');
  // standing class link (web_quiz_class_link): a class-link pick is served via 'class_link' in the link's class, the teacher's own visit as practice
  const asked = w.round ? { w, mode: w.roundMode, classId: w.classId }
    : w.cl ? require('./web-quiz-class-link').serveArgs(w, arguments[2]) : { w, mode: (arguments[2] || {}).mode, classId: (arguments[2] || {}).classId };
  const v2 = rules.v2 ? await serveV2(asked.w, ex, rules, { mode: storyAsk ? 'practice' : asked.mode, classId: asked.classId, device, story: storyAsk ? { passageId: (arguments[2] || {}).passageId } : null }) : null;   // mode: 'practice' from a caller (Story Time)
  if (v2 && v2.on_its_way) return { ex, on_its_way: true, draw: { outcome: 'on_its_way' }, copy: { ...Draw().ON_ITS_WAY_COPY } };
  if (v2 && v2.formNum !== w.form) spec = Bank.getTaskSpec({ grade: Number(v2.formNum), set: 'A', task });   // M8: the fixed grade's form
  const runId = v2 ? v2.runId : crypto.randomUUID();
  const ct = T.signChallenge({ studentId: w.studentId, ex, runId, ...(w.round ? { round: w.round, mode: w.roundMode } : {}) });
  RUNS.set(runId, { status: 'open', grade: w.grade, form: w.form, lang: w.lang, task, gradeSource: w.gradeSource, test: w.test, ...(v2 ? { v2: v2.mem, ...v2.top } : {}), ...(w.cl ? { cl: w.cl } : {}) });
  if (v2) await v2.store();
  const startEv = { step: ex, grade: w.grade, run: runId, ...(v2 ? v2.event : {}) };
  // the measurement envelope reads the run's v2 fields (kid from canonical_id) over the event's: the run as served
  await emitChStart(startEv, v2 ? { ...RUNS.get(runId), ...v2.event, canonical_id: v2.top.canonical_id } : RUNS.get(runId), w.studentId);
  // Fast pages: the page's remaining lookups need only the child, the game and the rules, so they start together and
  // are awaited where today's code reads them. Without _v2 nothing was written since the attempt check above, so its
  // answer is the practice-round answer too (the same read, made once).
  const page = fast ? {
    attempt: !rules.trail || w.round ? null : (attempt && !v2 ? attempt : Fast.early(attemptInfo(w.studentId, ex, ex === 'read' ? w.lang : null))),
    clips: Fast.early(clipsFor(ex, w.lang)),
    bits: Fast.early(TrailPage.bits({ studentId: w.studentId, device, lang: w.lang })),
    story: ex === 'listen' && !v2 ? Fast.early(storyClip(w.lang)) : null,
    live: ex === 'read' ? Fast.early(liveOn()) : null,
    previous: ex === 'read' && !rules.record ? Fast.early(previousRun(w.studentId, 'read', w.lang, w.form)) : null,
    questions: ex === 'read' ? Fast.early(questionsOn()) : null,
  } : null;
  const got = (key, start) => (page ? page[key] : start());
  // On the trail a stop already played (its first counted run exists) is a practice round: the page says so.
  const practiceRound = !w.round && ((rules.trail ? (await got('attempt', () => attemptInfo(w.studentId, ex, ex === 'read' ? w.lang : null))).attempt_no > 1 : false) || !!(v2 && rules.trail && v2.mem.mode === 'practice'));
  const base = { ex, name: nameOf(ex, w.lang), lang: w.lang, ct, clips: await got('clips', () => clipsFor(ex, w.lang)), ...ruleFlags(rules), ...(rules.guard ? { copy: copyFor(w.lang) } : {}),
    ...(rules.trail ? { trail: true, trail_copy: trailCopy(w.lang), ...(practiceRound ? { practice_round: true } : {}) } : {}), ...(v2 ? roundPayload(w, v2.payload, token) : {}), ...(await got('bits', () => TrailPage.bits({ studentId: w.studentId, device, lang: w.lang }))),
    // a teacher's own visit through the class link (played as practice): the page's banner says nothing counts on their phone
    ...(w.cl && w.cl.m === 'practice' ? { teacher_preview: true } : {}) };
  if (ex === 'missing' && v2 && v2.items) {
    // the A1 warm-up: the same 10 items in the same order on both forms, no 4-error stop; the try-out after item 10
    const p3 = Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ma.missing' });
    return { ...base, items: v2.items, practice: (p3.practice || []).map((i) => ({ seq: i.seq.slice(), answer: i.answer })), stop_after: 0, first_key_s: MISSING_FIRST_KEY_S,
      ...(v2.tryout ? { tryout: v2.tryout } : {}) };
  }
  if (ex === 'missing') {
    // the bank's order on every play (the form is the same for every child); the answer rides along for the page's
    // own feedback and stop — the item bank is public — and the server re-scores and re-applies the stop
    return {
      ...base,
      items: spec.items.map((i) => ({ seq: i.seq.slice(), answer: i.answer })),
      practice: (spec.practice || []).map((i) => ({ seq: i.seq.slice(), answer: i.answer })),
      stop_after: (spec.stop && spec.stop.n) || 4,
      first_key_s: MISSING_FIRST_KEY_S,
    };
  }
  if (ex === 'bigger') {
    return {
      ...base,
      items: servePairs((v2 && v2.items) || spec.items, w.form, rules.record),
      practice: (spec.practice || []).map((i) => ({ a: i.a, b: i.b, answer: i.answer })),
      per_item_s: PER_ITEM_S,
      stop_after: (spec.stop && spec.stop.n) || 4,
    };
  }
  if (ex === 'listen') {
    // the story is heard, never shown: only its clip and how many times EGRA reads it
    const url = v2 ? v2.clipUrl : await got('story', () => storyClip(w.lang));
    if (!url) fail(503, 'getting_ready');
    return { ...base, read_times: Number(spec.read_times) || 2, story_clip: { url }, ...(v2 && v2.story && v2.story.title ? { title: v2.story.title } : {}) };
  }
  const st = (v2 && v2.story) || spec.story || {};
  const live = await got('live', () => liveOn());
  // live: the bar marks the child's last checked words a minute ("last time"), null the first time
  const previousWcpm = live ? (rules.record ? null : ((await got('previous', () => previousRun(w.studentId, 'read', w.lang, w.form))) || {}).wcpm) : undefined;
  const out = { ...base, secs: READ_SECS, live, ...(live ? { previous_wcpm: previousWcpm == null ? null : previousWcpm } : {}), questions_on: await got('questions', () => questionsOn()), story: { text: st.text, tokens: st.tokens, lines: st.lines, dir: (v2 && v2.dir) || spec.direction },
    ...(v2 && v2.story && v2.story.title ? { title: v2.story.title } : {}),
    // live reading v3 (web_quiz_live_read_v3, read only when real-time is on; off ⇒ nothing): how the reading finishes itself
    ...(live && await LiveReadV3().forRead({ lang: w.lang, counted: async () => (v2 ? v2.mem.record === true : !!rules.record && !w.round && (await attemptInfo(w.studentId, 'read', w.lang)).attempt_no === 1) })) };
  // "Hear it again" on the kind card (web_quiz_zero_read_listen, read only under live reading v3; off ⇒ nothing)
  if (out.lr3 && (await zeroListenOn())) out.zero_listen = true;
  return out;
}

// ── challenge v2: the draw, the record decided at serve, the period (web_quiz_challenge_v2 / _period / _pool) ──────
// Everything below runs only when web_quiz_challenge_v2 is on; off, no line here is reached and every payload, row
// and event is today's. The decisions are web-quiz-challenge-draw.js's; this section turns them into a run row
// (inserted at serve, status 'served'), the page's draw fields and the ch_start fields, and finishes that row later.

const Draw = () => require('./web-quiz-challenge-draw');
// a served row stays open this long: the sweeper's served → abandoned boundary and the re-serve window (one constant)
const { SERVED_MS } = require('./web-quiz-challenge-served-window');
const TRAIL_ORDER = Object.freeze(['missing', 'read', 'listen', 'bigger']);
const VIA = { hub: 'hub', quiz: 'quiz_card' };
// meta keys written at serve that every later write of the row keeps
const SERVED_META_KEYS = ['draw', 'grade_fixed_src', 'open_band_src', 'pick_src', 'tryout', 'anchor_serves_any', 'admin_mode', 'sample_arm'];
// the class-week sample window (its own module and switch, another change); read only for a class-link run, and only
// under its parent web_quiz_class_round (SPEC §1)
const CLASS_WEEK_FLAG_KEY = 'web_quiz_class_week';
const CLASS_ROUND_FLAG_KEY = 'web_quiz_class_round';
const classWeekOpen = async (via) => via === 'class_link' && (await settingOn(CLASS_WEEK_FLAG_KEY)) && (await settingOn(CLASS_ROUND_FLAG_KEY));
// the record's parent switch: without the identity store's canon a record cannot be tied to one child (absent → off)
const canonOnForRecord = async () => { try { return Boolean(await require('./web-quiz-bind-page').canonOn()); } catch (_) { return false; } };
const TAP_OK = Object.freeze({ skip: Object.freeze([]) });
const isServedRow = (row) => !!row && row.status === 'served';
// a row served under _v2 (its serve-time meta) and the helped COLUMN written when it finishes (M6)
const isV2Meta = (meta) => !!meta && meta.pick_src !== undefined;
const helpedCol = (v) => (v === true ? 'helped' : (v === false ? 'self' : 'not_asked'));
const servedMeta = (meta) => Object.fromEntries(SERVED_META_KEYS.filter((k) => meta && meta[k] !== undefined).map((k) => [k, meta[k]]));
const words = (text) => String(text || '').split(/\s+/).filter(Boolean);
const bandOfId = (id) => { const b = Number(String(id || '').split('.')[2]); return b >= 1 && b <= 3 ? b : null; };

/** A passage's lines as the scorer and the reach rule read them ([{n, from, to}]), whatever the file wrote. */
function linesOf(lines, n) {
  if (Array.isArray(lines) && lines.length && lines.every((l) => l && Number.isInteger(Number(l.to)))) return lines;
  if (Array.isArray(lines) && lines.length && lines.every((l) => typeof l === 'string')) {
    let from = 0;
    return lines.map((l, k) => { const len = words(l).length; const out = { n: k + 1, from, to: from + len - 1 }; from += len; return out; });
  }
  return [{ n: 1, from: 0, to: Math.max(0, n - 1) }];
}

/** The passage's story and questions: the v4 bank's file, else (Set A, no pointer file yet) the v3 task spec. */
function passageFor(id, Bank) {
  const p = typeof Bank.getPassage === 'function' ? Bank.getPassage(id) : null;
  if (p && p.text) {
    const tokens = Array.isArray(p.tokens) ? p.tokens : words(p.text);
    return { id, text: p.text, tokens, lines: linesOf(p.lines, tokens.length), direction: p.direction || p.dir || (p.lang === 'ur' ? 'rtl' : 'ltr'), questions: p.questions || [],
      title_en: p.title_en == null ? null : p.title_en, title_ur: p.title_ur == null ? null : p.title_ur, kind: p.kind, pool: p.pool };   // kind/pool: the counted-listen title gate asks them (web-quiz-passage-title.js)
  }
  const m = /^(en|ur)\.(read|listen)\.2\.setA$/.exec(String(id || ''));
  if (!m) return null;
  const spec = Bank.getTaskSpec({ grade: 3, set: 'A', task: `${m[1]}.${m[2] === 'read' ? 'story' : 'listening'}` });
  const st = spec.story || {};
  return { id, text: st.text, tokens: st.tokens, lines: st.lines, direction: spec.direction, questions: spec.questions || [] };
}

// The passage's child-facing title: its one home is web-quiz-passage-title.js (a leaf)
const { titleOf, passageTitle } = require('./web-quiz-passage-title');
/** The menu entry's title field for a Trail stop with a passage served this period: {} when none. */
function menuTitle(trailStop) {
  const t = trailStop && trailStop.passage_id ? passageTitle(trailStop.passage_id) : null;
  return t ? { title: t } : {};
}

/** A v3 task spec with the drawn passage's story and questions (no passage → the spec as it is). */
function withPassage(spec, passage) {
  if (!passage) return spec;
  return { ...spec, story: { text: passage.text, tokens: passage.tokens, lines: passage.lines }, questions: passage.questions, direction: passage.direction || spec.direction };
}

/** A stopped reader: the questions whose needs_line ≤ the line they stopped in (meta.stop_line, else the lines read, at least 1). */
function stopLineQuestions(spec, wordsRead, row) {
  const stop = Number(row && row.meta && row.meta.stop_line);
  const full = ((spec.story && spec.story.lines) || []).filter((l) => Number(l.to) + 1 <= wordsRead).length;
  const last = Number.isInteger(stop) && stop >= 1 ? stop : Math.max(1, full);
  return new Set((spec.questions || []).filter((q) => Number(q.needs_line) >= 1 && Number(q.needs_line) <= last).map((q) => q.id));
}
const byNeedsLine = (qs) => [...(qs || [])].sort((a, b) => (Number(a.needs_line) || 99) - (Number(b.needs_line) || 99));

/** The A1 items the page answered (a skip counts as reached): what the statement's "finished all 10" reads. */
function reachedCount(items, answers) {
  const seen = new Set();
  for (const a of Array.isArray(answers) ? answers.slice(0, 50) : []) {
    const i = Number(a && a.i);
    if (Number.isInteger(i) && i >= 0 && i < items.length) seen.add(i);
  }
  return seen.size;
}

/** The try-out's answer, kept apart from the score: { item_id, resp: {pick|value, ms}, ok }. */
function tryoutAnswer(itemId, resp, Bank) {
  if (!resp || typeof resp !== 'object') return { item_id: itemId, resp: null, ok: null };
  const it = typeof Bank.getItemV4 === 'function' ? Bank.getItemV4(itemId) : null;
  const pm = (it && it.params) || {};
  const pick = Number.isFinite(Number(resp.pick)) && resp.pick !== null && resp.pick !== '' ? Number(resp.pick) : null;
  const value = typeof resp.value === 'string' && /^\d{1,4}$/.test(resp.value) ? resp.value : null;
  const ms = Number.isFinite(Number(resp.ms)) && Number(resp.ms) >= 0 ? Math.min(MISSING_MAX_MS, Math.round(Number(resp.ms))) : null;
  const want = pm.ans === 'a' ? pm.a : (pm.ans === 'b' ? pm.b : pm.ans);
  const got = pick != null ? pick : (value != null ? Number(value) : null);
  return { item_id: itemId, resp: { ...(pick != null ? { pick } : {}), ...(value != null ? { value } : {}), ms }, ok: got == null || want == null ? null : got === Number(want) };
}

/** The served bigger set's pairs (an item set from the v4 bank), or null for Set A as v3 holds it. */
function servedPairs(itemSetId, Bank) {
  if (!itemSetId || !/^bigger\./.test(itemSetId) || typeof Bank.itemSet !== 'function') return null;
  try { return Bank.itemSet(itemSetId).map((i) => ({ a: i.a, b: i.b, answer: i.answer })); } catch (_) { return null; }
}

/** The served row's v2 facts (another process scoring it, or questions after a restart); null when not readable. */
async function servedInfo(id) {
  const { data, error } = await supabase.from(TABLE).select('id, status, passage_id, item_set_id, anchor_block, mode, record, form, meta').eq('id', id).maybeSingle();
  if (error || !data) return null;
  if (!data.passage_id && !data.item_set_id && !data.anchor_block && data.mode == null) return null;
  return { passage_id: data.passage_id || null, item_set_id: data.item_set_id || null, anchor_block: data.anchor_block || null, mode: data.mode, record: data.record,
    tryout: (data.meta && data.meta.tryout && data.meta.tryout.item_id) || null, form: /^G[1-5]$/.test(String(data.form || '')) ? data.form.slice(1) : null };
}

/** A served row starts being scored (read upload, live mint, listen questions): status 'scoring', meta merged. */
async function startServed(id, meta) {
  const { data, error } = await supabase.from(TABLE).select('id, status, meta').eq('id', id).maybeSingle();
  if (error || !data || data.status !== 'served') return error ? 'unstored' : 'duplicate';
  const { data: hit, error: e2 } = await supabase.from(TABLE).update({ status: 'scoring', meta: { ...(data.meta || {}), ...meta } }).eq('id', id).eq('status', 'served').select('id');
  if (e2) { storeFailed(id, e2); return 'unstored'; }
  return hit && hit.length ? 'stored' : 'duplicate';
}

/** A served row's result (bigger, the warm-up): written once, only while the row is still 'served'. */
async function finishServed(id, row) {
  const { data, error } = await supabase.from(TABLE).select('id, status, meta').eq('id', id).maybeSingle();
  if (error || !data || data.status !== 'served') return error ? 'unstored' : 'duplicate';
  const { id: _id, student_id: _s, exercise: _e, grade: _g, lang: _l, created_at: _c, ...rest } = row;
  const { data: hit, error: e2 } = await supabase.from(TABLE).update({ ...rest, meta: { ...(data.meta || {}), ...(row.meta || {}) } }).eq('id', id).eq('status', 'served').select('id');
  if (e2) { storeFailed(id, e2); return 'unstored'; }
  return hit && hit.length ? 'stored' : 'duplicate';
}

/**
 * A finished run (scored or failed) renews the child's phone bindings, under web_quiz_phone_bind (the binder's own
 * switch reader and repository, required lazily: absent → nothing). A page run has no phone: never by phone. Never throws.
 */
async function renewBindings(studentId, now = Date.now()) {
  try {
    let IdFlags = null;
    try { IdFlags = require('./web-quiz-identity-flags'); } catch (_) { return; }
    if (!(await IdFlags.flags()).phoneBind) return;
    const BindRepo = require('./child-phone-bindings.repo');
    const canonicalId = await require('./web-quiz-identity-roster').canonicalStudentId(studentId);
    const at = new Date(now);
    for (const b of await BindRepo.activeForChild(canonicalId, at)) await BindRepo.renew(b.id, BindRepo.expiresAtFor(at), at);
  } catch (e) {
    logError('web_quiz.ch_bind_renew_failed', { error: String(e && e.message || e).slice(0, 120) });
  }
}

/** A finished served row that is the child's first exposure in a class lights the class light (web_quiz.light_lit). Never throws. */
async function lightIfFirst(id) {
  try {
    const { data, error } = await supabase.from(TABLE).select('id, exercise, status, mode, exposure_no, class_id, anchor_block, canonical_id, meta').eq('id', id).maybeSingle();
    if (!error && data && data.mode != null && !(data.meta && data.meta.quality === 'implausible')) Draw().lightLit(data);
  } catch (e) {
    logError('web_quiz.ch_light_failed', { error: String(e && e.message || e).slice(0, 120) });
  }
}

/** This period's record rows per stop (the menu's done/badge under _period); null when no period holds now. */
async function periodTrail(w) {
  const D = Draw();
  const periodNow = D.periodIdFor(new Date(), await D.periods());
  if (!periodNow) { D.notePeriodMissing(); return null; }
  const canonicalId = await require('./web-quiz-identity-roster').canonicalStudentId(w.studentId);
  return D.trailStateFor(canonicalId, periodNow, [w.studentId]);
}

/**
 * The child's own record row of this stop this period that was served and left (status served, or abandoned while still
 * marked record), the newest; null when none. The record key is (stop, language) for read and listen, the stop alone else.
 */
function openRecordRow(rows, ex, periodId, lang) {
  return (rows || []).filter((r) => r.exercise === ex && r.period_id === periodId && r.record === true && (r.status === 'served' || r.status === 'abandoned')
    && ((ex !== 'read' && ex !== 'listen') || r.lang === lang))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))).pop() || null;
}

/**
 * A served-and-left record row older than the sweeper's served boundary (or abandoned still marked record) gives the month's record up: one
 * update, only while the row is as read (status and meta), to status 'abandoned', record=false, meta.record_lost
 * 'reopened'. Its passage stays in the seen set, so the clean check after it draws another. Never throws.
 */
async function giveUpRecord(open) {
  try {
    const q = supabase.from(TABLE).update({ status: 'abandoned', record: false, meta: { ...(open.meta || {}), record_lost: 'reopened' } })
      .eq('id', open.id).eq('status', open.status).eq('record', true);
    const { data, error } = await (open.meta == null ? q.is('meta', null) : q.eq('meta', JSON.stringify(open.meta))).select('id');
    if (error) { if (!isMissingTable(error)) storeFailed(open.id, error); return; }
    if (data && data.length) Object.assign(open, { status: 'abandoned', record: false });
  } catch (e) {
    logError('web_quiz.ch_record_give_up_failed', { runId: open.id, error: String((e && e.message) || e).slice(0, 120) });
  }
}

/**
 * The child's own served record row of this stop, opened again before the sweeper would close it (its SERVED_MS): served again exactly as it was
 * (the same run, passage or item set, anchor block, band, exposures, form), nothing drawn, logged or inserted. Its store()
 * only stamps meta.reopened_at. Null when the row cannot be read whole or is no longer a served record (the caller
 * serves as today).
 */
async function reserveV2(w, ex, open, { D, Bank, pool, canonicalId, ob, now, formNum: formNow }) {
  const { data: row, error } = await supabase.from(TABLE).select('*').eq('id', open.id).maybeSingle();
  if (error || !row || row.status !== 'served' || row.record !== true) return null;
  const formNum = /^G[1-5]$/.test(String(row.form || '')) ? String(row.form).slice(1) : formNow;
  const form = `G${formNum}`;
  const passageId = row.passage_id || null; const itemSetId = row.item_set_id || null; const anchorBlock = row.anchor_block || null;
  let items = null; let tryout = null; let story = null; let dir = null; let clipUrl;
  if (ex === 'missing' && anchorBlock) {
    // the fixed anchor block, and the try-out drawn from the row's own seed (the same Bank call the serve made)
    items = Bank.anchorBlock(anchorBlock).map((i) => ({ item_id: i.item_id, seq: i.seq.slice(), answer: i.answer }));
    const want = row.meta && row.meta.tryout && row.meta.tryout.item_id;
    if (want && typeof Bank.listItemsV4 === 'function') {
      const all = Bank.listItemsV4();
      let t = row.draw_seed ? D.tryoutItem(all, row.draw_seed) : null;
      if (!t || t.item_id !== want) t = all.find((i) => i.item_id === want) || null;
      if (t) tryout = { item_id: t.item_id, task: t.task, ...(t.task === 'missing' ? { seq: t.params.seq.slice() } : { a: t.params.a, b: t.params.b }) };
    }
  } else if (ex === 'bigger') {
    items = pool ? servedPairs(itemSetId, Bank) : null;
  }
  if (passageId) {
    const p = passageFor(passageId, Bank);
    if (!p) { logError('web_quiz.ch_passage_missing', { passage_id: passageId }); fail(503, 'unavailable'); }
    story = { text: p.text, tokens: p.tokens, lines: p.lines, title: titleOf(p) };   // title: the page's intro names the passage (RULING #100(a)(2))
    dir = p.direction;
  }
  if (ex === 'listen') {
    clipUrl = await storyClip(w.lang, story && story.text);
    if (!clipUrl) fail(503, 'getting_ready');
  }
  const mode = 'check'; const record = true;
  const exposure = row.exposure_no == null ? null : row.exposure_no;
  const anchorExp = row.anchor_exposure_no == null ? null : row.anchor_exposure_no;
  const servesAny = row.anchor_serves_any == null ? (row.meta && row.meta.anchor_serves_any) || null : row.anchor_serves_any;
  const band = row.band == null ? null : row.band;
  const via = row.via || null;
  const periodId = row.period_id;
  const rung = (ex === 'read' || ex === 'listen') ? ob.rungs.reading : ob.rungs.numbers;
  const isPassage = ex === 'read' || ex === 'listen';
  const reopenedAt = new Date(now).toISOString();
  return {
    runId: row.id,
    mem: { passage_id: passageId, item_set_id: itemSetId, anchor_block: anchorBlock, mode, record, tryout: tryout ? tryout.item_id : null },
    formNum,
    top: { canonical_id: row.canonical_id || canonicalId, mode, period_id: periodId, band, record, via, exposure_no: exposure, passage_id: passageId, item_set_id: itemSetId,
      anchor_block: anchorBlock, anchor_exposure_no: anchorExp, form: formNum },
    // reopened: the page may say "let's carry on" instead of a fresh intro (r5-redteam-4 025824); the row and the score are untouched
    payload: { mode, ...(anchorBlock ? { anchor_block: anchorBlock } : {}), draw: { outcome: 'served' }, reopened: true },
    event: { w: 's', mode, period_id: periodId, form, band, rung: rung == null ? null : rung, ...(isPassage ? { passage_id: passageId } : { item_set_id: itemSetId }),
      exposure_no: exposure, ...(anchorBlock ? { anchor_exposure_no: anchorExp, anchor_serves_any: servesAny, anchor_block: anchorBlock } : {}), record, via, reopened: true },
    items, tryout, story, dir, clipUrl,
    async store() {
      await updateRunMeta(row.id, (cur) => ({ meta: { ...(cur.meta || {}), reopened_at: reopenedAt } }));
    },
  };
}

/**
 * What one exercise serves under _v2 and the run row that says so. Returns { on_its_way } (nothing served, the draw
 * logged) or { runId, mem, payload, event, store(), items?, tryout?, story?, dir?, clipUrl? }.
 * `mode` 'practice' from the caller (Story Time, another change) is honoured; a second serve of a stop in the same
 * period is practice. A teacher's device cannot be told apart here (who() carries no such signal).
 */
async function serveV2(w, ex, rules, { mode: askedMode, device = null, classId: askedClass = null, story: storyAsk = null } = {}) {
  const D = Draw();
  const { Bank } = childTest();
  const pool = rules.pool && typeof Bank.getItemV4 === 'function';
  const now = Date.now();
  const canonicalId = await require('./web-quiz-identity-roster').canonicalStudentId(w.studentId);
  const [rows, periodRows, fixed, pick] = await Promise.all([D.childRows(canonicalId, [w.studentId]), D.periods(), D.fixedGradeOf(canonicalId, w.grade), D.pickOf({ sessionId: w.sessionId || null, canonicalId, device })]);
  // fail closed: the child's runs could not be read (a provenance column missing): nothing drawn, written or recorded
  if (rows.readFailed) return { on_its_way: true };
  const periodNow = D.periodIdFor(new Date(now), periodRows);
  if (!periodNow && (rules.period || rules.pool)) D.notePeriodMissing(now);
  const periodRule = rules.period && !!periodNow;
  const ob = await D.openBand(canonicalId, fixed.grade);
  const formNum = formFor(fixed.grade) || w.form;   // M8: the FIXED grade's form, never the visit's
  const form = `G${formNum}`;
  // already counted: this period's record row of the stop (per language for read/listen) (_period), else a scored run ever
  const counted = periodRule ? D.countedThisPeriod(rows, ex, periodNow, w.lang)
    : rows.some((r) => r.exercise === ex && r.status === 'scored' && !notHomeAttempt(r) && (ex !== 'read' || r.lang === w.lang));
  // the caller's mode: 'practice' (Story Time) or 'class_round' (the teacher's locked round); else practice when counted
  let mode = askedMode === 'class_round' ? 'class_round' : (askedMode === 'practice' || counted ? 'practice' : 'check');
  // web_quiz_identity_canon is the record's hard parent: off, a would-be record is served as practice (the Trail still serves)
  const recordBlocked = periodRule && mode === 'check' && !(await canonOnForRecord()) ? 'identity_canon_off' : null;
  if (recordBlocked) mode = 'practice';
  // the child's own record row of this stop, served and left (RULING #85(a')): younger than the sweeper's served-row
  // boundary (SERVED_MS, the one constant both read) it is served again as it was; older, or abandoned still marked record, it
  // gives the record up (record=false) and a clean check follows
  if (periodRule && mode === 'check') {
    const open = openRecordRow(rows, ex, periodNow, w.lang);
    const fresh = !!open && open.status === 'served' && now - Date.parse(open.created_at) < SERVED_MS;
    const again = fresh ? await reserveV2(w, ex, open, { D, Bank, pool, canonicalId, ob, now, formNum }) : null;
    if (again) return again;
    if (open && !fresh) await giveUpRecord(open);
  }
  const seed = crypto.randomBytes(16).toString('hex');
  const runId = crypto.randomUUID();
  const seen = D.seenIdsOf(rows);
  const gb = D.gradeBand(fixed.grade);
  const drawRow = (d) => ({ draw_id: crypto.randomUUID(), canonical_id: canonicalId, period_id: periodNow, stop: ex, lang: w.lang, fixed_grade_band: gb, drawn_at: new Date(now).toISOString(), weights_v: 'w1', ...d });
  let passageId = null; let itemSetId = null; let anchorBlock = null; let band = null; let set = null;
  let items = null; let tryout = null; let story = null; let dir = null; let drawLog = null; let drawSeed = null; let periodSet;
  let storyDraw = null;

  if (ex === 'missing') {
    if (pool) {
      anchorBlock = 'A1';
      items = Bank.anchorBlock('A1').map((i) => ({ item_id: i.item_id, seq: i.seq.slice(), answer: i.answer }));
      const t = mode === 'check' && typeof Bank.listItemsV4 === 'function' ? D.tryoutItem(Bank.listItemsV4(), seed) : null;
      if (t) tryout = { item_id: t.item_id, task: t.task, ...(t.task === 'missing' ? { seq: t.params.seq.slice() } : { a: t.params.a, b: t.params.b }) };
      drawSeed = seed;
      drawLog = drawRow({ open_band: null, band: null, band_reason: 'anchor', eligible: [{ id: 'A1', w: 1 }], eligible_n: 1, ref_eligible: false, p: 1, served_id: 'A1', outcome: 'served', seed });
    } else { itemSetId = `missing.${form}.A`; set = 'A'; }
  } else if (ex === 'bigger') {
    if (pool) {
      const pickSet = D.biggerSetFor(form, periodNow, seen);
      itemSetId = pickSet.item_set_id;
      periodSet = pickSet.period_set;
      // a seen set is a practice replay at home; in the teacher's round the round's mode wins and exposure_no says it was met (SAMPLING_RULING NC4)
      if (pickSet.practice && mode !== 'class_round') mode = 'practice';
      items = servedPairs(itemSetId, Bank);
      drawLog = drawRow({ open_band: null, band: null, band_reason: 'set', eligible: [{ id: itemSetId, w: 1 }], eligible_n: 1, ref_eligible: false, p: 1, served_id: itemSetId, outcome: 'served', seed: null });
    } else itemSetId = `bigger.${form}.A`;
    set = /\.A$/.test(itemSetId) ? 'A' : null;
  } else if (pool && mode === 'check') {
    const db = D.drawBand({ fixedGrade: fixed.grade, openBand: ob.band, lastCountedRead: D.lastCountedRead(rows) });
    const registry = await D.registryPassages();
    // fail closed: the counted pool needs the provenance column; without it nothing is drawn, written or logged
    if (registry.provenanceMissing) return { on_its_way: true };
    // the counted draw admits only sourced passages (ITEMS §8.1; RULING #105 (iii): unconditional, no switch read)
    const d = D.drawPassage({ rows: registry.filter((r) => r.pool === 'check'), seenIds: seen, kind: ex, lang: w.lang, band: db.band, band_reason: db.band_reason, now: new Date(now), seed, counted: true });
    drawLog = drawRow({ open_band: db.open_band, band: d.band, band_reason: d.band_reason, eligible: d.eligible, eligible_n: d.eligible_n, ref_eligible: d.ref_eligible, p: d.p, served_id: d.served_id, outcome: d.outcome, seed: d.seed });
    if (d.outcome === 'on_its_way') {
      await D.logDraw({ ...drawLog, run_id: null });
      return { on_its_way: true };
    }
    passageId = d.id; band = d.band; drawSeed = seed;
  } else if (pool && storyAsk) {
    // Story Time: the practice story the shelf showed, only if the shelf could have shown it to this child (the
    // shelf's own open bands); anything else is refused before a row exists
    const pid = typeof storyAsk.passageId === 'string' ? storyAsk.passageId : null;
    const bands = require('./web-quiz-hub-play').openBands(fixed.grade, ob.rungs && ob.rungs.reading);
    const own = pid && typeof Bank.getPassage === 'function' ? Bank.getPassage(pid) : null;
    const s = D.storyPassageFor({ rows: await D.registryPassages(), pid, kind: ex, lang: w.lang, bands, reserve: !!(own && own.reserve === true), now: new Date(now) });
    if (!s) fail(400, 'story_pid');
    passageId = s.passage_id; band = Number(s.band);
    storyDraw = { outcome: 'served', band_reason: 'story', served_id: passageId, open_bands: [...bands].sort() };
  } else if (pool) {
    // practice (a replay in the period): no draw from the check pool; the period's record passage again, else the last one met
    const mine = rows.filter((r) => r.exercise === ex && r.passage_id && (r.lang == null || r.lang === w.lang));
    const rec = mine.filter((r) => r.period_id === periodNow && r.record === true).pop() || mine.pop();
    passageId = (rec && rec.passage_id) || `${w.lang}.${ex}.2.setA`;
    band = bandOfId(passageId);
  } else { passageId = `${w.lang}.${ex}.2.setA`; band = 2; }

  if (passageId) {
    const p = passageFor(passageId, Bank);
    if (!p) { logError('web_quiz.ch_passage_missing', { passage_id: passageId }); fail(503, 'unavailable'); }
    story = { text: p.text, tokens: p.tokens, lines: p.lines, title: titleOf(p) };   // title: the page's intro names the passage (RULING #100(a)(2))
    dir = p.direction;
    set = /\.setA$/.test(passageId) ? 'A' : null;
  }
  // the listening story must be playable before anything is written (a passage met is never served again)
  const clipUrl = ex === 'listen' ? await storyClip(w.lang, story && story.text) : undefined;
  if (ex === 'listen' && !clipUrl) fail(503, 'getting_ready');
  // Story Time read-along: the story in the quiz voice, played with the line lit before the child reads (the lazy clip
  // path; null until recorded, and asking records it); only on a story serve, never on a check
  const readAlong = storyDraw && ex === 'read' ? { url: await readAlongClip(w.lang, story && story.text) } : null;
  // the word-by-word read-along (web_quiz_readalong, web-quiz-readalong.js): the same story serve only; off ⇒ null
  const timed = storyDraw && ex === 'read' ? await require('./web-quiz-readalong').readAlong({ settingOn }).forPassage({ lang: w.lang, passageId, text: story && story.text }) : null;
  // the same player on practice runs only (never a counted run, never a class round): a replayed read may be heard
  // first (hear_first, inlined); a practice listen may show its words AFTER its questions (show_words: a flag only —
  // the listen payload never carries the story's words; the page asks for them by the run token, listenWords())
  const practiceTimed = mode === 'practice' && ((ex === 'read' && !storyDraw) || ex === 'listen')
    ? await require('./web-quiz-readalong').readAlong({ settingOn }).forPassage({ lang: w.lang, passageId, text: story && story.text }) : null;

  const servesAny = anchorBlock ? D.anchorServesAny(rows, anchorBlock) : null;   // the anchor_serves_any column (and meta, kept one period)
  const prev2 = anchorBlock ? D.anchorPrev2(rows, anchorBlock) : null;   // of which before the provenance columns: meta.draw.anchor_prev2
  const exposure = anchorBlock ? servesAny : D.exposureNo(rows, passageId || itemSetId);
  // M7: a passage or set already met is never a record; the anchor block is the exception
  const record = periodRule ? D.recordAtServe({ mode, outcome: drawLog ? drawLog.outcome : 'served', countedThisPeriod: counted, exposureNo: exposure, anchor: !!anchorBlock }) : null;
  const anchorExp = anchorBlock ? D.anchorExposureNo(rows, anchorBlock) : null;
  const metaDraw = drawLog ? { draw_id: drawLog.draw_id, outcome: drawLog.outcome, eligible: drawLog.eligible, eligible_n: drawLog.eligible_n, ref_eligible: drawLog.ref_eligible,
    p: drawLog.p, band_reason: drawLog.band_reason, weights_v: drawLog.weights_v, seed: drawLog.seed, ...(periodSet ? { period_set: periodSet } : {}),
    ...(prev2 ? { anchor_prev2: prev2 } : {}) } : storyDraw;
  const via = VIA[w.via] || w.via || null;
  const periodId = periodRule ? periodNow : null;
  // the class at write time: the caller's (the class link), else the canonical child's active enrolment; never a share code
  const classId = (typeof askedClass === 'string' && /^[0-9a-f-]{36}$/i.test(askedClass) ? askedClass : null) || await D.activeClassOf([canonicalId, w.studentId]);
  const admin = await D.adminFields({ mode, via, classId, at: new Date(now), classWeekOn: await classWeekOpen(via) });   // the class-week arm reads the run's class
  const row = {
    id: runId, student_id: w.studentId, exercise: ex, grade: w.grade, lang: w.lang, status: 'served', created_at: nowIso(),
    meta: { grade_fixed_src: fixed.src, open_band_src: ob.src, pick_src: pick.pick_src, ...(metaDraw ? { draw: metaDraw } : {}), ...(tryout ? { tryout: { item_id: tryout.item_id } } : {}), ...(anchorBlock ? { anchor_serves_any: servesAny } : {}), admin_mode: admin.admin_mode, sample_arm: admin.sample_arm, ...(recordBlocked ? { record_blocked: recordBlocked } : {}) },
    bank_version: pool ? Bank.versionV4 : Bank.versionV3, set, form, passage_id: passageId, item_set_id: itemSetId, mode, period_id: periodId,
    exposure_no: exposure, band, anchor_exposure_no: anchorExp, anchor_block: anchorBlock, draw_seed: drawSeed, canonical_id: canonicalId,
    id_src: pick.id_src, id_confidence: pick.id_confidence, homonym_in_list: pick.homonym_in_list, via, share_code_id: w.shareCodeId || null,
    record, started_at: new Date(now).toISOString(), class_id: classId,
    // the sampling columns (web_quiz_challenge_runs_sampling.sql); meta keeps the same three for one period
    admin_mode: admin.admin_mode, sample_arm: admin.sample_arm, anchor_serves_any: servesAny,
  };
  const rung = (ex === 'read' || ex === 'listen') ? ob.rungs.reading : ob.rungs.numbers;
  const isPassage = ex === 'read' || ex === 'listen';
  return {
    runId,
    mem: { passage_id: passageId, item_set_id: itemSetId, anchor_block: anchorBlock, mode, record, tryout: tryout ? tryout.item_id : null },
    formNum,
    // the run's v2 fields at the top of its in-process entry (the measurement events read them there); form stays the scoring form
    top: { canonical_id: canonicalId, mode, period_id: periodId, band, record, via, exposure_no: exposure, passage_id: passageId, item_set_id: itemSetId,
      anchor_block: anchorBlock, anchor_exposure_no: anchorExp, form: formNum },
    // the page gets only what it renders (ruling #43); every other field is on the row, in meta.draw and in ch_start
    payload: { mode, ...(mode === 'practice' ? { practice_round: true } : {}), ...(anchorBlock ? { anchor_block: anchorBlock } : {}), draw: { outcome: 'served' }, ...(readAlong ? { story_clip: readAlong } : {}), ...(timed ? { readalong: timed } : {}),
      ...(practiceTimed && ex === 'read' ? { hear_first: practiceTimed } : {}), ...(practiceTimed && ex === 'listen' ? { show_words: true } : {}) },
    event: { w: 's', mode, period_id: periodId, form, band, rung: rung == null ? null : rung, ...(isPassage ? { passage_id: passageId } : { item_set_id: itemSetId }),
      exposure_no: exposure, ...(anchorBlock ? { anchor_exposure_no: anchorExp, anchor_serves_any: servesAny, anchor_block: anchorBlock } : {}), record, via },
    items, tryout, story, dir, clipUrl,
    async store() {
      let stored = await insertRun(row);
      // stored as practice by insertRun (a second record this period): what the page, the run and ch_start say follows it
      const lost = stored === 'practice';
      if (lost) {
        stored = 'stored';
        for (const o of [this.mem, this.top, this.event, RUNS.get(runId)]) if (o) Object.assign(o, { record: false, mode: 'practice' });
        Object.assign(this.payload, { mode: 'practice', practice_round: true });
      }
      if (drawLog) await D.logDraw({ ...drawLog, run_id: stored === 'stored' ? runId : null });
      // IDENTITY §16: the year's fixed grade at the first counted play (the visit's grade; never changed after)
      if (!lost && record === true && mode === 'check') await D.writeChildIdentity({ canonicalId, grade: w.grade, gradeSource: w.gradeSource, now: new Date(now) });
    },
  };
}

// ── scoring ───────────────────────────────────────────────────────────────────────────────────────────

/** EGRA Toolkit §10.3 words (items) correct per minute, whole number for the kid. */
function wcpm(correct, timeLeft = 0) {
  return Math.round(childTest().Common.rate(correct, timeLeft));
}

/**
 * "Which is bigger?" from the phone's taps: [{i, pick, ms}]. A pick that is not the bigger number, a tap slower
 * than PER_ITEM_S, or no tap at all is a miss (EGMA scores a silence wrong); 4 misses in a row stop it.
 */
function scoreBigger(items, taps, { stopAfter = 4 } = {}) {
  const byI = new Map();
  for (const t of Array.isArray(taps) ? taps.slice(0, 50) : []) {
    const i = Number(t && t.i);
    if (Number.isInteger(i) && i >= 0 && i < items.length && !byI.has(i)) byI.set(i, t);
  }
  const rows = items.map((it, i) => {
    const t = byI.get(i);
    const ok = t && Number(t.pick) === it.answer && Number(t.ms) >= 0 && Number(t.ms) <= PER_ITEM_S * 1000;
    return { i: i + 1, verdict: ok ? 'correct' : (t ? 'wrong' : 'none') };
  });
  const stop = childTest().Common.applyConsecutiveStop(rows, stopAfter);
  return { correct: rows.filter((r) => r.verdict === 'correct').length, n: items.length, stopped: !!stop.stopped };
}

/**
 * The pairs as served. Under the record rule the bigger number sits second on exactly half of the form's pairs,
 * drawn once per form (the same for every child, so the side carries nothing a child can learn across runs);
 * the score compares the VALUE tapped, so the order touches nothing else.
 */
function servePairs(items, form, record) {
  if (!record) return items.map((i) => ({ a: i.a, b: i.b }));
  // a small seeded draw (mulberry32) of half the positions, seeded by the form
  let s = 0x9e3779b9 ^ (Number(form) || 0);
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const idx = items.map((_, i) => i).sort(() => rnd() - 0.5).slice(0, Math.floor(items.length / 2));
  const second = new Set(idx);
  return items.map((i, k) => {
    const hi = Math.max(i.a, i.b); const lo = Math.min(i.a, i.b);
    return second.has(k) ? { a: lo, b: hi } : { a: hi, b: lo };
  });
}

/** Per item: where the answer sat as served, the tap's verdict (null = no tap) and its ms. Numbers only. */
function biggerItems(items, taps, served) {
  const byI = new Map();
  for (const t of Array.isArray(taps) ? taps.slice(0, 50) : []) {
    const i = Number(t && t.i);
    if (Number.isInteger(i) && i >= 0 && i < items.length && !byI.has(i)) byI.set(i, t);
  }
  return items.map((it, i) => {
    const t = byI.get(i);
    const ms = t && Number.isFinite(Number(t.ms)) ? Math.max(0, Math.round(Number(t.ms))) : null;
    const ok = t ? (Number(t.pick) === it.answer && ms != null && ms <= PER_ITEM_S * 1000) : null;
    const s = served && served[i];
    return { i: i + 1, side: s && s.b === it.answer ? 'b' : 'a', ok, ms };
  });
}
const BIGGER_FAST_MS = 500;
// the speed floor: all 10 right AND the median per-item ms under 1500 (a reading child cannot be that fast; a script can)
const RAPID_PERFECT_MS = 1500;
// or the server's own clock from the serve under 25 s (that clock also holds ~10 s of the page's own pacing before and between items)
const RAPID_PERFECT_ELAPSED_S = 25;
function rapidPerfect(rows, elapsedS) {
  if (!Array.isArray(rows) || rows.length !== 10 || !rows.every((r) => r.ok === true && r.ms != null)) return false;
  const ms = rows.map((r) => Number(r.ms)).sort((a, b) => a - b);
  return (ms[4] + ms[5]) / 2 < RAPID_PERFECT_MS || (Number.isFinite(elapsedS) && elapsedS < RAPID_PERFECT_ELAPSED_S);
}
// A run is rapid when three or more items were FAST AND WRONG (fast and right is fluency); abandoned when the stop
// came from items never touched.
function itemFlags(rows, { fastMs, stopped }) {
  const noneN = rows.filter((r) => r.ok === null).length;
  const fast = (r) => r.ms < (typeof fastMs === 'function' ? fastMs(r) : fastMs);
  const rapid = rows.filter((r) => r.ok === false && r.ms != null && fast(r)).length >= 3;
  return { none_n: noneN, rapid, abandoned: !!stopped && noneN >= 3 };
}

// "Missing number" (EGMA): untimed, and scored two ways from the one run — `correct` (any time; drives the stop and
// the badge) and `correct_5s` (the first key pressed within 5 s of the item showing: the EGMA-comparable figure).
const MISSING_FIRST_KEY_S = 5;
const MISSING_MAX_MS = 10 * 60 * 1000;
// a keypad answer is rapid when it is wrong and came faster than a child can read the row and type it
const missingFastMs = (r) => 400 + 300 * (r.digits || 1);

/**
 * The phone's answers [{i, value, ms, first_key_ms, keys}] (value: the digits typed, or null for a skip) against the
 * form's items. EGMA's stop (4 wrong or skipped in a row) is applied here whatever the phone did; anything after the
 * stop is not reached. Returns the score and the per-item rows (numbers only).
 */
function scoreMissing(items, answers, { stopAfter = 4 } = {}) {
  const byI = new Map();
  for (const a of Array.isArray(answers) ? answers.slice(0, 50) : []) {
    const i = Number(a && a.i);
    if (Number.isInteger(i) && i >= 0 && i < items.length && !byI.has(i)) byI.set(i, a);
  }
  const num = (v, max) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(max, Math.round(Number(v))) : null);
  const rows = items.map((it, i) => {
    const a = byI.get(i);
    const value = a && typeof a.value === 'string' && /^\d{1,4}$/.test(a.value) ? a.value : null;
    const ms = a ? num(a.ms, MISSING_MAX_MS) : null;
    const firstKey = a ? num(a.first_key_ms, MISSING_MAX_MS) : null;
    const ok = value != null && Number(value) === Number(it.answer);
    // a skip (or no answer) is EGMA's silence: wrong for the stop, and an untouched item for the flags
    return {
      i: i + 1, verdict: value == null ? 'none' : (ok ? 'correct' : 'wrong'),
      ok: value == null ? null : ok, ok_5s: ok && firstKey != null && firstKey <= MISSING_FIRST_KEY_S * 1000,
      ms, first_key_ms: firstKey, keys: a ? num(a.keys, 99) : null, digits: String(it.answer).length,
    };
  });
  const stop = stopAfter > 0 ? childTest().Common.applyConsecutiveStop(rows, stopAfter) : { stopped: false };
  // an item past the stop counts for nothing, whatever the phone sent
  const reached = rows.filter((r) => r.verdict !== 'not_reached');
  const correct = reached.filter((r) => r.verdict === 'correct').length;
  const correct5s = reached.filter((r) => r.verdict === 'correct' && r.ok_5s).length;
  const out = rows.map((r) => (r.verdict === 'not_reached'
    ? { i: r.i, ok: null, ok_5s: false, ms: null, first_key_ms: null, keys: null, digits: r.digits, reached: false }
    : { i: r.i, ok: r.ok, ok_5s: r.ok_5s, ms: r.ms, first_key_ms: r.first_key_ms, keys: r.keys, digits: r.digits }));
  return { score: { correct, correct_5s: correct5s, n: items.length, stopped: !!stop.stopped }, rows: out };
}

// The endings that are the child's own: a reading ended this way is never a words-per-minute.
const ENDED_BY_CHILD = new Set(['stuck', 'home', 'hidden']);
// the noise floor: a counted read whose numbers cannot be believed — the question is whether SPEECH WAS ALIGNED AT ALL.
//   no_speech              the speech service heard no word, yet the model (given the printed text) credited the passage
//   low_stt_support        the speech service heard a quarter or less of what the count credits (stt_words < 0.25 × correct)
//   no_aligned_words       the alignment of what was heard credits 0 words while the model credits ≥ 90% of the tokens
//   low_story_confidence   the house confidence is under 0.5 while the model credits ≥ 90% (a 220 Hz tone: 0.44 with 60/60)
// Never the confidence alone. The reason rides meta.flags; the row reads quality 'implausible' (EVENTS §11) and, like a row the
// sweeper abandons, record=false with meta.record_lost='implausible' (the month stays open). Null = believed (today's rows).
// Every record read is judged first by the words the speech service heard (silentFloor), however it ended: fewer than
// max(3, 10% of the story's tokens) is not a reading at all — implausible, no_speech when nothing was heard, else
// no_aligned_words; at least that many falls through (real speech that aligns to nothing is unheard, the record kept).
// A silent or noisy room is never a reader of 0.
const IMPLAUSIBLE_CONF = 0.5;
const IMPLAUSIBLE_SHARE = 0.9;
const IMPLAUSIBLE_STT_SUPPORT = 0.25;   // heard words must be at least a quarter of the credited count
const SILENT_FLOOR_MIN = 3;
const SILENT_FLOOR_SHARE = 0.1;
const heardFloor = (m, tokensN) => (Number(m && m.stt_words) || 0) >= Math.max(SILENT_FLOOR_MIN, Math.ceil(SILENT_FLOOR_SHARE * tokensN));
function silentFloor(m, tokensN) {
  if (heardFloor(m, tokensN)) return null;
  return (Number(m && m.stt_words) || 0) === 0 ? 'no_speech' : 'no_aligned_words';
}
function readQuality(m, score, tokensN) {
  if (m && m.stt_words === 0) return 'no_speech';
  const correct = score.correct || 0;
  if (m && m.stt_words > 0 && correct > 0 && m.stt_words < IMPLAUSIBLE_STT_SUPPORT * correct) return 'low_stt_support';
  const credited = tokensN > 0 && correct >= IMPLAUSIBLE_SHARE * tokensN;
  if (!credited) return null;
  if (m && m.align_correct === 0 && m.stt_words > 0) return 'no_aligned_words';
  const conf = m ? m.story_confidence : null;
  if (conf != null && conf < IMPLAUSIBLE_CONF) return 'low_story_confidence';
  return null;
}

async function scoreRead(run, key, ext, ms, { Bank, media, scoreTask }, rules = {}, ctx = {}) {
  let file = null;
  try {
    file = media.tmpFile(ext);
    require('fs').writeFileSync(file, await r2.downloadFromR2(key, { bucket: childVoiceBucket() }));
    // Chrome's MediaRecorder webm has no duration header (ffmpeg reads "Duration: N/A"): the audio is decoded to
    // measure it. The page's own number is kept on the row but only stands in when nothing decodes — it is not the
    // audio (a Try again in the same page load once posted the previous reading's length, and the scorer then cut
    // the reading to it).
    const pageSec = Number(ms) > 0 ? Math.min(READ_SECS + 1, Number(ms) / 1000) : null;
    const probedSec = await media.probeDuration(file);
    const decodedSec = probedSec ? null : await media.decodedDuration(file);
    const durationSec = probedSec || decodedSec || pageSec;
    const source = probedSec ? 'probe' : (decodedSec ? 'decoded' : 'page');
    const audioSec = probedSec || decodedSec;
    const mismatch = !!(audioSec && pageSec && Math.abs(audioSec - pageSec) > 2);
    let blobBytes = null;
    try { blobBytes = require('fs').statSync(file).size; } catch (_) { /* unreadable: null */ }
    const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
    logEvent('web_quiz.ch_read_len', { run: ctx.runId || null, page_ms: Number(ms) > 0 ? Number(ms) : null, probe_s: r1(probedSec), decoded_s: r1(decodedSec), blob_bytes: blobBytes, source, mismatch });
    if (mismatch) logToFile('⚠️ web quiz challenge: the page\'s reading length is not the audio\'s', { run: ctx.runId || null, page_s: r1(pageSec), audio_s: r1(audioSec), source });
    const spec = withPassage(Bank.getTaskSpec({ grade: Number(run.form), set: 'A', task: run.task }), run.passage);
    // The comprehension questions are not part of the Challenge: the kid only reads.
    // Under the record rule the scorer's clock starts at the child's first word (EGRA's timer), not at the recording.
    const m = await scoreTask({ task: run.task, spec: { ...spec, questions: [] }, media: { file, durationSec, beginAtS: rules.record ? null : 0 }, lang: run.lang, grade: Number(run.form) });
    if (!m || m.ok === false) return { failed: true, reason: (m && m.reason) || 'internal_error', meta: { calls: m && m.calls ? m.calls.length : 0 } };
    const t = m.timed || {};
    const stopped = !!m.stopped_by_rule;
    const score = { correct: t.correct || 0, attempted: t.attempted || 0, stopped, finished_early: (t.time_remaining || 0) > 0, time_left: t.time_remaining || 0 };
    const cost = (m.meta && m.meta.cost_usd) || 0;
    const durationS = Math.round(durationSec * 10) / 10;
    // What the record rule keeps beside the numbers: how the reading ended, the scorer's own clock and doubt.
    const extra = rules.record ? {
      ended: ctx.ended || null, mic_check: ctx.micCheck || null, read_s: Math.round(durationSec), duration_source: source,
      clock: t.clock || null, begin_at_s: t.begin_at_s == null ? null : t.begin_at_s, end_at_s: t.end_at_s == null ? null : t.end_at_s,
      count_flag: m.count_flag || null, story_confidence: m.story_confidence == null ? null : m.story_confidence,
      ...(m.stt_words == null ? {} : { stt_words: m.stt_words }), ...(m.align_correct == null ? {} : { align_correct: m.align_correct }),
      ...(rules.items ? { items: (m.items || []).map((x) => ({ i: x.i, v: x.verdict })) } : {}),
    } : {};
    const tokensN = (spec.story && spec.story.tokens && spec.story.tokens.length) || 0;
    // numbers that cannot be believed are not a reading: zeroed, wcpm null, the raw counts kept, no items; record as served
    const implausibleRow = (doubt, rate) => {
      const { items, ...rest } = extra;
      return { score: { correct: 0, attempted: 0, stopped: false, finished_early: false, time_left: 0 }, wcpm: null, ended: ctx.ended || null, implausible: doubt,
        meta: { cost_usd: cost, seconds: m.meta && m.meta.seconds, duration_s: durationS, flags: [...(m.flags || []), doubt], ...rest, quality: 'implausible', raw: { correct: score.correct, attempted: score.attempted, wcpm: rate } } };
    };
    // The floor on the words heard runs first on every record read, however it ended, stopped or not, whatever the marker
    // credited: fewer words than the floor, none of them aligned to the story, is not a reading. A few words that DO align
    // are a weak reader's own (the bottom of the distribution): they, and enough words heard, fall through to today's paths.
    if (rules.record && !(Number(m && m.align_correct) > 0)) {
      const floor = silentFloor(m, tokensN);
      if (floor) return implausibleRow(floor, stopped ? 0 : wcpm(score.correct, score.time_left));
    }
    // Not one word of the story was heard: that is not a reading of 0 words — no score, no ✓, no growth baseline,
    // nothing in the class results; the child is asked to try again.
    if (!stopped && score.attempted === 0) return { failed: true, reason: 'unheard', meta: { cost_usd: cost, duration_s: durationS, ...extra } };
    // A reading the child ended before the minute is not a words-per-minute: incomplete (the words read are
    // kept), or abandoned when it barely began. The child's own ending ("too hard", Home, leaving) decides first —
    // a scorer can claim a finished story on audio that has no reading in it (seen: 60 of 60 "correct" on a
    // 21-s tone); otherwise the audio's own length, with the story unfinished, is the evidence.
    const childEnded = ENDED_BY_CHILD.has(ctx.ended);
    if (rules.record && !stopped && (childEnded || (!score.finished_early && durationSec < READ_SECS - 5))) {
      const reason = durationSec < 15 ? 'abandoned' : 'incomplete';
      return { failed: true, reason, words: score.correct, meta: { cost_usd: cost, seconds: m.meta && m.meta.seconds, duration_s: durationS, flags: m.flags || [], ...extra, words: score.correct } };
    }
    const rate = stopped ? 0 : wcpm(score.correct, score.time_left);
    // the noise floor
    const doubt = rules.record ? readQuality(m, score, tokensN) : null;
    if (doubt) return implausibleRow(doubt, rate);
    // Speech that aligns to nothing (enough words heard, not one of them the passage's) is not a reading of this text, whatever
    // the marker credited: unheard, the record kept. A first-line stop keeps its 0 (the discontinue is the child's own result).
    if (rules.record && !stopped && m.align_correct === 0 && heardFloor(m, tokensN)) return { failed: true, reason: 'unheard', meta: { cost_usd: cost, duration_s: durationS, ...extra } };
    return { score, wcpm: rate, ended: ctx.ended || null, meta: { cost_usd: cost, seconds: m.meta && m.meta.seconds, duration_s: durationS, flags: m.flags || [], ...extra } };
  } catch (e) {
    return { failed: true, reason: 'internal_error', meta: { error: String(e && e.message || e).slice(0, 120) } };
  } finally {
    if (file) media.cleanup(file);
    await forgetRun(key.slice(0, key.lastIndexOf('/') + 1), key);
  }
}

// ── class round (web_quiz_class_round) ──
// The round's games: the two tap games ("Missing number" only while its own switch is on). A child is done once each
// is stored for their open turn.
const ROUND_GAMES = Object.freeze(['bigger', 'missing']);
async function roundGame(c, rules) {
  try {
    await require('./web-quiz-class-round').gameStored(c.cr, c.sid, c.ex, c.r, { games: rules.missing ? ROUND_GAMES : ['bigger'] });
  } catch (err) {
    logToFile('⚠️ class round: game not recorded on the round', { run: c.r, error: err.message }, 'warn');
  }
}
// A round turn's page: nothing on it marks the counted cut (no practice banner, no mode), and it carries the same
// warm line for after every item.
// round_turn: a round run is no voluntary counted stop (the sampling design's NC4), so its end card prints no sticker line and
// its one button hands the phone back (jg.round.c_handback) via the turn's own /c/<token>/back (round_back), which the
// server answers with the round page the teacher opened; the teacher's report token never reaches the child's page.
function roundPayload(w, payload, token) {
  if (!w.round) return payload;
  const { practice_round: _p, mode: _m, ...rest } = payload;
  const l = clampLanguage(w.lang, ['en', 'ur']);
  const C = require('../../templates/class-round.page').T[l];
  return { ...rest, round_say: C.cNextSay, round_turn: true, round_handback: C.cHandback, round_back: `/c/${encodeURIComponent(token)}/back?lang=${l}` };
}
// ── end class round ──

function runOf(ct) {
  const c = T.verify(ct, 'c');
  if (!c || !c.r || !c.sid || !byId(c.ex)) fail(401, 'bad_token');
  return c;
}

// A child's voice is scored and forgotten: a private prefix (never the quiz-audio keys), deleted after scoring;
// the hourly orphan sweep catches an upload whose result never came (the buckets have no expiry rule). A kept
// reading (web_quiz_challenge_keep_audio) lives under kept/ and leaves only by the purge.
function runPrefix(c) {
  return `child-voice/${r2Env()}/${c.r}/`;
}
function uploadPrefix(c) {
  return `${runPrefix(c)}read-`;
}
// The kept readings: ONE prefix per env, the upload's UTC day in the key (the retention start), then the run.
function keptRoot() {
  return `child-voice/${r2Env()}/kept/`;
}
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
function keptRunPrefix(c, day) {
  return `${keptRoot()}${day}/${c.r}/`;
}
const isKeptKey = (key) => typeof key === 'string' && key.startsWith(keptRoot()) && DAY_RX.test(key.slice(keptRoot().length).split('/')[0]);
// This run's own prefix that `key` sits under (the plain one, or its kept one of any day), else null.
function ownPrefix(c, key) {
  if (typeof key !== 'string') return null;
  if (key.startsWith(runPrefix(c))) return runPrefix(c);
  if (!isKeptKey(key)) return null;
  const day = key.slice(keptRoot().length).split('/')[0];
  return key.startsWith(keptRunPrefix(c, day)) ? keptRunPrefix(c, day) : null;
}
const RUN_PREFIX_RX = /^child-voice\/[^/]+\/(?:[^/]+|kept\/\d{4}-\d{2}-\d{2}\/[^/]+)\/$/;

// The child's voice bucket: CHILD_VOICE_BUCKET, else the quiz-audio bucket (WEB_QUIZ_AUDIO_BUCKET, else the
// default). Never the bare default alone: on staging R2_BUCKET_NAME is production's bucket.
function childVoiceBucket(env = process.env) {
  return String(env.CHILD_VOICE_BUCKET || '').trim() || AudioStore.quizAudioBucket(env);
}

async function forget(key) {
  try {
    if (!(await r2.deleteKey(key, { bucket: childVoiceBucket() }))) logError('web_quiz.ch_voice_not_deleted', { reason: 'delete_failed' });
  } catch (e) {
    logError('web_quiz.ch_voice_not_deleted', { reason: String(e && e.message || e).slice(0, 80) });
  }
}

/**
 * Forget a run's whole private prefix: the key we know, then every key listed under the prefix (a reused upload
 * URL can have put more than one), and once more just after the upload URL has expired — so a PUT made after
 * scoring cannot leave an orphan (there is no lifecycle rule to catch one). Never throws.
 * THE KEEP INVARIANT: nothing under child-voice/<env>/kept/ is ever deleted here (or by the sweep) — only the purge
 * script removes a kept reading. The key's prefix decides, never the switch's value at this moment.
 */
async function forgetRun(prefix, key, { again = true } = {}) {
  if (!RUN_PREFIX_RX.test(String(prefix || '')) || prefix.startsWith(keptRoot())) return;
  if (key) await forget(key);
  try {
    const keys = await r2.listKeys(prefix, { bucket: childVoiceBucket() });
    for (const k of keys || []) if (k !== key && k.startsWith(prefix)) await forget(k);
  } catch (e) {
    logError('web_quiz.ch_voice_list_failed', { reason: String(e && e.message || e).slice(0, 80) });
  }
  if (again) {
    const t = setTimeout(() => { forgetRun(prefix, null, { again: false }).catch(() => {}); }, (PUT_TTL_S + 1) * 1000);
    if (t && typeof t.unref === 'function') t.unref();
  }
}

/**
 * The orphan sweep: a recording whose result call never came (the tab closed between the PUT and the result) is
 * deleted by nobody else. Every key under this env's private prefix older than `olderThanMs` (its name carries
 * the upload's ms timestamp) is deleted; counts only are logged. Never throws.
 */
const VOICE_KEY_RX = /\/read-(\d{13})\.(webm|ogg|m4a)$/;
const SWEEP_MAX_PER_TICK = 500;
/**
 * The purge's row write: a run whose kept reading was deleted no longer points at it (meta.audio_key null, the day it
 * was purged). Only when the row still names this exact key. Returns true when the row was cleared.
 */
async function forgetAudioKey(runId, key, { now = Date.now() } = {}) {
  const row = await updateRunMeta(runId, (cur) => (cur.meta && cur.meta.audio_key === key
    ? { meta: { ...cur.meta, audio_key: null, audio_purged_on: new Date(now).toISOString().slice(0, 10) } }
    : { meta: cur.meta }));
  return !!(row && row.meta && row.meta.audio_key === null);
}

async function sweepOrphans({ now = Date.now(), olderThanMs = 10 * 60 * 1000, max = SWEEP_MAX_PER_TICK } = {}) {
  const out = { listed: 0, deleted: 0, failed: 0 };
  const prefix = `child-voice/${r2Env()}/`;
  let keys = [];
  try { keys = (await r2.listKeys(prefix, { bucket: childVoiceBucket() })) || []; } catch (e) {
    logError('web_quiz.ch_voice_list_failed', { reason: String(e && e.message || e).slice(0, 80) });
    return out;
  }
  out.listed = keys.length;
  for (const k of keys) {
    if (out.deleted + out.failed >= max) break;   // the rest next tick: a tick is bounded
    const m = VOICE_KEY_RX.exec(String(k || ''));
    // a kept reading is not an orphan: it leaves only by the purge
    if (!m || !k.startsWith(prefix) || k.startsWith(keptRoot()) || now - Number(m[1]) <= olderThanMs) continue;
    try {
      if (await r2.deleteKey(k, { bucket: childVoiceBucket() })) out.deleted += 1; else out.failed += 1;
    } catch (_) { out.failed += 1; }
  }
  logEvent('web_quiz.ch_voice_swept', out);
  return out;
}

async function presignUpload({ ct, type, size, audio_consent } = {}, { device = null } = {}) {
  if (await PracticeCh().runOf(ct)) fail(403, 'practice');   // a preview never records a voice
  const c = runOf(ct);
  if (c.ex !== 'read') fail(400, 'no_audio');
  const base = String(type || '').split(';')[0].trim().toLowerCase();
  const ext = AUDIO_TYPES[base];
  if (!ext) fail(400, 'wrong_type');
  const n = Number(size);
  if (!(n > 0) || n > MAX_BYTES) fail(413, 'too_large');
  // One recording per run: a run already scoring or done (here, or stored by another process) gets no new URL.
  const mem = RUNS.get(c.r);
  if (!(await uploadable(c, mem))) fail(409, 'already_done');
  if (!(await Budget.readOpen())) fail(429, 'enough_for_today');
  const ts = Date.now();
  const consent = await TrailPage.consentFor({ audio_consent });
  // the mic notice: the upload already carries 'notice_shown', so this child's notice is marked seen on this phone now,
  // not only when the result comes back (a lost connection after the upload would otherwise show it again elsewhere)
  if (consent === 'notice_shown') await TrailPage.noteNoticeShown(c.sid, device);
  const key = (await keepAudioOn()) && TrailPage.allowsKeep(consent)
    ? `${keptRunPrefix(c, new Date(ts).toISOString().slice(0, 10))}read-${ts}.${ext}`
    : `${uploadPrefix(c)}${ts}.${ext}`;
  const putUrl = await r2.getPresignedUploadUrl(key, base, PUT_TTL_S, { bucket: childVoiceBucket(), signContentType: true });
  return { put_url: putUrl, key, content_type: base, max_bytes: MAX_BYTES, expires_in: PUT_TTL_S };
}

// A live run's row, written at its mint and not yet given its result (no 'live' status: the CHECK has none).
const isLiveRow = (row) => !!row && row.status === 'scoring' && !!row.meta && row.meta.phase === 'live';

// A run takes its one recording while it is open, or live (minted, not yet scored) — here or in the table.
async function uploadable(c, mem) {
  if (mem && mem.status) return mem.status === 'open' || mem.status === 'live';
  const row = await storedRun(c.r);
  return !row || isLiveRow(row) || isServedRow(row);
}

/** The run's state from what this process knows, else from the table. */
// A check the scorer judged not a reading (implausible: scored, record lost): no sticker on the card, none in the Book.
const noiseRun = (row) => row.status === 'scored' && row.record === false && row.mode === 'check';

async function runState(c) {
  const mem = RUNS.get(c.r);
  if (mem && mem.result) return mem.result;
  if (mem && mem.status === 'scoring') return { pending: true };
  const row = await storedRun(c.r);
  if (!row || isLiveRow(row) || isServedRow(row)) return null;
  if (row.status === 'scoring') return { pending: true };
  if (row.status === 'failed') return { failed: true, reason: (row.meta && row.meta.reason) || 'failed' };
  return { ...(row.exercise === 'read' ? { score: row.score, wcpm: row.wcpm } : { score: row.score }), ...(noiseRun(row) ? { sticker: false } : {}) };
}

/**
 * The child's last scored run of this exercise, for "7 more words than last time!" (null the first time). A reading
 * compares only with readings in the same language: the Urdu and English stories are different passages.
 */
async function previousRun(studentId, exercise, lang = null, form = null) {
  // web_quiz_read_feedback on, a read with its text level (form): "last time" is the child's last read at that level, so
  // a harder or easier passage never reads as growth or its loss; none at that level ⇒ the last read of any (one query)
  const level = exercise === 'read' && form != null && (await require('./web-quiz-read-feedback').on()) ? String(form).replace(/\D/g, '') : '';
  let qb = supabase.from('web_quiz_challenge_runs').select(level ? 'id, exercise, status, score, wcpm, created_at, form' : 'id, exercise, status, score, wcpm, created_at')
    .eq('student_id', studentId).eq('exercise', exercise).eq('status', 'scored');
  if (exercise === 'read' && lang) qb = qb.eq('lang', lang);
  const { data, error } = await qb.order('created_at', { ascending: false }).limit(level ? 10 : 1);
  const rows = (!error && data) || [];
  const r = (level && rows.find((x) => String(x.form || '').replace(/\D/g, '') === level)) || rows[0];
  if (!r) return null;
  const s = r.score || {};
  return exercise === 'read' ? { wcpm: r.wcpm, correct: s.correct, at: r.created_at } : { correct: s.correct, n: s.n, at: r.created_at };
}

// The child's readings in the last 24 h, not counting `except` (a live run's own row, made at its mint).
async function readsToday(studentId, except = null) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from('web_quiz_challenge_runs').select('id').eq('student_id', studentId).eq('exercise', 'read').in('status', PLAYED).gte('created_at', since);
  return error ? 0 : (data || []).filter((r) => r.id !== except).length;
}

// The run, from this process or rebuilt from the student (a token minted by another process: a restart, a replica).
async function runFor(c, mem, lang) {
  if (mem && mem.task) return mem;
  const gi = await gradeInfo({ studentId: c.sid });
  const form = formFor(gi.grade);
  if (!form) fail(403, 'not_eligible');
  const l = clampLanguage(lang);
  return { grade: gi.grade, form, lang: l, task: byId(c.ex).task(l), gradeSource: gi.source, test: isTestName(gi.name) };
}

/**
 * A temporary Soniox key for this run's live reading (the page opens the stream with it). Same gates as the upload:
 * the switch, one per run, the child's 10 a day and the day's cap — checked BEFORE anything is spent. Soniox down or
 * refusing ⇒ 502 live_unavailable (logged with its status), no run row: the page reads with the upload path.
 */
async function liveKey({ ct, lang } = {}) {
  if (await PracticeCh().runOf(ct)) fail(403, 'practice');   // a preview never asks for a speech key
  const c = runOf(ct);
  if (c.ex !== 'read') fail(400, 'no_audio');
  if (!(await liveOn())) fail(503, 'live_off');
  const Live = require('./web-quiz-soniox-live');
  if (!Live.configured()) fail(503, 'live_unavailable');
  const mem = RUNS.get(c.r) || {};
  const before = mem.status ? null : await storedRun(c.r);
  if ((mem.status && mem.status !== 'open') || (before && !isServedRow(before))) fail(409, 'already_done');
  if (await readsToday(c.sid) >= READS_PER_DAY || !(await Budget.readOpen())) fail(429, 'enough_for_today');
  const run = await runFor(c, mem, lang);
  RUNS.set(c.r, { ...run, status: 'minting' });
  const k = await Live.mintTempKey(c.r);
  if (!k.ok) {
    RUNS.set(c.r, { ...run, status: 'open' });
    logError('web_quiz.ch_live_key_failed', { runId: c.r, status: k.status, reason: k.reason });
    fail(502, 'live_unavailable');
  }
  RUNS.set(c.r, { ...run, status: 'live' });
  Budget.noteStarted();
  const rules = await rulesOf();
  const prov = rules.record ? await provenance(c.sid, 'read', run.lang, run) : {};
  const stored = (mem.v2 || isServedRow(before)) ? await startServed(c.r, { phase: 'live', ...prov })
    : await insertRun({ id: c.r, student_id: c.sid, exercise: 'read', grade: run.grade, lang: run.lang, status: 'scoring', created_at: nowIso(), meta: { phase: 'live', ...prov } });
  if (stored === 'duplicate') fail(409, 'already_done');
  logEvent('web_quiz.ch_live_key', { grade: run.grade, lang: run.lang, run: c.r });
  return { api_key: k.api_key, expires_at: k.expires_at, ws: Live.WS_URL, model: Live.MODEL, lang: run.lang };
}

// The page's live count, kept only when every number is one a 60-s reading of this passage can produce.
function liveCount(v, passageLen) {
  if (!v || typeof v !== 'object') return null;
  const n = (x) => (Number.isInteger(x) && x >= 0 ? x : null);
  const correct = n(v.correct); const attempted = n(v.attempted); const secs = n(v.secs);
  if (correct == null || attempted == null || secs == null) return null;
  if (correct > attempted || attempted > passageLen || secs > READ_SECS + 1) return null;
  return { correct, attempted, secs, v: 1 };
}

async function submit(body = {}, { waitMs = WAIT_MS, now = Date.now(), device = null } = {}) {
  // a preview's run (web_quiz_practice_play): scored here and forgotten
  { const pc = await PracticeCh().runOf(body.ct); if (pc) return PracticeCh().submit(pc, body); }
  const g1Run = Grade1.challengeOf(body.ct);   // grade-1 form: its run token scores there
  if (g1Run) return Grade1.submit(g1Run, body);
  const c = runOf(body.ct);
  // class round: the claim finishes a run only during this child's open turn (one round run per child per game per
  // term; the token's mode must be the one the server chose); the row's columns were written at the serve
  const claim = c.cr ? await require('./web-quiz-class-round').claimFor(c.cr, c.sid, c.ex, c.r) : null;
  if (c.cr && (!claim || claim.mode !== c.cm)) fail(401, 'bad_token');
  const rules = await rulesOf();
  let CT;
  try { CT = childTest({ scorer: c.ex === 'read' }); } catch (e) {
    // Not scorable here: an uploaded recording is still forgotten (only this run's own prefix).
    if (c.ex === 'read' && typeof body.key === 'string') await forgetRun(ownPrefix(c, body.key) || runPrefix(c), ownPrefix(c, body.key) ? body.key : null);
    throw e;
  }
  const { Bank } = CT;
  const mem = RUNS.get(c.r) || {};
  // A live run (its row made at the mint) takes its one result; any other stored or finished run is done.
  const storedRow = mem.status ? null : await storedRun(c.r);
  const isLive = mem.status === 'live' || (c.ex === 'read' && isLiveRow(storedRow));
  if ((mem.status && mem.status !== 'open' && !isLive) || (storedRow && !isLive && !isServedRow(storedRow))) fail(409, 'already_done');
  let run = await runFor(c, mem, body.lang);
  const base = { id: c.r, student_id: c.sid, exercise: c.ex, grade: run.grade, lang: run.lang, created_at: nowIso() };
  // challenge v2: a run served under _v2 already has its row: it is finished in place, never inserted a second time
  const sv = mem.v2 || (isServedRow(storedRow) ? await servedInfo(c.r) : null);
  if (sv && sv.form && !mem.task) run = { ...run, form: sv.form };   // M8: the served row's (fixed-grade) form
  if (sv && !run.v2 && sv.mode != null) run = { ...run, mode: sv.mode, record: sv.record };   // the served row's mode, when the memory is gone
  const writeRun = sv ? (row) => finishServed(c.r, row) : insertRun;
  const helpedV2 = sv ? { helped: helpedCol(helpedOf(body.helped)) } : {};

  if (c.ex === 'missing') {
    if (!rules.missing) fail(503, 'missing_off');
    const spec = Bank.getTaskSpec({ grade: Number(run.form), set: 'A', task: 'ma.missing' });
    const a1 = !!(sv && sv.anchor_block === 'A1');
    const items = a1 ? Bank.anchorBlock('A1') : spec.items;
    const { score, rows } = scoreMissing(items, body.answers, { stopAfter: a1 ? 0 : ((spec.stop && spec.stop.n) || 4) });
    if (a1) score.reached = reachedCount(items, body.answers);
    const result = { score };
    RUNS.set(c.r, { ...run, status: 'done', result });
    const reached = rows.filter((r) => r.reached !== false);
    const typed = reached.reduce((a, r) => a + (r.ms || 0), 0);
    const elapsedMs = Math.max(0, now - (Number(c.exp) - T.CHALLENGE_TTL_S) * 1000);
    // clock 'row_paint': each item's ms and first_key_ms run from the moment its row is painted (the page's rule)
    let meta = { ms: Number(body.ms) || null, ...(await provenance(c.sid, 'missing', null, run)), helped: helpedOf(body.helped), clock: 'row_paint', elapsed_s: Math.round(elapsedMs / 100) / 10, too_fast: elapsedMs < typed };
    if (rules.items) meta = { ...meta, items: rows, ...itemFlags(reached, { fastMs: missingFastMs, stopped: score.stopped }) };
    // the speed floor: a record warm-up with every item right and a median item time under the floor is a scripted 10/10
    if (rules.items && run.v2 && run.mode === 'check' && run.record === true && run.anchor_block && rapidPerfect(rows, meta.elapsed_s)) meta = { ...meta, quality: 'rapid_perfect' };
    if (sv && sv.tryout) meta = { ...meta, tryout: tryoutAnswer(sv.tryout, body.tryout, Bank) };
    const stored = await writeRun({ ...base, status: 'scored', score, scored_at: nowIso(), meta, ...helpedV2 });
    if (stored === 'duplicate') fail(409, 'already_done');
    await measureOutcome(c.r);
    await renewBindings(c.sid);
    await lightIfFirst(c.r);
    if (c.cr) await roundGame(c, rules);
    logEvent('web_quiz.ch_done', { step: 'missing', count: score.correct, count_5s: score.correct_5s, n: score.n, stopped: score.stopped, run: c.r });
    return result;
  }

  if (c.ex === 'bigger') {
    const spec = Bank.getTaskSpec({ grade: Number(run.form), set: 'A', task: 'ma.discrimination' });
    const items = (sv && servedPairs(sv.item_set_id, Bank)) || spec.items;
    const score = scoreBigger(items, body.taps, { stopAfter: (spec.stop && spec.stop.n) || 4 });
    const result = { score, previous: rules.record ? null : await previousRun(c.sid, 'bigger') };
    RUNS.set(c.r, { ...run, status: 'done', result });
    let meta = { ms: Number(body.ms) || null };
    if (rules.record) {
      // the server's clock: elapsed since the token's mint; a submit faster than its own taps is marked, never refused
      const rows = biggerItems(items, body.taps, servePairs(items, run.form, true));
      const tapped = rows.reduce((a, r) => a + (r.ms || 0), 0);
      const elapsedMs = Math.max(0, now - (Number(c.exp) - T.CHALLENGE_TTL_S) * 1000);
      meta = { ...meta, ...(await provenance(c.sid, 'bigger', null, run)), ...(rules.trail ? { helped: helpedOf(body.helped) } : {}), elapsed_s: Math.round(elapsedMs / 100) / 10, too_fast: elapsedMs < tapped || elapsedMs < rows.length * 400 };
      if (rules.items) meta = { ...meta, items: rows, ...itemFlags(rows, { fastMs: BIGGER_FAST_MS, stopped: score.stopped }) };
    }
    const stored = await writeRun({ ...base, status: 'scored', score, scored_at: nowIso(), meta, ...helpedV2 });
    if (stored === 'duplicate') fail(409, 'already_done');
    await measureOutcome(c.r);
    await renewBindings(c.sid);
    await lightIfFirst(c.r);
    if (c.cr) await roundGame(c, rules);
    logEvent('web_quiz.ch_done', { step: 'bigger', count: score.correct, n: score.n, stopped: score.stopped, run: c.r });
    return result;
  }

  // read
  const key = typeof body.key === 'string' ? body.key : '';
  if (!key) fail(400, 'no_audio');
  // A refused upload is deleted too: a presigned PUT cannot cap what was put there. Only this run's own prefix.
  // the run's plain prefix, or its kept one (the switch may have flipped between the upload and this call)
  const own = ownPrefix(c, key);
  const refuse = async (status, error) => { await forgetRun(own || runPrefix(c), own ? key : null); fail(status, error); };
  if (!own || !/^read-\d{13}\.(webm|ogg|m4a)$/.test(key.slice(own.length))) await refuse(403, 'not_your_upload');
  let head;
  try { head = await r2.headObject(key, { bucket: childVoiceBucket() }); } catch (_) { fail(502, 'storage_unavailable'); }
  if (!head || !head.exists) fail(404, 'no_upload');
  if (Number(head.sizeBytes) > MAX_BYTES) await refuse(413, 'too_large');
  // A live run was counted (both caps) at its mint; its own row is not "another reading today".
  if (!isLive && (await readsToday(c.sid) >= READS_PER_DAY || !(await Budget.readOpen()))) await refuse(429, 'enough_for_today');
  if (!isLive) Budget.noteStarted();

  RUNS.set(c.r, { ...run, status: 'scoring' });
  const previous = rules.record ? null : await previousRun(c.sid, 'read', run.lang, run.form);
  const readRun = sv && sv.passage_id ? { ...run, passage: passageFor(sv.passage_id, Bank) } : run;
  const story = (withPassage(Bank.getTaskSpec({ grade: Number(run.form), set: 'A', task: run.task }), readRun.passage).story || {});
  const live = isLive ? liveCount(body.live, (story.tokens && story.tokens.length) || String(story.text || '').split(/\s+/).filter(Boolean).length) : null;
  // the record rule's stamps (a live run was stamped at its mint; stamped again here from the same facts) and how
  // the page says the reading ended (its own words; the audio's length is what decides)
  const prov = rules.record ? await provenance(c.sid, 'read', run.lang, run, { except: c.r }) : {};
  const word = (v) => (typeof v === 'string' && /^[a-z_]{1,16}$/.test(v) ? v : null);
  const guardIn = rules.record ? { ended: word(body.ended), mic_check: word(body.mic_check), read_s: Number.isFinite(Number(body.read_s)) ? Math.max(0, Math.round(Number(body.read_s))) : null, ...(rules.trail ? { helped: helpedOf(body.helped) } : {}) } : {};
  // a kept reading: where it is (the key only — the bucket is the deployment's, nothing about the child)
  // The key decides, never the switch at this moment: a kept key stays whatever the switch now says; a plain key with
  // the switch now on is still deleted, and the row says so (calibration then knows why there is no audio).
  const audio = isKeptKey(key) ? { audio_key: key } : ((await keepAudioOn()) ? { audio_kept: false } : {});
  // live reading v3 (off ⇒ {}): the UI version and how the page says it ended, kept through the scorer's final write too
  const lr3Meta = await LiveReadV3().metaFor(body, { record: !!rules.record });
  const metaIn = { ms: Number(body.ms) || null, ...(live ? { live } : {}), ...prov, ...guardIn, ...audio, ...lr3Meta };
  // the mic notice (web_quiz_challenge_audio_consent; null with it off): on the row, one event per run; a run that
  // showed it marks this child's notice seen on this phone (x-wq-device), so it is not shown again
  const consent = await TrailPage.consentFor(body);
  const consentCols = TrailPage.columns(consent);
  TrailPage.noteConsent(c.r, consent);
  if (consent === 'notice_shown') await TrailPage.noteNoticeShown(c.sid, device);
  if (isLive) {
    // the child may already be answering the questions (the live result shows before this call): keep their answers
    await updateRunMeta(c.r, (cur) => ({ status: 'scoring', meta: { ...servedMeta(cur.meta), ...metaIn, ...(cur.meta && cur.meta.comp ? { comp: cur.meta.comp } : {}) } }));
  }
  else {
    const stored = sv ? await startServed(c.r, metaIn) : await insertRun({ ...base, status: 'scoring', meta: metaIn });
    if (stored === 'duplicate') await refuse(409, 'already_done');
  }
  const ext = key.split('.').pop();
  const promise = scoreRead(readRun, key, ext, body.ms, CT, rules, { ended: guardIn.ended, micCheck: guardIn.mic_check, readS: guardIn.read_s, runId: c.r }).then(async (r) => {
    const result = r.failed
      ? { failed: true, reason: r.reason, ...(r.words != null ? { words: r.words } : {}) }
      : { score: r.score, wcpm: r.wcpm, previous, ...(rules.record ? { ended: r.ended || null } : {}), ...(r.implausible ? { sticker: false } : {}) };
    const before = RUNS.get(c.r) || {};
    RUNS.set(c.r, { ...run, ...(before.comp ? { comp: before.comp } : {}), status: 'done', result });
    // the record rule's stamps ride the final write (which replaces meta); an abandoned reading is an exposure only
    const keep = !rules.record ? {} : (r.reason === 'abandoned' ? (({ attempt_no, counted, ...rest }) => rest)(prov) : prov);
    const stamp = rules.record ? { ms: metaIn.ms, ...keep, ...(rules.trail ? { helped: guardIn.helped } : {}) } : {};
    // answers to the questions may have been given while this reading was scored: keep them (meta.comp)
    await updateRunMeta(c.r, (cur) => {
      const comp = cur.meta && cur.meta.comp ? { comp: cur.meta.comp } : {};
      return r.failed
        ? { status: 'failed', ...(isV2Meta(cur.meta) ? { helped: helpedCol(helpedOf(body.helped)) } : {}), meta: { ...servedMeta(cur.meta), ...r.meta, ...stamp, ...audio, ...(live ? { live } : {}), ...lr3Meta, ...comp, reason: r.reason }, scored_at: nowIso() }
        : { status: 'scored', ...(isV2Meta(cur.meta) ? { helped: helpedCol(helpedOf(body.helped)) } : {}), score: r.score, wcpm: r.wcpm,
          // an implausible row never became a reading: record cleared (the sweeper's `abandoned` shape), record_lost says why, the month stays open
          ...(r.implausible && isV2Meta(cur.meta) ? { record: false } : {}),
          meta: { ...servedMeta(cur.meta), ...r.meta, ...stamp, ...(r.implausible && isV2Meta(cur.meta) ? { record_lost: 'implausible', counted: false } : {}), ...audio, ...(live ? { live } : {}), ...lr3Meta, ...comp }, scored_at: nowIso() };
    }, { force: true });
    await measureOutcome(c.r);
    await renewBindings(c.sid);
    await lightIfFirst(c.r);
    // after the row is final, on its own: a missing column can never cost the scored row
    await TrailPage.writeConsent(c.r, consentCols);
    if (r.failed) logError('web_quiz.ch_read_failed', { runId: c.r, reason: r.reason, run: c.r });
    else logEvent('web_quiz.ch_done', { step: 'read', count: r.score.correct, wcpm: r.wcpm, stopped: r.score.stopped, costUsd: r.meta.cost_usd, run: c.r, ...(rules.record ? { ended: r.ended || null } : {}) });
    return result;
  });
  RUNS.get(c.r).promise = promise;
  let timer;
  const later = new Promise((res) => { timer = setTimeout(() => res({ pending: true }), Math.max(0, waitMs)); });
  const out = await Promise.race([promise, later]);
  clearTimeout(timer);
  return out;
}

// ── questions after Read aloud ──────────────────────────────────────────────────────────────────────

const scriptOf = (lang) => (lang === 'ur' ? (x) => /[\u0600-\u06FF]/.test(x) : (x) => !/[\u0600-\u06FF]/.test(x));

/**
 * The bank questions a person has read as TAP questions (options built below, checked one by one in the story's
 * language), each with the listed wrong answers it must NOT offer: exactly one option is right, no wrong option is
 * something the story also supports, and no two wrong options mean the same. Anything not listed — a new bank
 * version, the listening questions — is never offered until it has been read the same way. Left out:
 *   ur.story.q3 «بلال نے کیا حرکت کرتے دیکھا؟»  the water and the wind also move in the story
 *   ur.story.q5                                  fewer than two fair wrong answers
 *   ur.story.q6 «بلال خوش کیوں تھا؟»             the story never says why: the right answer is only an inference
 */
const TAP_REVIEWED = new Map([
  ['en.story.q1', { skip: ['to plant trees'] }],          // "Today his class was planting trees." supports it
  ['en.story.q2', { skip: [] }],
  ['en.story.q3', { skip: [] }],
  ['en.story.q4', { skip: [] }],
  ['en.story.q5', { skip: [] }],
  ['en.story.q6', { skip: [] }],
  ['ur.story.q1', { skip: ['والدہ کے ساتھ'] }],           // the same as «امی کے ساتھ» (with mother)
  ['ur.story.q2', { skip: [] }],
  ['ur.story.q4', { skip: [] }],
  // listening (Phase 3 (2)): left out en q5 (its first accepted answer is circular), ur q4 («صاف کلاس» is the rubric's
  // own near-miss, «عائشہ کی» arguable), ur q5 (circular, too few fair wrong answers)
  ['en.listening.q1', { skip: [] }],
  ['en.listening.q2', { skip: [] }],
  ['en.listening.q3', { skip: [] }],
  ['en.listening.q4', { skip: [] }],
  ['en.listening.q6', { skip: [] }],
  ['ur.listening.q1', { skip: [] }],
  ['ur.listening.q2', { skip: ['کلاس'] }],                // the whole class cleaned, Ayesha included
  ['ur.listening.q3', { skip: [] }],
  ['ur.listening.q6', { skip: [] }],
]);

/** One bank question as a tap question: its first accept + two of its rejects, in the passage's script; null if short. */
function tapOptions(q, lang, runId) {
  // the whitelist governs the v3 questions; a v4 passage's own question carries tap_ok
  const reviewed = q && (TAP_REVIEWED.get(q.id) || (q.tap_ok === true ? TAP_OK : null));
  if (!reviewed) return null;
  const same = scriptOf(lang);
  const right = (q.accept || []).find((a) => same(a) && !NO_TEST_WORDS.test(a));
  // no two options may say the same thing: a wrong one inside another option ("books" / "his books") is skipped
  const norm = (x) => String(x).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  const clash = (a, b) => { const x = norm(a); const y = norm(b); return !x || !y || x.includes(y) || y.includes(x); };
  // A wrong answer the rubric itself discusses is a near-miss ("Water alone is wrong: water went in after the plant"):
  // fine to mark wrong when said, unfair as a tap option the story supports. A "don't know" is not an answer at all.
  const rubric = norm(q.rubric || '');
  const nearMiss = (a) => { const x = norm(a); return !!x && (` ${rubric} `).includes(` ${x} `); };
  const wrong = [];
  for (const a of q.reject || []) {
    if (wrong.length >= 2) break;
    if (!same(a) || NO_TEST_WORDS.test(a) || NOT_AN_ANSWER.test(a) || nearMiss(a) || reviewed.skip.includes(a)) continue;
    if (![right, ...wrong].some((b) => clash(a, b))) wrong.push(a);
  }
  if (!right || wrong.length < 2) return null;
  // the order is fixed per run and question (a refresh does not reshuffle), never the bank's order
  const seed = crypto.createHash('sha256').update(`${runId}|${q.id}`).digest();
  const opts = [right, ...wrong];
  for (let i = opts.length - 1; i > 0; i -= 1) { const j = seed[i] % (i + 1); [opts[i], opts[j]] = [opts[j], opts[i]]; }
  return { options: opts, right };
}

// The reading this run belongs to: its form, language and passage (from this process, else the table).
async function readingOf(c, lang) {
  if (c.ex !== 'read' && c.ex !== 'listen') fail(400, 'bad_request');
  if (c.ex === 'read' && !(await questionsOn())) fail(503, 'questions_off');
  if (c.ex === 'listen' && !(await listenOn())) fail(503, 'listen_off');
  return readingSpecOf(c, lang);
}

// The run, its row and its story (a v2 run's own passage), with no switch asked.
async function readingSpecOf(c, lang) {
  const mem = RUNS.get(c.r) || {};
  const row = await storedRun(c.r);
  const run = await runFor(c, mem.task ? mem : {}, (row && row.lang) || mem.lang || lang);
  const { Bank } = childTest();
  const spec = Bank.getTaskSpec({ grade: Number(run.form), set: 'A', task: run.task });
  // challenge v2: a run with a passage_id takes its story and questions from that passage (asked by stop line)
  const sv = mem.v2 || (row && (isServedRow(row) || (await rulesOf()).v2) ? await servedInfo(c.r) : null);
  if (sv && sv.passage_id) return { run, row, mem, spec: { ...withPassage(spec, passageFor(sv.passage_id, Bank)), by_line: true } };
  return { run, row, mem, spec };
}

// a read run whose result settled as not a reading: nothing heard (failed 'unheard') or not one word read
const notAReading = (row) => !!row && ((row.status === 'failed' && !!row.meta && row.meta.reason === 'unheard')
  || (row.status === 'scored' && !!row.score && Number(row.score.attempted != null ? row.score.attempted : row.score.correct) === 0));

/**
 * A reading's story length in words as the reading page counts them (its story.tokens; the same count the reached
 * questions use), by the run's token: 0 for any other game or when it cannot be known. Never throws.
 */
async function readLength(ct) {
  try {
    const c = runOf(ct);
    if (c.ex !== 'read') return 0;
    const t = ((await readingSpecOf(c, null)).spec.story || {}).tokens;
    return Array.isArray(t) ? t.length : 0;
  } catch (_) { return 0; }
}

/**
 * "Show me the words" after a practice listen's questions: the story's timing file (web_quiz_readalong), by the run
 * token. Only a practice listen run gets it — a counted listen never shows its text (it is heard, never shown).
 * "Hear it again" on a read that certified nothing: a read run gets its passage's timings only once its result has
 * settled as not a reading — never before the read (400), never while it is scored (409), never after a heard read
 * (403). The run is over and recorded; a re-read is the existing "Try again", so hearing it cannot lift a counted score.
 */
async function listenWords({ ct, lang } = {}) {
  { const pc = await PracticeCh().runOf(ct); if (pc) return PracticeCh().words(pc, { lang }); }
  const c = runOf(ct);
  // a read run only with its own switch on (web_quiz_zero_read_listen); off, today's answer
  if (c.ex !== 'listen' && !(c.ex === 'read' && (await zeroListenOn()))) fail(400, 'bad_request');
  const { run, row, mem, spec } = await readingOf(c, lang);
  const sv = mem.v2 || (await servedInfo(c.r)) || {};
  const mode = sv.mode || (row && row.mode) || mem.mode;
  if (c.ex === 'read') {
    if (!notAReading(row)) {
      if (mem.status === 'scoring' || (row && row.status === 'scoring')) fail(409, 'pending');
      if (!row || isServedRow(row) || row.status === 'abandoned') fail(400, 'bad_request');
      fail(403, 'heard');
    }
  } else if (mode !== 'practice') fail(403, 'not_practice');
  const st = spec.story || {};
  const t = sv.passage_id ? await require('./web-quiz-readalong').readAlong({ settingOn }).forPassage({ lang: run.lang, passageId: sv.passage_id, text: st.text }) : null;
  if (!t) fail(404, 'no_words');
  return { readalong: t };
}

/**
 * A grown-up's preview of a practice story (#listen/<pid> on the practice home): the stored clip + its word timings,
 * for a hub token on the phone it is bound to (as entryOf: a forwarded hub link opens nothing on another phone);
 * no run, no event keyed by a child. Only a story Story Time could show (released, reviewed, the practice pool, not
 * withdrawn) — never a counted passage.
 */
async function listenPreview(hub, pid, { lang, device } = {}) {
  if (!T.verify(hub, 'h')) fail(401, 'bad_token');
  if (!(await require('./web-quiz-hub-device').deviceTrusted(hub, device)).ok) fail(403, 'other_device');
  const m = /^(en|ur)\.(read|listen)\.([1-5])\.[a-z0-9_-]+$/i.exec(String(pid || ''));
  if (!m) fail(400, 'bad_request');
  if (!(await settingOn(require('./web-quiz-readalong').SWITCH_KEY))) fail(404, 'no_words');
  const { Bank } = childTest();
  const own = typeof Bank.getPassage === 'function' ? Bank.getPassage(pid) : null;
  const s = own ? Draw().storyPassageFor({ rows: await Draw().registryPassages(), pid, kind: m[2], lang: m[1], bands: new Set([1, 2, 3, 4, 5]), reserve: own.reserve === true, now: new Date() }) : null;
  if (!s) fail(404, 'no_words');
  const t = await require('./web-quiz-readalong').readAlong({ settingOn }).forPassage({ lang: m[1], passageId: s.passage_id, text: own.text });
  if (!t) fail(404, 'no_words');
  return { readalong: t };
}

/**
 * The questions the child reached (EGRA: only about text read; a stopped reader gets none), at most 3, in bank order.
 * Words attempted: the checked score, else the live count stored with the result, else the page's own count (bounded).
 */
async function questions({ ct, attempted, lang } = {}) {
  { const pc = await PracticeCh().runOf(ct); if (pc) return PracticeCh().questions(pc, { lang }); }
  const c = runOf(ct);
  const { run, row, mem, spec } = await readingOf(c, lang);
  if (c.ex === 'listen') return listenQuestions(c, run, row, spec);
  const out = [];
  for (const { q, t } of readQuestionList(spec, row, mem, attempted, run.lang, c.r)) {
    const k = q.id.split('.').pop();
    out.push({ id: q.id, prompt: q.prompt, options: t.options, clip: { url: await clipUrl(clipKey('read', k, run.lang, q.prompt), q.prompt, run.lang) } });
  }
  logEvent('web_quiz.ch_qs', { lang: run.lang, n: out.length });
  return { questions: out };
}

/** The reading's questions the child reached, with their tap options ({ q, t }), at most 3: what questions() serves. */
function readQuestionList(spec, row, mem, attempted, lang, runId) {
  const n = ((spec.story || {}).tokens || []).length;
  const checked = (row && row.status === 'scored' && row.score) || (mem && mem.result && mem.result.score) || null;
  if (checked && checked.stopped && !spec.by_line) return [];
  const live = row && row.meta && row.meta.live;
  let words = checked ? checked.attempted : (live ? live.attempted : (Number.isInteger(Number(attempted)) ? Number(attempted) : null));
  if (words == null) return [];
  words = Math.max(0, Math.min(n, words));
  const { reachedQuestions } = require('../child-test/scoring/reach');
  // challenge v2 passages: a stopped reader gets the questions their stop line reached, all in needs_line order
  const reached = spec.by_line && checked && checked.stopped ? stopLineQuestions(spec, words, row)
    : reachedQuestions(spec, { story: { words_attempted: words, finished_early: (checked && checked.finished_early) || words >= n } });
  const out = [];
  for (const q of spec.by_line ? byNeedsLine(spec.questions) : spec.questions || []) {
    if (out.length >= QA_MAX || !reached.has(q.id)) continue;
    const t = tapOptions(q, lang, runId);
    if (!t) continue;
    out.push({ q, t });
  }
  return out;
}

/**
 * The rung job's settle rule (web-quiz-rungs.js): how many of a scored reading's questions the child can still answer
 * (the questions reached by its checked score, less those answered in meta.comp). 0 when the row is not a scored
 * reading, the questions are off, or anything cannot be read. Called only with the rung switch on. Never throws.
 */
async function readQuestionsLeft(row) {
  try {
    if (!row || row.exercise !== 'read' || row.status !== 'scored' || !(await questionsOn())) return 0;
    const lang = clampLanguage(row.lang);
    const grade = /^G[1-5]$/.test(String(row.form || '')) ? Number(row.form.slice(1)) : formFor(Number(row.grade));
    if (!grade) return 0;
    const { Bank } = childTest();
    let spec = Bank.getTaskSpec({ grade, set: 'A', task: byId('read').task(lang) });
    if (row.passage_id) spec = { ...withPassage(spec, passageFor(row.passage_id, Bank)), by_line: true };
    const asked = Object.keys((row.meta && row.meta.comp && row.meta.comp.a) || {}).length;
    return Math.max(0, readQuestionList(spec, row, null, null, lang, row.id).length - asked);
  } catch (_) {
    return 0;
  }
}

/** Listening: the child heard the whole story, so no reach rule; the run is written as scoring when they are served. */
async function listenQuestions(c, run, row, spec) {
  const out = [];
  const optAudio = await optionAudioOn();
  for (const q of spec.questions || []) {
    if (out.length >= QA_MAX) break;
    const t = tapOptions(q, run.lang, c.r);
    if (!t) continue;
    const k = q.id.split('.').pop();
    const item = { id: q.id, prompt: q.prompt, options: t.options, clip: { url: await clipUrl(clipKey('listen', k, run.lang, q.prompt), q.prompt, run.lang) } };
    // each option in the same voice and pipeline as the question, in the option's own (per-run) order; a clip not
    // recorded yet is null (and asked for), so that option is shown without its play button
    if (optAudio) item.option_clips = await Promise.all(t.options.map(async (o) => ({ url: await clipUrl(clipKey('listen', `${k}-opt`, run.lang, o), o, run.lang) })));
    out.push(item);
  }
  if ((!row || isServedRow(row)) && out.length) {
    RUNS.set(c.r, { ...run, ...(RUNS.get(c.r) && RUNS.get(c.r).v2 ? { v2: RUNS.get(c.r).v2 } : {}), status: 'listening' });
    if (row) await startServed(c.r, { phase: 'listen', n: out.length });
    else await insertRun({ id: c.r, student_id: c.sid, exercise: 'listen', grade: run.grade, lang: run.lang, status: 'scoring', created_at: nowIso(), meta: { phase: 'listen', n: out.length } });
  }
  logEvent('web_quiz.ch_qs', { lang: run.lang, n: out.length, step: 'listen' });
  return { questions: out };
}

/** One tap: { ok, answer } (the right option's text). A question counts once; at most 3 per reading. */
async function answer({ ct, q, pick, lang, helped } = {}) {
  { const pc = await PracticeCh().runOf(ct); if (pc) return PracticeCh().answer(pc, { q, pick, lang }); }
  const c = runOf(ct);
  const { run, row, mem, spec } = await readingOf(c, lang);
  const bq = (spec.questions || []).find((x) => x.id === q);
  const p = Number(pick);
  if (!bq || !Number.isInteger(p) || p < 0 || p > 2) fail(400, 'bad_request');
  const t = tapOptions(bq, run.lang, c.r);
  if (!t) fail(400, 'bad_request');
  // The answers so far come from the stored row (and this process): the next tap may be served by another replica,
  // or by the new process after a deploy, which must count on from there, never from zero. Keys are question
  // numbers, values 0/1: nothing a child said or tapped as text is kept.
  const key = q.split('.').pop();
  const ans = { ...((row && row.meta && row.meta.comp && row.meta.comp.a) || {}), ...((mem.comp && mem.comp.a) || {}) };
  if (ans[key] !== undefined) return { ok: ans[key] === 1, answer: t.right };
  if (Object.keys(ans).length >= QA_MAX) fail(400, 'bad_request');
  const ok = t.options[p] === t.right;
  ans[key] = ok ? 1 : 0;
  RUNS.set(c.r, { ...(RUNS.get(c.r) || run), comp: { a: ans } });
  const tally = (a) => { const vals = Object.values(a); return { asked: vals.length, correct: vals.filter((x) => x === 1).length, v: 1, a }; };
  let numbers = tally(ans);
  if (row) {
    // merged into the row as it is now (another tap or the checked score may have written since it was read)
    const written = await updateRunMeta(c.r, (cur) => {
      const a = { ...((cur.meta && cur.meta.comp && cur.meta.comp.a) || {}), ...ans };
      return { meta: { ...(cur.meta || {}), comp: tally(a) } };
    });
    if (written) numbers = written.meta.comp;
    // the lamps once the answers are in (web_quiz_challenge_rungs; a scored v2 reading only; off ⇒ no query)
    if (c.ex === 'read' && written && written.status === 'scored' && isV2Meta(written.meta)) await require('./web-quiz-rungs').onRecordFinal(c.r, { questionsLeft: readQuestionsLeft }).catch(() => null);
  }
  // listening: the last answer scores the run ({correct, n}, as "Which is bigger?")
  const n = row && row.meta && Number(row.meta.n);
  if (c.ex === 'listen' && row && n && numbers.asked >= n) {
    await updateRun(c.r, { status: 'scored', score: { correct: numbers.correct, n }, scored_at: nowIso(), ...(isV2Meta(row.meta) ? { helped: helpedCol(helpedOf(helped)) } : {}) });
    await measureOutcome(c.r);
    await renewBindings(c.sid);
    await lightIfFirst(c.r);
    logEvent('web_quiz.ch_done', { step: 'listen', count: numbers.correct, n });
  }
  logEvent('web_quiz.ch_qa', { lang: run.lang, ok });
  return { ok, answer: t.right };
}

async function poll(ct) {
  if (await PracticeCh().runOf(ct)) fail(404, 'not_found');   // a preview's run is never stored
  const c = runOf(ct);
  const state = await runState(c);
  if (!state) fail(404, 'not_found');
  return state;
}

// ── results for a class list (the teacher report) ─────────────────────────────────────────────────────

/** Every student id of a class: the children enrolled in it, plus (for list=) the old list's own rows. */
async function classStudentIds({ cls, list }) {
  let classId = cls || null;
  const ids = new Set();
  if (list) {
    const { data: l, error } = await supabase.from('student_lists').select('id, class_id').eq('id', list).maybeSingle();
    if (error) fail(502, 'db_unavailable');
    if (l && l.class_id && !classId) classId = l.class_id;
    const { data: kids } = await supabase.from('students').select('id').eq('list_id', list);
    (kids || []).forEach((k) => ids.add(k.id));
  }
  if (classId) {
    const { data: enr, error } = await supabase.from('class_enrollments').select('id, student_id, is_active').eq('class_id', classId).eq('is_active', true);
    if (error) fail(502, 'db_unavailable');
    (enr || []).forEach((e) => ids.add(e.student_id));
  }
  return [...ids];
}

async function listResults({ cls, list } = {}) {
  const idRx = /^[0-9a-f-]{8,64}$/i;
  if ((cls != null && !(typeof cls === 'string' && idRx.test(cls))) || (list != null && !(typeof list === 'string' && idRx.test(list))) || (!cls && !list)) {
    fail(400, 'bad_request');
  }
  const ids = await classStudentIds({ cls, list });
  if (!ids.length) return [];
  // the record rule: the FIRST scored run per child × exercise (oldest first), never an early-stopped reading
  const record = await recordOn();
  const { data: runs, error: rErr } = await supabase.from('web_quiz_challenge_runs').select('id, student_id, exercise, status, score, wcpm, meta, created_at, scored_at')
    .in('student_id', ids).eq('status', 'scored').order('created_at', { ascending: record });
  if (rErr) {
    if (isMissingTable(rErr)) return [];
    fail(502, 'db_unavailable');
  }
  const seen = new Set();
  const out = [];
  for (const r of runs || []) {
    if (record && legacyIncomplete(r)) continue;
    const k = `${r.student_id}|${r.exercise}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const s = r.score || {};
    out.push(r.exercise === 'read'
      ? { student_id: r.student_id, exercise: r.exercise, score: s.correct || 0, wcpm: r.wcpm == null ? null : r.wcpm, at: r.scored_at || r.created_at }
      : { student_id: r.student_id, exercise: r.exercise, score: s.correct || 0, of: s.n || 10, ...(r.exercise === 'missing' ? { score_5s: s.correct_5s || 0 } : {}), at: r.scored_at || r.created_at });
  }
  return out;
}

// ── challenge v2: the clip warm job (web-quiz-challenge-clip-warm.js, switch web_quiz_challenge_clip_warm) ───
// One clip by the serve's own key and recorder: known or found in the store ⇒ 'had'; else recorded now, awaited,
// under the same per-process cap and in-flight set as a child's first serve ⇒ 'recorded' | 'missing'.
// `record: false` (the cap reached): the store is asked, nothing is recorded.
async function warmClip(key, text, lang, { record = true, now = Date.now() } = {}) {
  if (clipKnown.get(key) !== true) {
    try { if ((await r2.headObject(key, { bucket: AudioStore.quizAudioBucket() })).exists) clipKnown.set(key, true); } catch (_) { /* absent */ }
  }
  if (clipKnown.get(key) === true) return 'had';
  if (!record) return 'missing';
  await recordClip(key, text, lang, now);
  return clipKnown.get(key) === true ? 'recorded' : 'missing';
}
const clipsLeft = (now = Date.now()) => Math.max(0, MAX_CLIP_RECORDINGS - clipsRecordedOn(now));

// Live reading v3: a story page's speech keys spend the same daily read budget (read from the cached switches: with
// real-time or v3 off nothing is counted and nothing more is read)
// (web_quiz_games_together, the hub's switch cache: the two switches read together)
Budget.countAlso(async (sinceIso) => {
  if (require('./web-quiz-hub-flags').nowOf('gamesTogether')) {
    const [live, v3] = await Promise.all([liveOn(), settingOn(LiveReadV3().FLAG_KEY)]);
    return live && v3 ? LiveReadV3().STORY_KEY_WEIGHT * (await LiveReadV3().keysSince(sinceIso)) : 0;
  }
  return (await liveOn()) && (await settingOn(LiveReadV3().FLAG_KEY)) ? LiveReadV3().STORY_KEY_WEIGHT * (await LiveReadV3().keysSince(sinceIso)) : 0;
});

module.exports = {
  _previousRun: previousRun,
  menu, exercise, entryOf, presignUpload, submit, poll, readLength, listResults, liveKey, liveOn, questions, answer, listenWords, listenPreview, questionsOn, readQuestionsLeft, tapOptions, listenOn, optionAudioOn,
  scoreBigger, wcpm, formFor, formForChild, gradeOf, gradeInfo, kidChip, challengeOn, clipKey, childVoiceBucket,
  recordOn, readGuardOn, itemsOn, keepAudioOn, v2On, periodOn, poolOn, storyOn, V2_FLAG_KEY, PERIOD_FLAG_KEY, POOL_FLAG_KEY, STORY_FLAG_KEY, keptRoot, isKeptKey, forgetAudioKey, trailOn, missingOn, scoreMissing, sweepOrphans, servePairs, biggerItems, itemFlags, legacyIncomplete,
  EXERCISES, TRAIL_ORDER, nameOf, lineOf, FLAG_KEY, LIVE_FLAG_KEY, RECORD_FLAG_KEY, GUARD_FLAG_KEY, ITEMS_FLAG_KEY, TRAIL_FLAG_KEY, MISSING_FLAG_KEY, TABLE, MAX_BYTES,
  settingOn, warmClip, clipsLeft, MAX_CLIP_RECORDINGS, // challenge v2: the clip warm job
  recordClip,      // the one-voice pre-flip recording of the short lines (scripts/quiz/one-voice-missing-keys.js)
  updateRunMeta,   // the meta compare-and-set write, reused by the stuck-run sweeper (web-quiz-challenge-sweeper.js)
  __reset, storyVoiceOn, exerciseLines,
};
// The passage's child-facing title {en, ur} | null: one home for the shelf and the stop's intro (RULING #100(a)(2)).
module.exports.passageTitle = passageTitle;
// the class-week arm's switch gate (with its parent web_quiz_class_round), read at the v2 serve
module.exports.classWeekOpen = classWeekOpen;
// the preview's games (web-quiz-practice-challenge.js): the same switches, bank, clips, copy and scoring as a child's,
// none of the run code (nothing there writes)
module.exports._practiceKit = {
  challengeOn, formForChild, rulesOf, ruleFlags, copyFor, trailCopy, nameOf, byId, clipsFor, clipUrl, clipKey, storyClip, readAlongClip,
  tapOptions, optionAudioOn, listenOn, settingOn, passageFor, titleOf, childTest, Grade1, Draw, TrailPage, Tel,
  EXERCISES, TRAIL_ORDER, PER_ITEM_S, MISSING_FIRST_KEY_S, READ_SECS, QA_MAX, servePairs, scoreBigger, scoreMissing,
};
// the runs insert (and its duplicate-record rule), for its test
module.exports.insertRun = insertRun;
// the quality floors (speed, noise), pure, for their tests
module.exports.readQuality = readQuality;
module.exports.rapidPerfect = rapidPerfect;
// the read scorer, the passage lookup and the battery loader, for the one-off re-score of kept readings (scripts/quiz/rescore-kept-reads.js)
module.exports.scoreRead = scoreRead;
module.exports.passageFor = passageFor;
module.exports.childTest = childTest;
// the v3 home's door screens (web-quiz-hub-doors.js): a listening story opens only once its clip is recorded, and a
// row's words in the quiz voice (the clips' own scheme and recorder; a missing one is recorded in the background, so
// the row has it on a later open, under the same daily cap as every clip)
module.exports.storyClip = storyClip;
module.exports.sayClip = async (text, lang) => {
  if (!text) return null;
  const key = clipKey('door', 'say', lang, String(text));
  // a door label never takes the last half of the day's recordings from the challenge's own clips: past it, known clips only
  if (clipsLeft() <= MAX_CLIP_RECORDINGS / 2 && clipKnown.get(key) !== true) return null;
  return clipUrl(key, String(text), lang);
};
// a listen row on the door's Stories list: the listening story's own key, but like the labels it records only while more
// than half the day's recordings are left (past it, known clips only), so opening Stories never spends the challenge's half
module.exports.storyClipCapped = (lang, text) => {
  if (!text) return null;
  const key = clipKey('listen', 'story', lang, text);
  if (clipsLeft() <= MAX_CLIP_RECORDINGS / 2 && clipKnown.get(key) !== true) return null;
  return clipUrl(key, text, lang);
};
// tests only: the day's recordings already made (to stand at a point of the daily cap without recording)
module.exports.__useClips = (n, now = Date.now()) => { clipsRecordedOn(now); clipsRecorded = n; };
