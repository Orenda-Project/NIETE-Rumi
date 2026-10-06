'use strict';
/**
 * THE KID HUB — what a child gets when they type /quiz on WhatsApp (app_settings
 * `web_quiz_hub`): one link to a page that holds their teacher's newest quiz,
 * the quizzes they can play again, the video library, three recommended video
 * quizzes and (when on) Jugnu's Challenge.
 *
 * WHO THE CHILD IS. The hub token (web-quiz-token.js kind 'h') names the
 * students rows registered on the WhatsApp phone that asked — never anyone
 * else. A sibling phone has more than one, and the page asks "Who is playing?"
 * with ONLY those children. A child is picked by `kid`, an opaque chip of this
 * hub (chipId('h', studentId)); each quiz link carries the chip of THAT quiz's
 * code (`k`), which startSession already accepts, so nobody picks a name twice.
 *
 *   hub(token, {kid})      the page's boot JSON (contract: W37 M4 SPEC §1.3)
 *   hubLink(studentIds)    `<portal>/h/<token>` when the hub is on, else null
 *   kidOf(token, kid)      the student id a hub chip names (for other hub routes)
 *
 * Teacher card: (a) a teacher-sent code this child opened and has not finished,
 * still open; else (b) an open code their class teacher sent in the last 7 days
 * for the class list's grade. Play again: finished, still-open codes, newest
 * first, with the best score and the number of tries (the FIRST finish is the
 * one the teacher sees; every later one is practice — web-quiz.service countedFor).
 * Recommended: the last finished quiz's subject and grade, same chapter first,
 * then the next chapters in the WhatsApp Flow's order, then the rest of the
 * subject, filled to 3 from the grade's other subjects (Flow subject order).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const Videos = require('./web-quiz-videos');
const Order = require('./video-bank-order');

const HUB_KEY = 'web_quiz_hub';
const CHALLENGE_KEY = 'web_quiz_challenge';
const LIBRARY_KEY = 'web_quiz_library';
const TTL_MS = 30 * 1000;
const AGAIN_MAX = 6;
const RECS_MAX = 3;
const TEACHER_DAYS = 7;
const CHALLENGE_GRADES = ['2', '3', '4', '5'];
let cache = null; // { at, hub, challenge, library }

// The web quiz's own error type, so the internal router answers it as every other wq route does.
const fail = (status, error) => { const { WqError } = require('./web-quiz.service'); throw new WqError(status, { error }); };

// ─── switches (read like web-quiz-link.js: 30 s cache, fail closed) ─────────

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [HUB_KEY, CHALLENGE_KEY, LIBRARY_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    cache = { at: now, hub: isTrue(by[HUB_KEY]), challenge: isTrue(by[CHALLENGE_KEY]), library: isTrue(by[LIBRARY_KEY]) };
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz hub: settings lookup failed — hub off', { error: err.message });
    return { hub: false, challenge: false, library: false };
  }
}

/** `<portal>/h/<token>` for these children, or null (hub off, no base URL, no secret, no child). Never throws. */
async function hubLink(studentIds) {
  try {
    const Link = require('./web-quiz-link');
    const base = Link.webBaseUrl();
    if (!base || !(await flags()).hub) return null;
    const token = T.signHub(studentIds);
    return token ? `${base}/h/${token}` : null;
  } catch (err) {
    logToFile('⚠️ web quiz hub: no hub link', { error: err.message });
    return null;
  }
}

// ─── helpers (pure) ─────────────────────────────────────────────────────────

const kidChip = (studentId) => T.chipId('h', studentId);
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const gradeNum = (v) => (String(v == null ? '' : v).match(/\d+/) || [''])[0];
const daysAgoIso = (d) => new Date(Date.now() - d * 86400000).toISOString();
const isOpen = (c) => c && c.active !== false && (!c.expires_at || new Date(c.expires_at).getTime() > Date.now());

/** The ids a genuine hub token names; else 401. */
function idsOf(token) {
  const tok = T.verify(token, 'h');
  if (!tok || !Array.isArray(tok.ids) || !tok.ids.length) fail(401, 'bad_token');
  return tok.ids.map(String);
}

/** The student id the hub chip `kid` names on this token, or null. */
function kidOf(token, kid) {
  const tok = T.verify(token, 'h');
  if (!tok || !Array.isArray(tok.ids) || !kid) return null;
  return tok.ids.map(String).find((id) => kidChip(id) === String(kid)) || null;
}

/**
 * Recommendation order (pure). `rows` = playable bank rows of grade G the child has not
 * finished; `last` = the last finished quiz's {subject, chapter, vid}.
 */
function recOrder(rows, { subject, chapter, vid } = {}, max = RECS_MAX) {
  const pool = rows.filter((r) => r.id !== vid);
  const ch = String(chapter || '').toLowerCase();
  const inS = pool.filter((r) => r.subject === subject).sort(Order.compareVideos);
  const same = ch ? inS.filter((r) => String(r.clean_chapter || '').toLowerCase() === ch) : [];
  const next = ch ? inS.filter((r) => String(r.clean_chapter || '').toLowerCase() > ch) : [];
  const rest = inS.filter((r) => !same.includes(r) && !next.includes(r));
  const others = [...new Set(pool.filter((r) => r.subject !== subject).map((r) => r.subject))].sort(Order.compareSubjects);
  const fill = [];
  others.forEach((s) => fill.push(...pool.filter((r) => r.subject === s).sort(Order.compareVideos)));
  return [...same, ...next, ...rest, ...fill].slice(0, max);
}

/** No history: the first chapter of each subject of the grade, in the Flow's subject order (pure). */
function firstOfEach(rows, max = RECS_MAX) {
  const subjects = [...new Set(rows.map((r) => r.subject))].sort(Order.compareSubjects);
  return subjects.map((s) => rows.filter((r) => r.subject === s).sort(Order.compareVideos)[0]).filter(Boolean).slice(0, max);
}

// ─── reads ──────────────────────────────────────────────────────────────────

async function teacherCard(kidRow, list, history, grade) {
  // (a) a teacher-sent code this child opened and has not finished, still open.
  const opened = history.find((e) => e.teacherSent && e.active && !e.latest);
  if (opened) return { code: opened.code, topic: opened.topic, subject: opened.subject, sent_at: opened.sentAt, k: T.chipId(opened.shareCodeId, kidRow.id), src: 'opened' };
  // (b) the class teacher's open codes from the last 7 days for the list's grade.
  if (!list || !list.user_id || !grade) return null;
  const { data: codes } = await supabase.from('quiz_share_codes')
    .select('id, code, quiz_id, topic, active, expires_at, created_at')
    .eq('teacher_user_id', list.user_id).eq('active', true)
    .is('parent_share_code_id', null).is('invited_by_student_id', null)
    .gte('created_at', daysAgoIso(TEACHER_DAYS)).order('created_at', { ascending: false }).limit(20);
  const open = (codes || []).filter(isOpen);
  if (!open.length) return null;
  const { data: quizzes } = await supabase.from('quizzes').select('id, topic, subject, grade').in('id', [...new Set(open.map((c) => c.quiz_id))]);
  const quizById = new Map((quizzes || []).map((q) => [q.id, q]));
  const finished = new Set(history.filter((e) => e.latest).map((e) => e.shareCodeId));
  const hit = open.find((c) => {
    const q = quizById.get(c.quiz_id);
    return q && !finished.has(c.id) && (Videos.gradesFor(q.grade).includes(grade) || gradeNum(q.grade) === grade);
  });
  if (!hit) return null;
  const q = quizById.get(hit.quiz_id);
  return { code: hit.code, topic: q.topic || hit.topic || '', subject: q.subject || '', sent_at: hit.created_at, k: T.chipId(hit.id, kidRow.id), src: 'class' };
}

function againOf(history, kidId, teacherCode) {
  return history
    .filter((e) => e.code && e.active && e.latest && e.code !== teacherCode)
    .sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')))
    .slice(0, AGAIN_MAX)
    .map((e) => ({
      code: e.code, topic: e.topic, subject: e.subject,
      best: { c: (e.best && e.best.correct_answers) || 0, t: (e.best && e.best.total_questions_answered) || 0 },
      tries: e.attempts, last_at: e.lastAt, k: T.chipId(e.shareCodeId, kidId),
    }));
}

/** The video's poster without a network call: a presigned key (signPoster) or the meta cache. */
async function posterOf(row) {
  const hit = Videos._metaCache && Videos._metaCache.get(row.id);
  const cached = hit && hit.v ? hit.v : {};
  let poster = cached.poster || null;
  if (!poster) {
    try {
      const media = require('./web-quiz-media');
      if (typeof media.signPoster === 'function' && row.r2_url) poster = await media.signPoster(row.r2_url);
    } catch (_) { /* the page shows the subject tile */ }
  }
  return { poster, secs: cached.secs || null };
}

async function recsFor(kidId, history, grade) {
  const lastDone = history.filter((e) => e.latest)
    .sort((a, b) => String(b.latest.completed_at || '').localeCompare(String(a.latest.completed_at || '')))[0] || null;
  let last = null;
  let G = grade;
  if (lastDone) {
    if (lastDone.videoId) {
      const { data: v } = await supabase.from('student_videos').select('id, grade, subject, clean_chapter').eq('id', lastDone.videoId).maybeSingle();
      if (v) { last = { subject: v.subject, chapter: v.clean_chapter, vid: v.id }; G = String(v.grade); }
    }
    if (!last) {
      const gs = Videos.gradesFor(lastDone.grade);
      last = { subject: Videos.subjectFor(lastDone.subject), chapter: null, vid: null };
      if (gs.length) G = gs.includes(grade) ? grade : gs[0];
    }
  }
  if (!G) return [];
  const { data: vids, error } = await supabase.from('student_videos')
    .select('id, grade, subject, clean_chapter, clean_title, r2_url')
    .eq('migration_status', 'done').is('superseded_by', null).eq('grade', G).limit(400);
  if (error || !vids || !vids.length) return [];
  const { data: quizzes } = await supabase.from('quizzes').select('id, video_id')
    .in('video_id', vids.map((r) => r.id)).eq('quiz_source', 'video').eq('status', 'ready');
  const quizOf = new Map((quizzes || []).map((q) => [q.video_id, q.id]));
  const { data: done } = await supabase.from('quiz_sessions').select('quiz_id')
    .eq('student_id', kidId).eq('status', 'completed').limit(300);
  const finished = new Set((done || []).map((r) => r.quiz_id));
  const playable = vids.filter((r) => quizOf.has(r.id) && !finished.has(quizOf.get(r.id)));
  const chosen = last ? recOrder(playable, last) : firstOfEach(playable);
  const metas = await Promise.all(chosen.map(posterOf));
  return chosen.map((r, i) => {
    const out = { vid: r.id, title: r.clean_title || '', chapter: r.clean_chapter || '', subject: r.subject, grade: String(r.grade) };
    if (metas[i].poster) out.poster = metas[i].poster;
    if (metas[i].secs) out.secs = metas[i].secs;
    return out;
  });
}

// ─── the hub ────────────────────────────────────────────────────────────────

async function hub(token, { kid } = {}) {
  if (!T.secret()) fail(503, 'web_quiz_off');
  const ids = idsOf(token);
  const f = await flags();
  if (!f.hub) fail(503, 'web_quiz_off');

  const { data: rows } = await supabase.from('students')
    .select('id, student_name, student_name_urdu, self_reported_class, list_id, is_active').in('id', ids);
  const kidsRows = ids.map((id) => (rows || []).find((r) => r.id === id)).filter((r) => r && r.is_active !== false);
  const { data: lists } = kidsRows.some((r) => r.list_id)
    ? await supabase.from('student_lists').select('id, user_id, class_name, section').in('id', kidsRows.map((r) => r.list_id).filter(Boolean))
    : { data: [] };
  const listOf = (r) => (lists || []).find((l) => l.id === r.list_id) || null;
  const gradeOf = (r) => gradeNum((listOf(r) || {}).class_name) || gradeNum(r.self_reported_class) || null;

  const chosen = kidsRows.find((r) => kidChip(r.id) === String(kid || '')) || (kidsRows.length === 1 ? kidsRows[0] : null);
  const StudentQuiz = require('./student-quiz.service');
  const history = chosen ? await StudentQuiz.quizzesForStudents([chosen]) : [];
  const lang = (history[0] && history[0].language) === 'ur' ? 'ur' : 'en';
  const nameOf = (r) => firstName(lang === 'ur' && r.student_name_urdu && String(r.student_name_urdu).trim() ? r.student_name_urdu : r.student_name);
  const out = {
    lang,
    kids: kidsRows.map((r) => ({ chip: kidChip(r.id), first: nameOf(r), animal: T.animalFor(r.id), grade: gradeOf(r) })),
    kid: chosen ? kidChip(chosen.id) : null,
    teacher: null, again: [], recs: [], challenge: null, lib: null,
  };
  if (!chosen) {
    logEvent('web_quiz.hub_open', { kids: kidsRows.length, picked: false });
    return out;
  }
  const grade = gradeOf(chosen) || (history[0] ? (Videos.gradesFor(history[0].grade)[0] || null) : null);
  out.teacher = await teacherCard(chosen, listOf(chosen), history, grade);
  out.again = againOf(history, chosen.id, out.teacher && out.teacher.code);
  try {
    out.recs = await recsFor(chosen.id, history, grade);
  } catch (err) {
    logToFile('⚠️ web quiz hub: recommendations unavailable', { error: err.message });
  }
  if (f.challenge && CHALLENGE_GRADES.includes(String(grade))) {
    out.challenge = { on: true, exercises: [{ id: 'bigger', done: false }, { id: 'read', done: false }] };
  }
  // The library: M4b's page when it is on; else the child's newest open quiz (its scorecard lists more videos).
  const newest = history.find((e) => e.active && e.code);
  if (f.library) out.lib = { href: `/lib/${token}?kid=${out.kid}` };
  else if (newest) out.lib = { href: `/q/${newest.code}?k=${T.chipId(newest.shareCodeId, chosen.id)}` };
  logEvent('web_quiz.hub_open', {
    kids: kidsRows.length, has_teacher: Boolean(out.teacher), teacher_src: out.teacher ? out.teacher.src : null,
    again_n: out.again.length, recs_n: out.recs.length, challenge: Boolean(out.challenge),
  });
  return out;
}

module.exports = {
  hub, hubLink, kidOf, flags, recOrder, firstOfEach,
  HUB_KEY, CHALLENGE_KEY, LIBRARY_KEY, AGAIN_MAX, RECS_MAX,
  _resetCache: () => { cache = null; },
};
