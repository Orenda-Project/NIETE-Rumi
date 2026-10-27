'use strict';
/**
 * A teacher sends a storybook to the class (app_settings `web_quiz_stories_teacher`, default off; it needs the child's
 * stories (`web_quiz_stories`) and hub (`web_quiz_hub`) on too, or a child's link would open nothing).
 *
 *   shelf({ uid, grade, lang, all })   the teacher library's story shelf: ready books of that grade and language,
 *                                      the featured book (story_books.featured_rank) first, then a per-teacher-day shuffle;
 *                                      four books unless `all`; each with its cover, first page and page-1 voice file
 *                                      `send`: whether this teacher's class can get a web link at all
 *   prepare / preview                  the send made ready: one quizzes row per teacher × book (quiz_source 'story',
 *                                      meta.story = {book_id, lang}, no questions) and its class code through the video
 *                                      quiz's own mintCode, minted CLOSED (active false) so a book only looked at never
 *                                      reaches a child; the exact class message
 *   share / send                       the teacher's tap: the code opened, the row marked sent; send answers wa.me with
 *                                      the message (the teacher forwards it; the bot sends nothing)
 *   storyForQuiz(quizRow, ctx)         /q/<code> of a story send: {id, from_teacher, code} for the page, null otherwise
 *   storyDoorOk(session)               the hub door opens for an unfinished session of a story send (the story is the run)
 * The class report of a story send is story-teacher-report.js (it requires nothing of the send).
 *
 * A story send never writes a challenge_passages row: the Challenge's draw, the Book's shelf and the teacher's week
 * story never see a storybook. With the switch off nothing here is reached: the routes answer 404 and a code whose quiz
 * has no questions is the 404 it is today.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const Snap = require('../settings/settings-snapshot'); // web_quiz_page_keep: the page switches in one read
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
// The book a story send carries (`meta.story.book_id`): one reader for the send and its report.
const { bookOf } = require('./story-teacher-report');
const { mustWrite } = require('./must-write');

const FLAG_KEY = 'web_quiz_stories_teacher';
// The child's side this needs: the reader (stories) and the hub it opens in.
const NEEDS = ['web_quiz_stories', 'web_quiz_hub'];
// The Stories page's own security policy (hashed <meta> + header; default off). Read in the switch's one read.
const CSP_KEY = 'quiz_teacher_stories_csp';
const FLAG_TTL_MS = require('../../config/app-settings-ttl').APP_SETTINGS_FLAG_TTL_MS;   // 30 s; APP_SETTINGS_FLAG_TTL_MS shortens it on a test lane (bd-0vaqcg)
const SHELF_N = 4;
const SOURCE = 'story';
const BOOK_COLS = 'id, title, grade, lang, pages, minutes, cover_file, featured_rank, status';

let flag = null;
/** On only when this switch AND the child's stories and hub are exactly `true`; any read failure is off. */
async function flagOn() {
  if (flag && Date.now() - flag.at < FLAG_TTL_MS) return flag.on;
  try {
    const keys = [FLAG_KEY, ...NEEDS];
    const { data, error } = await Snap.rows([...keys, CSP_KEY], () => supabase.from('app_settings').select('key, value').in('key', [...keys, CSP_KEY]));
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = new Map((data || []).map((r) => [r.key, r.value]));
    flag = { at: Date.now(), on: keys.every((k) => by.get(k) === true), csp: by.get(CSP_KEY) === true };
  } catch (e) {
    logToFile('⚠️ story send: settings lookup failed — off', { error: e.message });
    flag = { at: Date.now(), on: false, csp: false };
  }
  return flag.on;
}

/** Whether the Stories page carries its policy: what the switch read above last saw (no read of its own); else off. */
function pageCspOn() {
  return !!(flag && flag.on === true && flag.csp === true);
}

class StoryError extends Error {
  constructor(status, error) { super(error); this.status = status; this.body = { error }; }
}
const fail = (status, error) => { throw new StoryError(status, error); };
// A write the teacher's "sent" depends on that does not land (must-write.js): this module's own refusal.
const unavailable = () => new StoryError(503, 'unavailable');
// A send write that must land on a row; otherwise the send is refused as unavailable.
const MUST_ROW = { needRow: true, refuse: unavailable };

/**
 * The teacher behind a teacher-home token (`{k:'th', uid, lang, via, exp}`); null when not genuine or stale.
 * The ONE adapter: the teacher home's own verifier (first-touch/teacher-home.token.js verifyTeacherHome) when it is
 * deployed, else the same signed shape checked here.
 */
function teacherToken(token) {
  let p = null;
  let home = null;
  try { home = require('../first-touch/teacher-home.token'); } catch (_) { home = null; }
  if (home && typeof home.verifyTeacherHome === 'function') {
    const v = home.verifyTeacherHome(token);
    p = v && v.ok ? (typeof v.ok === 'object' ? v.ok : v) : null;
  } else {
    p = require('./web-quiz-token').verify(token, 'th');
  }
  return p && typeof p.uid === 'string' && p.uid ? p : null;
}
function teacherOf(token) {
  const p = teacherToken(token);
  return p ? p.uid : null;
}

/** The Pakistan calendar day (UTC+5) of `now`, 'YYYY-MM-DD'. */
function pktDay(now) {
  return new Date(Number(now) + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The order a teacher sees on one day: stable for that teacher and day, different across teachers and days. */
function dayOrder(rows, uid, now) {
  const key = (r) => crypto.createHash('sha256').update(`${uid}|${pktDay(now)}|${r.id}`).digest('hex');
  return rows.map((r) => [key(r), r]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((x) => x[1]);
}

const FILE_RX = /^[a-z0-9-]+\.(webp|ogg|mp3)$/;
function bookTile(b, firstPage, sampleAudio) {
  return {
    id: b.id, title: b.title, grade: Number(b.grade), lang: b.lang, dir: b.lang === 'ur' ? 'rtl' : 'ltr',
    pages: Number(b.pages) || 0, minutes: b.minutes == null ? null : Number(b.minutes),
    cover: b.cover_file ? `/s/${b.id}/${b.cover_file}` : null, featured: b.featured_rank != null,
    first_page: firstPage ? `/s/${b.id}/${firstPage}` : null,
    sample_audio: sampleAudio && FILE_RX.test(sampleAudio) ? `/s/${b.id}/${sampleAudio}` : null,
  };
}

/** Per book: page 1's picture and the file name of page 1's current voice (the teacher hears what the class hears). */
async function firstPages(bookIds) {
  const pics = new Map();
  const audio = new Map();
  if (!bookIds.length) return { pics, audio };
  const { data: pages } = await supabase.from('story_pages').select('id, book_id, n, image_file').in('book_id', bookIds).eq('n', 1);
  const byPage = new Map();
  (pages || []).forEach((p) => {
    if (!p) return;
    if (p.image_file) pics.set(p.book_id, p.image_file);
    if (p.id) byPage.set(p.id, p.book_id);
  });
  if (byPage.size) {
    const { data: voices } = await supabase.from('story_page_voices').select('page_id, audio_key, is_current')
      .in('page_id', [...byPage.keys()]).eq('is_current', true);
    (voices || []).forEach((v) => {
      const file = v && v.audio_key ? String(v.audio_key).split('/').pop() : null;
      if (file && byPage.has(v.page_id)) audio.set(byPage.get(v.page_id), file);
    });
  }
  return { pics, audio };
}

async function shelf({ uid, grade, lang, all = false, now = Date.now() } = {}) {
  if (!(await flagOn())) fail(404, 'stories_off');
  if (!uid) fail(401, 'bad_token');
  const g = Number(grade);
  if (!(Number.isInteger(g) && g >= 1 && g <= 5)) fail(400, 'bad_grade');
  const l = lang === 'ur' ? 'ur' : lang === 'en' ? 'en' : fail(400, 'bad_lang');
  const { data, error } = await supabase.from('story_books').select(BOOK_COLS)
    .eq('status', 'ready').eq('grade', g).eq('lang', l);
  if (error) fail(503, 'unavailable');
  const rows = (data || []).filter((b) => b && b.id && b.status === 'ready');
  const featured = rows.filter((b) => b.featured_rank != null).sort((a, b) => Number(a.featured_rank) - Number(b.featured_rank));
  const rest = dayOrder(rows.filter((b) => b.featured_rank == null), uid, now);
  const ordered = [...featured, ...rest].slice(0, all ? undefined : SHELF_N);
  const { pics, audio } = await firstPages(ordered.map((b) => b.id));
  // `send`: whether this teacher's class can get a web link (a story is read on the web page only); false, the page
  // shows the books with one line and no way into a send that would be refused.
  const send = await require('./web-quiz-link').webQuizOn(uid);
  return { grade: g, lang: l, books: ordered.map((b) => bookTile(b, pics.get(b.id), audio.get(b.id))), send };
}

/** This teacher's story rows for this book, oldest first (one is kept per teacher × book). */
async function rowsFor(uid, bookId) {
  const { data } = await supabase.from('quizzes').select('id, meta, status, created_at')
    .eq('teacher_id', uid).eq('quiz_source', SOURCE).order('created_at', { ascending: true });
  return (data || []).filter((q) => bookOf(q) === String(bookId));
}

/** The send's row: the one this teacher has for the book, else a new one; two first previews at once keep the oldest. */
async function rowFor(uid, book, lang) {
  const had = (await rowsFor(uid, book.id))[0];
  if (had) return had;
  const data = await mustWrite(supabase.from('quizzes').insert({
    teacher_id: uid, quiz_source: SOURCE, topic: book.title, grade: String(book.grade), language: lang, status: 'ready',
    meta: { story: { book_id: book.id, lang } },
  }).select('id, meta, status, created_at').single(), 'story send: could not write the send', MUST_ROW);
  const all = await rowsFor(uid, book.id);
  const keep = all[0] || data;
  if (keep.id !== data.id) {
    await supabase.from('quizzes').delete().eq('id', data.id).eq('status', 'ready');
    logEvent('teacher_story_row_merged', { book_id: book.id, kept: keep.id });
  }
  return keep;
}

/**
 * The code this teacher holds for this quiz, while it has not expired: handed back again (the maker's rule), never a
 * second code. An open code first; else, while the row is not yet sent, the closed one a preview made (a code closed
 * after a send was closed for a reason and is never opened again).
 */
async function heldCode(uid, quiz, now) {
  const quizId = quiz.id;
  const { data } = await supabase.from('quiz_share_codes').select('id, code, active, expires_at, invited_by_student_id, class_id, created_at')
    .eq('quiz_id', quizId).eq('teacher_user_id', uid).is('invited_by_student_id', null)
    .order('created_at', { ascending: false });
  const nowIso = new Date(now).toISOString();
  const live = (data || []).filter((c) => c && (!c.expires_at || c.expires_at > nowIso));
  return live.find((c) => c.active !== false) || (quiz.status === 'sent' ? null : live.find((c) => c.active === false)) || null;
}

/** The class to bind the code to: the one the teacher picked when it is theirs, else the one the server knows. */
async function classFor(uid, quizId, want) {
  const HandoutClass = require('./handout-class.service');
  const r = await HandoutClass.resolveClass({ teacherUserId: uid, quizId });
  if (want) {
    const mine = r && r.state === 'known' ? [r.class] : (r && Array.isArray(r.classes) ? r.classes : []);
    if (mine.some((c) => c && String(c.id) === String(want))) return String(want);
  }
  return HandoutClass.classIdToMint(r);
}

/**
 * The way back on every forwarded class message: the teacher home's copy object owns the line
 * (`first-touch/teacher-home.copy` async returnLine(lang): the line, or '' while its switch is off); absent, no line.
 */
async function returnLine(lang) {
  try {
    const C = require('../first-touch/teacher-home.copy');
    const line = typeof C.returnLine === 'function' ? await C.returnLine(lang) : null;
    return typeof line === 'string' && line ? line : null;
  } catch (_) {
    return null;
  }
}

async function classMessage({ teacher, title, link, lang }) {
  const body = resolveUx('storyClassMessage', { language: lang, params: { teacher, title, link } });
  const back = await returnLine(lang);
  return back ? `${body}\n\n${back}` : body;
}

/**
 * The send, made ready: the row, a code (reused, else minted closed), the link and the exact class message. Nothing a
 * child can open yet: the preview shows this, and the teacher's tap opens the code and marks the row sent.
 */
async function prepare({ uid, storyId, classId = null, now = Date.now() } = {}) {
  if (!(await flagOn())) fail(404, 'stories_off');
  if (!uid) fail(401, 'bad_token');
  if (typeof storyId !== 'string' || !/^[0-9a-f-]{36}$/i.test(storyId)) fail(400, 'bad_story');
  const { data: book } = await supabase.from('story_books').select(BOOK_COLS).eq('id', storyId).maybeSingle();
  if (!book || book.status !== 'ready') fail(404, 'no_story');
  // No web link for this teacher's class: refused before the row or a code is written (nothing left behind).
  if (!(await require('./web-quiz-link').webQuizOn(uid))) fail(409, 'web_quiz_off');
  const lang = clampLanguage(book.lang);
  const quiz = await rowFor(uid, book, lang);

  const Share = require('./video-quiz-share.service');
  let held = await heldCode(uid, quiz, now);
  // An open code handed back again (a second send); a preview's closed code opened by this tap is not one.
  const reused = Boolean(held && held.active !== false);
  if (!held) {
    const cls = await classFor(uid, quiz.id, classId);
    // Closed in its own insert until the teacher sends it: a book only looked at is never "from your teacher" on a
    // child's hub, not even for a moment, and no failed second write can leave it open.
    const minted = await Share.mintCode({ quizId: quiz.id, userId: uid, videoId: null, language: lang, classId: cls, active: false });
    if (!minted) fail(503, 'unavailable');
    held = { ...minted, active: false, class_id: minted.classId || null };
  }
  const link = await require('./web-quiz-link').quizLink(held.code, {
    teacherUserId: uid, whatsapp: `https://wa.me/${Share.botNumber()}?text=QUIZ-${held.code}`, quizId: quiz.id,
  });
  // A story is read on the web page only: a WhatsApp quiz of a story has nothing to ask (the check above, held again
  // here for a link that still is not a page).
  if (!/\/q\/[A-Za-z0-9]+$/.test(String(link || ''))) fail(409, 'web_quiz_off');

  const { data: user } = await supabase.from('users').select('name').eq('id', uid).maybeSingle();
  // The class reads this name: a neutral "your teacher" when the teacher has none.
  const teacher = (user && user.name) || resolveUx('storyYourTeacher', { language: lang });
  const message = await classMessage({ teacher, title: book.title, link, lang });
  return { book, quiz, held, reused, lang, out: { code: held.code, link, class_message: message, wa_href: `https://wa.me/?text=${encodeURIComponent(message)}` } };
}

/** The preview sheet: the book, the exact class message, and where the report comes (in the teacher's language). */
async function preview({ uid, storyId, classId = null, ui = null, now = Date.now() } = {}) {
  const p = await prepare({ uid, storyId, classId, now });
  const { pics, audio } = await firstPages([p.book.id]);
  const uiLang = ui || p.lang;
  return { book: bookTile(p.book, pics.get(p.book.id), audio.get(p.book.id)), ...p.out,
    report_line: resolveUx('storyReportWhere', { language: uiLang }), back_line: resolveUx('storyComeBack', { language: uiLang }) };
}

/**
 * The teacher's tap: the code opened, the row marked sent; the meta carries the code, the message and the times. An
 * update that matched no row (the code or the row gone) is refused like one that failed.
 */
async function markSent(p, now) {
  if (p.held.active === false) {
    // Never a sent row behind a closed code (the class would get "expired"): no open, no send.
    await mustWrite(supabase.from('quiz_share_codes').update({ active: true }).eq('id', p.held.id).select('id'), 'story send: could not open the code', MUST_ROW);
  }
  const meta = { ...(p.quiz.meta || {}), story: { book_id: p.book.id, lang: p.lang }, share_code: p.held.code, share_code_id: p.held.id,
    link: p.out.link, student_message: p.out.class_message, sent_at: new Date(now).toISOString(),
    first_sent_at: (p.quiz.meta && p.quiz.meta.first_sent_at) || new Date(now).toISOString() };
  await mustWrite(supabase.from('quizzes').update({ meta, status: 'sent' }).eq('id', p.quiz.id).select('id'), 'story send: could not mark the send', MUST_ROW);
  logEvent('teacher_story_sent', { book_id: p.book.id, quiz_id: p.quiz.id, share_code_id: p.held.id, class_id: p.held.class_id || null, reused: p.reused });
}

/** POST /api/teacher/story/share: {code, link, class_message}, the send opened and marked sent. */
async function share({ uid, storyId, classId = null, now = Date.now() } = {}) {
  const p = await prepare({ uid, storyId, classId, now });
  await markSent(p, now);
  return { code: p.out.code, link: p.out.link, class_message: p.out.class_message };
}

/** POST /api/teacher/story/send (the page's Send form): the send opened and marked sent, then wa.me with the message. */
async function send({ uid, storyId, classId = null, now = Date.now() } = {}) {
  const p = await prepare({ uid, storyId, classId, now });
  await markSent(p, now);
  return { redirect: p.out.wa_href };
}

// The server's max-rows: a read past it is paged.
const EVENTS_PAGE = 1000;
const COUNT_CHUNK = 300;
const COUNT_SESSION_COLS = 'id, quiz_id, share_code_id, student_id, user_id, status, invited_by_student_id, created_at, completed_at, device_ref';

/** Every row of `make().in(column, ids)`: the ids in chunks of COUNT_CHUNK, each chunk paged by id. Throws on a read error. */
async function pagedIn(make, column, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += COUNT_CHUNK) {
    const part = ids.slice(i, i + COUNT_CHUNK);
    for (let from = 0; ; from += EVENTS_PAGE) {
      const { data, error } = await make().in(column, part).order('id', { ascending: true }).range(from, from + EVENTS_PAGE - 1);
      if (error) throw new Error(error.message || 'read failed');
      out.push(...(data || []));
      if (!data || data.length < EVENTS_PAGE) break;
    }
  }
  return out;
}

/**
 * The teacher home's Stories tile line: the stories this teacher has sent (only these books with `bookIds`) and the
 * children of those sends who read: a child who joined a send's class link and has any story_events row on that send's
 * book since it was first sent. A child reading the same book from the shelf, or before the send, is not counted; the
 * children are the ones both reports count (no teacher's own try, no invited friend).
 * Null while the switch is off, and on any read error (never throws). A preview is not a send. Reads only.
 */
async function storyCounts(uid, { bookIds = null } = {}) {
  try {
    if (!uid || !(await flagOn())) return null;
    const { data: rows, error } = await supabase.from('quizzes').select('id, meta')
      .eq('teacher_id', uid).eq('quiz_source', SOURCE).eq('status', 'sent');
    if (error) return null;
    const want = Array.isArray(bookIds) ? new Set(bookIds.map(String)) : null;
    const sends = (rows || []).filter((q) => q && q.id && bookOf(q) && (!want || want.has(bookOf(q))));
    if (!sends.length) return { sent: 0, read: 0 };
    // The children both reports count (joined, no teacher's own try, no invited friend, one attempt per child),
    // read in chunks and pages: a big class is neither cut at the server's 1000-row cap nor too long for one request.
    const { countedSessions } = require('./teacher-report.data');
    const sessions = countedSessions(await pagedIn(() => supabase.from('quiz_sessions').select(COUNT_SESSION_COLS),
      'quiz_id', sends.map((q) => q.id)), uid, { opened: true });
    const kids = [...new Set(sessions.map((x) => x && x.student_id).filter(Boolean))];
    if (!kids.length) return { sent: sends.length, read: 0 };
    const books = [...new Set(sends.map(bookOf))];
    const events = await pagedIn(() => supabase.from('story_events').select('child_id, book_id, at').in('book_id', books),
      'child_id', kids);
    const kidsOf = new Map(sends.map((q) => [q.id, new Set()]));
    sessions.forEach((x) => { if (x && x.student_id && kidsOf.has(x.quiz_id)) kidsOf.get(x.quiz_id).add(x.student_id); });
    const read = new Set();
    sends.forEach((q) => {
      // As times, not strings: the database writes "+00:00" where the send's time has "Z".
      const since = (q.meta && (q.meta.first_sent_at || q.meta.sent_at)) || null;
      const sinceMs = since ? Date.parse(since) : -Infinity;
      const mine = kidsOf.get(q.id);
      events.forEach((e) => { if (e && mine.has(e.child_id) && String(e.book_id) === bookOf(q) && Date.parse(e.at) >= sinceMs) read.add(e.child_id); });
    });
    return { sent: sends.length, read: read.size };
  } catch (e) {
    logToFile('⚠️ story send: tile counts failed', { error: e.message });
    return null;
  }
}

/** The page's story for a code whose quiz is a story send, when the switch is on; null otherwise (today's 404). */
async function storyForQuiz(quizRow, ctx) {
  const bookId = bookOf(quizRow);
  if (!bookId || !quizRow.id || !(await flagOn())) return null;
  const { data: q } = await supabase.from('quizzes').select('quiz_source').eq('id', quizRow.id).maybeSingle();
  if (!q || q.quiz_source !== SOURCE) return null;
  return { id: String(bookId), from_teacher: true, code: ctx && ctx.code ? String(ctx.code) : null };
}

/**
 * The class's name for the teacher on a story's landing: children say «ٹیچر», never «استاد» (the quiz landing's word,
 * kept as it is for quizzes). English is the quiz landing's label unchanged.
 */
function storyTeacher(teacherName, lang) {
  const { teacherLabel } = require('./quiz-teacher-label');
  const label = teacherLabel(teacherName, lang);
  if (clampLanguage(lang) !== 'ur') return label;
  if (label === resolveUx('tqYourTeacher', { language: 'ur' })) return resolveUx('storyYourTeacher', { language: 'ur' });
  const [before, after] = resolveUx('tqTeacherNamed', { language: 'ur', params: { name: '\u0000' } }).split('\u0000');
  if (!label.startsWith(before) || !label.endsWith(after)) return label;
  return resolveUx('storyTeacherNamed', { language: 'ur', params: { name: label.slice(before.length, label.length - after.length) } });
}

/** The page's boot for a story send: the book to open, and the teacher named in the children's word. */
function storyBoot(out, story, ctx) {
  out.story = story;
  if (out.cls && out.cls.teacher) out.cls.teacher = storyTeacher(ctx && ctx.parent && ctx.parent.teacher_name, ctx && ctx.lang);
  return out;
}

/** Whether a session belongs to a story send (the hub door opens before it is "finished": the story is the run). */
async function storyDoorOk(session) {
  if (!session || !session.share_code_id || !(await flagOn())) return false;
  const { data: sc } = await supabase.from('quiz_share_codes').select('quiz_id').eq('id', session.share_code_id).maybeSingle();
  if (!sc || !sc.quiz_id) return false;
  const { data: q } = await supabase.from('quizzes').select('quiz_source, meta').eq('id', sc.quiz_id).maybeSingle();
  return Boolean(q && q.quiz_source === SOURCE && bookOf(q));
}

module.exports = {
  FLAG_KEY, NEEDS, CSP_KEY, SOURCE, StoryError, flagOn, pageCspOn, teacherToken, teacherOf, pktDay, dayOrder, bookOf, shelf, prepare, preview, share, send,
  storyForQuiz, storyBoot, storyTeacher, storyDoorOk, returnLine, storyCounts,
  _reset: () => { flag = null; },
};
