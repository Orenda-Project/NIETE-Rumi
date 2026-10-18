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
 *   kidFromHub(token, kid, device) {studentId, grade, rootId, lang} for the library route (null on an untrusted phone)
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
const { read: dbRead } = require('./web-quiz-db-deadline');   // a deadline + one retry on reads (web_quiz_db_deadline)
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
// The challenge's form for a child (web-quiz-challenge.js gradeOf + formForChild, the grade-1 switches included), or
// null when it has none; required on use so the hub never depends on the challenge to boot.
async function challengeForm(studentId) {
  try {
    const Challenge = require('./web-quiz-challenge');
    return (await Challenge.formForChild(await Challenge.gradeOf({ studentId }))) || null;
  } catch (err) {
    logToFile('⚠️ web quiz hub: challenge grade unavailable', { error: err.message });
    return null;
  }
}

// The stops this child's Trail has, by the challenge menu's own rule (web-quiz-challenge.js menu()): the grade-1 form's
// one stop; else the Trail order, the warm-up only with its switches, listen only with its. Not today's read-aloud cap
// nor a listen story still recording: those close a stop for a day, they never take it off the Trail.
async function trailStops(form) {
  const Challenge = require('./web-quiz-challenge');
  const G1 = require('./web-quiz-challenge-grade1');
  if (form === G1.FORM) return [G1.EXERCISE];
  const missing = (await Challenge.recordOn()) && (await Challenge.missingOn());
  const listen = await Challenge.listenOn();
  return Challenge.TRAIL_ORDER.filter((id) => (id !== 'missing' || missing) && (id !== 'listen' || listen));
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

/** The ids a genuine hub token names; else 401 (404 for a genuine guest token). */
function idsOf(token) {
  const tok = T.verify(token, 'h');
  if (!tok && T.verify(token, 'g')) fail(404, 'not_found'); // a guest token (web_quiz_guest_home): the guest page is not built
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
    const { data } = await dbRead('kidClasses:class_enrollments:1', (db) => db.from('class_enrollments').select('class_id').eq('student_id', studentId).eq('is_active', true));
    (data || []).forEach((r) => r.class_id && ids.add(r.class_id));
  } catch (_) { /* no roster: the played codes only */ }
  const played = history.filter((e) => e.teacherSent && e.shareCodeId).map((e) => e.shareCodeId);
  if (played.length) {
    const { data, error } = await dbRead('kidClasses:quiz_share_codes:1', (db) => db.from('quiz_share_codes').select('id, class_id').in('id', played.slice(0, 50)));
    if (!error) (data || []).forEach((r) => r.class_id && ids.add(r.class_id));
  }
  return ids;
}

/** Open teacher-sent codes of these teachers from the last 7 days, newest first; class_id when the column exists. */
async function recentCodes(teachers) {
  const q = (cols) => dbRead('recentCodes:quiz_share_codes:1', (db) => db.from('quiz_share_codes').select(cols)
    .in('teacher_user_id', teachers.slice(0, 5)).eq('active', true)
    .is('parent_share_code_id', null).is('invited_by_student_id', null)
    .gte('created_at', daysAgoIso(TEACHER_DAYS)).order('created_at', { ascending: false }).limit(30));
  const base = 'id, code, quiz_id, topic, active, expires_at, created_at, teacher_user_id';
  const withClass = await q(`${base}, class_id`);
  if (!withClass.error) return withClass.data || [];
  const plain = await q(base);
  return plain.data || [];
}

const { lessonRefs } = require('./web-quiz-lesson-refs');

// pageLang: the language the child's page resolved (web_quiz_return_lang on: the twin in that language is picked first);
// null: the child's newest quiz's, as before.
async function teacherCard(kidRow, list, history, grade, homeP = null, pageLang = null) {
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
  const listed = codes.filter((c) => isOpen(c) && !seen.has(c.id));
  if (!listed.length) return null;
  // The child home (web_quiz_home_v3): a storybook the teacher only previewed is not "from your teacher" — told apart
  // by three more columns on this same quizzes read (the home's switch is read beside the hub's own reads).
  const Home = require('./web-quiz-hub-home');
  const home = homeP ? (await homeP.flags).home === true : false;
  const quizIds = [...new Set([...listed.map((c) => c.quiz_id), ...history.filter((e) => e.latest && e.quizId).map((e) => e.quizId)])];
  const cols = `id, topic, subject, grade, language, lesson_plan_id, coaching_session_id${home ? `, ${Home.PREVIEW_COLS}` : ''}`;
  const { data: quizzes } = await dbRead('teacherCard:quizzes:1', (db) => db.from('quizzes').select(cols).in('id', quizIds));
  const previews = home ? Home.storyPreviews(quizzes) : null;
  const open = previews && previews.size ? listed.filter((c) => !previews.has(c.quiz_id)) : listed;
  if (!open.length) return null;
  const quizById = new Map((quizzes || []).map((q) => [q.id, q]));
  // The same lesson the child already finished (its twin in the other language) is not "new from your teacher".
  const doneLessons = new Set(history.filter((e) => e.latest).flatMap((e) => lessonRefs(quizById.get(e.quizId))));
  const lang = pageLang || clampLanguage(require('./student-quiz.service').childLanguage(history));
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
    const { count, error } = await dbRead('answeredSoFar:quiz_answers:1', (db) => db.from('quiz_answers').select('id', { count: 'exact', head: true }).eq('session_id', entry.openSessionId));
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
      const { data: v } = await dbRead('recsFor:student_videos:1', (db) => db.from('student_videos').select('id, grade, subject, clean_chapter').eq('id', lastDone.videoId).maybeSingle());
      if (v) { last = { subject: v.subject, chapter: v.clean_chapter, vid: v.id }; G = String(v.grade); }
    }
    if (!last) {
      const gs = Videos.gradesFor(lastDone.grade);
      last = { subject: Videos.subjectFor(lastDone.subject), chapter: null, vid: null };
      if (gs.length) G = gs.includes(grade) ? grade : gs[0];
    }
  }
  if (!G) return [];
  const { data: vids, error } = await dbRead('recsFor:student_videos:2', (db) => db.from('student_videos')
    .select('id, grade, subject, clean_chapter, clean_title, r2_url')
    .eq('migration_status', 'done').is('superseded_by', null).eq('grade', G).limit(400));
  if (error || !vids || !vids.length) return [];
  const { data: quizzes } = await dbRead('recsFor:quizzes:1', (db) => db.from('quizzes').select('id, video_id')
    .in('video_id', vids.map((r) => r.id)).eq('quiz_source', 'video').eq('status', 'ready'));
  const quizOf = new Map((quizzes || []).map((q) => [q.video_id, q.id]));
  const { data: done } = await dbRead('recsFor:quiz_sessions:1', (db) => db.from('quiz_sessions').select('quiz_id')
    .eq('student_id', kidId).eq('status', 'completed').limit(300));
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
  let studentId = kidOf(token, chip);
  let rawIds = studentId ? [studentId] : [];
  // child identity store (web_quiz_identity_canon): the hub shows each child by the id they are known by, so a chip
  // may name a folded id; it resolves through the token's raw ids (the phone must be trusted for one of them).
  if (!studentId && chip && (await require('./web-quiz-identity-flags').flags()).canon) {
    const tok = T.verify(token, 'h');
    const raw = tok && Array.isArray(tok.ids) ? tok.ids.map(String) : [];
    const canon = await require('./web-quiz-identity-roster').canonicalStudentIds(raw);
    rawIds = raw.filter((id) => kidChip(canon.get(id) || id) === String(chip));
    studentId = rawIds.length ? canon.get(rawIds[0]) || rawIds[0] : null;
  }
  if (!studentId) return null;
  // A forwarded link opens nothing as the child on another phone.
  const trust = await deviceTrusted(token, device);
  if (!trust.ok || !rawIds.some((id) => trust.ids.includes(id))) return null;
  const ctx = await kidContext(studentId);
  if (!ctx) return null;
  const root = ctx.history.find((e) => e.teacherSent) || null;
  // lang: the child's language from their own quizzes (null with none), for the video library's language list;
  // web_quiz_return_lang: the hub's own order (a grown-up's choice → class quiz → the link's `l` → the join's → lesson)
  const CLang = require('./web-quiz-child-lang');
  const lang = (await require('./web-quiz-return-lang').on())
    ? CLang.ladder({ own: await CLang.ownOf(studentId), history: ctx.history, linked: await linkedLang(token) })
    : require('./student-quiz.service').childLanguage(ctx.history);
  return { studentId, grade: ctx.grade, rootId: root ? root.shareCodeId : null, lang };
}

// `known`: the child's row and class list the caller has just read (fast first page), so they are not read again.
async function kidContext(studentId, known = null) {
  const { data: row } = known ? { data: known.row } : await dbRead('kidContext:students:1', (db) => db.from('students')
    .select('id, student_name, student_name_urdu, self_reported_class, list_id, is_active').eq('id', studentId).maybeSingle());
  if (!row || row.is_active === false) return null;
  const { data: list } = known ? { data: known.list } : row.list_id
    ? await dbRead('kidContext:student_lists:1', (db) => db.from('student_lists').select('id, user_id, class_name, section').eq('id', row.list_id).maybeSingle())
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

/**
 * The language the child chose on the page that sent them here (?lang=en|ur), when it may win over the guess from
 * their history: only under web_quiz_challenge_v2 (with its parents; web-quiz-hub-play.js switches, 30 s cache,
 * fail closed) or web_quiz_return_lang (the join's first home; web-quiz-return-lang.js, the same). Anything else, or
 * both off: null, and the hub is today's. Asked only when a lang came.
 */
async function askedLang(lang) {
  if (lang !== 'en' && lang !== 'ur') return null;
  try {
    if ((await require('./web-quiz-hub-play').switches()).v2) return lang;
  } catch (_) { /* v2 closed; the return switch may still say yes */ }
  try {
    return (await require('./web-quiz-return-lang').on()) ? lang : null;
  } catch (_) {
    return null;
  }
}

/**
 * The language the /quiz reply spoke, carried by the hub link (`l`, en|ur), for a child with no class quiz yet: only under
 * web_quiz_return_lang (web-quiz-return-lang.js, 30 s cache, fails closed). No `l`, or the switch off: null (today's).
 */
async function linkedLang(token) {
  const tok = T.verify(token, 'h');
  const R = require('./web-quiz-return-lang');
  if (!tok || !R.linkLang(tok.l)) return null;
  try {
    return (await R.on()) ? tok.l : null;
  } catch (_) {
    return null;
  }
}

/** A phone that may not see the children: their language only, never a name, a chip or a quiz. */
async function lockedHub(ids, why, asked = null, linked = null) {
  let lang = 'en';
  let chosen = null;
  try {
    const { data: rows } = await dbRead('lockedHub:students:1', (db) => db.from('students').select('id, is_active').in('id', ids));
    const live = (rows || []).filter((r) => r.is_active !== false);
    if (live.length) {
      const StudentQuiz = require('./student-quiz.service');
      // web_quiz_return_lang: the child's kept row, by the id the child is known by (the token keeps raw ids), read beside
      // the quizzes; the one order (web-quiz-child-lang.js ladder) — off: null, today's line
      const [history, own] = await Promise.all([StudentQuiz.quizzesForStudents(live),
        live.length === 1 ? require('./web-quiz-child-lang').ownOf(live[0].id, { raw: true }) : null]);
      lang = clampLanguage(require('./web-quiz-child-lang').ladder({ own, history, linked }));
      chosen = own && own.source === 'chosen' ? own.language : null;
    } else if (linked) lang = linked;
  } catch (_) { /* English */ }
  if (asked) lang = asked;
  // a grown-up's kept choice outranks the URL's ?lang= (web_quiz_return_lang; off: null)
  if (chosen) lang = chosen;
  logEvent('web_quiz.hub_locked', { kids: ids.length, why });
  return { lang, locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: await brandKey() };
}

// ─── the hub ────────────────────────────────────────────────────────────────

/**
 * The hub's children rows and their lists, read for the ids as given before the identity lookup has answered
 * (web_quiz_hub_fanout). take(ids) gives them back only when every one of `ids` was asked for, so the rows are
 * exactly what the same reads for `ids` would answer (null: read again, as off); lists(listIds) the same for the
 * lists, when every list id was asked for. A failed early read is never used and never thrown here.
 */
function earlyRows(given, readRows, readLists) {
  const asked = new Set(given);
  const rowsP = Promise.resolve().then(() => readRows(given));
  const listsP = rowsP.then((res) => {
    const listIds = [...new Set(((res && res.data) || []).filter((r) => r && r.is_active !== false).map((r) => r.list_id).filter(Boolean))];
    return listIds.length ? readLists(listIds).then((l) => ({ listIds: new Set(listIds), res: l })) : null;
  });
  rowsP.catch(() => {});
  listsP.catch(() => {});
  return {
    async take(ids) {
      if (!ids.every((id) => asked.has(id))) return null;
      const rowsRes = await rowsP.catch(() => null);
      if (!rowsRes || rowsRes.error) return null;
      const early = await listsP.catch(() => null);
      return { rowsRes, lists: (listIds) => (early && !early.res.error && listIds.every((id) => early.listIds.has(id)) ? early.res : null) };
    },
  };
}

// web_quiz_hub_fanout: the cached switch readers on the hub's path, kept warm by web-quiz-hub-warm.js between visits
// (each answers from its own cache while fresh). They live here, not in the keeper, so the keeper needs no module that
// leads back to the hub.
const HUB_SWITCH_READERS = [
  () => require('./web-quiz-ur-polish').ui(),
  () => require('./web-quiz-identity-flags').flags(),
  () => require('./web-quiz-student-join').flags(),
  () => require('./web-quiz-bind-way-back').on(),
  () => require('./web-quiz-return-lang').on(),
  () => require('./web-quiz-next-offer-state').raw(),
  () => require('./web-quiz-hub-play').switches(),
  () => require('./web-quiz-challenge').recordOn(),
  () => require('./web-quiz-challenge').missingOn(),
  () => require('./web-quiz-challenge').poolOn(),
  () => require('./web-quiz-challenge').listenOn(),
  () => require('./web-quiz-book').flags(),
  () => require('./web-quiz-telemetry').flag(),
  () => brandKey(),
];

async function hubPayload(token, { kid, device, src, lang: wanted, keep = false, st = null } = {}) {
  const mark = st ? (n) => st.mark(n) : () => {}; // the step timings (web-quiz-server-timing.js); nothing without a stopwatch
  if (!T.secret()) fail(503, 'web_quiz_off');
  const practice = await require('./web-quiz-hub-home').practiceHub(token, { lang: wanted, brandKey }); // a coach's class preview by grade: null unless web_quiz_home_v3
  if (practice) return practice;
  const ids = idsOf(token);
  const f = await Flags.flags();
  if (!f.hub) fail(503, 'web_quiz_off');
  // web_quiz_hub_fanout: the reads that do not need each other's answers start together (the same answer, byte for byte)
  const together = f.fanout === true;
  if (together) require('./web-quiz-hub-warm').touch(HUB_SWITCH_READERS); // the hub's switches stay warm for the next child
  const brandP = together ? brandKey() : null;
  let asked; let linked; let trust; let idFlags = null;
  if (together) [asked, linked, trust, idFlags] = await Promise.all([askedLang(wanted), linkedLang(token), deviceTrusted(token, device), require('./web-quiz-identity-flags').flags()]);
  else {
    asked = await askedLang(wanted);
    linked = await linkedLang(token);
    trust = await deviceTrusted(token, device);
  }
  mark('gate');
  if (!trust.ok) return lockedHub(ids, trust.why, asked, linked);
  // Only the children this phone is trusted for: all of them on the bound phone, else the ones it played as.
  let mine = ids.filter((id) => trust.ids.includes(id));
  const readRows = (them) => dbRead('hubPayload:students:1', (db) => db.from('students')
    .select('id, student_name, student_name_urdu, self_reported_class, list_id, is_active').in('id', them));
  const readLists = (listIds) => dbRead('hubPayload:student_lists:1', (db) => db.from('student_lists').select('id, user_id, class_name, section').in('id', listIds));
  // web_quiz_hub_fanout: the children's rows and lists for the ids as given are read beside the identity lookup below;
  // used only when every id it gives is one of them (the usual case), else read again for its ids, as off.
  const early = together ? earlyRows(mine, readRows, readLists) : null;
  // child identity store (web_quiz_identity_canon): each child once, by the id they are known by (the token keeps raw ids).
  if ((idFlags || await require('./web-quiz-identity-flags').flags()).canon) {
    const canon = await require('./web-quiz-identity-roster').canonicalStudentIdsShared(mine);
    mine = [...new Set(mine.map((id) => canon.get(id) || id))];
  }
  mark('gate');

  const pre = early ? await early.take(mine) : null;
  const { data: rows } = pre ? pre.rowsRes : await readRows(mine);
  const kidsRows = mine.map((id) => (rows || []).find((r) => r.id === id)).filter((r) => r && r.is_active !== false);
  const listIds = kidsRows.map((r) => r.list_id).filter(Boolean);
  const { data: lists } = kidsRows.some((r) => r.list_id)
    ? (pre && pre.lists(listIds)) || await readLists(listIds)
    : { data: [] };
  mark('kids');
  const listOf = (r) => (lists || []).find((l) => l.id === r.list_id) || null;
  const gradeOf = (r) => gradeNum((listOf(r) || {}).class_name) || gradeNum(r.self_reported_class) || null;

  const chosen = kidsRows.find((r) => kidChip(r.id) === String(kid || '')) || (kidsRows.length === 1 ? kidsRows[0] : null);
  // Started now, beside the rest of the hub's reads (challengeForm never rejects): it is a few reads of its own.
  const challengeP = f.challenge && chosen ? challengeForm(chosen.id) : Promise.resolve(null);
  // The child home's reads (web_quiz_home_v3), started here too: keyed on the child alone, so they add no wait.
  const homeP = chosen ? require('./web-quiz-hub-home').prefetch(chosen.id) : null;
  // Stories too (hubBits never rejects; {} while web_quiz_stories is off): its reads run beside the hub's own.
  const storiesP = chosen ? require('./web-quiz-stories').hubBits({ studentId: chosen.id }) : null;
  // The child's kept language (web_quiz_return_lang; child_language), started here too: a grown-up's tap on the grown-ups
  // corner (`keep`, this trusted phone, the child the request names) is kept, else the child's row is read. Off: null.
  const CL = require('./child-language.repo');
  const ownP = !chosen ? Promise.resolve(null)
    : keep && asked && kidChip(chosen.id) === String(kid || '')
      ? CL.choose(chosen.id, asked).then((kept) => (kept ? { language: asked, source: 'chosen' } : CL.stored(chosen.id)))
      : CL.stored(chosen.id);
  // Jugnu's Book needs the child alone: started here too when the reads go together (awaited in today's place).
  const bookP = together && chosen ? require('./web-quiz-book').hubBits({ studentId: chosen.id }) : null;
  if (bookP) bookP.catch(() => {});
  // Fast first page (web_quiz_fast): the chosen child's row and list are the ones just read above.
  const ctx = chosen ? await kidContext(chosen.id, require('./web-quiz-fast').on() ? { row: chosen, list: listOf(chosen) } : null) : null;
  const history = ctx ? ctx.history : [];
  // web_quiz_return_lang: the one order (web-quiz-child-lang.js ladder) over the child's kept row: a kept choice outranks
  // even a `?lang=` the URL still carries (a join's redirect is reopened for days), the link's `l` sits before the
  // join's. Off: `own` is null and the order is today's line exactly.
  const own = await ownP;
  mark('ctx');
  const lang = clampLanguage(require('./web-quiz-child-lang').ladder({ own, asked, history, linked }));
  const nameOf = (r) => firstName(lang === 'ur' && r.student_name_urdu && String(r.student_name_urdu).trim() ? r.student_name_urdu : r.student_name);
  const out = {
    lang,
    kids: kidsRows.map((r) => ({ chip: kidChip(r.id), first: nameOf(r), animal: T.animalFor(r.id), grade: gradeOf(r) })),
    kid: chosen ? kidChip(chosen.id) : null,
    teacher: null, again: [], recs: [], challenge: null, lib: null,
    // Which brand the page wears: a key only; the edge owns the look (as getQuiz).
    brand: await (brandP || brandKey()),
  };
  // Events v2 (web_quiz_events_v2): hub_open gains the envelope and the phone's key (kid only once a child is picked).
  // src is the route the caller passed (the hub URL's from=), only from the known set; the return mark (ret) is not known here.
  const openEv = (base, studentId) => (f.hub && f.eventsV2 ? require('./web-quiz-measure-events').hubOpen(base, { studentId, device, src }) : base);
  // ...and the page's event batches carry the hub token and the picked chip (hub.js, wq-tel.js setIds). Off: no key.
  if (f.hub && f.eventsV2) out.ev2 = true;
  if (together) return payloadTogether({ out, f, token, chosen, kidsRows, trust, lang, device, src, ctx, history, homeP, storiesP, challengeP, bookP, openEv, mark });
  // keep my place (web_quiz_phone_bind): the card's ticket for a chosen child, the picker chips' line2/played. Off: untouched.
  await require('./web-quiz-bind-page').hubExtras(out, { token, chosen, rows: kidsRows, trust, lang, device, src });
  // a child whose place is saved on a family phone with no code (joined on their own, or confirmed on the /quiz landing):
  // never the "keep my place" card again, on any link (quiz_student_join; off: untouched)
  if (chosen && out.bind && out.bind.offer) await require('./web-quiz-student-join').hideCardIfBound(out, chosen.id);
  mark('take');
  if (!chosen) {
    logEvent('web_quiz.hub_open', openEv({ kids: kidsRows.length, picked: false }, null));
    return out;
  }
  const grade = ctx.grade;
  // web_quiz_return_lang: the teacher's twin in the page's own language (off: the newest quiz's, today's)
  out.teacher = await teacherCard(chosen, ctx.list, history, grade, homeP, (await require('./web-quiz-return-lang').on()) ? out.lang : null);
  mark('teacher');
  out.again = againOf(history, chosen.id, out.teacher && out.teacher.code);
  // The Home button is on: the library and challenge links from here say so (hub.js adds home=1).
  if (f.homeButton) out.nav_home = true;
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
  mark('recs');
  // The tile asks the challenge's own grade rule (a band of grades is no grade there), so it never opens onto a refusal.
  const form = await challengeP;
  if (form) out.challenge = { on: true };
  // The library: M4b's page when it is on; else the child's newest open quiz (its scorecard lists more videos).
  const newest = history.find((e) => e.active && e.code);
  // The library page opens in the child's language (?l=), the same one this hub is in.
  if (f.library) out.lib = { href: `/lib/${token}?kid=${out.kid}&l=${out.lang}` };
  else if (newest) out.lib = { href: `/q/${newest.code}?k=${T.chipId(newest.shareCodeId, chosen.id)}` };
  // The Library tile wears the child's grade picture (the library opens on that grade).
  if (out.lib && grade && artOf('grade', grade)) out.lib.art = artOf('grade', grade);
  const collect = {};
  // the ranked next thing's own reads start now, beside Jugnu's corner and the Book (null at once while it is off)
  const nextPrep = require('./web-quiz-next-offer-sources').hubPrep({ out, token, history, lang: out.lang, chosenId: chosen.id, grade, stopsOf: () => trailStops(form) });
  Object.assign(out, await require('./web-quiz-hub-play').playField({ chosenId: chosen.id, last: out.last, lang: out.lang, challenge: out.challenge, grade, stopsOf: () => trailStops(form), steps: () => require('./web-quiz-challenge'), collect })); // Jugnu first, lantern, shelf, install: no `play` key with their switches off
  logEvent('web_quiz.hub_open', openEv({
    kids: kidsRows.length, has_teacher: Boolean(out.teacher), teacher_src: out.teacher ? out.teacher.src : null,
    again_n: out.again.length, recs_n: out.recs.length, challenge: Boolean(out.challenge),
  }, chosen.id));
  Object.assign(out, await require('./web-quiz-book').hubBits({ studentId: chosen.id })); // Jugnu's Book: {} while web_quiz_challenge_book is off
  mark('play');
  // Stories (started with the challenge's reads), the v3 home's doors + header and the ranked next thing are independent
  // fields (none reads another): read side by side, so neither Stories nor the slot adds a serial wave. Each is {} while off.
  const [storyBits, homeBits, nextField] = await Promise.all([
    storiesP,
    require('./web-quiz-hub-home').homeField({ out, chosenId: chosen.id, history, pre: homeP, device, src, grade }),
    require('./web-quiz-next-offer-sources').hubField({ out, token, history, collect, lang: out.lang, chosenId: chosen.id, grade, subjectArt: subjectArtOf, prep: nextPrep }),
  ]);
  Object.assign(out, storyBits, homeBits, nextField);
  mark('home');
  return out;
}

/**
 * hubPayload's second half with web_quiz_hub_fanout on: the same fields, set in the same order (so the JSON is the
 * same, byte for byte), but the parts that need only the child's history start together: the keep-my-place extras,
 * the teacher card, the last quiz's answered count, the recommendations and Jugnu's corner (once the challenge's form
 * and the answered count are known); the Book was started with the child's first reads. The ranked next thing still
 * starts once the teacher, last quiz, recommendations and library are on `out`, as today.
 * Step timings: the parts that run side by side are one step, timed as `teacher` (then `play` for the Book, `home`).
 */
async function payloadTogether({ out, f, token, chosen, kidsRows, trust, lang, device, src, ctx, history, homeP, storiesP, challengeP, bookP, openEv, mark }) {
  const extrasP = (async () => {
    await require('./web-quiz-bind-page').hubExtras(out, { token, chosen, rows: kidsRows, trust, lang, device, src });
    if (chosen && out.bind && out.bind.offer) await require('./web-quiz-student-join').hideCardIfBound(out, chosen.id);
  })();
  if (!chosen) {
    await extrasP;
    mark('take');
    logEvent('web_quiz.hub_open', openEv({ kids: kidsRows.length, picked: false }, null));
    return out;
  }
  const grade = ctx.grade;
  const last = f.childHome ? lastOf(history, chosen.id) : undefined;
  const answeredP = last && last.state === 'open'
    ? answeredSoFar(history.find((e) => e.code === last.code), last.answered).then((n) => { last.answered = n; })
    : Promise.resolve();
  const NO_RECS = {};
  const recsP = recsFor(chosen.id, history, grade).catch((err) => {
    logToFile('⚠️ web quiz hub: recommendations unavailable', { error: err.message });
    return NO_RECS;
  });
  const collect = {};
  const playP = Promise.all([challengeP, answeredP]).then(([form]) => require('./web-quiz-hub-play').playField({ chosenId: chosen.id, last: f.childHome ? last : undefined, lang: out.lang, challenge: form ? { on: true } : null, grade, stopsOf: () => trailStops(form), steps: () => require('./web-quiz-challenge'), collect, together: true }));
  // web_quiz_return_lang: the teacher's twin in the page's own language, as on the one-by-one path (off: today's)
  const teacherP = require('./web-quiz-return-lang').on().then((rl) => teacherCard(chosen, ctx.list, history, grade, homeP, rl ? out.lang : null));
  const [, teacher, , recs, form, play] = await Promise.all([extrasP, teacherP, answeredP, recsP, challengeP, playP]);
  mark('teacher');
  out.teacher = teacher;
  out.again = againOf(history, chosen.id, out.teacher && out.teacher.code);
  if (f.homeButton) out.nav_home = true;
  if (f.childHome) {
    out.home_v = 1;
    out.last = last;
    if (out.last && out.teacher && out.teacher.code === out.last.code) out.teacher = null;
    if (out.last) out.again = out.again.filter((a) => a.code !== out.last.code);
  }
  if (recs !== NO_RECS) out.recs = recs;
  if (form) out.challenge = { on: true };
  const newest = history.find((e) => e.active && e.code);
  if (f.library) out.lib = { href: `/lib/${token}?kid=${out.kid}&l=${out.lang}` };
  else if (newest) out.lib = { href: `/q/${newest.code}?k=${T.chipId(newest.shareCodeId, chosen.id)}` };
  if (out.lib && grade && artOf('grade', grade)) out.lib.art = artOf('grade', grade);
  const nextPrep = require('./web-quiz-next-offer-sources').hubPrep({ out, token, history, lang: out.lang, chosenId: chosen.id, grade, stopsOf: () => trailStops(form) });
  Object.assign(out, play);
  logEvent('web_quiz.hub_open', openEv({
    kids: kidsRows.length, has_teacher: Boolean(out.teacher), teacher_src: out.teacher ? out.teacher.src : null,
    again_n: out.again.length, recs_n: out.recs.length, challenge: Boolean(out.challenge),
  }, chosen.id));
  Object.assign(out, await bookP);
  mark('play');
  const [storyBits, homeBits, nextField] = await Promise.all([
    storiesP,
    require('./web-quiz-hub-home').homeField({ out, chosenId: chosen.id, history, pre: homeP, device, src }),
    require('./web-quiz-next-offer-sources').hubField({ out, token, history, collect, lang: out.lang, chosenId: chosen.id, grade, subjectArt: subjectArtOf, prep: nextPrep }),
  ]);
  Object.assign(out, storyBits, homeBits, nextField);
  mark('home');
  return out;
}

/** The hub's boot JSON, with whether the page sends its page-session events (rt, wq-tel.js). */
async function hub(token, opts = {}) {
  // web_quiz_hub_fanout on (the hub's own switch cache; never read here): the Urdu polish, the answer and the telemetry
  // switch side by side, and the hub's switches kept warm for the next child. The same JSON, byte for byte.
  if (Flags.fanoutNow()) return hubTogether(token, opts);
  const ui = await require('./web-quiz-ur-polish').ui();
  if (opts.st) opts.st.mark('ui');
  // Fast first page (web_quiz_fast): named only when on, so the edge sends the next hub's head before the bot answers.
  const fast = require('./web-quiz-fast').on();
  const out = await hubPayload(token, opts);
  if (opts.st) opts.st.mark('other');
  // The read-along preview (#listen/<pid>, web_quiz_readalong): named only when on and this phone holds the hub, so
  // the edge adds its script to that page alone; off, the hub JSON (and page) is today's.
  const listen = !out.locked && (await Flags.flags()).readalong;
  const rt = await Tel.flag();
  if (opts.st) opts.st.mark('tail');
  return { ...out, rt, ...(ui ? { ui } : {}), ...(fast ? { fast: true } : {}), ...(listen ? { listen: true } : {}) };
}

async function hubTogether(token, opts) {
  const fast = require('./web-quiz-fast').on();
  const [ui, out, rt] = await Promise.all([require('./web-quiz-ur-polish').ui(), hubPayload(token, opts), Tel.flag()]);
  if (opts.st) opts.st.mark('other');
  const listen = !out.locked && (await Flags.flags()).readalong;
  if (opts.st) opts.st.mark('tail');
  return { ...out, rt, ...(ui ? { ui } : {}), ...(fast ? { fast: true } : {}), ...(listen ? { listen: true } : {}) };
}

module.exports = {
  hub, kidOf, kidFromHub, deviceTrusted, deviceMayName, recOrder, firstOfEach, AGAIN_MAX, RECS_MAX,
  // the switches live in web-quiz-hub-flags.js (student-quiz reads them without loading this module)
  hubLink: Flags.hubLink, flags: Flags.flags, HUB_KEY: Flags.HUB_KEY, CHALLENGE_KEY: Flags.CHALLENGE_KEY, LIBRARY_KEY: Flags.LIBRARY_KEY,
  _resetCache: Flags._resetCache,
  // the per-child reads, for a result card's next thing (web-quiz-next-offer-sources.js snapshot)
  _parts: { kidContext, kidChip, teacherCard, againOf, lastOf, challengeForm, trailStops, recsFor, subjectArtOf, lessonRefs },
};
