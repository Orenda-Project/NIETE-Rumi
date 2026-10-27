'use strict';
/**
 * The child home (app_settings `web_quiz_home_v3`, default OFF): the keys the v3 home page (wq-home.js) draws on top of
 * the hub's boot JSON — one Next thing, three doors (Stories, Games, Videos) and the header's day-dots and sticker jar.
 * Additive only: with the switch off (or any failure) `homeField` returns {} and the hub payload is today's, byte for byte.
 *
 *   homeField({ out, chosenId, history, pre, device, src, grade })  {} | { home_v3: 1, doors, head, remember? }
 *   doorsOf({ out, stories, hasRoot, videoShelf }) the three doors (pure); every door is always present, an empty
 *                                                 one is [] / null and the page shows its "coming soon" line
 *   headOf(stamps, now)                           { dots, today } (pure): days with a finish this PKT week, as a count
 *   prefetch(chosenId)                            the home's reads, started beside the hub's own: { flags, data }
 *   storyPreviews(quizzes)                        the storybooks a teacher only previewed (pure; switch on)
 *   practiceHub(token, { lang, brandKey })        the coach's preview of the class's home, or null (not a practice
 *                                                 token, or the switch off: the caller goes on to today's path)
 *
 * THE PRACTICE HOME. A teacher trying the child app sees what their class sees, by GRADE, with no child anywhere: a hub
 * token `{k:'h', ids:[], pr:1, g:<1-5>, lang?, bk?}` (the join's practice mode mints it) boots the same shell with this
 * week's story and the listening story for the grade's entry band, the number games the grade has, the videos as
 * watch-only, an empty jar, no dots and no name. It reads no child table and writes nothing (no binding, no Redis key);
 * `bk` is the teacher home it came from (a /quiz/teacher/<t> path only), for the strip's Back and the grown-ups corner.
 * With app_settings `web_quiz_practice_play` on (web-quiz-practice-play.js) the same payload says `practice_play: 1`
 * and carries the Stories bit: the content routes answer the token read-only for its grade, so the page plays
 * instead of showing "children open it from their own link". Off: the look-only preview, byte for byte.
 *
 * The page decides nothing about what is next: the Next tile is `out.next` (web_quiz_next_offer) when the server sent it,
 * else the hub's own lantern / teacher card, in that order (wq-home.js). The doors carry ids and hrefs only; the
 * storybook shelf is a stub the stories reader fills (web_quiz_stories). Never a tile the server would answer "on its
 * way": the Trail's "more stories" list and an empty shelf are left out; a child with no class quiz gets the Videos
 * door too (`watch: true`: videos/start answers a watch-only start under this switch, not 409 no_class).
 *
 * `class_doors: {class, schools}` beside the home (web_quiz_class_doors, web-quiz-class-doors-flag.js): "My class" and
 * "My school" on the home, the quiz page's class table and school league for the child's newest class quiz. Off or no
 * class quiz: absent.
 *
 * `home_fb: 1` beside the home (web_quiz_home_fallback_v3, web-quiz-home-fallback-flag.js; homeField and practiceHub as
 * exported): when wq-home.js never arrives, hub.js draws a plain home from this payload instead of the old hub. Off: absent.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { clampLanguage } = require('../../config/ux-strings');

const HomeFlags = require('./web-quiz-home-flags');
// the preview that plays (web_quiz_practice_play) and the practice token's rule: a leaf module
const Practice = require('./web-quiz-practice-play');
const { flags, KEY, STORIES_KEY } = HomeFlags;
const PKT_MS = 5 * 3600 * 1000;
const DAY_MS = 86400000;
const FINAL = new Set(['scored', 'failed']);

// Monday 00:00 PKT of the week `ms` is in, as epoch ms.
function weekStart(ms) {
  const p = new Date(ms + PKT_MS);
  const back = (p.getUTCDay() + 6) % 7;
  return Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate() - back) - PKT_MS;
}

/** The header's day-dots (pure): how many PKT days this week had a finish, and whether today did. Never a weekday map. */
function headOf(stamps, now = Date.now()) {
  const start = weekStart(now);
  const days = new Set();
  (stamps || []).forEach((iso) => {
    const at = Date.parse(iso || '');
    if (Number.isFinite(at) && at >= start && at < start + 7 * DAY_MS) days.add(Math.floor((at - start) / DAY_MS));
  });
  return { dots: days.size, today: days.has(Math.floor((now - start) / DAY_MS)) };
}

// A subject's picture (the hub's own subject art), or null; never throws.
function subjectArt(subject) {
  if (!subject) return null;
  try {
    const Lib = require('./web-quiz-library');
    const Videos = require('./web-quiz-videos');
    return (typeof Lib.subjectArt === 'function' && Lib.subjectArt(Videos.subjectFor(subject) || subject)) || null;
  } catch (_) {
    return null;
  }
}
const withArt = (row) => { const art = row.art || subjectArt(row.subject); return art ? { ...row, art } : row; };
// a video lesson's Urdu-script name (web_quiz_videos_ur_titles), only when the hub row has one
const urOf = (r) => (r && r.topic_ur ? { topic_ur: r.topic_ur } : {});

/** The three doors (pure). `out` = the hub payload built so far; `stories` = web_quiz_stories on; `hasRoot` = a class quiz played. */
function doorsOf({ out = {}, stories = false, hasRoot = false, videoShelf = false } = {}) {
  const shelf = (out.play && Array.isArray(out.play.shelf)) ? out.play.shelf : [];
  const story = shelf
    .filter((t) => t && t.pid && (t.id === 'week_story' || t.id === 'listen'))
    .map((t) => ({ kind: t.id === 'listen' ? 'listen' : 'passage', id: t.pid, fresh: t.nx === 'new', ...(t.title ? { title: t.title } : {}) }));
  if (stories) story.push({ kind: 'shelf' });
  const games = [];
  if (out.teacher && out.teacher.code) games.push(withArt({ kind: 'quiz', code: out.teacher.code, k: out.teacher.k, topic: out.teacher.topic || '', ...urOf(out.teacher), subject: out.teacher.subject || '', done: false, from: 'teacher' }));
  if (out.last && out.last.code && out.last.state === 'open') games.push(withArt({ kind: 'quiz', code: out.last.code, k: out.last.k, topic: out.last.topic || '', ...urOf(out.last), subject: out.last.subject || '', done: false, from: 'last' }));
  if (out.challenge && out.challenge.on) games.push({ kind: 'numbers' });
  const again = out.last && out.last.state === 'done' && out.last.again ? [{ code: out.last.code, k: out.last.k, topic: out.last.topic, ...urOf(out.last), subject: out.last.subject }] : [];
  again.concat(out.again || []).forEach((a) => { if (a && a.code) games.push(withArt({ kind: 'quiz', code: a.code, k: a.k, topic: a.topic || '', ...urOf(a), subject: a.subject || '', done: true, ...(a.art ? { art: a.art } : {}) })); });
  // Every child with a library: one with no class quiz yet WATCHES (videos/start's watch-only answer, same switch).
  const videos = out.lib && out.lib.href ? { href: out.lib.href, ...(out.lib.art ? { art: out.lib.art } : {}), ...(hasRoot ? {} : { watch: true }), ...(videoShelf ? { shelf: true } : {}) } : null;
  // The hub's "Try these next" (out.recs: the grade's video quizzes not yet played) is the Games door's way to a NEW
  // quiz for a child with no teacher quiz; ids and words only, the page starts one through videos/start. None: no key.
  const recs = (out.recs || []).filter((r) => r && r.vid).slice(0, 3)
    .map((r) => ({ vid: r.vid, title: r.title || '', ...(r.title_ur ? { title_ur: r.title_ur } : {}), subject: r.subject || '', ...(r.art ? { art: r.art } : {}) }));
  return { stories: story, games, videos, ...(recs.length ? { recs } : {}) };
}

// The child's final Jugnu runs this PKT week (one small read; null on any error).
async function runsOf(chosenId, now) {
  try {
    const { data, error } = await supabase.from('web_quiz_challenge_runs').select('status, created_at')
      .eq('student_id', chosenId).gte('created_at', new Date(weekStart(now)).toISOString()).limit(200);
    return error ? null : (data || []).filter((r) => FINAL.has(r.status));
  } catch (_) {
    return null;
  }
}

// This week's finishes (pure): the quizzes in the hub's history and the child's final Jugnu runs.
function stampsOf(history, runs, now) {
  const quiz = (history || []).map((e) => e && e.latest && e.latest.completed_at).filter(Boolean);
  if (!runs) return { stamps: quiz, fresh: false };
  return { stamps: quiz.concat(runs.map((r) => r.created_at)), fresh: runs.some((r) => now - Date.parse(r.created_at || '') < DAY_MS) };
}

/*
 * A phone that keeps this child (an active binding) gets two rows minted HERE, at render, from the binding's phone, never
 * from a URL a child could forward: "Someone new?" (`jn`, the join's sibling token) and the grown-ups corner's teacher
 * switch (`grownups.teacher_href`, a fresh landing). Both come from modules other changes add; a module that is not
 * there, its own switch off, no binding, or a value of the wrong shape: no key. The phone never rides in the payload.
 */
const JOIN_MODULE = './web-quiz-student-join';
const DOOR_MODULE = '../first-touch/one-door.service';
// The finish card (web_quiz_card_v3): its own module says whether it is on, so a watched video ends on the card.
const CARD_MODULE = './web-quiz-card-image';
const JN_RX = /^[A-Za-z0-9._-]{8,600}$/;
const GL_RX = /^(https:\/\/[A-Za-z0-9.-]+(:\d+)?)?\/quiz\/go\/[A-Za-z0-9._~-]{4,600}$/;
const TEACHER_LABEL = { en: 'I teach a class', ur: 'میں ٹیچر ہوں' };
let modules = null; // tests inject { join, door, card } here (null = the real requires)
function optional(name, spec) {
  if (modules) return modules[name] || null;
  try { return require(spec); } catch (_) { return null; }
}
// The phone's active bindings for this child, or null when neither row's module is there (no read then).
async function bindsOf(chosenId) {
  const Join = optional('join', JOIN_MODULE);
  const Door = optional('door', DOOR_MODULE);
  if (!(Join && typeof Join.siblingJoinToken === 'function') && !(Door && typeof Door.mintLandingForPhone === 'function')) return null;
  return require('./child-phone-bindings.repo').activeForChild(chosenId);
}
async function phoneRows(binds, lang) {
  if (!binds) return {};
  const Join = optional('join', JOIN_MODULE);
  const Door = optional('door', DOOR_MODULE);
  const sib = Join && typeof Join.siblingJoinToken === 'function' ? Join.siblingJoinToken : null;
  const land = Door && typeof Door.mintLandingForPhone === 'function' ? Door.mintLandingForPhone : null;
  const newest = binds.filter((b) => b && b.phone_norm)
    .sort((a, b) => String(b.last_played_at || b.bound_at || '').localeCompare(String(a.last_played_at || a.bound_at || '')))[0];
  if (!newest) return {};
  const ask = (fn) => (fn ? Promise.resolve().then(() => fn({ phoneNorm: newest.phone_norm, lang })).catch(() => null) : Promise.resolve(null));
  const [jn, gl] = await Promise.all([ask(sib), ask(land)]);
  return {
    ...(typeof jn === 'string' && JN_RX.test(jn) ? { jn } : {}),
    ...(typeof gl === 'string' && GL_RX.test(gl) ? { grownups: { teacher_href: gl, teacher_label: TEACHER_LABEL[clampLanguage(lang)] } } : {}),
  };
}

/** `{card_v3: true}` (+ `share_v4: true`) when the finish card's module is there and its switch is on, else `{}`; + `ur_share: true`
 * (the corrected Urdu share words) whenever that switch is on. Never throws. */
async function cardField() {
  const Card = optional('card', CARD_MODULE);
  if (!Card || typeof Card.field !== 'function') return {};
  try {
    const f = await Card.field();
    // the one share (web_quiz_share_v4) rides beside the card: the video's share waits for its card, never sends bare words
    const ur = f.ur_share === true ? { ur_share: true } : {};
    return f.card_v3 === true ? { card_v3: true, ...(f.share_v4 === true ? { share_v4: true } : {}), ...ur } : ur;
  } catch (_) { return {}; }
}

/** `{friends_joined: {n}}` (today's count) when web_quiz_share_joined is on and a friend joined from this child's card today, else `{}`. */
async function friendsField(chosenId) {
  try {
    const f = await require('./web-quiz-share-open').friendsOf(chosenId);
    return f ? { friends_joined: { n: f.n } } : {};
  } catch (_) { return {}; }
}

/** The count, only for a phone that may name the child (one it played on, or one its hub was opened on), else `{}`. */
async function friendsFor(friends, chosenId, device) {
  if (!friends || !friends.friends_joined) return {};
  try {
    return (await require('./web-quiz-hub-device').deviceMayName([chosenId], device)) ? friends : {};
  } catch (_) { return {}; }
}

/**
 * The home's reads, started by the hub the moment it knows the chosen child, beside its own reads (never after them):
 * the switches, this week's runs, the finish card's switch and the phone's bindings depend on nothing but the child.
 * `{ flags, data }`: two promises that never reject; with the switch off `data` reads nothing more.
 */
function prefetch(chosenId, now = Date.now()) {
  const f = flags();
  const data = f.then((on) => (on.home && chosenId
    // "a friend joined" only rides the one share, after the card's read (its warm cache): no read of its own
    ? Promise.all([runsOf(chosenId, now), cardField().then((card) => Promise.all([card, card.share_v4 ? friendsField(chosenId) : {}])), bindsOf(chosenId).catch(() => null)])
      .then(([runs, [card, friends], binds]) => ({ runs, card, friends, binds }))
    : null)).catch(() => null);
  return { flags: f, data };
}

// `{class_doors}` with web_quiz_class_doors on and a class quiz in the hub's own history (never the watch root), else {}.
// Never throws. onP: the switch's read, started by prefetchFb beside the home's own reads (no added wave); rootP: the
// watch root's id, read only once the switch is on.
const ClassDoors = require('./web-quiz-class-doors-flag');
async function classDoorsOf(history, chosenId, onP, rootP, lang) {
  try {
    const links = (await (onP || ClassDoors.on())) ? ClassDoors.linksOf(history, chosenId, await (rootP || ClassDoors.root()), lang) : null;
    return links ? { class_doors: links } : {};
  } catch (_) {
    return {};
  }
}

/**
 * The live links this phone made (web-quiz-home-remember.js rowsFor), started by the hub with its first reads
 * (web_quiz_hub_waves3) and handed to homeField: read only while the home is on (as homeField reads them); [] otherwise.
 */
function rememberRows(device) {
  return flags().then((f) => (f.home ? require('./web-quiz-home-remember').rowsFor(device) : []), () => []);
}

/** `{home_v3, doors, head}` for the hub payload of a chosen child, or `{}` (switch off, no child, any failure). Never throws. */
// welcome: web-quiz-child-welcome.js field()'s promise (the hub starts it beside the next thing, which it also holds)
async function homeField({ out, chosenId, history, now = Date.now(), pre, device = null, src = null, grade = null, rows: rowsP = null, welcome = null } = {}) {
  try {
    const p = pre || prefetch(chosenId, now);
    const f = await p.flags;
    if (!f.home || !chosenId || !out) return {};
    // web_quiz_video_shelf: the child's grade's lesson lengths, read after this answer (the Videos door's library shows them)
    if (f.shelf === true && grade && out.lib && /^\/lib\//.test(out.lib.href || '')) { try { require('./web-quiz-library').warmGrade(grade, { lang: out.lang }); } catch (_) { /* never the home's */ } }
    const d = await p.data;
    if (!d) return {};
    const hasRoot = (history || []).some((e) => e && e.teacherSent);
    const { stamps, fresh } = stampsOf(history, d.runs, now);
    const head = headOf(stamps, now);
    // The sticker jar leads to Jugnu's Book, so it is there only when the Book is; "new" = a sticker in the last day.
    head.jar = out.book_on ? { fresh } : null;
    // the first open after a self-join (src join | bind, the phone that joined): "Jugnu will remember you" + Undo, once
    // ...and, for the link's whole life, "Forget this phone" in the grown-ups corner of the phone that made it
    const R = require('./web-quiz-home-remember');
    // (one read of the binding rows for both, beside the phone rows: no added wave)
    const rows = rowsP || R.rowsFor(device);
    const [remember, own, phones, cd, friends] = await Promise.all([R.field({ device, chosenId, src, rows }), R.owns({ device, chosenId, binds: d.binds, rows }), phoneRows(d.binds, out.lang), classDoorsOf(history, chosenId, p.cd, p.cdRoot, out.lang), friendsFor(d.friends, chosenId, device)]);
    if (own) remember.forget_phone = true;
    return { home_v3: 1, doors: doorsOf({ out, stories: f.stories, hasRoot, videoShelf: f.shelf === true }), head, ...d.card, ...friends, ...phones, ...remember, ...cd, ...(f.list ? { list_states: 1 } : {}), ...(welcome ? await welcome : {}) };
  } catch (err) {
    logToFile('⚠️ web quiz home: unavailable', { error: err.message });
    return {};
  }
}

/**
 * The storybooks the teacher only previewed (the preview mints its code at render), from the teacher card's own quizzes
 * read (pure): a `quiz_source:'story'` quiz counts as sent with `status:'sent'` or `meta.sent_at` / `meta.first_sent_at`.
 * The hub asks for these columns only with the switch on (PREVIEW_COLS); with it off it never calls this.
 */
const PREVIEW_COLS = 'quiz_source, status, meta';
function storyPreviews(quizzes) {
  const sent = (q) => q.status === 'sent' || Boolean(q.meta && (q.meta.sent_at || q.meta.first_sent_at));
  return new Set((quizzes || []).filter((q) => q && q.quiz_source === 'story' && !sent(q)).map((q) => q.id));
}

// ─── the practice home ─────────────────────────────────────────────────────────────────────────────

const BACK_LABEL = { en: 'Back to my teacher home', ur: 'ٹیچر ہوم پر واپس' };

/** The practice fields of a genuine hub token, or null (pure): pr:1, no child named, a grade 1-5 (the rule's one home). */
const practiceOf = (token) => Practice.practiceOf(token);

// This week's story and the listening story the grade's children are shown first (the entry band, no reading rung):
// the same passages, the same release rule and the same title home as the child's shelf. [] on any failure.
async function practiceStories(g, lang) {
  try {
    const Play = require('./web-quiz-hub-play');
    const s = await Play.switches();
    if (!s.v2 || !s.story) return [];
    const p = await Play.passagesOf(lang, new Date().toISOString(), Play.openBands(g, 0));
    const newest = (kind) => p.live.filter((r) => r.kind === kind).sort((a, b) => Date.parse(b.released_at) - Date.parse(a.released_at))[0] || null;
    const title = (pid) => { try { return require('./web-quiz-passage-title').titleFor(pid, lang) || null; } catch (_) { return null; } };
    return [['passage', newest('read')], ['listen', newest('listen')]].filter((x) => x[1])
      .map(([kind, r]) => { const t = title(r.passage_id); return { kind, id: r.passage_id, fresh: false, ...(t ? { title: t } : {}) }; });
  } catch (_) {
    return [];
  }
}

/** The practice payload, or null. Never reads a child table; never throws past a bad token (null). */
async function practiceHub(token, { lang: asked, brandKey } = {}) {
  const pr = practiceOf(token);
  if (!pr) return null;
  try {
    const f = await flags();
    if (!f.home) return null;
    const hubFlags = await require('./web-quiz-hub-flags').flags();
    if (!hubFlags.hub) return null;
    const lang = asked ? clampLanguage(asked) : pr.lang;
    let form = null;
    if (hubFlags.challenge) {
      try { form = await require('./web-quiz-challenge').formForChild(pr.g); } catch (_) { form = null; }
    }
    const stories = await practiceStories(pr.g, lang);
    if (f.stories) stories.push({ kind: 'shelf' });
    // web_quiz_practice_play: the preview PLAYS (the content routes answer this token read-only for its grade), so the
    // page loads the storybook shelf (the Stories bit, as a child's hub carries it) and the Videos door as its shelves.
    // Off: the look-only preview, byte for byte.
    const play = await Practice.on();
    // the Stories bit as the stories module gives a child's hub (web_quiz_stories, the same JSON-true read; a preview
    // has no book to resume), from the home's own switch read
    const storiesBit = play && f.stories ? { stories: { on: 1 } } : {};
    // the preview's Games = a child's of that teacher (bd-5gyspy.5): a link minted for a teacher (`tu`) lists the
    // teacher's own open quizzes first, each opened as the teacher's own preview (web-quiz-practice-teacher.js)
    const quizRows = play && pr.tu ? (await require('./web-quiz-practice-teacher').rowsFor(pr.tu, { previews: storyPreviews })).map(withArt) : [];
    const out = {
      lang, practice: 1, th: { practice: true }, grade: pr.g,
      kids: [], kid: null, teacher: null, again: [], recs: [], challenge: form ? { on: true } : null, lib: null,
      brand: typeof brandKey === 'function' ? await brandKey() : null,
      home_v3: 1,
      doors: { stories, games: [...quizRows, ...(form ? [{ kind: 'numbers' }] : [])], videos: { watch: true, practice: true, grade: pr.g, ...(play && f.shelf === true ? { shelf: true } : {}) } },
      head: { dots: 0, today: false, jar: null },
      ...(pr.bk ? { practice_back: pr.bk, grownups: { teacher_href: pr.bk, teacher_label: BACK_LABEL[lang] } } : {}),
      ...(f.list ? { list_states: 1 } : {}),
      ...(play ? { practice_play: 1, ...storiesBit } : {}),
    };
    logEvent('web_quiz.hub_open', { practice: 1, kid: null, grade: pr.g, lang, ...(play ? { practice_play: 1, role: 'practice' } : {}) });
    return out;
  } catch (err) {
    logToFile('⚠️ web quiz home: practice unavailable', { error: err.message });
    return null;
  }
}

// The fallback switch is read beside the home's own reads (once its flags say the home is on), never after them: no wave.
const Fallback = require('./web-quiz-home-fallback-flag');
const fbOf = (f) => f.then((on) => (on.home ? Fallback.on() : false)).catch(() => false);
// ...and so is web_quiz_class_doors (classDoorsOf).
const cdOf = (f) => f.then((on) => (on.home ? ClassDoors.on() : false)).catch(() => false);
function prefetchFb(chosenId, now) {
  const p = prefetch(chosenId, now);
  p.fb = fbOf(p.flags);
  p.cd = cdOf(p.flags);
  p.cdRoot = p.cd.then((on) => (on ? ClassDoors.root() : null));
  return p;
}
function homeFieldFb(a = {}) {
  const pre = a.pre || prefetchFb(a.chosenId, a.now);
  return Promise.all([homeField({ ...a, pre }), pre.fb || fbOf(pre.flags)]).then(([field, on]) => (on && field && field.home_v3 ? { ...field, home_fb: 1 } : field));
}
function practiceHubFb(token, o) {
  const fb = practiceOf(token) ? fbOf(flags()) : false;
  return Promise.all([practiceHub(token, o), fb]).then(([out, on]) => (on && out && out.home_v3 ? { ...out, home_fb: 1 } : out));
}
module.exports = { homeField: homeFieldFb, rememberRows, friendsField, friendsFor, doorsOf, headOf, flags, practiceHub: practiceHubFb, practiceOf, prefetch: prefetchFb, storyPreviews, PREVIEW_COLS, KEY, STORIES_KEY, _resetCache: () => { HomeFlags._resetCache(); Fallback._resetCache(); ClassDoors._resetCache(); }, _useModules: (m) => { modules = m; } };
