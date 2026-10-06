'use strict';
/**
 * "Watch another video" on the web child quiz: the video-bank lessons a child can
 * watch next, and the code each one plays under.
 *
 *   list(code, {st})        up to 8 lessons of the quiz's grade, same subject first:
 *                           title, chapter, minutes, MB, poster when one exists, done
 *                           when this child has already finished its quiz.
 *   start({code, st, vid})  the code for that lesson's quiz: ONE per (class code, video
 *                           quiz), reused by every child of the class, minted on first
 *                           use with the teacher's attribution (teacher_user_id,
 *                           teacher_name) and parent_share_code_id = the class code.
 *
 * A "more videos" code has a parent and no inviter. resolveCode collapses a code to its
 * parent only when it has an inviter (a friend's challenge), so this one plays its own
 * quiz and has its own league, and startSession schedules no 12-hour teacher report for
 * it: the teacher did not send it, and a report is a paid WhatsApp message. The child's
 * scores still reach their history (E7 reads every finished session of the child).
 *
 * Today's WhatsApp equivalent is the binge offer (video-quiz-binge.service.js), which
 * opens the Student Videos Flow; the same student_videos rows and quizzes serve both.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');

const LIST_MAX = 8;
const CODE_DAYS = 30;
const META_TTL_MS = 6 * 60 * 60 * 1000;
const HEAD_BYTES = 65535;
const VID_RX = /^[0-9a-f-]{36}$/i;
const { GRADE_ORDER } = require('./video-bank-order');

// The quiz row's subject (lesson quizzes write lower-case short names) -> the video bank's.
const SUBJECTS = {
  maths: 'Maths', math: 'Maths', mathematics: 'Maths',
  science: 'Science', 'general science': 'Science',
  english: 'English', urdu: 'Urdu',
  islamiat: 'Islamic Studies', islamiyat: 'Islamic Studies', 'islamic studies': 'Islamic Studies',
  'general knowledge': 'General Knowledge', gk: 'General Knowledge',
  sst: 'General Knowledge', 'social studies': 'General Knowledge',
  geography: 'Geography', history: 'History',
};

/** '3' -> ['3']; '3-5' -> ['3','4','5']; 'Grade 2' -> ['2']; 'KG' -> ['KG']. Pure. */
function gradesFor(grade) {
  const g = String(grade == null ? '' : grade).trim().toUpperCase().replace(/^GRADE\s*/, '');
  if (!g) return [];
  if (GRADE_ORDER.includes(g)) return [g];
  const band = /^(\d+)\s*-\s*(\d+)$/.exec(g);
  if (band) {
    const out = [];
    for (let n = Number(band[1]); n <= Number(band[2]); n += 1) if (GRADE_ORDER.includes(String(n))) out.push(String(n));
    return out;
  }
  return [];
}

function subjectFor(subject) {
  const s = String(subject || '').trim();
  return SUBJECTS[s.toLowerCase()] || (s ? s : null);
}

/** Same subject first, then lessons the child has not done, then the bank's own order. Pure. */
function pick(rows, { subject, exclude, done, max = LIST_MAX }) {
  const rank = (r) => [r.subject === subject ? 0 : 1, done.has(r.id) ? 1 : 0, GRADE_ORDER.indexOf(String(r.grade))];
  return rows
    .filter((r) => r.id !== exclude)
    .map((r, i) => ({ r, i, k: rank(r) }))
    .sort((a, b) => (a.k[0] - b.k[0]) || (a.k[1] - b.k[1]) || (a.k[2] - b.k[2]) || (a.i - b.i))
    .slice(0, max)
    .map((x) => x.r);
}

// ─── length and poster of a lesson (read once per process, never stored) ────

/** Seconds from an MP4's movie header (mvhd). The bank's files are fast-start, so it sits in the first 64 KB. Pure. */
function mp4Seconds(buf) {
  if (!buf || !buf.length) return null;
  const at = buf.indexOf('mvhd');
  if (at < 4 || at + 32 > buf.length) return null;
  const ver = buf[at + 4];
  let scale; let dur;
  if (ver === 1) {
    scale = buf.readUInt32BE(at + 24);
    dur = Number(buf.readBigUInt64BE(at + 28));
  } else {
    scale = buf.readUInt32BE(at + 16);
    dur = buf.readUInt32BE(at + 20);
  }
  return scale > 0 && dur > 0 ? Math.round(dur / scale) : null;
}

const metaCache = new Map();

async function lessonMeta(videoId, { fetchImpl } = {}) {
  const hit = metaCache.get(videoId);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.v;
  let v = null;
  try {
    const media = require('./web-quiz-media');
    const pv = await media.presignVideo({ video_id: videoId }, { db: supabase, expiresIn: META_TTL_MS / 1000 });
    if (pv && pv.url) {
      v = { bytes: pv.bytes || null, poster: pv.poster || null, secs: null };
      try {
        const f = fetchImpl || ((...a) => fetch(...a));
        const res = await f(pv.url, { headers: { range: `bytes=0-${HEAD_BYTES}` } });
        if (res && (res.status === 206 || res.status === 200)) v.secs = mp4Seconds(Buffer.from(await res.arrayBuffer()));
      } catch (_) { /* no length shown, the lesson still is */ }
    }
  } catch (e) {
    logToFile('⚠️ web-quiz videos: lesson details unavailable', { videoId, error: e.message });
  }
  metaCache.set(videoId, { at: Date.now(), v });
  return v;
}

/** A lesson's cached details without fetching: undefined when not (or no longer) cached. */
function peekMeta(videoId) {
  const hit = metaCache.get(videoId);
  return hit && Date.now() - hit.at < META_TTL_MS ? hit.v : undefined;
}

// Lessons being warmed right now: one fetch per lesson, however many lists ask.
const warming = new Map();
/** Read the details of uncached lessons in the background, a few at a time. Resolves when done; never throws. */
function warmMeta(videoIds, { fetchImpl, concurrency = 4 } = {}) {
  const todo = [...new Set(videoIds)].filter((id) => peekMeta(id) === undefined && !warming.has(id));
  if (!todo.length) return Promise.all([...warming.values()]).then(() => undefined);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++];
      const p = lessonMeta(id, { fetchImpl }).catch(() => null);
      warming.set(id, p);
      try { await p; } finally { warming.delete(id); }
    }
  };
  return Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker)).then(() => undefined);
}

// ─── list ───────────────────────────────────────────────────────────────────

async function finishedVideoQuizzes(st) {
  const tok = T.verify(st, 's');
  if (!tok || !tok.sid) return new Set();
  const { data: s } = await supabase.from('quiz_sessions').select('student_id').eq('id', tok.sid).maybeSingle();
  if (!s || !s.student_id) return new Set();
  const { data: rows } = await supabase.from('quiz_sessions').select('quiz_id')
    .eq('student_id', s.student_id).eq('status', 'completed').limit(200);
  return new Set((rows || []).map((r) => r.quiz_id).filter(Boolean));
}

function requireOn(WebQuiz) {
  if (!T.secret()) throw new WebQuiz.WqError(503, { error: 'web_quiz_off' });
}

async function list(code, { st, fetchImpl } = {}) {
  const WebQuiz = require('./web-quiz.service');
  requireOn(WebQuiz);
  const ctx = await WebQuiz.resolveCode(code);
  const { data: quiz } = await supabase.from('quizzes').select('id, grade, subject, video_id').eq('id', ctx.quizId).maybeSingle();
  const grades = gradesFor(quiz && quiz.grade);
  const subject = subjectFor(quiz && quiz.subject);
  const out = { grade: grades[0] || null, subject, videos: [] };
  if (!grades.length) return out;

  const { data: vids, error } = await supabase.from('student_videos')
    .select('id, grade, subject, clean_chapter, clean_title')
    .eq('migration_status', 'done').is('superseded_by', null).in('grade', grades).limit(400);
  if (error) {
    logToFile('⚠️ web-quiz videos: bank unavailable', { error: error.message });
    return out;
  }
  const rows = vids || [];
  if (!rows.length) return out;
  const { data: quizzes } = await supabase.from('quizzes').select('id, video_id')
    .in('video_id', rows.map((r) => r.id)).eq('quiz_source', 'video').eq('status', 'ready');
  const quizOf = new Map((quizzes || []).map((q) => [q.video_id, q.id]));
  const playable = rows.filter((r) => quizOf.has(r.id));

  const finished = st ? await finishedVideoQuizzes(st) : new Set();
  const done = new Set(playable.filter((r) => finished.has(quizOf.get(r.id))).map((r) => r.id));
  const chosen = pick(playable, { subject, exclude: (ctx.parent && ctx.parent.video_id) || (quiz && quiz.video_id) || null, done });

  const metas = await Promise.all(chosen.map((r) => lessonMeta(r.id, { fetchImpl })));
  out.videos = chosen.map((r, i) => {
    const m = metas[i] || {};
    const item = { vid: r.id, title: r.clean_title || '', chapter: r.clean_chapter || '', subject: r.subject, grade: r.grade };
    if (m.secs) item.secs = m.secs;
    if (m.bytes) item.mb = Math.round(m.bytes / 100000) / 10;
    if (m.poster) item.poster = m.poster;
    if (done.has(r.id)) item.done = true;
    return item;
  });
  logEvent('web_quiz.more_videos_listed', { shareCodeId: ctx.shareCodeId, quizId: ctx.quizId, grade: out.grade, subject, n: out.videos.length });
  return out;
}

// ─── start ──────────────────────────────────────────────────────────────────

/** The class code a "more videos" code hangs off: its parent when it is one itself, else this code. */
function classRootId(ctx) {
  const r = ctx.row || {};
  return r.parent_share_code_id && !r.invited_by_student_id ? r.parent_share_code_id : ctx.shareCodeId;
}

/** The kid's hub (M4a's module, optional here: loaded by path so a deployment without it answers 503). */
function hubModule() {
  try { return require(require('path').join(__dirname, 'web-quiz-hub')); } catch (_) { return null; }
}

/** One code per (class code, video quiz): the live one, else minted with the class code's teacher. -> {id, code} */
async function codeFor({ rootId, root, vq, video, vid, lang, fail }) {
  const { data: have } = await supabase.from('quiz_share_codes').select('id, code, active, expires_at')
    .eq('parent_share_code_id', rootId).eq('quiz_id', vq.id).is('invited_by_student_id', null).limit(5);
  const live = (have || []).find((c) => c.active !== false && (!c.expires_at || new Date(c.expires_at) > new Date()));
  if (live) {
    logEvent('web_quiz.more_video_code', { shareCodeId: rootId, videoId: vid, quizId: vq.id, reused: true });
    return live;
  }
  let r = root;
  if (!r || r.id !== rootId) {
    const { data } = await supabase.from('quiz_share_codes')
      .select('id, teacher_user_id, teacher_name, language').eq('id', rootId).maybeSingle();
    r = data;
  }
  if (!r) fail(404, 'not_found');
  const { randomCode } = require('./video-quiz-share.service');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase.from('quiz_share_codes').insert({
      code: randomCode(), quiz_id: vq.id, video_id: vid,
      teacher_user_id: r.teacher_user_id, teacher_name: r.teacher_name,
      topic: video.clean_title || vq.topic || null, language: r.language || lang,
      parent_share_code_id: rootId, invited_by_student_id: null, active: true,
      expires_at: new Date(Date.now() + CODE_DAYS * 86400000).toISOString(),
    }).select('id, code').single();
    if (!error && data) {
      logEvent('web_quiz.more_video_code', { shareCodeId: rootId, videoId: vid, quizId: vq.id, reused: false, newShareCodeId: data.id });
      return data;
    }
    if (error && error.code !== '23505') {
      logToFile('❌ web-quiz videos: could not mint a code', { error: error.message }, 'error');
      break;
    }
  }
  return fail(502, 'db_unavailable');
}

async function lessonOf(vid, fail) {
  const [{ data: video }, { data: vq }] = await Promise.all([
    supabase.from('student_videos').select('id, clean_title, migration_status, superseded_by').eq('id', vid).maybeSingle(),
    supabase.from('quizzes').select('id, topic, status').eq('video_id', vid).eq('quiz_source', 'video').maybeSingle(),
  ]);
  if (!video || video.migration_status !== 'done' || !vq || vq.status !== 'ready') fail(404, 'not_found');
  return { video, vq };
}

/**
 * From a quiz page: {code, st, vid} -> {code}. From the kid's hub: {hub, kid, vid} -> {code, k},
 * rooted at the newest teacher-sent code the child played (kidFromHub().rootId; none -> 409 no_class),
 * with k = the child's chip on that code so the page starts as them with no picking.
 */
async function start(body = {}) {
  const WebQuiz = require('./web-quiz.service');
  requireOn(WebQuiz);
  const fail = (status, error) => { throw new WebQuiz.WqError(status, { error }); };
  const vid = String(body.vid || '');
  if (body.hub) {
    const Hub = hubModule();
    if (!Hub || typeof Hub.kidFromHub !== 'function') fail(503, 'hub_off');
    const who = await Hub.kidFromHub(String(body.hub), body.kid == null ? null : String(body.kid));
    if (!who || !who.studentId) fail(401, 'bad_token');
    if (!who.rootId) fail(409, 'no_class');
    if (!VID_RX.test(vid)) fail(400, 'bad_request');
    const { video, vq } = await lessonOf(vid, fail);
    const c = await codeFor({ rootId: who.rootId, root: null, vq, video, vid, lang: 'en', fail });
    return { code: c.code, k: T.chipId(c.id, who.studentId) };
  }
  const ctx = await WebQuiz.resolveCode(body.code);
  const tok = T.verify(body.st, 's');
  if (!tok || tok.sc !== ctx.shareCodeId) fail(401, 'bad_token');
  if (!VID_RX.test(vid)) fail(400, 'bad_request');
  const { video, vq } = await lessonOf(vid, fail);
  const c = await codeFor({ rootId: classRootId(ctx), root: ctx.parent, vq, video, vid, lang: ctx.lang, fail });
  return { code: c.code };
}

module.exports = { list, start, gradesFor, subjectFor, pick, mp4Seconds, classRootId, peekMeta, warmMeta, LIST_MAX, VID_RX, _metaCache: metaCache };
