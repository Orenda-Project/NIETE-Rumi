'use strict';
/**
 * The teacher home's reads. Every list comes from the service that already computes it; nothing here re-derives a
 * rule another file owns:
 *
 *   lessons + coaching   transcript-quiz-list loadLessonPage + lessonItems + quizState (what /quiz and its Flow show:
 *                        recorded lessons, lesson plans without a quiz, their quizzes and each one's state)
 *   played counts        teacher-report.data classReport (the report's own counting), raced against a budget
 *   library shares       the teacher's own share codes on library quizzes (maker sends), counted with the report's
 *                        sessionsFor + countedSessions; their words from maker.bank shareMessage
 *   videos               maker.bank chipTree (the maker's own bank); the prefill from maker.cta prefillOf
 *   stories              the stories service's shelf, when it is there (typeof guard)
 *   children             child-phone-bindings childrenForPhone + web-quiz-hub-flags hubLink
 *   confirm rows         web-quiz-join-queue candidatesFor
 *   report links         teacher-report-gate teacherReportOn + reportUrls
 *
 * Reads only. Every list fails to empty on its own (a slow or broken source costs its section, never the page).
 * `deps` lets a test hand in a stand-in for one source; by default each is the real module, required at call time.
 */
const { logToFile } = require('../../utils/logger');

const REPORT_BUDGET_MS = 4000;
const SIDE_BUDGET_MS = 2500;
const LESSON_ROWS = 30;
// The quick answer (quiz_teacher_home_paged) reads each list up to PostgREST's row cap, in one request.
const HISTORY_ROWS = 1000;
const SHARE_DAYS = 30;

// The stories service ships in its own pull request: looked up by name, absent → no stories section.
const STORIES_MODULE = '../quiz/story-teacher.service';
const optional = (path) => { try { return require(path); } catch (_) { return null; } };

function defaults() {
  return {
    supabase: () => require('../../config/supabase'),
    List: () => require('../quiz/transcript-quiz-list.service'),
    Report: () => require('../quiz/teacher-report.data'),
    Gate: () => require('../quiz/teacher-report-gate'),
    Bank: () => require('./maker.bank'),
    Cta: () => require('./maker.cta'),
    Bindings: () => require('../quiz/child-phone-bindings.repo'),
    Hub: () => require('../quiz/web-quiz-hub-flags'),
    Queue: () => require('../quiz/web-quiz-join-queue'),
    Stories: () => optional(STORIES_MODULE),
    Keys: () => require('./door.keys'),
    CountsFlag: () => require('./teacher-home-counts.flag'),
  };
}
const dep = (deps, name) => (deps && deps[name] ? deps[name] : defaults()[name]());

/** A promise's value, or `fallback` when it throws or runs past `ms` (the page never waits on one slow source). */
function within(p, ms, fallback, what) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([
    Promise.resolve(p).catch((err) => { logToFile(`⚠️ teacher home: ${what} failed — section empty`, { error: err && err.message }); return fallback; }),
    late,
  ]).finally(() => clearTimeout(timer));
}

const firstWord = (s) => String(s || '').trim().split(/\s+/)[0] || null;

/** The users row the page acts for, or null. */
async function teacherOf(uid, deps) {
  const supabase = dep(deps, 'supabase');
  // registration_*: isRegistered() for the portal link (teacher-home.routes portalHref), the /portal command's own test
  const { data, error } = await supabase.from('users').select('id, name, phone_number, preferred_language, role, registration_completed, registration_state').eq('id', uid).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

/** "Mrs Amina Testwala" → "Amina": the report's own title strip, then the first word. */
function firstNameOf(user) {
  if (!user || !user.name) return null;
  let name = user.name;
  try { name = require('../quiz/web-quiz-class-link').stripTitle(name) || name; } catch (_) { /* the raw name */ }
  return firstWord(name);
}

const topicOfSession = (s) => {
  const a = (s && s.analysis_data) || {};
  return (typeof a.topic === 'string' && a.topic.trim()) || (typeof a.subject === 'string' && a.subject.trim()) || null;
};

/**
 * The lessons timeline's raw rows from /quiz's own list: [{ kind:'session'|'lp'|'lesson', key, date, state, quizId,
 * topic, subject, meta }] newest first. `meta` is the quiz's meta (for the class message), never sent to the page.
 */
async function lessons(uid, deps, { light = false } = {}) {
  const List = dep(deps, 'List');
  // light: the quick answer's reads (the list service's loadLessonPageLight), each source up to the row cap: every
  // recorded lesson is listed with its quiz (today's scan stops after 50 sessions; a light row costs bytes, not trips)
  const { sessions, quizzes, lessons: plans } = await (light ? List.loadLessonPage(uid, HISTORY_ROWS, { light: true }) : List.loadLessonPage(uid, LESSON_ROWS));
  return List.lessonItems(sessions, quizzes, plans).map((it) => {
    const q = it.quiz || null;
    const topic = (q && q.topic) || topicOfSession(it.session) || (it.lesson && (it.lesson.topic || it.lesson.title)) || null;
    return {
      kind: it.kind, key: it.key, date: it.date || (q && q.created_at) || null, state: List.quizState(q),
      quizId: q ? q.id : null, topic, subject: (q && q.subject) || (it.lesson && it.lesson.subject) || null,
      grade: (q && q.grade) || (it.lesson && it.lesson.grade) || null,
    };
  });
}

/**
 * The report's own played counts for the quizzes this teacher MADE and sent: Map quizId → { played, of, date, topic,
 * source } (+ `book` on a story send: its meta.story.book_id or null, brought by the same quizzes read). The class
 * report also lists the library quizzes the teacher sent (their sender's report); those are this page's library shares
 * (by their code), so they are left out here — one row per send, never two.
 */
async function playedOwn(uid, deps, { light = false } = {}) {
  const Report = dep(deps, 'Report');
  const out = new Map();
  if (light) {
    // the quick answer: the report's own rows for the teacher's own quizzes only (no library send in them, so no
    // "which are mine" read after; the same rows as below, a story's `book` from the report's own quizzes read)
    const own = await Report.classReport(uid, { days: 60, ownOnly: true });
    ((own && own.quizzes) || []).filter((q) => !q.sent).forEach((q) => out.set(q.id, {
      played: q.played || 0, of: q.of == null ? null : q.of, date: q.date, topic: q.topic, source: q.source || null, ...(q.source === 'story' ? { book: q.book == null ? null : q.book } : {}),
    }));
    return out;
  }
  const r = await Report.classReport(uid, { days: 60 });
  const rows = (r && r.quizzes) || [];
  if (!rows.length) return out;
  const mine = new Map(); // quizId → the story's book id or null
  const ids = rows.map((q) => q.id);
  for (let i = 0; i < ids.length; i += 300) { // under PostgREST's .in() header cap
    const { data: made, error } = await dep(deps, 'supabase').from('quizzes').select('id, story_book:meta->story->>book_id').in('id', ids.slice(i, i + 300)).eq('teacher_id', uid);
    if (error) throw new Error(error.message);
    (made || []).forEach((q) => mine.set(q.id, q.story_book ? String(q.story_book) : null));
  }
  rows.filter((q) => mine.has(q.id)).forEach((q) => out.set(q.id, {
    played: q.played || 0, of: q.of == null ? null : q.of, date: q.date, topic: q.topic, source: q.source || null, ...(q.source === 'story' ? { book: mine.get(q.id) } : {}),
  }));
  return out;
}

/**
 * The teacher's sends of LIBRARY quizzes (codes they hold on a quiz that is not theirs, i.e. the maker's sends),
 * newest first, each with the report's own count of children who finished: [{ shareCodeId, quizId, topic, at, played }].
 */
async function libraryShares(uid, deps, now = Date.now(), { light = false } = {}) {
  const supabase = dep(deps, 'supabase');
  const Report = dep(deps, 'Report');
  const since = new Date(now - SHARE_DAYS * 86400000).toISOString();
  const { data, error } = await supabase.from('quiz_share_codes')
    .select('id, quiz_id, topic, created_at, active, expires_at')
    // the teacher's own sends only: never a child's code under one of theirs (a watch child, a class child's lesson code)
    .eq('teacher_user_id', uid).is('parent_share_code_id', null).is('invited_by_student_id', null).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(10);
  if (error) throw new Error(error.message);
  const codes = (data || []).filter((c) => c.active !== false && (!c.expires_at || new Date(c.expires_at).getTime() > now));
  if (!codes.length) return [];
  const ownRead = supabase.from('quizzes').select('id, teacher_id').in('id', codes.map((c) => c.quiz_id));
  // light (the quick answer): the "prepared" marks asked alongside the quizzes read, not after it
  const notYetSoon = light ? require('./teacher-home.sent').prepared(codes.map((c) => c.id)) : null;
  const { data: own, error: e2 } = await ownRead;
  if (e2) throw new Error(e2.message);
  const mine = new Set((own || []).filter((q) => q.teacher_id === uid).map((q) => q.id));
  const notYet = await (notYetSoon || require('./teacher-home.sent').prepared(codes.map((c) => c.id)));
  const lib = codes.filter((c) => !mine.has(c.quiz_id) && !notYet.has(c.id));
  if (!lib.length) return [];
  const counted = Report.countedSessions(await Report.sessionsFor(lib.map((c) => c.id)), uid);
  const per = new Map();
  counted.forEach((s) => per.set(s.share_code_id, (per.get(s.share_code_id) || 0) + 1));
  return lib.map((c) => ({ shareCodeId: c.id, quizId: c.quiz_id, topic: c.topic || null, at: c.created_at, played: per.get(c.id) || 0 }));
}

/**
 * Of the teacher's own sent quizzes, the ones "Send again" would answer: the quiz is theirs and sent, its stored class
 * message and code are there, and the code is theirs, open and unexpired (the send's own checks, teacher-home.send
 * ownMessage), read in two batches. → Set of quiz ids.
 */
async function sendableOwn(uid, quizIds, deps, now = Date.now()) {
  const supabase = dep(deps, 'supabase');
  const ids = [...new Set((quizIds || []).filter(Boolean))];
  const codeOf = new Map();
  for (let i = 0; i < ids.length; i += 300) { // under PostgREST's .in() header cap
    const { data, error } = await supabase.from('quizzes').select('id, status, meta').in('id', ids.slice(i, i + 300)).eq('teacher_id', uid);
    if (error) throw new Error(error.message);
    (data || []).forEach((q) => {
      const m = q.meta || {};
      if ((q.status === 'sent' || q.status === 'report_sent') && typeof m.student_message === 'string' && m.student_message && m.share_code_id) codeOf.set(q.id, m.share_code_id);
    });
  }
  const live = new Set();
  const codeIds = [...new Set(codeOf.values())];
  for (let i = 0; i < codeIds.length; i += 300) {
    const { data, error } = await supabase.from('quiz_share_codes').select('id, active, expires_at, teacher_user_id').in('id', codeIds.slice(i, i + 300));
    if (error) throw new Error(error.message);
    (data || []).forEach((c) => {
      if (c.teacher_user_id === uid && c.active !== false && !(c.expires_at && new Date(c.expires_at).getTime() <= now)) live.add(c.id);
    });
  }
  return new Set([...codeOf.entries()].filter(([, c]) => live.has(c)).map(([q]) => q));
}

/**
 * The quick answer's send-again rows, read from the teacher id alone (so they start with the other reads): every sent
 * quiz of the teacher's (newest first, up to the row cap) whose stored message and code pass teacher-home.send ownFrom,
 * the same rule sendableOwn applies to a list of ids → Map quizId → own message ({ message, shareCodeId, topic, source }).
 */
async function sendableRows(uid, deps, now = Date.now()) {
  const supabase = dep(deps, 'supabase');
  const Send = require('./teacher-home.send');
  // the two fields of meta the rule reads, never the whole meta
  const { data, error } = await supabase.from('quizzes')
    .select('id, teacher_id, status, quiz_source, topic, student_message:meta->student_message, share_code_id:meta->share_code_id')
    .eq('teacher_id', uid).in('status', ['sent', 'report_sent']).order('created_at', { ascending: false }).limit(HISTORY_ROWS);
  if (error) throw new Error(error.message);
  const quizzes = (data || [])
    .map((q) => ({ id: q.id, teacher_id: q.teacher_id, status: q.status, quiz_source: q.quiz_source, topic: q.topic, meta: q.meta || { student_message: q.student_message, share_code_id: q.share_code_id } }))
    .filter((q) => Send.storedCodeOf(q));
  const codeIds = [...new Set(quizzes.map((q) => q.meta.share_code_id))];
  const reads = [];
  for (let i = 0; i < codeIds.length; i += 300) { // under PostgREST's .in() header cap; the chunks go together
    reads.push(supabase.from('quiz_share_codes').select('id, active, expires_at, teacher_user_id').in('id', codeIds.slice(i, i + 300))
      .then(({ data: rows, error: e }) => { if (e) throw new Error(e.message); return rows || []; }));
  }
  const codes = new Map((await Promise.all(reads)).flat().map((c) => [c.id, c]));
  const out = new Map();
  quizzes.forEach((q) => { const own = Send.ownFrom(uid, q, codes.get(q.meta.share_code_id), now); if (own) out.set(q.id, own); });
  return out;
}

/** Report links for one of the teacher's own quizzes, or null when the report page is not on for them. */
async function reportLinks(uid, quizId, deps) {
  const Gate = dep(deps, 'Gate');
  if (!(await Gate.teacherReportOn(uid))) return null;
  const u = Gate.reportUrls({ teacherId: uid, quizId });
  return u ? { live: u.live, remind: u.remind } : null;
}

/** The bank's video pick for a grade: the prefill's subject first, then the bank's subject order. → chip | null. */
function videoPick(tree, grade, preferSubject) {
  const cell = tree && tree[String(grade)];
  if (!cell) return null;
  const subjects = Object.keys(cell).filter((s) => Array.isArray(cell[s]) && cell[s].length);
  if (!subjects.length) return null;
  const subject = preferSubject && subjects.includes(preferSubject) ? preferSubject : subjects[0];
  const t = cell[subject][0];
  return { quizId: t.quizId, topic: t.topic, subject, grade: String(grade), qlang: t.qlang || null };
}

/** The class's grade: the device's last pick (1–5), else the prefill's grade, else Grade 2 (the largest shelf). */
function gradeOf(asked, pf) {
  if (/^[1-5]$/.test(String(asked || ''))) return Number(asked);
  const m = /^grade_([1-5])\|/.exec(String(pf || ''));
  return m ? Number(m[1]) : 2;
}

/** The stories service's shelf for a grade, or null when the service (or its switch) is not there. */
async function storyShelf(uid, grade, lang, deps) {
  const Stories = dep(deps, 'Stories');
  if (!Stories || typeof Stories.shelf !== 'function') return null;
  if (typeof Stories.flagOn === 'function' && !(await Stories.flagOn())) return null;
  const out = await Stories.shelf({ uid, grade, lang });
  const books = Array.isArray(out) ? out : (out && Array.isArray(out.books) ? out.books : null);
  return books ? books.slice(0, 4).map((b) => ({ id: String(b.id), title: b.title || '', cover: b.cover || null, featured: Boolean(b.featured) })) : null;
}

/** "Children on this phone": the hub link for this phone's children, or null. */
async function childrenLink(user, deps) {
  if (!user || !user.phone_number) return null;
  const kids = await dep(deps, 'Bindings').childrenForPhone(user.phone_number);
  if (!kids || !kids.length) return null;
  return dep(deps, 'Hub').hubLink(kids.map((k) => k.id), 'teacher_home');
}

/** The confirm rows (a child who joined on their own, maybe one of this class) for this teacher: [{ looseId, candidateId, first, candidateFirst }]. */
async function confirmRows(uid, deps) {
  const rows = await dep(deps, 'Queue').candidatesFor(uid);
  return (rows || []).slice(0, 5).map((r) => ({
    looseId: r.loose_id, candidateId: r.candidate_id, first: firstWord(r.first), candidateFirst: firstWord(r.candidate_first),
  })).filter((r) => r.looseId && r.candidateId && r.first && r.candidateFirst);
}

/** The maker link (via 'menu'; tour 1 when the tour was seen, or when that read fails). */
async function makerLink(uid, lang, pf, deps) {
  const Cta = dep(deps, 'Cta');
  let tour = 0;
  try {
    const Keys = dep(deps, 'Keys');
    if (typeof Keys.tourSeen === 'function') tour = (await Keys.tourSeen(uid)) ? 1 : 0;
  } catch (_) { tour = 1; }
  const url = Cta.makerUrl({ uid, lang, tour, via: 'menu', ...(pf ? { pf } : {}) });
  if (!url) return null;
  const at = url.indexOf('/m/');
  return at >= 0 ? url.slice(at) : null;
}

module.exports = {
  teacherOf, firstNameOf, lessons, playedOwn, libraryShares, sendableOwn, sendableRows, reportLinks, videoPick, gradeOf, storyShelf,
  childrenLink, confirmRows, makerLink, within, dep, REPORT_BUDGET_MS, SIDE_BUDGET_MS, HISTORY_ROWS,
};
