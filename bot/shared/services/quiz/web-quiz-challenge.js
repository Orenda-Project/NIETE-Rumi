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
 * after scoring (or a failed scoring), and only numbers are stored.
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
const { WqError } = require('./web-quiz.service');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { LANGUAGE_OFFER } = require('../../config/languages');
const Budget = require('./web-quiz-challenge-budget');

const FLAG_KEY = 'web_quiz_challenge';
const LIVE_FLAG_KEY = 'web_quiz_challenge_realtime';
const QA_FLAG_KEY = 'web_quiz_challenge_questions';
const LISTEN_FLAG_KEY = 'web_quiz_challenge_listen';
const QA_MAX = 3;
// Never shown to a child as an option (the page's no-test-words rule, Urdu and English).
// "I don't know" is never offered as an option (it is in some rubrics' reject lists as a non-answer).
const NOT_AN_ANSWER = /معلوم نہیں|نہیں معلوم|پتا نہیں|پتہ نہیں|\bdon'?t know\b|\bnot sure\b/i;
const NO_TEST_WORDS = /\b(test|tests|testing|egra|egma|assessment|exam)\b|ٹیسٹ|امتحان|جائزہ|اسیسمنٹ/i;
const TABLE = 'web_quiz_challenge_runs';
const FLAG_TTL_MS = 30 * 1000;
const PER_ITEM_S = 10;
const READ_SECS = 60;
const MAX_BYTES = 3 * 1024 * 1024;
// The upload URL lives for the longest take (60 s) plus slack: it is minted when the recording stops.
const PUT_TTL_S = 3 * 60;
const CLIP_TTL_S = 6 * 60 * 60;
const WAIT_MS = 5000;
const READS_PER_DAY = 10;
const MAX_CLIP_RECORDINGS = 64;  // per process: 2 exercises × 4 lines × 2 languages = 16 clips, ever
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
  { id: 'read', mins: 2, task: (lang) => `${lang}.story` },
  { id: 'listen', mins: 2, task: (lang) => `${lang}.listening` },
]);
const byId = (id) => EXERCISES.find((e) => e.id === id) || null;

// Names and the mascot's lines live in the string catalog (ux-strings.js, keys wqCh*), both languages.
const KEY = { bigger: 'Bigger', read: 'Read', listen: 'Listen' };
const PART_KEY = { intro: 'Intro', start: 'Start', stop: 'Stop', done: 'Done' };
const nameOf = (ex, lang) => resolveUx(`wqCh${KEY[ex]}Name`, { language: lang });
const lineOf = (ex, part, lang) => resolveUx(`wqCh${KEY[ex]}${PART_KEY[part]}`, { language: lang });
const PARTS = ['intro', 'start', 'stop', 'done'];
// The quiz's one voice per language (web-quiz-voice.js QUIZ_VOICE), pinned per call: never a fallback provider.
const { quizVoice, voiceTag } = require('./web-quiz-voice');
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

function __reset() { flagCache = null; liveCache = null; qaCache = null; listenCache = null; Budget._reset(); RUNS.clear(); clipKnown.clear(); clipRecording.clear(); clipsRecorded = 0; }

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

async function entryOf(token, kid, device) {
  if (!T.secret()) fail(503, 'web_quiz_off');
  const h = T.verify(token, 'h');
  if (h) {
    const ids = (Array.isArray(h.ids) ? h.ids : []).filter((x) => typeof x === 'string').slice(0, 4);
    if (!ids.length) fail(401, 'bad_token');
    let hit = ids[0];
    if (kid) {
      hit = ids.find((id) => kidChip(id) === kid);
      if (!hit) fail(401, 'bad_token');
    } else if (ids.length > 1) fail(400, 'pick_kid');
    // A forwarded hub link opens nothing as the child: only the phone the link is bound to
    // (or one THIS child played on) gets their results or a run (web-quiz-hub-device deviceTrusted).
    const trust = await require('./web-quiz-hub-device').deviceTrusted(token, device);
    if (!trust.ok || !trust.ids.includes(String(hit))) fail(403, 'other_device');
    return { studentId: hit, via: 'hub' };
  }
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
async function gradeOf(entry) {
  const { data: enr } = await supabase.from('class_enrollments').select('id, class_id, student_id, is_active')
    .eq('student_id', entry.studentId).eq('is_active', true);
  if (enr && enr.length) {
    const { data: cls } = await supabase.from('classes').select('id, grade_code').eq('id', enr[0].class_id).maybeSingle();
    const g = cls && gradeNum(String(cls.grade_code || '').replace(/^grade_/, ''));
    if (g) return g;
  }
  const { data: kid } = await supabase.from('students').select('id, list_id, self_reported_class').eq('id', entry.studentId).maybeSingle();
  if (kid && kid.list_id) {
    const { data: list } = await supabase.from('student_lists').select('id, class_name').eq('id', kid.list_id).maybeSingle();
    const g = list && gradeNum(list.class_name);
    if (g) return g;
  }
  if (kid && gradeNum(kid.self_reported_class)) return gradeNum(kid.self_reported_class);
  let quizId = entry.quizId || null;
  const { data: sessions } = await supabase.from('quiz_sessions').select('id, quiz_id, student_class, created_at')
    .eq('student_id', entry.studentId).order('created_at', { ascending: false }).limit(1);
  const last = sessions && sessions[0];
  if (last && gradeNum(last.student_class)) return gradeNum(last.student_class);
  if (!quizId && last) quizId = last.quiz_id;
  if (quizId) {
    const { data: q } = await supabase.from('quizzes').select('id, grade').eq('id', quizId).maybeSingle();
    return q ? gradeNum(q.grade) : null;
  }
  return null;
}

/** The maths form for a grade: 2-3 ⇒ '3', 4-5 ⇒ '5'; anything else is not eligible. */
function formFor(grade) {
  if (grade === 2 || grade === 3) return '3';
  if (grade === 4 || grade === 5) return '5';
  return null;
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

async function who(token, { kid, lang, device } = {}) {
  if (!(await challengeOn())) fail(503, 'challenge_off');
  const entry = await entryOf(token, kid, device);
  const grade = await gradeOf(entry);
  const form = formFor(grade);
  if (!form) fail(403, 'not_eligible');
  return { ...entry, grade, form, lang: await languageOf(entry, lang) };
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

async function insertRun(row) {
  const { error } = await supabase.from('web_quiz_challenge_runs').insert(row);
  if (!error) return 'stored';
  if (error.code === '23505') return 'duplicate';
  storeFailed(row.id, error);
  return 'unstored';
}

async function updateRun(id, patch) {
  const { error } = await supabase.from('web_quiz_challenge_runs').update(patch).eq('id', id);
  if (error && !isMissingTable(error)) storeFailed(id, error);
}

async function storedRun(id) {
  const { data, error } = await supabase.from('web_quiz_challenge_runs').select('id, exercise, lang, status, score, wcpm, meta').eq('id', id).maybeSingle();
  return error ? null : data;
}

/**
 * A run's meta has more than one writer (the checked score, each tap's meta.comp), on any replica. Each write is
 * built from a fresh read and lands only if meta is still what was read (jsonb equality), else it is rebuilt from
 * a new read, so neither writer puts back a stale copy of the other's keys. `build(row)` returns the patch.
 * Returns the row as written, or null (no row, a store error, or still contended after the retries).
 */
const META_TRIES = 5;
async function updateRunMeta(id, build) {
  for (let i = 0; i < META_TRIES; i += 1) {
    const cur = await storedRun(id);
    if (!cur) return null;
    const patch = build(cur);
    const q = supabase.from('web_quiz_challenge_runs').update(patch).eq('id', id);
    const { data, error } = await (cur.meta == null ? q.is('meta', null) : q.eq('meta', JSON.stringify(cur.meta))).select('id');
    if (error) {
      if (!isMissingTable(error)) storeFailed(id, error);
      return null;
    }
    if (data && data.length) return { ...cur, ...patch };
  }
  logError('web_quiz.challenge_meta_contended', { runId: id, tries: META_TRIES });
  return null;
}

// ── clips: the mascot's lines, recorded once per env in the quiz voice ───────────────────────────────

// quiz-audio/<env>/challenge/<lang>/<exercise>/<part>-<voiceTag>-<hash8>.ogg — the quiz clips' own scheme and bucket.
function clipKey(ex, part, lang, text) {
  return AudioStore.clipKey({ quizId: 'challenge', lang, qid: ex, part, voice: voiceTag(lang), text });
}

async function recordClip(key, text, lang) {
  if (clipRecording.has(key) || clipsRecorded >= MAX_CLIP_RECORDINGS) return;
  clipRecording.add(key);
  clipsRecorded += 1;
  try {
    const tts = require('../tts');
    const v = quizVoice(lang);
    // The provider and voice pinned per call, no fallback: a clip that cannot be made in this voice stays missing.
    const out = await tts.synthesize({ text, language: lang, useCase: 'reading', site: 'web_quiz_challenge', provider: v.provider, voice: v.voice });
    await r2.uploadBuffer(out.audio, key, 'audio/ogg', { bucket: AudioStore.quizAudioBucket() });
    clipKnown.set(key, true);
    logEvent('web_quiz.ch_clip_recorded', { lang, provider: out.provider, voice: out.voice, audioSec: Math.round((out.durationSec || 0) * 10) / 10 });
  } catch (e) {
    logError('web_quiz.ch_clip_failed', { lang, error: String(e && e.message || e).slice(0, 200) });
  } finally {
    clipRecording.delete(key);
  }
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
async function storyClip(lang) {
  let text = null;
  try { text = (childTest().Bank.getTaskSpec({ grade: 3, set: 'A', task: `${lang}.listening` }).story || {}).text; } catch (_) { text = null; }
  if (!text) return null;
  return clipUrl(clipKey('listen', 'story', lang, text), text, lang);
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

async function menu(token, { kid, lang, device } = {}) {
  const w = await who(token, { kid, lang, device });
  const runs = (await storedRuns(w.studentId)).filter((r) => r.status === 'scored');
  logEvent('web_quiz.ch_open', { via: w.via, grade: w.grade });
  // Today's read-aloud cap reached (web-quiz-challenge-budget.js): "Which is bigger?" only until Pakistan midnight.
  const readOk = await Budget.readOpen();
  // "Listen and answer" only once its story is recorded (asking for it starts the recording): never silence to listen to
  const listenOk = (await listenOn()) && !!(await storyClip(w.lang));
  return {
    form: `G${w.form}`,
    lang: w.lang,
    exercises: EXERCISES.filter((e) => (e.id !== 'read' || readOk) && (e.id !== 'listen' || listenOk)).map((e) => {
      const last = runs.find((r) => r.exercise === e.id) || null;
      return { id: e.id, name: nameOf(e.id, w.lang), mins: e.mins, done: !!last, last: lastOf(last) };
    }),
  };
}

// ── E: one exercise ───────────────────────────────────────────────────────────────────────────────────

async function exercise(token, ex, { kid, lang, device } = {}) {
  const def = byId(ex);
  if (!def) fail(404, 'not_found');
  const w = await who(token, { kid, lang, device });
  if (ex === 'read' && !(await Budget.readOpen())) fail(429, 'enough_for_today');
  if (ex === 'listen' && !(await listenOn())) fail(503, 'listen_off');
  const { Bank } = childTest();
  const task = def.task(w.lang);
  const spec = Bank.getTaskSpec({ grade: Number(w.form), set: 'A', task });
  const runId = crypto.randomUUID();
  const ct = T.signChallenge({ studentId: w.studentId, ex, runId });
  RUNS.set(runId, { status: 'open', grade: w.grade, form: w.form, lang: w.lang, task });
  logEvent('web_quiz.ch_start', { step: ex, grade: w.grade });
  const base = { ex, name: nameOf(ex, w.lang), lang: w.lang, ct, clips: await clipsFor(ex, w.lang) };
  if (ex === 'bigger') {
    return {
      ...base,
      items: spec.items.map((i) => ({ a: i.a, b: i.b })),
      practice: (spec.practice || []).map((i) => ({ a: i.a, b: i.b, answer: i.answer })),
      per_item_s: PER_ITEM_S,
      stop_after: (spec.stop && spec.stop.n) || 4,
    };
  }
  if (ex === 'listen') {
    // the story is heard, never shown: only its clip and how many times EGRA reads it
    const url = await storyClip(w.lang);
    if (!url) fail(503, 'getting_ready');
    return { ...base, read_times: Number(spec.read_times) || 2, story_clip: { url } };
  }
  const st = spec.story || {};
  const live = await liveOn();
  // live: the bar marks the child's last checked words a minute ("last time"), null the first time
  const previousWcpm = live ? ((await previousRun(w.studentId, 'read', w.lang)) || {}).wcpm : undefined;
  return { ...base, secs: READ_SECS, live, ...(live ? { previous_wcpm: previousWcpm == null ? null : previousWcpm } : {}), questions_on: await questionsOn(), story: { text: st.text, tokens: st.tokens, lines: st.lines, dir: spec.direction } };
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

async function scoreRead(run, key, ext, ms, { Bank, media, scoreTask }) {
  let file = null;
  try {
    file = media.tmpFile(ext);
    require('fs').writeFileSync(file, await r2.downloadFromR2(key, { bucket: childVoiceBucket() }));
    // Chrome's MediaRecorder webm has no duration header (ffmpeg reads "Duration: N/A"): the page's own
    // recorded length stands in, so the STT cost and the stored duration are not lost.
    const pageSec = Number(ms) > 0 ? Math.min(READ_SECS + 1, Number(ms) / 1000) : null;
    const durationSec = (await media.probeDuration(file)) || pageSec;
    const spec = Bank.getTaskSpec({ grade: Number(run.form), set: 'A', task: run.task });
    // The comprehension questions are not part of the Challenge: the kid only reads.
    const m = await scoreTask({ task: run.task, spec: { ...spec, questions: [] }, media: { file, durationSec, beginAtS: 0 }, lang: run.lang, grade: Number(run.form) });
    if (!m || m.ok === false) return { failed: true, reason: (m && m.reason) || 'internal_error', meta: { calls: m && m.calls ? m.calls.length : 0 } };
    const t = m.timed || {};
    const stopped = !!m.stopped_by_rule;
    const score = { correct: t.correct || 0, attempted: t.attempted || 0, stopped, finished_early: (t.time_remaining || 0) > 0, time_left: t.time_remaining || 0 };
    // Not one word of the story was heard: that is not a reading of 0 words — no score, no ✓, no growth baseline,
    // nothing in the class results; the child is asked to try again.
    if (!stopped && score.attempted === 0) return { failed: true, reason: 'unheard', meta: { cost_usd: (m.meta && m.meta.cost_usd) || 0, duration_s: Math.round(durationSec * 10) / 10 } };
    return { score, wcpm: stopped ? 0 : wcpm(score.correct, score.time_left), meta: { cost_usd: (m.meta && m.meta.cost_usd) || 0, seconds: m.meta && m.meta.seconds, duration_s: Math.round(durationSec * 10) / 10, flags: m.flags || [] } };
  } catch (e) {
    return { failed: true, reason: 'internal_error', meta: { error: String(e && e.message || e).slice(0, 120) } };
  } finally {
    if (file) media.cleanup(file);
    await forgetRun(key.slice(0, key.lastIndexOf('/') + 1), key);
  }
}

function runOf(ct) {
  const c = T.verify(ct, 'c');
  if (!c || !c.r || !c.sid || !byId(c.ex)) fail(401, 'bad_token');
  return c;
}

// A child's voice is scored and forgotten: a private prefix (never the quiz-audio keys), deleted after scoring;
// the bucket's lifecycle rule (≤ 7 days) catches an upload whose result never came.
function runPrefix(c) {
  return `child-voice/${r2Env()}/${c.r}/`;
}
function uploadPrefix(c) {
  return `${runPrefix(c)}read-`;
}

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
 */
async function forgetRun(prefix, key, { again = true } = {}) {
  if (!/^child-voice\/[^/]+\/[^/]+\/$/.test(String(prefix || ''))) return;
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

async function presignUpload({ ct, type, size } = {}) {
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
  const key = `${uploadPrefix(c)}${Date.now()}.${ext}`;
  const putUrl = await r2.getPresignedUploadUrl(key, base, PUT_TTL_S, { bucket: childVoiceBucket(), signContentType: true });
  return { put_url: putUrl, key, content_type: base, max_bytes: MAX_BYTES, expires_in: PUT_TTL_S };
}

// A live run's row, written at its mint and not yet given its result (no 'live' status: the CHECK has none).
const isLiveRow = (row) => !!row && row.status === 'scoring' && !!row.meta && row.meta.phase === 'live';

// A run takes its one recording while it is open, or live (minted, not yet scored) — here or in the table.
async function uploadable(c, mem) {
  if (mem && mem.status) return mem.status === 'open' || mem.status === 'live';
  const row = await storedRun(c.r);
  return !row || isLiveRow(row);
}

/** The run's state from what this process knows, else from the table. */
async function runState(c) {
  const mem = RUNS.get(c.r);
  if (mem && mem.result) return mem.result;
  if (mem && mem.status === 'scoring') return { pending: true };
  const row = await storedRun(c.r);
  if (!row || isLiveRow(row)) return null;
  if (row.status === 'scoring') return { pending: true };
  if (row.status === 'failed') return { failed: true, reason: (row.meta && row.meta.reason) || 'failed' };
  return row.exercise === 'read' ? { score: row.score, wcpm: row.wcpm } : { score: row.score };
}

/**
 * The child's last scored run of this exercise, for "7 more words than last time!" (null the first time). A reading
 * compares only with readings in the same language: the Urdu and English stories are different passages.
 */
async function previousRun(studentId, exercise, lang = null) {
  let qb = supabase.from('web_quiz_challenge_runs').select('id, exercise, status, score, wcpm, created_at')
    .eq('student_id', studentId).eq('exercise', exercise).eq('status', 'scored');
  if (exercise === 'read' && lang) qb = qb.eq('lang', lang);
  const { data, error } = await qb.order('created_at', { ascending: false }).limit(1);
  const r = !error && data && data[0];
  if (!r) return null;
  const s = r.score || {};
  return exercise === 'read' ? { wcpm: r.wcpm, correct: s.correct, at: r.created_at } : { correct: s.correct, n: s.n, at: r.created_at };
}

// The child's readings in the last 24 h, not counting `except` (a live run's own row, made at its mint).
async function readsToday(studentId, except = null) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from('web_quiz_challenge_runs').select('id').eq('student_id', studentId).eq('exercise', 'read').gte('created_at', since);
  return error ? 0 : (data || []).filter((r) => r.id !== except).length;
}

// The run, from this process or rebuilt from the student (a token minted by another process: a restart, a replica).
async function runFor(c, mem, lang) {
  if (mem && mem.task) return mem;
  const grade = await gradeOf({ studentId: c.sid });
  const form = formFor(grade);
  if (!form) fail(403, 'not_eligible');
  const l = clampLanguage(lang);
  return { grade, form, lang: l, task: byId(c.ex).task(l) };
}

/**
 * A temporary Soniox key for this run's live reading (the page opens the stream with it). Same gates as the upload:
 * the switch, one per run, the child's 10 a day and the day's cap — checked BEFORE anything is spent. Soniox down or
 * refusing ⇒ 502 live_unavailable (logged with its status), no run row: the page reads with the upload path.
 */
async function liveKey({ ct, lang } = {}) {
  const c = runOf(ct);
  if (c.ex !== 'read') fail(400, 'no_audio');
  if (!(await liveOn())) fail(503, 'live_off');
  const Live = require('./web-quiz-soniox-live');
  if (!Live.configured()) fail(503, 'live_unavailable');
  const mem = RUNS.get(c.r) || {};
  if ((mem.status && mem.status !== 'open') || (!mem.status && await storedRun(c.r))) fail(409, 'already_done');
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
  const stored = await insertRun({ id: c.r, student_id: c.sid, exercise: 'read', grade: run.grade, lang: run.lang, status: 'scoring', created_at: nowIso(), meta: { phase: 'live' } });
  if (stored === 'duplicate') fail(409, 'already_done');
  logEvent('web_quiz.ch_live_key', { grade: run.grade, lang: run.lang });
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

async function submit(body = {}, { waitMs = WAIT_MS } = {}) {
  const c = runOf(body.ct);
  let CT;
  try { CT = childTest({ scorer: c.ex === 'read' }); } catch (e) {
    // Not scorable here: an uploaded recording is still forgotten (only this run's own prefix).
    if (c.ex === 'read' && typeof body.key === 'string') await forgetRun(runPrefix(c), body.key.startsWith(runPrefix(c)) ? body.key : null);
    throw e;
  }
  const { Bank } = CT;
  const mem = RUNS.get(c.r) || {};
  // A live run (its row made at the mint) takes its one result; any other stored or finished run is done.
  const storedRow = mem.status ? null : await storedRun(c.r);
  const isLive = mem.status === 'live' || (c.ex === 'read' && isLiveRow(storedRow));
  if ((mem.status && mem.status !== 'open' && !isLive) || (storedRow && !isLive)) fail(409, 'already_done');
  const run = await runFor(c, mem, body.lang);
  const base = { id: c.r, student_id: c.sid, exercise: c.ex, grade: run.grade, lang: run.lang, created_at: nowIso() };

  if (c.ex === 'bigger') {
    const spec = Bank.getTaskSpec({ grade: Number(run.form), set: 'A', task: 'ma.discrimination' });
    const score = scoreBigger(spec.items, body.taps, { stopAfter: (spec.stop && spec.stop.n) || 4 });
    const result = { score, previous: await previousRun(c.sid, 'bigger') };
    RUNS.set(c.r, { ...run, status: 'done', result });
    const stored = await insertRun({ ...base, status: 'scored', score, scored_at: nowIso(), meta: { ms: Number(body.ms) || null } });
    if (stored === 'duplicate') fail(409, 'already_done');
    logEvent('web_quiz.ch_done', { step: 'bigger', count: score.correct, n: score.n, stopped: score.stopped });
    return result;
  }

  // read
  const key = typeof body.key === 'string' ? body.key : '';
  if (!key) fail(400, 'no_audio');
  // A refused upload is deleted too: a presigned PUT cannot cap what was put there. Only this run's own prefix.
  const refuse = async (status, error) => { await forgetRun(runPrefix(c), key.startsWith(runPrefix(c)) ? key : null); fail(status, error); };
  if (!key.startsWith(uploadPrefix(c)) || !/^\d{13}\.(webm|ogg|m4a)$/.test(key.slice(uploadPrefix(c).length))) await refuse(403, 'not_your_upload');
  let head;
  try { head = await r2.headObject(key, { bucket: childVoiceBucket() }); } catch (_) { fail(502, 'storage_unavailable'); }
  if (!head || !head.exists) fail(404, 'no_upload');
  if (Number(head.sizeBytes) > MAX_BYTES) await refuse(413, 'too_large');
  // A live run was counted (both caps) at its mint; its own row is not "another reading today".
  if (!isLive && (await readsToday(c.sid) >= READS_PER_DAY || !(await Budget.readOpen()))) await refuse(429, 'enough_for_today');
  if (!isLive) Budget.noteStarted();

  RUNS.set(c.r, { ...run, status: 'scoring' });
  const previous = await previousRun(c.sid, 'read', run.lang);
  const story = (Bank.getTaskSpec({ grade: Number(run.form), set: 'A', task: run.task }).story || {});
  const live = isLive ? liveCount(body.live, (story.tokens && story.tokens.length) || String(story.text || '').split(/\s+/).filter(Boolean).length) : null;
  const metaIn = { ms: Number(body.ms) || null, ...(live ? { live } : {}) };
  if (isLive) {
    // the child may already be answering the questions (the live result shows before this call): keep their answers
    await updateRunMeta(c.r, (cur) => ({ status: 'scoring', meta: { ...metaIn, ...(cur.meta && cur.meta.comp ? { comp: cur.meta.comp } : {}) } }));
  }
  else {
    const stored = await insertRun({ ...base, status: 'scoring', meta: metaIn });
    if (stored === 'duplicate') await refuse(409, 'already_done');
  }
  const ext = key.split('.').pop();
  const promise = scoreRead(run, key, ext, body.ms, CT).then(async (r) => {
    const result = r.failed ? { failed: true, reason: r.reason } : { score: r.score, wcpm: r.wcpm, previous };
    const before = RUNS.get(c.r) || {};
    RUNS.set(c.r, { ...run, ...(before.comp ? { comp: before.comp } : {}), status: 'done', result });
    // answers to the questions may have been given while this reading was scored: keep them (meta.comp)
    await updateRunMeta(c.r, (cur) => {
      const comp = cur.meta && cur.meta.comp ? { comp: cur.meta.comp } : {};
      return r.failed
        ? { status: 'failed', meta: { ...r.meta, ...comp, reason: r.reason }, scored_at: nowIso() }
        : { status: 'scored', score: r.score, wcpm: r.wcpm, meta: { ...r.meta, ...(live ? { live } : {}), ...comp }, scored_at: nowIso() };
    });
    if (r.failed) logError('web_quiz.ch_read_failed', { runId: c.r, reason: r.reason });
    else logEvent('web_quiz.ch_done', { step: 'read', count: r.score.correct, wcpm: r.wcpm, stopped: r.score.stopped, costUsd: r.meta.cost_usd });
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
  const reviewed = q && TAP_REVIEWED.get(q.id);
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
  const mem = RUNS.get(c.r) || {};
  const row = await storedRun(c.r);
  const run = await runFor(c, mem.task ? mem : {}, (row && row.lang) || mem.lang || lang);
  const { Bank } = childTest();
  const spec = Bank.getTaskSpec({ grade: Number(run.form), set: 'A', task: run.task });
  return { run, row, mem, spec };
}

/**
 * The questions the child reached (EGRA: only about text read; a stopped reader gets none), at most 3, in bank order.
 * Words attempted: the checked score, else the live count stored with the result, else the page's own count (bounded).
 */
async function questions({ ct, attempted, lang } = {}) {
  const c = runOf(ct);
  const { run, row, mem, spec } = await readingOf(c, lang);
  if (c.ex === 'listen') return listenQuestions(c, run, row, spec);
  const n = ((spec.story || {}).tokens || []).length;
  const checked = (row && row.status === 'scored' && row.score) || (mem.result && mem.result.score) || null;
  if (checked && checked.stopped) return { questions: [] };
  const live = row && row.meta && row.meta.live;
  let words = checked ? checked.attempted : (live ? live.attempted : (Number.isInteger(Number(attempted)) ? Number(attempted) : null));
  if (words == null) return { questions: [] };
  words = Math.max(0, Math.min(n, words));
  const { reachedQuestions } = require('../child-test/scoring/reach');
  const reached = reachedQuestions(spec, { story: { words_attempted: words, finished_early: (checked && checked.finished_early) || words >= n } });
  const out = [];
  for (const q of spec.questions || []) {
    if (out.length >= QA_MAX || !reached.has(q.id)) continue;
    const t = tapOptions(q, run.lang, c.r);
    if (!t) continue;
    const k = q.id.split('.').pop();
    out.push({ id: q.id, prompt: q.prompt, options: t.options, clip: { url: await clipUrl(clipKey('read', k, run.lang, q.prompt), q.prompt, run.lang) } });
  }
  logEvent('web_quiz.ch_qs', { lang: run.lang, n: out.length });
  return { questions: out };
}

/** Listening: the child heard the whole story, so no reach rule; the run is written as scoring when they are served. */
async function listenQuestions(c, run, row, spec) {
  const out = [];
  for (const q of spec.questions || []) {
    if (out.length >= QA_MAX) break;
    const t = tapOptions(q, run.lang, c.r);
    if (!t) continue;
    const k = q.id.split('.').pop();
    out.push({ id: q.id, prompt: q.prompt, options: t.options, clip: { url: await clipUrl(clipKey('listen', k, run.lang, q.prompt), q.prompt, run.lang) } });
  }
  if (!row && out.length) {
    RUNS.set(c.r, { ...run, status: 'listening' });
    await insertRun({ id: c.r, student_id: c.sid, exercise: 'listen', grade: run.grade, lang: run.lang, status: 'scoring', created_at: nowIso(), meta: { phase: 'listen', n: out.length } });
  }
  logEvent('web_quiz.ch_qs', { lang: run.lang, n: out.length, step: 'listen' });
  return { questions: out };
}

/** One tap: { ok, answer } (the right option's text). A question counts once; at most 3 per reading. */
async function answer({ ct, q, pick, lang } = {}) {
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
  }
  // listening: the last answer scores the run ({correct, n}, as "Which is bigger?")
  const n = row && row.meta && Number(row.meta.n);
  if (c.ex === 'listen' && row && n && numbers.asked >= n) {
    await updateRun(c.r, { status: 'scored', score: { correct: numbers.correct, n }, scored_at: nowIso() });
    logEvent('web_quiz.ch_done', { step: 'listen', count: numbers.correct, n });
  }
  logEvent('web_quiz.ch_qa', { lang: run.lang, ok });
  return { ok, answer: t.right };
}

async function poll(ct) {
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
  const { data: runs, error: rErr } = await supabase.from('web_quiz_challenge_runs').select('id, student_id, exercise, status, score, wcpm, created_at, scored_at')
    .in('student_id', ids).eq('status', 'scored').order('created_at', { ascending: false });
  if (rErr) {
    if (isMissingTable(rErr)) return [];
    fail(502, 'db_unavailable');
  }
  const seen = new Set();
  const out = [];
  for (const r of runs || []) {
    const k = `${r.student_id}|${r.exercise}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const s = r.score || {};
    out.push(r.exercise === 'read'
      ? { student_id: r.student_id, exercise: r.exercise, score: s.correct || 0, wcpm: r.wcpm == null ? null : r.wcpm, at: r.scored_at || r.created_at }
      : { student_id: r.student_id, exercise: r.exercise, score: s.correct || 0, of: s.n || 10, at: r.scored_at || r.created_at });
  }
  return out;
}

module.exports = {
  menu, exercise, presignUpload, submit, poll, listResults, liveKey, liveOn, questions, answer, questionsOn, tapOptions, listenOn,
  scoreBigger, wcpm, formFor, gradeOf, kidChip, challengeOn, clipKey, childVoiceBucket,
  EXERCISES, nameOf, lineOf, FLAG_KEY, LIVE_FLAG_KEY, TABLE, MAX_BYTES,
  __reset,
};
