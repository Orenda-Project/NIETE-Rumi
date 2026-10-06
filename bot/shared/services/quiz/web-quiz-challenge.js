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
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const r2 = require('../../storage/r2');
const T = require('./web-quiz-token');
const Bank = require('../child-test/item-bank');
const { applyConsecutiveStop, rate } = require('../child-test/scoring/tasks/common');
const { WqError } = require('./web-quiz.service');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { LANGUAGE_OFFER } = require('../../config/languages');

const FLAG_KEY = 'web_quiz_challenge';
const TABLE = 'web_quiz_challenge_runs';
const FLAG_TTL_MS = 30 * 1000;
const PER_ITEM_S = 10;
const READ_SECS = 60;
const MAX_BYTES = 3 * 1024 * 1024;
const PUT_TTL_S = 15 * 60;
const CLIP_TTL_S = 6 * 60 * 60;
const WAIT_MS = 5000;
const READS_PER_DAY = 10;
const MAX_CLIP_RECORDINGS = 64;  // per process: 2 exercises × 4 lines × 2 languages = 16 clips, ever
const AUDIO_TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

const fail = (status, error, extra = {}) => { throw new WqError(status, { error, ...extra }); };

// The exercises built so far, in menu order. The other five of the battery are added here as they ship.
const EXERCISES = Object.freeze([
  { id: 'bigger', mins: 2, task: () => 'ma.discrimination' },
  { id: 'read', mins: 2, task: (lang) => `${lang}.story` },
]);
const byId = (id) => EXERCISES.find((e) => e.id === id) || null;

// Names and the mascot's lines live in the string catalog (ux-strings.js, keys wqCh*), both languages.
const KEY = { bigger: 'Bigger', read: 'Read' };
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
const RUNS = new Map();          // runId → { status, result, promise }
const clipKnown = new Map();     // key → true (exists) | number (missing, checked at)
const clipRecording = new Set();
let clipsRecorded = 0;

function __reset() { flagCache = null; RUNS.clear(); clipKnown.clear(); clipRecording.clear(); clipsRecorded = 0; }

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

/** The chip a hub page sends for one of the phone's children (not reversible): the hub's own, T.chipId('h', id). */
function kidChip(studentId) {
  return T.chipId('h', studentId);
}

// The hub's band-aware grade for this child (web-quiz-hub.js kidFromHub), when that module is deployed.
async function hubGrade(token, chip) {
  let Hub;
  try { Hub = require('./web-quiz-hub'); } catch (_) { return null; }
  try {
    const k = typeof Hub.kidFromHub === 'function' ? await Hub.kidFromHub(token, chip) : null;
    return k ? gradeNum(k.grade) : null;
  } catch (_) { return null; }
}

// ── who is playing ─────────────────────────────────────────────────────────────────────────────────────

async function entryOf(token, kid) {
  if (!T.secret()) fail(503, 'web_quiz_off');
  const h = T.verify(token, 'h');
  if (h) {
    const ids = (Array.isArray(h.ids) ? h.ids : []).filter((x) => typeof x === 'string').slice(0, 4);
    if (!ids.length) fail(401, 'bad_token');
    if (kid) {
      const hit = ids.find((id) => kidChip(id) === kid);
      if (!hit) fail(401, 'bad_token');
      return { studentId: hit, via: 'hub', hubGrade: await hubGrade(token, kid) };
    }
    if (ids.length > 1) fail(400, 'pick_kid');
    return { studentId: ids[0], via: 'hub', hubGrade: await hubGrade(token, kidChip(ids[0])) };
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
 * The child's grade: the hub's own reading (when web-quiz-hub.js is deployed), then the class the child is
 * enrolled in, then the old class list, then the class the child gave themself, then their newest quiz session's
 * class, then that quiz's grade. Most quiz children are LOOSE students rows (no list, no enrolment). A band is
 * unknown, never its first digit.
 */
async function gradeOf(entry) {
  if (entry.hubGrade) return entry.hubGrade;
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

async function who(token, { kid, lang } = {}) {
  if (!(await challengeOn())) fail(503, 'challenge_off');
  const entry = await entryOf(token, kid);
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
  const { data, error } = await supabase.from('web_quiz_challenge_runs').select('id, exercise, status, score, wcpm, meta').eq('id', id).maybeSingle();
  return error ? null : data;
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

async function menu(token, { kid, lang } = {}) {
  const w = await who(token, { kid, lang });
  const runs = (await storedRuns(w.studentId)).filter((r) => r.status === 'scored');
  logEvent('web_quiz.ch_open', { via: w.via, grade: w.grade });
  return {
    form: `G${w.form}`,
    lang: w.lang,
    exercises: EXERCISES.map((e) => {
      const last = runs.find((r) => r.exercise === e.id) || null;
      return { id: e.id, name: nameOf(e.id, w.lang), mins: e.mins, done: !!last, last: lastOf(last) };
    }),
  };
}

// ── E: one exercise ───────────────────────────────────────────────────────────────────────────────────

async function exercise(token, ex, { kid, lang } = {}) {
  const def = byId(ex);
  if (!def) fail(404, 'not_found');
  const w = await who(token, { kid, lang });
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
  const st = spec.story || {};
  return { ...base, secs: READ_SECS, story: { text: st.text, tokens: st.tokens, lines: st.lines, dir: spec.direction } };
}

// ── scoring ───────────────────────────────────────────────────────────────────────────────────────────

/** EGRA Toolkit §10.3 words (items) correct per minute, whole number for the kid. */
function wcpm(correct, timeLeft = 0) {
  return Math.round(rate(correct, timeLeft));
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
  const stop = applyConsecutiveStop(rows, stopAfter);
  return { correct: rows.filter((r) => r.verdict === 'correct').length, n: items.length, stopped: !!stop.stopped };
}

async function scoreRead(run, key, ext) {
  const media = require('../child-test/scoring/media');
  const { scoreTask } = require('../child-test/scoring/tasks');
  let file = null;
  try {
    file = media.tmpFile(ext);
    require('fs').writeFileSync(file, await r2.downloadFromR2(key, { bucket: childVoiceBucket() }));
    const durationSec = await media.probeDuration(file);
    const spec = Bank.getTaskSpec({ grade: Number(run.form), set: 'A', task: run.task });
    // The comprehension questions are not part of the Challenge: the kid only reads.
    const m = await scoreTask({ task: run.task, spec: { ...spec, questions: [] }, media: { file, durationSec, beginAtS: 0 }, lang: run.lang, grade: Number(run.form) });
    if (!m || m.ok === false) return { failed: true, reason: (m && m.reason) || 'internal_error', meta: { calls: m && m.calls ? m.calls.length : 0 } };
    const t = m.timed || {};
    const stopped = !!m.stopped_by_rule;
    const score = { correct: t.correct || 0, attempted: t.attempted || 0, stopped, finished_early: (t.time_remaining || 0) > 0, time_left: t.time_remaining || 0 };
    return { score, wcpm: stopped ? 0 : wcpm(score.correct, score.time_left), meta: { cost_usd: (m.meta && m.meta.cost_usd) || 0, seconds: m.meta && m.meta.seconds, duration_s: Math.round(durationSec * 10) / 10, flags: m.flags || [] } };
  } catch (e) {
    return { failed: true, reason: 'internal_error', meta: { error: String(e && e.message || e).slice(0, 120) } };
  } finally {
    if (file) media.cleanup(file);
    await forget(key);
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

async function presignUpload({ ct, type, size } = {}) {
  const c = runOf(ct);
  if (c.ex !== 'read') fail(400, 'no_audio');
  const base = String(type || '').split(';')[0].trim().toLowerCase();
  const ext = AUDIO_TYPES[base];
  if (!ext) fail(400, 'wrong_type');
  const n = Number(size);
  if (!(n > 0) || n > MAX_BYTES) fail(413, 'too_large');
  const key = `${uploadPrefix(c)}${Date.now()}.${ext}`;
  const putUrl = await r2.getPresignedUploadUrl(key, base, PUT_TTL_S, { bucket: childVoiceBucket() });
  return { put_url: putUrl, key, content_type: base, max_bytes: MAX_BYTES, expires_in: PUT_TTL_S };
}

/** The run's state from what this process knows, else from the table. */
async function runState(c) {
  const mem = RUNS.get(c.r);
  if (mem && mem.result) return mem.result;
  if (mem && mem.status === 'scoring') return { pending: true };
  const row = await storedRun(c.r);
  if (!row) return null;
  if (row.status === 'scoring') return { pending: true };
  if (row.status === 'failed') return { failed: true, reason: (row.meta && row.meta.reason) || 'failed' };
  return row.exercise === 'read' ? { score: row.score, wcpm: row.wcpm } : { score: row.score };
}

/** The child's last scored run of this exercise, for "7 more words than last time!" (null the first time). */
async function previousRun(studentId, exercise) {
  const { data, error } = await supabase.from('web_quiz_challenge_runs').select('id, exercise, status, score, wcpm, created_at')
    .eq('student_id', studentId).eq('exercise', exercise).eq('status', 'scored').order('created_at', { ascending: false }).limit(1);
  const r = !error && data && data[0];
  if (!r) return null;
  const s = r.score || {};
  return exercise === 'read' ? { wcpm: r.wcpm, correct: s.correct, at: r.created_at } : { correct: s.correct, n: s.n, at: r.created_at };
}

async function readsToday(studentId) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from('web_quiz_challenge_runs').select('id').eq('student_id', studentId).eq('exercise', 'read').gte('created_at', since);
  return error ? 0 : (data || []).length;
}

async function submit(body = {}, { waitMs = WAIT_MS } = {}) {
  const c = runOf(body.ct);
  const mem = RUNS.get(c.r) || {};
  if ((mem.status && mem.status !== 'open') || (!mem.status && await storedRun(c.r))) fail(409, 'already_done');
  // A token minted by another process (a restart, a second replica): rebuild the run from the student.
  const run = mem.task ? mem : await (async () => {
    const grade = await gradeOf({ studentId: c.sid });
    const form = formFor(grade);
    if (!form) fail(403, 'not_eligible');
    const lang = clampLanguage(body.lang);
    return { grade, form, lang, task: byId(c.ex).task(lang) };
  })();
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
  const refuse = async (status, error) => { if (key.startsWith(runPrefix(c))) await forget(key); fail(status, error); };
  if (!key.startsWith(uploadPrefix(c)) || !/^\d{13}\.(webm|ogg|m4a)$/.test(key.slice(uploadPrefix(c).length))) await refuse(403, 'not_your_upload');
  let head;
  try { head = await r2.headObject(key, { bucket: childVoiceBucket() }); } catch (_) { fail(502, 'storage_unavailable'); }
  if (!head || !head.exists) fail(404, 'no_upload');
  if (Number(head.sizeBytes) > MAX_BYTES) await refuse(413, 'too_large');
  if (await readsToday(c.sid) >= READS_PER_DAY) await refuse(429, 'enough_for_today');

  RUNS.set(c.r, { ...run, status: 'scoring' });
  const previous = await previousRun(c.sid, 'read');
  const stored = await insertRun({ ...base, status: 'scoring', meta: { ms: Number(body.ms) || null } });
  if (stored === 'duplicate') await refuse(409, 'already_done');
  const ext = key.split('.').pop();
  const promise = scoreRead(run, key, ext).then(async (r) => {
    const result = r.failed ? { failed: true, reason: r.reason } : { score: r.score, wcpm: r.wcpm, previous };
    RUNS.set(c.r, { ...run, status: 'done', result });
    await updateRun(c.r, r.failed
      ? { status: 'failed', meta: { ...r.meta, reason: r.reason }, scored_at: nowIso() }
      : { status: 'scored', score: r.score, wcpm: r.wcpm, meta: r.meta, scored_at: nowIso() });
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
  menu, exercise, presignUpload, submit, poll, listResults,
  scoreBigger, wcpm, formFor, kidChip, challengeOn, clipKey, childVoiceBucket,
  EXERCISES, nameOf, lineOf, FLAG_KEY, TABLE, MAX_BYTES,
  __reset,
};
