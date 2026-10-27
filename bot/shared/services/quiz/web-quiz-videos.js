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
 *   start({hub, kid, vid})  a child with no class code yet (web_quiz_home_v3 on): {watch} — the lesson's own signed
 *                           video, no code minted; with {after:1} the quiz after it, on a code of the child's own
 *                           under the watch root (app_settings VALUE web_quiz_watch_root). Switch off: 409 no_class.
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
const { clampLanguage } = require('../../config/ux-strings');

const LIST_MAX = 8;
const CODE_DAYS = 30;
const META_TTL_MS = 6 * 60 * 60 * 1000;
const HEAD_BYTES = 65535;
const VID_RX = /^[0-9a-f-]{36}$/i;
const WATCH_TTL_S = 6 * 60 * 60;
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

// ─── length and poster of a lesson (read once per process; the grade warm-up's reads also kept in Redis) ────

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
/** Read the details of uncached lessons in the background, a few at a time. Resolves when done; never throws.
 *  `keep` (the grade warm-up, web_quiz_video_shelf): each whole read is also kept in Redis for the rest of its life. */
function warmMeta(videoIds, { fetchImpl, concurrency = 4, keep = false } = {}) {
  const todo = [...new Set(videoIds)].filter((id) => peekMeta(id) === undefined && !warming.has(id));
  if (!todo.length) return Promise.all([...warming.values()]).then(() => undefined);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++];
      const p = lessonMeta(id, { fetchImpl }).catch(() => null).then((v) => (keep ? keepMeta(id).then(() => v) : v));
      warming.set(id, p);
      try { await p; } finally { warming.delete(id); }
    }
  };
  return Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker)).then(() => undefined);
}

// web_quiz_video_shelf: a restart (a deploy) empties the memory above, so the grade warm-up's whole reads are kept in
// Redis with what is left of their life, and the first warm-up after a restart reads them all back once (one scan).
const KEEP_PREFIX = 'wq:vmeta:';
async function keepMeta(id) {
  const hit = metaCache.get(id);
  if (!hit || !hit.v || !hit.v.secs) return; // a read without its length is read again after a restart
  const left = Math.floor((hit.at + META_TTL_MS - Date.now()) / 1000);
  if (left <= 0) return;
  try { await require('../cache/railway-redis.service').set(KEEP_PREFIX + id, { id, at: hit.at, v: hit.v }, left); } catch (_) { /* memory still has it */ }
}
let restored = null;
/** Read back the kept lessons once per process; one already in memory stays. Never throws. */
function restoreMeta() {
  if (!restored) {
    restored = (async () => {
      try {
        const rows = await require('../cache/railway-redis.service').scanValues(`${KEEP_PREFIX}*`);
        for (const raw of rows || []) {
          let e;
          try { e = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { continue; }
          if (!e || !VID_RX.test(String(e.id)) || typeof e.at !== 'number' || !e.v || metaCache.has(e.id)) continue;
          if (Date.now() - e.at < META_TTL_MS) metaCache.set(e.id, { at: e.at, v: e.v });
        }
      } catch (_) { /* nothing read back: the warm-up reads the files */ }
    })();
  }
  return restored;
}
/** Drop one lesson's details from memory (a read that did not come back whole). */
function forgetMeta(id) { metaCache.delete(id); }

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

/**
 * One code per (class code, video quiz): the live one, else minted with the class code's teacher. -> {id, code}
 * The code's language (its page's language and direction) is the LESSON's (`lang`), never the class code's:
 * an Urdu lesson tapped from an English class is an Urdu page. (A live code minted in the class's language
 * before this rule is corrected by the page's boot, getQuiz, which every lesson code passes through.)
 */
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
      topic: video.clean_title || vq.topic || null, language: lang,
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
    supabase.from('quizzes').select('id, topic, status, language').eq('video_id', vid).eq('quiz_source', 'video').maybeSingle(),
  ]);
  if (!video || video.migration_status !== 'done' || !vq || vq.status !== 'ready') fail(404, 'not_found');
  return { video, vq, lang: await lessonLanguage(vq) };
}

/**
 * The lesson quiz's language, by the rule its clips are recorded in (the row's, else its questions' script):
 * bank video quizzes carry no language of their own, so an Urdu lesson is known by its Urdu questions.
 */
async function lessonLanguage(vq) {
  const { quizLanguage } = require('./web-quiz-publish.service');
  const { data: qs } = vq.language ? { data: [] }
    : await supabase.from('quiz_questions').select('question_text, option_a').eq('quiz_id', vq.id).limit(3);
  return clampLanguage(quizLanguage(vq, qs || []));
}

// ─── watch-only: a child with no class code yet (web_quiz_home_v3) ──────────

const { WATCH_ROOT_KEY, rootOf } = require('./watch-root');   // the one spelling of the key and one parser

/** The watch root: a share code id from the VALUE key (watch-root.js's parser), or null. Fails closed. */
async function watchRoot() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', WATCH_ROOT_KEY).maybeSingle();
    return rootOf(data && data.value);
  } catch (_) {
    return null;
  }
}

/**
 * The quiz after a watched video, for a child with no class: a code of the child's OWN under the watch root (a code's
 * league is everyone who played it, and class-less children are strangers from different schools), reused once the
 * child has played it. A child code (parent set, no inviter) schedules no teacher report and never reads as
 * teacher-sent on the hub, so the child stays class-less. -> {id, code}
 */
async function watchCodeFor({ rootId, vq, video, vid, lang, studentId, fail }) {
  const { data: played } = await supabase.from('quiz_sessions').select('share_code_id')
    .eq('student_id', studentId).eq('quiz_id', vq.id).limit(20);
  const ids = [...new Set((played || []).map((r) => r.share_code_id).filter(Boolean))];
  if (ids.length) {
    const { data: mine } = await supabase.from('quiz_share_codes').select('id, code, active, expires_at, parent_share_code_id, invited_by_student_id')
      .in('id', ids).eq('parent_share_code_id', rootId).is('invited_by_student_id', null);
    const live = (mine || []).find((c) => c.active !== false && (!c.expires_at || new Date(c.expires_at) > new Date()));
    if (live) return live;
  }
  const { data: r } = await supabase.from('quiz_share_codes').select('id, teacher_user_id, teacher_name').eq('id', rootId).maybeSingle();
  if (!r) fail(409, 'no_class');
  const { randomCode } = require('./video-quiz-share.service');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase.from('quiz_share_codes').insert({
      code: randomCode(), quiz_id: vq.id, video_id: vid,
      teacher_user_id: r.teacher_user_id, teacher_name: r.teacher_name,
      topic: video.clean_title || vq.topic || null, language: lang,
      parent_share_code_id: rootId, invited_by_student_id: null, active: true,
      expires_at: new Date(Date.now() + CODE_DAYS * 86400000).toISOString(),
    }).select('id, code').single();
    if (!error && data) {
      logEvent('web_quiz.watch_quiz_code', { videoId: vid, quizId: vq.id, newShareCodeId: data.id });
      return data;
    }
    if (error && error.code !== '23505') {
      logToFile('❌ web-quiz videos: could not mint a watch code', { error: error.message }, 'error');
      break;
    }
  }
  return fail(502, 'db_unavailable');
}

const OPTIONAL = Object.freeze({ nextOffer: './web-quiz-next-offer', events: './web-quiz-events-v3' });
/** An optional module by name, or null when its file is not on this deployment (any other load error still throws). */
function optional(name) {
  const spec = OPTIONAL[name];
  try {
    return require(spec);
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(`'${spec}'`)) return null;
    throw e;
  }
}

/** EVENTS_V3 §1 `activity_start` for a watch, under web_quiz_events_v3 (its writer and switch are optional modules: absent = nothing). */
async function activityStart(vid, studentId) {
  try {
    const N = optional('nextOffer');
    if (!N || !(await N.switches()).events) return;
    const Ev = optional('events');
    if (Ev) Ev.emit3('web_quiz.activity_start', { kind: 'video', item: vid, via: 'hub_door', offer: null }, { canonicalId: studentId });
  } catch (_) { /* no events writer on this deployment */ }
}

/**
 * The caller's `{ next }` for after this video: the route passes the next-thing slot's (`hooks.onWatch`), so this module
 * loads nothing of the slot's. No hook, no phone, any failure: `{}`. Never rejects.
 */
async function watchNextOf(onWatch, args) {
  try {
    if (typeof onWatch !== 'function' || args.device == null) return {};
    const got = await onWatch({ ...args, device: String(args.device) });
    return got && typeof got === 'object' ? got : {};
  } catch (_) {
    return {};
  }
}

/**
 * A child with no class code: with web_quiz_home_v3 off, 409 no_class (today). On: {watch: {vid, url, poster?, secs?,
 * title, lang, after}} — the video first, nothing minted (`after` = whether the quiz after it can be offered); with
 * body.after, {code, k} for the quiz after it under the watch root, else 409 no_class.
 */
async function watchStart(who, vid, body, fail, hooks = {}) {
  if (!(await require('./web-quiz-home-flags').flags()).home) fail(409, 'no_class');
  if (!VID_RX.test(vid)) fail(400, 'bad_request');
  const { video, vq, lang } = await lessonOf(vid, fail);
  const rootId = await watchRoot();
  if (body.after) {
    if (!rootId) fail(409, 'no_class');
    const c = await watchCodeFor({ rootId, vq, video, vid, lang, studentId: who.studentId, fail });
    return { code: c.code, k: T.chipId(c.id, who.studentId) };
  }
  // the ranked Next after it (web_quiz_next_offer; {} when off), asked beside the signing so it never adds to it
  const nextP = watchNextOf(hooks.onWatch, { studentId: who.studentId, vid, title: video.clean_title || '', lang, kidLang: who.lang || null, after: Boolean(rootId), device: body.device });
  const media = await require('./web-quiz-media').presignVideo({ video_id: vid }, { expiresIn: WATCH_TTL_S });
  if (!media || !media.url) fail(503, 'unavailable');
  const meta = peekMeta(vid) || {};
  logEvent('web_quiz.video_watch_start', { videoId: vid, lang, after: Boolean(rootId) });
  await activityStart(vid, who.studentId);
  const { next } = await nextP;
  return {
    watch: {
      vid, url: media.url, ...(media.poster ? { poster: media.poster } : {}), ...(meta.secs ? { secs: meta.secs } : {}),
      title: video.clean_title || '', ...(await urTitleOf(vid)), lang, after: Boolean(rootId), ...(next ? { next } : {}),
    },
  };
}

/**
 * A grown-up's preview (web_quiz_practice_play): {watch: {vid, url, poster?, secs?, title, lang, after: false}} — the
 * lesson's own signed video, as a child with no class gets it, with nothing minted and no event keyed by a child; the
 * quiz after it (body.after) makes a code and a child's session, so it is refused (409 no_class) and never offered.
 */
async function practiceWatch(who, vid, body, fail) {
  if (!(await require('./web-quiz-home-flags').flags()).home) fail(409, 'no_class');
  if (body.after) fail(409, 'no_class');
  if (!VID_RX.test(vid)) fail(400, 'bad_request');
  const { video, lang } = await lessonOf(vid, fail);
  const media = await require('./web-quiz-media').presignVideo({ video_id: vid }, { expiresIn: WATCH_TTL_S });
  if (!media || !media.url) fail(503, 'unavailable');
  const meta = peekMeta(vid) || {};
  require('./web-quiz-practice-play').note('videos_start', { grade: who.grade, lang });
  return {
    watch: {
      vid, url: media.url, ...(media.poster ? { poster: media.poster } : {}), ...(meta.secs ? { secs: meta.secs } : {}),
      title: video.clean_title || '', ...(await urTitleOf(vid)), lang, after: false,
    },
  };
}

/** web_quiz_videos_ur_titles: {title_ur} when the lesson has an Urdu-script name, else nothing (off = not read). */
async function urTitleOf(vid) {
  if (!(await require('./web-quiz-library-flag').urTitlesOn())) return {};
  const of = await require('./web-quiz-bank').urTitles();
  const u = of && of.get(vid);
  return u && u.t ? { title_ur: u.t } : {};
}

/**
 * From a quiz page: {code, st, vid} -> {code}. From the kid's hub: {hub, kid, vid} -> {code, k},
 * rooted at the newest teacher-sent code the child played (kidFromHub().rootId; none -> 409 no_class),
 * with k = the child's chip on that code so the page starts as them with no picking.
 */
async function start(body = {}, hooks = {}) {
  const WebQuiz = require('./web-quiz.service');
  requireOn(WebQuiz);
  const fail = (status, error) => { throw new WebQuiz.WqError(status, { error }); };
  const vid = String(body.vid || '');
  if (body.hub) {
    // web_quiz_practice_play: a grown-up's preview link watches its lesson, nothing minted (no code, no session)
    const Practice = require('./web-quiz-practice-play');
    const preview = await Practice.who(String(body.hub));
    if (preview) return practiceWatch(preview, vid, body, fail);
    const Hub = hubModule();
    if (!Hub || typeof Hub.kidFromHub !== 'function') fail(503, 'hub_off');
    // body.device: this phone's device_ref (the route sets it from x-wq-device) — a forwarded hub link starts nothing as the child.
    const who = await Hub.kidFromHub(String(body.hub), body.kid == null ? null : String(body.kid), body.device == null ? undefined : String(body.device));
    if (!who || !who.studentId) { Practice.refused('videos_start', String(body.hub)); fail(401, 'bad_token'); }
    if (!who.rootId) return watchStart(who, vid, body, fail, hooks);
    if (!VID_RX.test(vid)) fail(400, 'bad_request');
    const { video, vq, lang } = await lessonOf(vid, fail);
    const c = await codeFor({ rootId: who.rootId, root: null, vq, video, vid, lang, fail });
    return { code: c.code, k: T.chipId(c.id, who.studentId) };
  }
  const ctx = await WebQuiz.resolveCode(body.code);
  const tok = T.verify(body.st, 's');
  if (!tok || tok.sc !== ctx.shareCodeId) fail(401, 'bad_token');
  if (!VID_RX.test(vid)) fail(400, 'bad_request');
  const { video, vq, lang } = await lessonOf(vid, fail);
  const c = await codeFor({ rootId: classRootId(ctx), root: ctx.parent, vq, video, vid, lang, fail });
  return { code: c.code };
}

module.exports = { urTitleOf, list, start, watchRoot, WATCH_ROOT_KEY, gradesFor, subjectFor, pick, mp4Seconds, classRootId, peekMeta, warmMeta, restoreMeta, forgetMeta, LIST_MAX, VID_RX, _metaCache: metaCache };
