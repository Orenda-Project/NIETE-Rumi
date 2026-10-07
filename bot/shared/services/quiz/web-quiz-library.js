'use strict';
/**
 * The web video library: a child picks SUBJECT (with a grade strip) → CHAPTER → video, in the
 * WhatsApp Student Videos Flow's own order (video-bank-order.js).
 *
 *   lib(code, {st, g, s})      the library seen from a quiz the child is in
 *     no s  → { grade, grades:[{g, n, art}], subjects:[{key, n, art}], mine? }  (mine: the quiz's own subject)
 *     s     → { grade, subject, art, chapters:[{name, videos:[{vid, title, secs?, mb?, poster?, done?, code?}]}] }
 *   libHub(token, {kid, g, s}) the same, seen from the kid's hub (the hub module names the child)
 *
 * Fast by construction (the "watch more" list used to cost ~40 R2 calls on a cold process):
 *   - the bank (every live row and its ready video-quiz id) is held in memory and refreshed every
 *     10 minutes, one refresh at a time; a stale index still answers while the refresh runs;
 *   - posters are signed without asking R2 if they exist (the page falls back to the subject art);
 *   - lengths and sizes come only from web-quiz-videos' cache, uncached ones are read after answering;
 *   - "done" is one query, and the class's existing code for each video is one query, so the page can
 *     open a lesson without minting (POST /videos/start is only for a class's first-ever play).
 *
 * Off unless app_settings `web_quiz_library` is true: then 404 library_off and the page keeps
 * today's 8-item list (web-quiz-videos.list).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const Order = require('./video-bank-order');

const INDEX_TTL_MS = 10 * 60 * 1000;
const PAGE = 1000;

// The library's pictures (dashboard/public/wq/art, one-year cache: a new picture gets a new number).
const ART_V = 1;
const ART_EXT = 'webp';
const SUBJECT_SLUG = {
  English: 'english', Maths: 'maths', Urdu: 'urdu', Science: 'science', Geography: 'geography',
  'General Knowledge': 'gk', History: 'history', 'Islamic Studies': 'islamic',
};
const subjectArt = (s) => (SUBJECT_SLUG[s] ? `/wq/art/subject-${SUBJECT_SLUG[s]}-${ART_V}.${ART_EXT}` : null);
const gradeArt = (g) => (Order.GRADE_ORDER.includes(String(g)) ? `/wq/art/grade-${String(g).toLowerCase()}-${ART_V}.${ART_EXT}` : null);

// ─── flag ────────────────────────────────────────────────────────────────────

const { libraryOn, FLAG_KEY } = require('./web-quiz-library-flag');

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

/** The class's live code for each quiz: ONE query over every quiz shown. */
async function classCodes(rootId, quizIds) {
  if (!rootId || !quizIds.length) return new Map();
  const { data } = await supabase.from('quiz_share_codes').select('code, quiz_id, active, expires_at, created_at')
    .eq('parent_share_code_id', rootId).in('quiz_id', quizIds).is('invited_by_student_id', null);
  const now = new Date();
  const out = new Map();
  for (const c of (data || [])) {
    if (c.active === false || (c.expires_at && new Date(c.expires_at) <= now)) continue;
    const had = out.get(c.quiz_id);
    if (!had || String(c.created_at || '') > String(had.created_at || '')) out.set(c.quiz_id, c);
  }
  return new Map([...out].map(([k, v]) => [k, v.code]));
}

// ─── the views ───────────────────────────────────────────────────────────────

function subjectsView(ix, grade) {
  const byGrade = new Map();
  const bySubject = new Map();
  for (const r of ix.rows) {
    byGrade.set(String(r.grade), (byGrade.get(String(r.grade)) || 0) + 1);
    if (String(r.grade) === grade) bySubject.set(r.subject, (bySubject.get(r.subject) || 0) + 1);
  }
  const grades = [...byGrade.keys()].filter((g) => Order.GRADE_ORDER.includes(g))
    .sort((a, b) => Order.gradeRank(a) - Order.gradeRank(b))
    .map((g) => ({ g, n: byGrade.get(g), art: gradeArt(g) }));
  const subjects = [...bySubject.keys()].filter(Boolean).sort(Order.compareSubjects)
    .map((s) => ({ key: s, n: bySubject.get(s), art: subjectArt(s) }));
  return { grade, grades, subjects };
}

async function chaptersView(ix, { grade, subject, studentId, rootId, fetchImpl }) {
  const Videos = require('./web-quiz-videos');
  const Media = require('./web-quiz-media');
  const rows = ix.rows.filter((r) => String(r.grade) === grade && r.subject === subject).sort(Order.compareVideos);
  const quizIds = rows.map((r) => ix.quizOf.get(r.id));
  const [done, codes, posters] = await Promise.all([
    doneQuizzes(studentId, quizIds),
    classCodes(rootId, quizIds),
    Promise.all(rows.map((r) => Media.signPoster(r.r2_url))),
  ]);
  const chapters = [];
  const missing = [];
  rows.forEach((r, i) => {
    const qid = quizIds[i];
    const v = { vid: r.id, title: r.clean_title || '' };
    const m = Videos.peekMeta(r.id);
    if (m === undefined) missing.push(r.id);
    if (m && m.secs) v.secs = m.secs;
    if (m && m.bytes) v.mb = Math.round(m.bytes / 100000) / 10;
    if (posters[i]) v.poster = posters[i];
    if (done.has(qid)) v.done = true;
    if (codes.has(qid)) v.code = codes.get(qid);
    const name = r.clean_chapter || '';
    const last = chapters[chapters.length - 1];
    if (last && last.name.toLowerCase() === name.toLowerCase()) last.videos.push(v);
    else chapters.push({ name, videos: [v] });
  });
  // Lengths and sizes for next time, read after this answer has gone.
  if (missing.length) track(new Promise((res) => setImmediate(res)).then(() => Videos.warmMeta(missing, { fetchImpl })));
  return { grade, subject, art: subjectArt(subject), chapters };
}

async function view(ix, { grade, g, s, studentId, rootId, fetchImpl }) {
  const want = Order.GRADE_ORDER.includes(String(g || '').toUpperCase()) ? String(g).toUpperCase() : grade;
  if (!want) return { grade: null, grades: subjectsView(ix, '').grades, subjects: [] };
  if (!s) return subjectsView(ix, want);
  return chaptersView(ix, { grade: want, subject: String(s).slice(0, 60), studentId, rootId, fetchImpl });
}

/** A grade band's quiz ("3-5", 38% of quizzes): the child's own grade when it is inside the band. */
async function childGradeIn(band, st, shareCodeId) {
  const tok = st ? T.verify(st, 's') : null;
  if (!tok || !tok.sid || tok.sc !== shareCodeId) return null;
  const pick = (v) => {
    const m = /\d+/.exec(String(v || ''));
    return m && band.includes(String(Number(m[0]))) ? String(Number(m[0])) : null;
  };
  const { data: sess } = await supabase.from('quiz_sessions').select('student_class, student_id').eq('id', tok.sid).maybeSingle();
  const own = sess && pick(sess.student_class);
  if (own || !sess || !sess.student_id) return own || null;
  const { data: kid } = await supabase.from('students').select('self_reported_class').eq('id', sess.student_id).maybeSingle();
  return (kid && pick(kid.self_reported_class)) || null;
}

async function guard() {
  const WebQuiz = require('./web-quiz.service');
  if (!T.secret()) throw new WebQuiz.WqError(503, { error: 'web_quiz_off' });
  if (!(await libraryOn())) throw new WebQuiz.WqError(404, { error: 'library_off' });
  return WebQuiz;
}

async function lib(code, { st, g, s, fetchImpl } = {}) {
  const WebQuiz = await guard();
  const Videos = require('./web-quiz-videos');
  const ctx = await WebQuiz.resolveCode(code);
  const [ix, { data: quiz }, studentId] = await Promise.all([
    bank(),
    supabase.from('quizzes').select('id, grade, subject').eq('id', ctx.quizId).maybeSingle(),
    s ? studentFromSt(st, ctx.shareCodeId) : Promise.resolve(null),
  ]);
  const band = Videos.gradesFor(quiz && quiz.grade);
  const grade = (band.length > 1 && !g ? await childGradeIn(band, st, ctx.shareCodeId) : null) || band[0] || null;
  const out = await view(ix, { grade, g, s, studentId, rootId: Videos.classRootId(ctx), fetchImpl });
  if (!s) {
    // The quiz's own subject, when the bank has it for this grade: "Watch another video" opens it.
    const mine = Videos.subjectFor(quiz && quiz.subject);
    if (mine && (out.subjects || []).some((x) => x.key === mine)) out.mine = mine;
  }
  logEvent('web_quiz.lib_view', { shareCodeId: ctx.shareCodeId, g: out.grade, s: out.subject || undefined,
    n: out.chapters ? out.chapters.reduce((a, c) => a + c.videos.length, 0) : (out.subjects || []).length });
  return out;
}

/**
 * The library from the kid's hub. The hub module (web-quiz-hub.js, M4a) names the child from its
 * token: kidFromHub(token, chip) -> {studentId, grade, rootId} | null.
 */
async function libHub(token, { kid, g, s, fetchImpl } = {}) {
  const WebQuiz = await guard();
  // The hub module is M4a's and optional here: loaded by path so a deployment without it answers
  // hub_off instead of failing to boot.
  let Hub;
  try { Hub = require(require('path').join(__dirname, 'web-quiz-hub')); } catch (_) { Hub = null; }
  if (!Hub || typeof Hub.kidFromHub !== 'function') throw new WebQuiz.WqError(503, { error: 'hub_off' });
  const who = await Hub.kidFromHub(token, kid);
  if (!who) throw new WebQuiz.WqError(401, { error: 'bad_token' });
  const Videos = require('./web-quiz-videos');
  const ix = await bank();
  const grade = Videos.gradesFor(who.grade)[0] || null;
  const out = await view(ix, { grade, g, s, studentId: who.studentId || null, rootId: who.rootId || null, fetchImpl });
  logEvent('web_quiz.lib_view', { hub: 1, g: out.grade, s: out.subject || undefined });
  return out;
}

// ─── download ────────────────────────────────────────────────────────────────

const slug = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
/** "science-grade3-parts-of-a-flower.mp4" (ASCII only: the name travels in a signed header). */
function fileName(row) {
  const name = [slug(row.subject), `grade${slug(row.grade)}`, slug(row.clean_title)].filter((x) => x && x !== 'grade').join('-');
  return `${name || 'video'}.mp4`;
}

/** GET /videos/dl/:code?st&vid -> {redirect}: a 1-hour link that saves the video. Not behind the library flag. */
async function download(code, { st, vid } = {}) {
  const WebQuiz = require('./web-quiz.service');
  const Videos = require('./web-quiz-videos');
  if (!T.secret()) throw new WebQuiz.WqError(503, { error: 'web_quiz_off' });
  const ctx = await WebQuiz.resolveCode(code);
  const tok = st ? T.verify(st, 's') : null;
  if (!tok || tok.sc !== ctx.shareCodeId) throw new WebQuiz.WqError(401, { error: 'bad_token' });
  const id = String(vid || '');
  if (!Videos.VID_RX.test(id)) throw new WebQuiz.WqError(400, { error: 'bad_request' });
  const { data: row } = await supabase.from('student_videos')
    .select('id, grade, subject, clean_title, r2_url, migration_status').eq('id', id).maybeSingle();
  if (!row || row.migration_status !== 'done' || !row.r2_url) throw new WebQuiz.WqError(404, { error: 'not_found' });
  const url = await require('./web-quiz-media').presignDownload(row.r2_url, fileName(row), { expiresIn: 3600 });
  if (!url) throw new WebQuiz.WqError(404, { error: 'not_found' });
  logEvent('web_quiz.video_download', { shareCodeId: ctx.shareCodeId, videoId: id });
  return { redirect: url };
}

module.exports = {
  lib, libHub, download, fileName, libraryOn, subjectArt, gradeArt, FLAG_KEY,
  _reset: () => { index = null; loading = null; require('./web-quiz-library-flag')._reset(); studentOfSession.clear(); },
  _idle: async () => { while (background.size) await Promise.all([...background]); },
};
