'use strict';
/**
 * The web video library: a child picks SUBJECT (with a grade strip) → CHAPTER → video, in the
 * WhatsApp Student Videos Flow's own order (video-bank-order.js).
 *
 *   lib(code, {st, g, s})      the library seen from a quiz the child is in
 *     no s  → { grade, grades:[{g, n, art}], subjects:[{key, n, art}], mine? }  (mine: the quiz's own subject)
 *     s     → { grade, subject, art, chapters:[{name, videos:[{vid, title, secs?, mb?, poster?, done?, code?}]}] }
 *   libHub(token, {kid, g, s}) the same, seen from the kid's hub (the hub module names the child); a grown-up's preview
 *                              link (web_quiz_practice_play) sees its grade's library, watch only (no Quiz button).
 *                              `g` may be several grades or 'all' (bd-5gyspy.5): then `sel` and `first` say which, and
 *                              each chapter its `grade`; with no `g` the visitor's own grade(s), else every grade
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
 *
 * app_settings `web_quiz_videos_v3` (off unless the JSON true; off = all of the above unchanged):
 *   - only the videos in the child's language, plus those with no language, inside each subject that has any in
 *     the child's language (a subject with none is shown as it is) (the hub: the child's own
 *     language, else the page's ?l=; a quiz code: the page's ?l=, else the code's language);
 *   - chapters and titles with their numbers compared as numbers (Order.compareVideosNatural);
 *   - each chapter's `art` (its first poster) and `tile: 'neutral'`: a broken poster falls back to the
 *     chapter's art, then to a plain tile, never to the subject art.
 *
 * app_settings `web_quiz_video_shelf` (off unless the JSON true; off = all of the above unchanged), a subject's lessons
 * seen from the kid's hub:
 *   - each lesson with a poster also names its small thumbnail, `thumb: /wq/vt/<vid>.webp` (web-quiz-video-thumb.js);
 *   - `quiz: true` when this child's quiz after any lesson can be made: a class (the hub's root), or the watch root
 *     set (a class-less child's quizzes hang under it; absent = no quiz is offered, never a button that fails).
 */
const supabase = require('../../config/supabase');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const Order = require('./video-bank-order');


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

const { libraryOn, videosV3On, urTitlesOn, videoShelfOn, rewatchDoneOn, FLAG_KEY } = require('./web-quiz-library-flag');
const langOf = (l) => (l === 'en' || l === 'ur' ? l : null);

// ─── the bank, the child, the class's codes (web-quiz-bank.js) ───────────────

const { bank, track, studentFromSt, doneQuizzes, classCodes, languages, urTitles } = require('./web-quiz-bank');

/**
 * web_quiz_videos_v3: the bank as a child of `lang` sees it. Inside a grade's subject that is in the child's language
 * (at least LANG_FLOOR of its videos, or LANG_SHARE of them), the other language's videos are left out (a video with
 * no language is for both). A subject with fewer is shown whole, the child's language first; a subject with none in
 * the child's language is shown as it is, so no subject disappears (e.g. Maths taught in English to an Urdu child).
 */
const LANG_FLOOR = 3;
const LANG_SHARE = 0.25;
async function inLanguage(ix, lang) {
  const of = lang ? await languages() : null;
  if (!of) return ix;
  const group = (r) => `${r.grade}|${r.subject}`;
  const all = new Map();
  const own = new Map();
  for (const r of ix.rows) {
    all.set(group(r), (all.get(group(r)) || 0) + 1);
    if (of.get(r.id) === lang) own.set(group(r), (own.get(group(r)) || 0) + 1);
  }
  const hasLang = new Set([...own].filter(([k, n]) => n >= LANG_FLOOR || n >= LANG_SHARE * all.get(k)).map(([k]) => k));
  // A thin subject is shown whole; its videos in the child's language are listed first.
  const ownFirst = new Set(ix.rows.filter((r) => own.has(group(r)) && !hasLang.has(group(r)) && of.get(r.id) === lang).map((r) => r.id));
  // A subject shown as it is because all its videos are in another language is listed after the others.
  const otherOnly = new Set(ix.rows.filter((r) => !own.has(group(r)) && of.has(r.id) && of.get(r.id) !== lang).map(group));
  return { ...ix, rows: ix.rows.filter((r) => !hasLang.has(group(r)) || !of.has(r.id) || of.get(r.id) === lang), otherLast: otherOnly, ownFirst };
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
  // web_quiz_videos_v3: a subject shown only in another language comes after the child's own; each group in order.
  const first = (k) => (ix.otherLast && ix.otherLast.has(`${grade}|${k}`) ? 1 : 0);
  const subjects = [...bySubject.keys()].filter(Boolean).sort((a, b) => first(a) - first(b) || Order.compareSubjects(a, b))
    .map((s) => ({ key: s, n: bySubject.get(s), art: subjectArt(s) }));
  return { grade, grades, subjects };
}

/** A grade's subject's lessons in the order the child's subject screen lists them (one order for the screen and the next lesson). Pure. */
function lessonOrder(ix, grade, subject, v3) {
  const rows = ix.rows.filter((r) => String(r.grade) === grade && r.subject === subject).sort(v3 ? Order.compareVideosNatural : Order.compareVideos);
  // web_quiz_videos_v3: in a thin subject the child's language comes first, each part in the usual order.
  if (ix.ownFirst && ix.ownFirst.size) rows.sort((a, b) => (ix.ownFirst.has(b.id) ? 1 : 0) - (ix.ownFirst.has(a.id) ? 1 : 0));
  return rows;
}

// grades (several grades, «All grades»; bd-5gyspy.5): the subject's lessons grade by grade in that order, each chapter
// naming its `grade` (a chapter never runs across two grades).
async function chaptersView(ix, { grade, grades = null, subject, studentId, rootId, fetchImpl, hubKid, v3 }) {
  const Videos = require('./web-quiz-videos');
  const Media = require('./web-quiz-media');
  const rows = grades ? grades.flatMap((g) => lessonOrder(ix, g, subject, v3)) : lessonOrder(ix, grade, subject, v3);
  const quizIds = rows.map((r) => ix.quizOf.get(r.id));
  const [done, codes, posters, ur] = await Promise.all([
    doneQuizzes(studentId, quizIds),
    classCodes(rootId, quizIds),
    Promise.all(rows.map((r) => Media.signPoster(r.r2_url))),
    // web_quiz_videos_ur_titles: each lesson's Urdu-script name and its chapter's; off = not read at all
    urTitlesOn().then((on) => (on ? urTitles() : null)),
  ]);
  const chapters = [];
  const missing = [];
  rows.forEach((r, i) => {
    const qid = quizIds[i];
    const v = { vid: r.id, title: r.clean_title || '' };
    const u = ur && ur.get(r.id);
    if (u && u.t) v.title_ur = u.t;
    const m = Videos.peekMeta(r.id);
    if (m === undefined) missing.push(r.id);
    if (m && m.secs) v.secs = m.secs;
    if (m && m.bytes) v.mb = Math.round(m.bytes / 100000) / 10;
    if (posters[i]) v.poster = posters[i];
    if (done.has(qid)) v.done = true;
    if (codes.has(qid)) {
      v.code = codes.get(qid).code;
      // From the hub: the child's chip on that code, so /q/<code>?k=<k> starts as them.
      if (hubKid && studentId) v.k = T.chipId(codes.get(qid).id, studentId);
    }
    const name = r.clean_chapter || '';
    const last = chapters[chapters.length - 1];
    if (last && last.name.toLowerCase() === name.toLowerCase() && (!grades || last.grade === String(r.grade))) last.videos.push(v);
    else chapters.push({ name, ...(grades ? { grade: String(r.grade) } : {}), videos: [v] });
    const ch = chapters[chapters.length - 1];
    if (u && u.c && !ch.name_ur) ch.name_ur = u.c;
  });
  // Lengths and sizes for next time, read after this answer has gone.
  if (missing.length) track(new Promise((res) => setImmediate(res)).then(() => Videos.warmMeta(missing, { fetchImpl })));
  if (!v3) return { grade, subject, art: subjectArt(subject), chapters };
  for (const c of chapters) {
    const first = c.videos.find((v) => v.poster);
    if (first) c.art = first.poster;
  }
  return { grade, subject, art: subjectArt(subject), tile: 'neutral', chapters };
}

/**
 * Several grades at once (bd-5gyspy.5: «All grades», or a teacher's taught grades): the subjects any of them has (a
 * subject in the first grade's group first, then by the usual subject order; `n` summed), or one subject's lessons
 * grade by grade. `grade` is the leading grade; `grades` the chips, as one grade's view gives them.
 */
async function gradesView(ix, { grades, s, studentId, rootId, fetchImpl, hubKid, v3 }) {
  if (s) return chaptersView(ix, { grade: grades[0], grades, subject: String(s).slice(0, 60), studentId, rootId, fetchImpl, hubKid, v3 });
  const n = new Map();
  const at = new Map();
  for (const r of ix.rows) {
    const i = grades.indexOf(String(r.grade));
    if (i < 0 || !r.subject) continue;
    n.set(r.subject, (n.get(r.subject) || 0) + 1);
    if (!at.has(r.subject) || i < at.get(r.subject)) at.set(r.subject, i);
  }
  const subjects = [...n.keys()].sort((a, b) => at.get(a) - at.get(b) || Order.compareSubjects(a, b))
    .map((k) => ({ key: k, n: n.get(k), art: subjectArt(k) }));
  return { grade: grades[0], grades: subjectsView(ix, '').grades, subjects };
}

async function view(ix, { grade, g, s, studentId, rootId, fetchImpl, hubKid, v3 }) {
  const want = Order.GRADE_ORDER.includes(String(g || '').toUpperCase()) ? String(g).toUpperCase() : grade;
  if (!want) return { grade: null, grades: subjectsView(ix, '').grades, subjects: [] };
  if (!s) return subjectsView(ix, want);
  return chaptersView(ix, { grade: want, subject: String(s).slice(0, 60), studentId, rootId, fetchImpl, hubKid, v3 });
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

async function lib(code, { st, g, s, l, fetchImpl } = {}) {
  const WebQuiz = await guard();
  const v3 = await videosV3On();
  const Videos = require('./web-quiz-videos');
  const ctx = await WebQuiz.resolveCode(code);
  const [ix, { data: quiz }, studentId] = await Promise.all([
    v3 ? bank().then((b) => inLanguage(b, langOf(l) || langOf(ctx.lang))) : bank(),
    supabase.from('quizzes').select('id, grade, subject').eq('id', ctx.quizId).maybeSingle(),
    s ? studentFromSt(st, ctx.shareCodeId) : Promise.resolve(null),
  ]);
  const band = Videos.gradesFor(quiz && quiz.grade);
  const grade = (band.length > 1 && !g ? await childGradeIn(band, st, ctx.shareCodeId) : null) || band[0] || null;
  const out = await view(ix, { grade, g, s, studentId, rootId: Videos.classRootId(ctx), fetchImpl, v3 });
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
 * token on THIS phone: kidFromHub(token, chip, device) -> {studentId, grade, rootId, lang} | null.
 */
async function libHub(token, opts = {}) {
  // web_quiz_kid_together: this answer's child rows are read once and shared (web-quiz-hub-child-rows.js)
  const ChildRows = require('./web-quiz-hub-child-rows');
  if (require('./web-quiz-hub-flags').kidTogetherNow() && !ChildRows.inside()) return ChildRows.run(() => libHub(token, opts));
  const { kid, g, s, l, device, fetchImpl } = opts;
  const WebQuiz = await guard();
  const v3 = await videosV3On();
  // The hub module is M4a's and optional here: loaded by path so a deployment without it answers
  // hub_off instead of failing to boot.
  let Hub;
  try { Hub = require(require('path').join(__dirname, 'web-quiz-hub')); } catch (_) { Hub = null; }
  if (!Hub || typeof Hub.kidFromHub !== 'function') throw new WebQuiz.WqError(503, { error: 'hub_off' });
  // device: this phone's device_ref (x-wq-device) — a forwarded hub link opens no library as the child.
  // web_quiz_practice_play: a grown-up's preview link (no child) opens its grade's library, watch only
  const Practice = require('./web-quiz-practice-play');
  const preview = await Practice.who(token);
  const who = preview || await Hub.kidFromHub(token, kid, device);
  if (!who) { Practice.refused('lib', token); throw new WebQuiz.WqError(401, { error: 'bad_token' }); }
  const Videos = require('./web-quiz-videos');
  // web_quiz_return_lang: the hub's own language (its link's `l`) wins, the child's next; off: the child's, then `l`
  // (a preview: the page's language, then its token's)
  const lang = preview ? langOf(l) || langOf(who.lang)
    : v3 && (await require('./web-quiz-return-lang').on()) ? langOf(l) || langOf(who.lang) : langOf(who.lang) || langOf(l);
  const ix = v3 ? await inLanguage(await bank(), lang) : await bank();
  // web_quiz_grade_change: a class child opens at the grade the family chose (off: the hub's own grade, no read)
  const grade = Videos.gradesFor(preview ? String(who.grade) : await require('./web-quiz-grade-change').browseGrade(who))[0] || null;
  // No grade forbids a video (bd-5gyspy.5): `g` is one grade (today's view), several, or 'all'; with none asked, the
  // visitor's own grade(s) (a preview: its teacher's taught grades, else its token's), and with none, every grade.
  const GradePick = require('./web-quiz-grade-pick');
  const asked = String(g == null ? '' : g).trim().toUpperCase();
  const within = subjectsView(ix, '').grades.map((x) => x.g);
  let p;
  if (Order.GRADE_ORDER.includes(asked)) p = { all: false, grades: [asked], first: [] };
  else {
    const taught = preview && who.teacherId ? (await GradePick.teacherGrades(who.teacherId)).map(String) : [];
    p = GradePick.pick(asked, taught.length ? taught : grade ? [grade] : [], within);
  }
  const sg = GradePick.single(p);
  const at = { s, studentId: who.studentId || null, rootId: who.rootId || null, fetchImpl, hubKid: true, v3 };
  const out = sg ? await view(ix, { grade: sg, ...at }) : p.grades.length
    ? { ...(await gradesView(ix, { grades: p.grades, ...at })), sel: GradePick.selOf(p), first: p.first.slice() }
    : await view(ix, { grade: null, ...at });
  if (out.chapters && await videoShelfOn()) await shelfOf(out, who.rootId || null, { watchOnly: Boolean(preview) });
  // web_quiz_rewatch_done (the library's own settings read): a finished lesson opens as a fresh go (wq-lib.js again=1)
  if (out.chapters && await rewatchDoneOn()) out.rewatch_done = true;
  logEvent('web_quiz.lib_view', { hub: 1, g: out.grade, s: out.subject || undefined, ...(preview ? { practice: 1 } : {}) });
  GradePick.note('videos', p, lang, out.chapters ? out.chapters.reduce((a, c) => a + c.videos.length, 0) : (out.subjects || []).length);
  if (preview) Practice.note('lib', { grade: out.grade, s: out.subject || undefined });
  return out;
}

/** web_quiz_video_shelf: each lesson's thumbnail, and whether this child's quizzes can be made (in place). */
// `v`: the drawing's version (web-quiz-video-thumb.js VERSION); the picture is cached for good under it.
const THUMB_PATH = (vid) => `/wq/vt/${vid}.webp?v=${require('./web-quiz-video-thumb').VERSION}`;
// watchOnly (a grown-up's preview): the quiz after a lesson makes a code and a child's session, so it is never offered.
async function shelfOf(out, rootId, { watchOnly = false } = {}) {
  for (const c of out.chapters) for (const v of c.videos) if (v.poster) v.thumb = THUMB_PATH(v.vid);
  out.quiz = watchOnly ? false : Boolean(rootId || (await shelfRoot()));
  return out;
}
// The watch root for the shelves' Quiz buttons, held 30 s from its read (shared while it is in flight): one read per
// Videos open, not one per subject's shelf (the quiz itself is made on the tap with a fresh read).
const ROOT_HOLD_MS = 30 * 1000;
let rootHeld = null;
function shelfRoot() {
  const now = Date.now();
  if (rootHeld && now - rootHeld.at < ROOT_HOLD_MS) return rootHeld.v;
  rootHeld = { at: now, v: require('./web-quiz-videos').watchRoot() };
  return rootHeld.v;
}

/**
 * web_quiz_video_shelf: a grade's lesson lengths read in the background when a child of that grade opens the hub (the
 * home asks), a few at a time, so the first Videos open after a restart already shows "6 min" on its lessons. The reads
 * are kept in Redis and read back after a restart, so a deploy does not send every lesson's file to be read again. Only the
 * lessons the child's language shows (web_quiz_videos_v3). Held for hours once every lesson was read; a bank that did
 * not load, or a lesson whose details did not come back, is held a minute only (that lesson is not kept), so one bad
 * read right after a restart never blanks a grade. Never throws.
 */
const WARM_AGAIN_MS = 3 * 60 * 60 * 1000; // half the lengths' life in web-quiz-videos.js
const WARM_RETRY_MS = 60 * 1000;
const warmed = new Map();                  // grade|language -> no new read before this time
function warmGrade(grade, { lang, fetchImpl } = {}) {
  try {
    const Videos = require('./web-quiz-videos');
    const g = Videos.gradesFor(grade)[0];
    const key = `${g}|${langOf(lang) || ''}`;
    if (!g || Date.now() < (warmed.get(key) || 0)) return;
    warmed.set(key, Date.now() + WARM_AGAIN_MS);
    const retry = () => warmed.set(key, Date.now() + WARM_RETRY_MS);
    track(new Promise((res) => setImmediate(res)).then(async () => {
      const ix = (await videosV3On()) ? await inLanguage(await bank(), langOf(lang)) : await bank();
      const ids = ix.rows.filter((r) => String(r.grade) === g).map((r) => r.id);
      if (!ids.length) return retry();
      // what a bot before this restart read is read back first (once), and this warm-up's reads are kept in turn
      await Videos.restoreMeta();
      await Videos.warmMeta(ids, { fetchImpl, keep: true });
      const missed = ids.filter((id) => Videos.peekMeta(id) === null);
      if (!missed.length) return undefined;
      missed.forEach((id) => Videos.forgetMeta(id));
      return retry();
    }).catch(retry));
  } catch (_) { /* the hub never waits on this */ }
}

/**
 * The lesson to watch after a watched one: the next in its grade and subject, in the subject screen's order (the
 * child's language as the library shows it), that this child has not finished — the rest of the list, then wrapping.
 * -> {vid, title, poster?} | null. Never throws (a suggestion never fails a video).
 */
async function nextLesson({ vid, studentId = null, lang = null } = {}) {
  try {
    const v3 = await videosV3On();
    const ix = v3 ? await inLanguage(await bank(), langOf(lang)) : await bank();
    const row = ix && ix.rows.find((r) => r.id === vid);
    if (!row) return null;
    const list = lessonOrder(ix, String(row.grade), row.subject, v3);
    const at = list.findIndex((r) => r.id === vid);
    const after = list.slice(at + 1).concat(list.slice(0, at));
    if (!after.length) return null;
    const done = await doneQuizzes(studentId, after.map((r) => ix.quizOf.get(r.id)));
    const next = after.find((r) => !done.has(ix.quizOf.get(r.id)));
    if (!next) return null;
    const poster = await require('./web-quiz-media').signPoster(next.r2_url);
    return { vid: next.id, title: next.clean_title || '', ...(poster ? { poster } : {}) };
  } catch (_) {
    return null;
  }
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
  lib, libHub, download, fileName, libraryOn, subjectArt, gradeArt, FLAG_KEY, nextLesson, lessonOrder, THUMB_PATH, warmGrade,
  inLanguage,
  _reset: () => { rootHeld = null; warmed.clear(); require('./web-quiz-bank')._reset(); require('./web-quiz-library-flag')._reset(); },
  _idle: () => require('./web-quiz-bank')._idle(),
};
