'use strict';
/**
 * The video bank as the web quiz reads it, held in memory: every live row (migration_status done,
 * not superseded) with its ready video-quiz id, refreshed every 10 minutes, one refresh at a time;
 * a stale index still answers while the refresh runs. Plus the per-child and per-class lookups the
 * library and the scorecard share: a child's finished quizzes (one query), the class's live code per
 * quiz (one query), and the next lesson after a video quiz ("Next in this chapter").
 *
 * A leaf module (no web-quiz.service): web-quiz.service and web-quiz-library both require it.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');
const Order = require('./video-bank-order');

const INDEX_TTL_MS = 10 * 60 * 1000;
const PAGE = 1000;

// ─── the bank index ──────────────────────────────────────────────────────────

let index = null;     // { at, rows: [...], quizOf: Map(video_id -> quiz_id) }
let loading = null;   // the one refresh in flight
const background = new Set();
function track(p) { background.add(p); p.finally(() => background.delete(p)); return p; }

async function pages(build) {
  const out = [];
  let after = null;
  for (let i = 0; i < 20; i += 1) {
    let q = build();
    if (after) q = q.gt('id', after);
    const { data, error } = await q.order('id', { ascending: true }).limit(PAGE);
    if (error) throw new Error(error.message || 'bank read failed');
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
    after = data[data.length - 1].id;
  }
  return out;
}

async function loadIndex() {
  const [rows, quizzes] = await Promise.all([
    pages(() => supabase.from('student_videos').select('id, grade, subject, clean_chapter, clean_title, r2_url')
      .eq('migration_status', 'done').is('superseded_by', null)),
    pages(() => supabase.from('quizzes').select('id, video_id').eq('quiz_source', 'video').eq('status', 'ready')
      .not('video_id', 'is', null)),
  ]);
  const quizOf = new Map();
  for (const q of quizzes) if (!quizOf.has(q.video_id)) quizOf.set(q.video_id, q.id);
  const live = rows.filter((r) => quizOf.has(r.id) && r.r2_url);
  return { at: Date.now(), rows: live, quizOf };
}

function refresh() {
  if (!loading) {
    loading = loadIndex().then((ix) => { index = ix; return ix; }).finally(() => { loading = null; });
    track(loading.catch((e) => logToFile('⚠️ web-quiz library: bank unavailable', { error: e.message })));
  }
  return loading;
}

/** The index: fresh, or stale while a refresh runs; the first caller of a cold process waits. */
async function bank() {
  if (index && Date.now() - index.at < INDEX_TTL_MS) return index;
  if (index) { refresh(); return index; }
  return refresh();
}

// ─── each video's language (app_settings web_quiz_videos_v3 only) ────────────
// Its own read and its own 10-minute cache, so the bank's read above is the same with the switch off.
// A failed read (no language column yet) is no language for any video: nothing is filtered out.

let langs = null;     // { at, of: Map(video_id -> 'en'|'ur') | null }
let langsLoading = null;
async function loadLanguages() {
  try {
    const rows = await pages(() => supabase.from('student_videos').select('id, language')
      .eq('migration_status', 'done').is('superseded_by', null));
    const of = new Map();
    for (const r of rows) if (r.language === 'en' || r.language === 'ur') of.set(r.id, r.language);
    return { at: Date.now(), of };
  } catch (e) {
    logToFile('⚠️ web-quiz library: video languages unavailable — none filtered', { error: e.message });
    return { at: Date.now(), of: null };
  }
}

/** Map(video_id -> 'en'|'ur') for the videos that have a language, or null when it could not be read. */
async function languages() {
  if (langs && Date.now() - langs.at < INDEX_TTL_MS) return langs.of;
  if (!langsLoading) langsLoading = loadLanguages().then((x) => { langs = x; return x; }).finally(() => { langsLoading = null; });
  return (await langsLoading).of;
}

// ─── each lesson's Urdu-script name (app_settings web_quiz_videos_ur_titles only) ───────────────
// Its own read and its own 10-minute cache, like the languages above, so the bank's read is the same with the switch off.
// A failed read (no column yet) is no Urdu name for any video: the door keeps today's titles.

let urNames = null;     // { at, of: Map(video_id -> {t, c}) | null }
let urLoading = null;
async function loadUrNames() {
  try {
    const rows = await pages(() => supabase.from('student_videos').select('id, title_ur, chapter_ur')
      .eq('migration_status', 'done').is('superseded_by', null));
    const of = new Map();
    const str = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
    for (const r of rows) if (str(r.title_ur) || str(r.chapter_ur)) of.set(r.id, { t: str(r.title_ur), c: str(r.chapter_ur) });
    return { at: Date.now(), of };
  } catch (e) {
    logToFile('⚠️ web-quiz library: Urdu video names unavailable — none shown', { error: e.message });
    return { at: Date.now(), of: null };
  }
}

/** Map(video_id -> {t: title_ur|null, c: chapter_ur|null}) for the lessons that have one, or null when unreadable. */
async function urTitles() {
  if (urNames && Date.now() - urNames.at < INDEX_TTL_MS) return urNames.of;
  if (!urLoading) urLoading = loadUrNames().then((x) => { urNames = x; return x; }).finally(() => { urLoading = null; });
  return (await urLoading).of;
}

// ─── the child ───────────────────────────────────────────────────────────────

const studentOfSession = new Map();
async function studentFromSt(st, shareCodeId) {
  const tok = st ? T.verify(st, 's') : null;
  if (!tok || !tok.sid || tok.sc !== shareCodeId) return null;
  if (studentOfSession.has(tok.sid)) return studentOfSession.get(tok.sid);
  const { data } = await supabase.from('quiz_sessions').select('student_id').eq('id', tok.sid).maybeSingle();
  const sid = (data && data.student_id) || null;
  if (sid) {
    if (studentOfSession.size > 5000) studentOfSession.clear();
    studentOfSession.set(tok.sid, sid);
  }
  return sid;
}

async function doneQuizzes(studentId, quizIds) {
  if (!studentId || !quizIds.length) return new Set();
  const { data } = await supabase.from('quiz_sessions').select('quiz_id')
    .eq('student_id', studentId).eq('status', 'completed').in('quiz_id', quizIds);
  return new Set((data || []).map((r) => r.quiz_id));
}

/** The class's live code for each quiz: ONE query over every quiz shown. -> Map(quizId -> {code, id}) */
async function classCodes(rootId, quizIds) {
  if (!rootId || !quizIds.length) return new Map();
  const { data } = await supabase.from('quiz_share_codes').select('id, code, quiz_id, active, expires_at, created_at')
    .eq('parent_share_code_id', rootId).in('quiz_id', quizIds).is('invited_by_student_id', null);
  const now = new Date();
  const out = new Map();
  for (const c of (data || [])) {
    if (c.active === false || (c.expires_at && new Date(c.expires_at) <= now)) continue;
    const had = out.get(c.quiz_id);
    if (!had || String(c.created_at || '') > String(had.created_at || '')) out.set(c.quiz_id, c);
  }
  return new Map([...out].map(([k, v]) => [k, { code: v.code, id: v.id }]));
}

// ─── "Next in this chapter" ──────────────────────────────────────────────────

/**
 * The lesson after a finished video quiz: the next video of the same grade and subject in the
 * Flow's order that this child has not finished — the rest of this chapter first, then the next
 * chapters, then (wrapping) the earlier ones. Null for a lesson quiz, or when nothing is left.
 * Never throws (the scorecard must not fail over a suggestion).
 * @param {{quizId: string, studentId?: string|null, shareCodeId: string}} at
 * @returns {Promise<{vid, title, chapter, subject, grade, poster?, code?}|null>}
 */
async function nextInChapter({ quizId, studentId, shareCodeId }) {
  try {
    const ix = await bank();
    if (!ix) return null;
    const videoOf = ix.videoOf || (ix.videoOf = new Map([...ix.quizOf].map(([v, q]) => [q, v])));
    const vid = videoOf.get(quizId);
    const row = vid && ix.rows.find((r) => r.id === vid);
    if (!row) return null;
    const list = ix.rows.filter((r) => r.grade === row.grade && r.subject === row.subject).sort(Order.compareVideos);
    const at = list.findIndex((r) => r.id === vid);
    const after = list.slice(at + 1).concat(list.slice(0, at));
    if (!after.length) return null;
    const done = await doneQuizzes(studentId, after.map((r) => ix.quizOf.get(r.id)));
    const next = after.find((r) => !done.has(ix.quizOf.get(r.id)));
    if (!next) return null;
    const { data: sc } = await supabase.from('quiz_share_codes').select('id, parent_share_code_id').eq('id', shareCodeId).maybeSingle();
    const rootId = (sc && (sc.parent_share_code_id || sc.id)) || shareCodeId;
    const nq = ix.quizOf.get(next.id);
    const [codes, poster] = await Promise.all([
      classCodes(rootId, [nq]),
      require('./web-quiz-media').signPoster(next.r2_url),
    ]);
    const out = { vid: next.id, title: next.clean_title || '', chapter: next.clean_chapter || '', subject: next.subject, grade: String(next.grade) };
    if (poster) out.poster = poster;
    if (codes.has(nq)) out.code = codes.get(nq).code;
    return out;
  } catch (e) {
    logToFile('⚠️ web-quiz bank: no next lesson', { error: e.message });
    return null;
  }
}

module.exports = {
  bank, refresh, track, studentFromSt, doneQuizzes, classCodes, nextInChapter, languages, urTitles,
  _reset: () => { index = null; loading = null; langs = null; langsLoading = null; urNames = null; urLoading = null; studentOfSession.clear(); },
  _idle: async () => { while (background.size) await Promise.all([...background]); },
};
