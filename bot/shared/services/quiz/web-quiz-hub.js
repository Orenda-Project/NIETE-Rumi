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
 *   kidOf(token, kid)      the student id a hub chip names
 *   kidFromHub(token, kid) {studentId, grade, rootId} for the library / challenge routes
 *   deviceTrusted(token, device)  may this phone (device_ref) see the children's names?
 *
 * A FORWARDED LINK NAMES NOBODY. The hub token is bound to the first phone (device_ref)
 * that opens it — Redis SET NX for the token's life — and a phone that has already played
 * as one of its children is trusted too. Any other phone, a request with no device (the
 * server render) or Redis down gets `locked: true` with no names, no history and no chips:
 * the page asks for the child the link was sent to. Fail closed, never a silent play.
 *
 * Teacher card: (a) a teacher-sent code this child opened and has not finished,
 * still open; else (b) an open code from the last 7 days, of the child's grade,
 * from the child's teachers (the class list's, and those whose links they played). Play again: finished, still-open codes, newest
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
const Flags = require('./web-quiz-hub-flags');
const crypto = require('crypto');
const { clampLanguage } = require('../../config/ux-strings');

const AGAIN_MAX = 6;
const RECS_MAX = 3;
const TEACHER_DAYS = 7;
const CHALLENGE_GRADES = ['2', '3', '4', '5'];

// The web quiz's own error type, so the internal router answers it as every other wq route does.
const fail = (status, error) => { const { WqError } = require('./web-quiz.service'); throw new WqError(status, { error }); };

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

const BIND_PREFIX = 'wq:hub:dev:';
const bindKey = (token) => BIND_PREFIX + crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);

/** Has this phone (device_ref) ever played as one of these children (any code)? */
async function deviceKnows(studentIds, deviceRef) {
  try {
    const { data } = await supabase.from('quiz_sessions').select('id').in('student_id', studentIds).eq('device_ref', deviceRef).limit(1);
    return Boolean(data && data.length);
  } catch (_) {
    return false;
  }
}

/**
 * May this phone see the hub's children? {ok, why}. A phone the children played on, or the
 * first phone that opens this link (bound for the token's life). No device, a foreign one,
 * or Redis down for an unknown one: not trusted.
 */
async function deviceTrusted(token, device) {
  const tok = T.verify(token, 'h');
  if (!tok || !Array.isArray(tok.ids) || !tok.ids.length) return { ok: false, why: 'bad_token' };
  const d = T.cleanDeviceRef(device);
  if (!d) return { ok: false, why: 'no_device' };
  if (await deviceKnows(tok.ids.map(String), d)) return { ok: true, why: 'played' };
  const redis = require('../cache/railway-redis.service');
  if (!redis || typeof redis.isAvailable !== 'function' || !redis.isAvailable()) return { ok: false, why: 'no_store' };
  const key = bindKey(token);
  const ttl = Math.max(60, tok.exp - Math.floor(Date.now() / 1000));
  try {
    await redis.setNX(key, d, ttl);
    // Read back: setNX answers "claimed" when Redis errors, so only the stored value decides.
    const bound = await redis.get(key);
    return bound === d ? { ok: true, why: 'bound' } : { ok: false, why: bound ? 'other_device' : 'no_store' };
  } catch (_) {
    return { ok: false, why: 'no_store' };
  }
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
  // (b) an open code from the last 7 days, for the child's grade (band-aware), from the child's
  // teachers: the class list's teacher, and the teachers whose links this child has played
  // (every quiz child on prod is a loose students row with no list, so the second is the one that finds them).
  const teachers = [...new Set([list && list.user_id, ...history.filter((e) => e.teacherSent).map((e) => e.teacherUserId)].filter(Boolean))];
  if (!teachers.length || !grade) return null;
  const { data: codes } = await supabase.from('quiz_share_codes')
    .select('id, code, quiz_id, topic, active, expires_at, created_at')
    .in('teacher_user_id', teachers.slice(0, 5)).eq('active', true)
    .is('parent_share_code_id', null).is('invited_by_student_id', null)
    .gte('created_at', daysAgoIso(TEACHER_DAYS)).order('created_at', { ascending: false }).limit(30);
  const seen = new Set(history.map((e) => e.shareCodeId));
  const open = (codes || []).filter((c) => isOpen(c) && !seen.has(c.id));
  if (!open.length) return null;
  const { data: quizzes } = await supabase.from('quizzes').select('id, topic, subject, grade').in('id', [...new Set(open.map((c) => c.quiz_id))]);
  const quizById = new Map((quizzes || []).map((q) => [q.id, q]));
  // A quiz with no grade, or another grade, is never shown: it may be another class's.
  const hit = open.find((c) => quizById.get(c.quiz_id) && Videos.gradesFor(quizById.get(c.quiz_id).grade).includes(grade));
  if (!hit) return null;
  const q = quizById.get(hit.quiz_id);
  return { code: hit.code, topic: q.topic || hit.topic || '', subject: q.subject || '', sent_at: hit.created_at, k: T.chipId(hit.id, kidRow.id), src: 'teacher' };
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

/**
 * For the other hub routes (library, challenge): the child a hub chip names, their grade and
 * their class root code (the newest teacher-sent code they played; "watch more" codes hang
 * off it). Null when the token or the chip is not genuine.
 */
async function kidFromHub(token, chip) {
  const studentId = kidOf(token, chip);
  if (!studentId) return null;
  const ctx = await kidContext(studentId);
  if (!ctx) return null;
  const root = ctx.history.find((e) => e.teacherSent) || null;
  return { studentId, grade: ctx.grade, rootId: root ? root.shareCodeId : null };
}

async function kidContext(studentId) {
  const { data: row } = await supabase.from('students')
    .select('id, student_name, student_name_urdu, self_reported_class, list_id, is_active').eq('id', studentId).maybeSingle();
  if (!row || row.is_active === false) return null;
  const { data: list } = row.list_id
    ? await supabase.from('student_lists').select('id, user_id, class_name, section').eq('id', row.list_id).maybeSingle()
    : { data: null };
  const StudentQuiz = require('./student-quiz.service');
  const history = await StudentQuiz.quizzesForStudents([row]);
  const grade = gradeNum((list || {}).class_name) || gradeNum(row.self_reported_class)
    || gradeNum((history.find((e) => e.className) || {}).className)
    || (history[0] ? (Videos.gradesFor(history[0].grade)[0] || null) : null);
  return { row, list, history, grade: grade || null };
}

async function brandKey() {
  try {
    const WebQuizBrand = require('../../config/web-quiz-brand');
    const { orgName, botName } = require('../../config/branding');
    return await WebQuizBrand.resolveBrandKey({ db: supabase, orgName, botName });
  } catch (_) {
    return null;
  }
}

/** A phone that may not see the children: their language only, never a name, a chip or a quiz. */
async function lockedHub(ids, why) {
  let lang = 'en';
  try {
    const { data: rows } = await supabase.from('students').select('id, is_active').in('id', ids);
    const live = (rows || []).filter((r) => r.is_active !== false);
    if (live.length) {
      const StudentQuiz = require('./student-quiz.service');
      const history = await StudentQuiz.quizzesForStudents(live);
      lang = clampLanguage(history[0] && history[0].language);
    }
  } catch (_) { /* English */ }
  logEvent('web_quiz.hub_locked', { kids: ids.length, why });
  return { lang, locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: await brandKey() };
}

// ─── the hub ────────────────────────────────────────────────────────────────

async function hub(token, { kid, device } = {}) {
  if (!T.secret()) fail(503, 'web_quiz_off');
  const ids = idsOf(token);
  const f = await Flags.flags();
  if (!f.hub) fail(503, 'web_quiz_off');
  const trust = await deviceTrusted(token, device);
  if (!trust.ok) return lockedHub(ids, trust.why);

  const { data: rows } = await supabase.from('students')
    .select('id, student_name, student_name_urdu, self_reported_class, list_id, is_active').in('id', ids);
  const kidsRows = ids.map((id) => (rows || []).find((r) => r.id === id)).filter((r) => r && r.is_active !== false);
  const { data: lists } = kidsRows.some((r) => r.list_id)
    ? await supabase.from('student_lists').select('id, user_id, class_name, section').in('id', kidsRows.map((r) => r.list_id).filter(Boolean))
    : { data: [] };
  const listOf = (r) => (lists || []).find((l) => l.id === r.list_id) || null;
  const gradeOf = (r) => gradeNum((listOf(r) || {}).class_name) || gradeNum(r.self_reported_class) || null;

  const chosen = kidsRows.find((r) => kidChip(r.id) === String(kid || '')) || (kidsRows.length === 1 ? kidsRows[0] : null);
  const ctx = chosen ? await kidContext(chosen.id) : null;
  const history = ctx ? ctx.history : [];
  const lang = clampLanguage(history[0] && history[0].language);
  const nameOf = (r) => firstName(lang === 'ur' && r.student_name_urdu && String(r.student_name_urdu).trim() ? r.student_name_urdu : r.student_name);
  const out = {
    lang,
    kids: kidsRows.map((r) => ({ chip: kidChip(r.id), first: nameOf(r), animal: T.animalFor(r.id), grade: gradeOf(r) })),
    kid: chosen ? kidChip(chosen.id) : null,
    teacher: null, again: [], recs: [], challenge: null, lib: null,
    // Which brand the page wears: a key only; the edge owns the look (as getQuiz).
    brand: await brandKey(),
  };
  if (!chosen) {
    logEvent('web_quiz.hub_open', { kids: kidsRows.length, picked: false });
    return out;
  }
  const grade = ctx.grade;
  out.teacher = await teacherCard(chosen, ctx.list, history, grade);
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
  // The library page opens in the child's language (?l=), the same one this hub is in.
  if (f.library) out.lib = { href: `/lib/${token}?kid=${out.kid}&l=${out.lang}` };
  else if (newest) out.lib = { href: `/q/${newest.code}?k=${T.chipId(newest.shareCodeId, chosen.id)}` };
  logEvent('web_quiz.hub_open', {
    kids: kidsRows.length, has_teacher: Boolean(out.teacher), teacher_src: out.teacher ? out.teacher.src : null,
    again_n: out.again.length, recs_n: out.recs.length, challenge: Boolean(out.challenge),
  });
  return out;
}

module.exports = {
  hub, kidOf, kidFromHub, deviceTrusted, recOrder, firstOfEach, AGAIN_MAX, RECS_MAX,
  // the switches live in web-quiz-hub-flags.js (student-quiz reads them without loading this module)
  hubLink: Flags.hubLink, flags: Flags.flags, HUB_KEY: Flags.HUB_KEY, CHALLENGE_KEY: Flags.CHALLENGE_KEY, LIBRARY_KEY: Flags.LIBRARY_KEY,
  _resetCache: Flags._resetCache,
};
