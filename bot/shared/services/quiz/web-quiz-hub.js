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
 *   kidFromHub(token, kid, device) {studentId, grade, rootId} for the library route (null on an untrusted phone)
 *   deviceTrusted(token, device)  which of the children may this phone (device_ref) see? {ok, why, ids}
 *
 * A FORWARDED LINK NAMES NOBODY. The hub token is bound to the first phone (device_ref)
 * that opens it — Redis SET NX for the token's life — and a phone that has already played
 * as one of its children is trusted too. Any other phone, a request with no device (the
 * server render) or Redis down gets `locked: true` with no names, no history and no chips:
 * the page asks for the child the link was sent to. Fail closed, never a silent play.
 *
 * Teacher card: (a) a teacher-sent code this child opened and has not finished,
 * still open; else (b) an open code from the last 7 days from the child's teachers
 * (the class list's, and those whose links they played): a code bound to the
 * child's class (quiz_share_codes.class_id, or resolveQuizClass) first, then one of
 * the child's grade; never another class's, never the twin of a lesson they finished,
 * and the child's language before the other. Play again: finished, still-open codes, newest
 * first, with the best score and the number of tries (the FIRST finish is the
 * one the teacher sees; every later one is practice — web-quiz.service countedFor).
 * Recommended: the last finished quiz's subject and grade, same chapter first,
 * then the next chapters in the WhatsApp Flow's order, then the rest of the
 * subject, filled to 3 from the grade's other subjects (Flow subject order).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const Tel = require('./web-quiz-telemetry');
const T = require('./web-quiz-token');
const Videos = require('./web-quiz-videos');
const Order = require('./video-bank-order');
const Flags = require('./web-quiz-hub-flags');
const { clampLanguage } = require('../../config/ux-strings');

const AGAIN_MAX = 6;
const RECS_MAX = 3;
const TEACHER_DAYS = 7;
const RESOLVE_MAX = 5;
// The challenge's grade for a child (web-quiz-challenge.js gradeOf + formFor), required on use so the hub never depends on the challenge to boot.
async function challengeGrade(studentId) {
  try {
    const Challenge = require('./web-quiz-challenge');
    return Boolean(Challenge.formFor(await Challenge.gradeOf({ studentId })));
  } catch (err) {
    logToFile('⚠️ web quiz hub: challenge grade unavailable', { error: err.message });
    return false;
  }
}

// The web quiz's own error type, so the internal router answers it as every other wq route does.
const fail = (status, error) => { const { WqError } = require('./web-quiz.service'); throw new WqError(status, { error }); };

// ─── helpers (pure) ─────────────────────────────────────────────────────────

// The library's pictures (web-quiz-library.js), required on use so the hub never depends on the library to boot.
function artOf(kind, v) {
  try {
    const Lib = require('./web-quiz-library');
    const fn = kind === 'grade' ? Lib.gradeArt : Lib.subjectArt;
    return (typeof fn === 'function' && fn(v)) || null;
  } catch (_) {
    return null;
  }
}
const subjectArtOf = (subject) => artOf('subject', Videos.subjectFor(subject) || subject);

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

// Which phone may see a hub's children: web-quiz-hub-device.js (a leaf module, so web-quiz.service can ask it too).
const { deviceTrusted, deviceMayName } = require('./web-quiz-hub-device');

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

/** The child's classes: active enrolments, plus the classes of the teacher codes they played (a loose prod child has only these). */
async function kidClasses(studentId, history) {
  const ids = new Set();
  try {
    const { data } = await supabase.from('class_enrollments').select('class_id').eq('student_id', studentId).eq('is_active', true);
    (data || []).forEach((r) => r.class_id && ids.add(r.class_id));
  } catch (_) { /* no roster: the played codes only */ }
  const played = history.filter((e) => e.teacherSent && e.shareCodeId).map((e) => e.shareCodeId);
  if (played.length) {
    const { data, error } = await supabase.from('quiz_share_codes').select('id, class_id').in('id', played.slice(0, 50));
    if (!error) (data || []).forEach((r) => r.class_id && ids.add(r.class_id));
  }
  return ids;
}

/** Open teacher-sent codes of these teachers from the last 7 days, newest first; class_id when the column exists. */
async function recentCodes(teachers) {
  const q = (cols) => supabase.from('quiz_share_codes').select(cols)
    .in('teacher_user_id', teachers.slice(0, 5)).eq('active', true)
    .is('parent_share_code_id', null).is('invited_by_student_id', null)
    .gte('created_at', daysAgoIso(TEACHER_DAYS)).order('created_at', { ascending: false }).limit(30);
  const base = 'id, code, quiz_id, topic, active, expires_at, created_at, teacher_user_id';
  const withClass = await q(`${base}, class_id`);
  if (!withClass.error) return withClass.data || [];
  const plain = await q(base);
  return plain.data || [];
}

const lessonRefs = (q) => [q && q.lesson_plan_id && `lp:${q.lesson_plan_id}`, q && q.coaching_session_id && `cs:${q.coaching_session_id}`].filter(Boolean);

async function teacherCard(kidRow, list, history, grade) {
  // (a) a teacher-sent code this child opened and has not finished, still open.
  const opened = history.find((e) => e.teacherSent && e.active && !e.latest);
  if (opened) return { code: opened.code, topic: opened.topic, subject: opened.subject, sent_at: opened.sentAt, k: T.chipId(opened.shareCodeId, kidRow.id), src: 'opened' };
  // (b) an open code from the last 7 days from the child's teachers: the class list's teacher, and the teachers
  // whose links this child has played (every quiz child on prod is a loose students row with no list).
  const teachers = [...new Set([list && list.user_id, ...history.filter((e) => e.teacherSent).map((e) => e.teacherUserId)].filter(Boolean))];
  if (!teachers.length) return null;
  const seen = new Set(history.map((e) => e.shareCodeId));
  // Independent reads in parallel: the codes and the child's classes.
  const [codes, myClasses] = await Promise.all([recentCodes(teachers), kidClasses(kidRow.id, history)]);
  const open = codes.filter((c) => isOpen(c) && !seen.has(c.id));
  if (!open.length) return null;
  const quizIds = [...new Set([...open.map((c) => c.quiz_id), ...history.filter((e) => e.latest && e.quizId).map((e) => e.quizId)])];
  const { data: quizzes } = await supabase.from('quizzes').select('id, topic, subject, grade, language, lesson_plan_id, coaching_session_id').in('id', quizIds);
  const quizById = new Map((quizzes || []).map((q) => [q.id, q]));
  // The same lesson the child already finished (its twin in the other language) is not "new from your teacher".
  const doneLessons = new Set(history.filter((e) => e.latest).flatMap((e) => lessonRefs(quizById.get(e.quizId))));
  const lang = clampLanguage(require('./student-quiz.service').childLanguage(history));
  const fresh = open.filter((c) => quizById.get(c.quiz_id) && !lessonRefs(quizById.get(c.quiz_id)).some((r) => doneLessons.has(r)));
  const ranked = [];
  const push = (c, rank) => { const q = quizById.get(c.quiz_id); ranked.push({ c, q, rank, langMiss: clampLanguage(q.language) === lang ? 0 : 1 }); };
  // A hand-out bound to the child's class is theirs: no class resolution needed (the hub boot stays fast).
  fresh.filter((c) => c.class_id && myClasses.has(c.class_id)).forEach((c) => push(c, 0));
  if (!ranked.length) {
    // Unbound codes only (a code bound to another class is never this child's), the newest 5, resolved in parallel.
    const { resolveQuizClass } = require('./web-quiz-identity');
    const loose = fresh.filter((c) => !c.class_id).slice(0, RESOLVE_MAX);
    const placed = await Promise.all(loose.map((c) => (myClasses.size
      ? resolveQuizClass({ teacherUserId: c.teacher_user_id, quizId: c.quiz_id, shareCodeId: c.id }).catch(() => null)
      : Promise.resolve(null))));
    loose.forEach((c, i) => {
      const r = placed[i];
      const known = r && r.state === 'known' && r.class && r.class.id ? r.class.id : null;
      if (known && myClasses.size) {
        if (myClasses.has(known)) push(c, 0);
        return;
      }
      // No class to compare: the child's grade (band-aware); a quiz with no grade, or another grade, may be another class's.
      if (grade && Videos.gradesFor(quizById.get(c.quiz_id).grade).includes(grade)) push(c, 1);
    });
  }
  ranked.sort((a, b) => (a.rank - b.rank) || (a.langMiss - b.langMiss) || String(b.c.created_at).localeCompare(String(a.c.created_at)));
  const hit = ranked[0];
  if (!hit) return null;
  return { code: hit.c.code, topic: hit.q.topic || hit.c.topic || '', subject: hit.q.subject || '', sent_at: hit.c.created_at, k: T.chipId(hit.c.id, kidRow.id), src: hit.rank === 0 ? 'class' : 'teacher' };
}

/**
 * The home page's top card (web_quiz_child_quiz_home): the quiz this child touched last that can still be
 * continued (an unfinished attempt — a retry included — on an open link) or was finished, with its latest
 * score. Null when there is none.
 */
function lastOf(history, kidId) {
  const e = history.find((x) => x.code && (x.latest || x.active));
  if (!e) return null;
  const base = { code: e.code, topic: e.topic, subject: e.subject, k: T.chipId(e.shareCodeId, kidId) };
  // Unfinished — or finished once and a newer attempt left unfinished on a still-open link: Continue resumes it.
  if (!e.latest || (e.openAnswered != null && e.active)) return { ...base, state: 'open', answered: e.openAnswered || 0 };
  return { ...base, state: 'done', score: { c: e.latest.correct_answers || 0, t: e.latest.total_questions_answered || 0 }, again: Boolean(e.active) };
}

/**
 * How many questions an unfinished sitting has answered. A web sitting keeps total_questions_answered at 0 until it
 * finishes (its answers are quiz_answers rows), so the rows are counted; the larger of the two wins. Never throws.
 */
async function answeredSoFar(entry, fallback = 0) {
  if (!entry || !entry.openSessionId) return fallback;
  try {
    const { count, error } = await supabase.from('quiz_answers').select('id', { count: 'exact', head: true }).eq('session_id', entry.openSessionId);
    return error ? fallback : Math.max(fallback, count || 0);
  } catch (_) {
    return fallback;
  }
}

function againOf(history, kidId, teacherCode) {
  return history
    .filter((e) => e.code && e.active && e.latest && e.code !== teacherCode)
    .sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')))
    .slice(0, AGAIN_MAX)
    .map((e) => {
      const row = {
        code: e.code, topic: e.topic, subject: e.subject,
        best: { c: (e.best && e.best.correct_answers) || 0, t: (e.best && e.best.total_questions_answered) || 0 },
        tries: e.attempts, last_at: e.lastAt, k: T.chipId(e.shareCodeId, kidId),
      };
      const art = subjectArtOf(e.subject);
      if (art) row.art = art;
      return row;
    });
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
    const art = subjectArtOf(r.subject);
    if (art) out.art = art;
    if (metas[i].secs) out.secs = metas[i].secs;
    return out;
  });
}

/**
 * For the other hub routes (library, challenge): the child a hub chip names, their grade and
 * their class root code (the newest teacher-sent code they played; "watch more" codes hang
 * off it). Null when the token or the chip is not genuine.
 */
async function kidFromHub(token, chip, device) {
  const studentId = kidOf(token, chip);
  if (!studentId) return null;
  // A forwarded link opens nothing as the child on another phone.
  const trust = await deviceTrusted(token, device);
  if (!trust.ok || !trust.ids.includes(studentId)) return null;
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
      lang = clampLanguage(StudentQuiz.childLanguage(history));
    }
  } catch (_) { /* English */ }
  logEvent('web_quiz.hub_locked', { kids: ids.length, why });
  return { lang, locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: await brandKey() };
}

// ─── the hub ────────────────────────────────────────────────────────────────

async function hubPayload(token, { kid, device } = {}) {
  if (!T.secret()) fail(503, 'web_quiz_off');
  const ids = idsOf(token);
  const f = await Flags.flags();
  if (!f.hub) fail(503, 'web_quiz_off');
  const trust = await deviceTrusted(token, device);
  if (!trust.ok) return lockedHub(ids, trust.why);
  // Only the children this phone is trusted for: all of them on the bound phone, else the ones it played as.
  const mine = ids.filter((id) => trust.ids.includes(id));

  const { data: rows } = await supabase.from('students')
    .select('id, student_name, student_name_urdu, self_reported_class, list_id, is_active').in('id', mine);
  const kidsRows = mine.map((id) => (rows || []).find((r) => r.id === id)).filter((r) => r && r.is_active !== false);
  const { data: lists } = kidsRows.some((r) => r.list_id)
    ? await supabase.from('student_lists').select('id, user_id, class_name, section').in('id', kidsRows.map((r) => r.list_id).filter(Boolean))
    : { data: [] };
  const listOf = (r) => (lists || []).find((l) => l.id === r.list_id) || null;
  const gradeOf = (r) => gradeNum((listOf(r) || {}).class_name) || gradeNum(r.self_reported_class) || null;

  const chosen = kidsRows.find((r) => kidChip(r.id) === String(kid || '')) || (kidsRows.length === 1 ? kidsRows[0] : null);
  // Started now, beside the rest of the hub's reads (challengeGrade never rejects): it is a few round trips of its own.
  const challengeP = f.challenge && chosen ? challengeGrade(chosen.id) : Promise.resolve(false);
  const ctx = chosen ? await kidContext(chosen.id) : null;
  const history = ctx ? ctx.history : [];
  const lang = clampLanguage(require('./student-quiz.service').childLanguage(history));
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
  // The home page: the last quiz on top; neither the teacher card nor Play again repeats it.
  if (f.childHome) {
    out.home_v = 1;
    out.last = lastOf(history, chosen.id);
    if (out.last && out.last.state === 'open') out.last.answered = await answeredSoFar(history.find((e) => e.code === out.last.code), out.last.answered);
    if (out.last && out.teacher && out.teacher.code === out.last.code) out.teacher = null;
    if (out.last) out.again = out.again.filter((a) => a.code !== out.last.code);
  }
  try {
    out.recs = await recsFor(chosen.id, history, grade);
  } catch (err) {
    logToFile('⚠️ web quiz hub: recommendations unavailable', { error: err.message });
  }
  // The tile asks the challenge's own grade rule (a band of grades is no grade there), so it never opens onto a refusal.
  if (await challengeP) {
    out.challenge = { on: true, exercises: [{ id: 'bigger', done: false }, { id: 'read', done: false }] };
  }
  // The library: M4b's page when it is on; else the child's newest open quiz (its scorecard lists more videos).
  const newest = history.find((e) => e.active && e.code);
  // The library page opens in the child's language (?l=), the same one this hub is in.
  if (f.library) out.lib = { href: `/lib/${token}?kid=${out.kid}&l=${out.lang}` };
  else if (newest) out.lib = { href: `/q/${newest.code}?k=${T.chipId(newest.shareCodeId, chosen.id)}` };
  // The Library tile wears the child's grade picture (the library opens on that grade).
  if (out.lib && grade && artOf('grade', grade)) out.lib.art = artOf('grade', grade);
  logEvent('web_quiz.hub_open', {
    kids: kidsRows.length, has_teacher: Boolean(out.teacher), teacher_src: out.teacher ? out.teacher.src : null,
    again_n: out.again.length, recs_n: out.recs.length, challenge: Boolean(out.challenge),
  });
  return out;
}

/** The hub's boot JSON, with whether the page sends its page-session events (rt, wq-tel.js). */
async function hub(token, opts = {}) {
  return { ...(await hubPayload(token, opts)), rt: await Tel.flag() };
}

module.exports = {
  hub, kidOf, kidFromHub, deviceTrusted, deviceMayName, recOrder, firstOfEach, AGAIN_MAX, RECS_MAX,
  // the switches live in web-quiz-hub-flags.js (student-quiz reads them without loading this module)
  hubLink: Flags.hubLink, flags: Flags.flags, HUB_KEY: Flags.HUB_KEY, CHALLENGE_KEY: Flags.CHALLENGE_KEY, LIBRARY_KEY: Flags.LIBRARY_KEY,
  _resetCache: Flags._resetCache,
};
