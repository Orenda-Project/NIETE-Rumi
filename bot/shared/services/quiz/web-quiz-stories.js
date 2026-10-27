'use strict';
/**
 * STORIES — storybooks a child reads with Jugnu (app_settings `web_quiz_stories`, only a literal true; fails closed:
 * off, every answer is 404 `stories_off` and nothing about the child is read).
 *
 *   shelf(token, {kid, g, l, t, device, now})   the books of one grade × language for the child a hub chip names
 *   shelfPublic({g, l})                         the same shelf's covers for anyone (no token, no child data)
 *   book(id, token, {kid, device})              one ready book: pages, words with the voice's timings, questions (no answers)
 *   bookData(id)                                the same payload with no child (the teacher's preview, behind its own token)
 *   event(token, {kid, book_id, page_n, event, data}, {device})  one story event; questions are checked here
 *   hubBits()                                   {} off; {stories: {on: 1}} for the hub payload (the page loads wq-stories.js)
 *   stickersFor(studentId)                      the child's storybook stickers (first finish of each book) for the Book
 *   pageReadable(bookId, n)                     may this page be read aloud (the live-read key checks before it spends)
 *
 * Content lives in the database and the storage bucket (story_books, story_pages, story_page_voices, story_questions);
 * pictures and audio are served by the same-origin `/s/<book>/<file>` route (audio only from the book's own story/ keys). Rules:
 *   - the shelf lists only `status='ready'` books: books the teacher sent first, then the unfinished ones in a shuffle
 *     seeded by (child, PKT day), finished last; every book carries its `shelf_position`;
 *   - a book's `words[]` are the printed words merged with the CURRENT voice's timings by `i`; a page with no voice
 *     has `audio: null` (the reader skips Listen);
 *   - only `reviewed` questions are sent, and never their answer: `story_questions_done` sends the child's picks and
 *     the server counts them;
 *   - stars are effort stars (listened, read aloud, answered), never a score;
 *   - `story_done` gives the storybook sticker the first time a child finishes a book, only with Jugnu's Book on.
 * A grown-up's preview link (app_settings web_quiz_practice_play, web-quiz-practice-play.js) is answered for its grade
 * with no child: the same shelf (nothing finished), the same book without the microphone, every event answered and
 * none kept. Off, that link is refused 401 as any token that names no child.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { WqError } = require('./web-quiz-error');
const { clampLanguage } = require('../../config/ux-strings');

const FLAG_KEY = 'web_quiz_stories';
// The 2× crop of the printed words: on its own switch, used only as a lens that replaces the print where the words
// would be too small. Off ⇒ every page's text_band is null and the reader shows the picture only.
const BAND_KEY = 'web_quiz_stories_band';
// "Read it together" needs the live reader's story keys: offered only when both of its switches are on.
const LR3_KEYS = ['web_quiz_live_read_v3', 'web_quiz_challenge_realtime'];
// Your turn's word rules (a word said again absorbed, words run together, the longest skipped word to practise, the page
// event's absorbed count): the book's lrr, only with live reading on and this switch the boolean true; off ⇒ today's reader.
const REPEAT_KEY = 'web_quiz_lr_repeat';
// The reader's kind screen on every stall (a dropped voice, a missing book, the page kept in the address, the mic per
// page, the never-blank stage, no voice before Listen, the 600 ms button hold): the book says `steady: 1`. Off ⇒ no key.
const STEADY_KEY = 'web_quiz_stories_steady';
// "Slower" waits between phrases instead of slowing the voice: on, the book says slow_gaps (off: the payload is unchanged).
const GAPS_KEY = 'web_quiz_stories_slow_gaps';
// Slower's numbers {sentence: [target, least], comma: [target, least]} in ms (ints 0–2,000, least ≤ target), sent only with
// the gaps switch; absent or junk, the book says `true` and the player keeps its own.
const MS_KEY = 'web_quiz_stories_slow_ms';
// Jugnu keeps its passage recordings (web-quiz-challenge.js keepAudioOn): the microphone notice says so (book.lr3_keep)
const KEEP_KEY = 'web_quiz_challenge_keep_audio';
// The reader warmed from the shelf (JSON true only): the shelf's answer says `warm: true`, so the page fetches the reader's
// files while the child looks at the shelf and the first page's picture as soon as the book arrives (wq-stories.js).
const WARM_KEY = 'web_quiz_story_warm';
// The reader's text lens (JSON true only): the book says `tx: 1`, and a page of small print shows, at rest, its words at a
// readable size over the sheet's own beside the art (and a sliver word box never zooms the page). Off ⇒ no key.
const LENS_KEY = 'web_quiz_stories_text_lens';
// The reader's polish (JSON true only): the book says `pl: 1`; while it is open <html> carries the book's language and
// direction, and the voice's word ring is drawn round the word instead of on its letters. Off ⇒ no key.
const POLISH_KEY = 'web_quiz_stories_polish';
// A phone that cannot play Ogg Opus (iOS before 18.4) hears each page voice as mp3 (JSON true only): the book says
// `mp3: 1`, and on such a phone the reader asks for <voice>.mp3, which the edge makes from the stored .ogg. Off ⇒ no key.
const MP3_KEY = 'web_quiz_story_mp3';
// Keys that ride the stories read. A read naming them that fails is made again without them, the last first (they are off),
// so a rider's failure never turns stories off.
const RIDERS = [GAPS_KEY, MS_KEY, REPEAT_KEY, KEEP_KEY, WARM_KEY, LENS_KEY, POLISH_KEY, MP3_KEY];
const HOST_KEYS = [FLAG_KEY, BAND_KEY, STEADY_KEY, ...LR3_KEYS];
const TTL_MS = 30 * 1000;
const PKT_MS = 5 * 3600 * 1000;
const DAY_MS = 86400000;
const GRADES = [1, 2, 3, 4, 5];
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_RX = /^[a-z0-9-]+\.(webp|ogg|mp3)$/;
const MAX_TEACHER = 5;
const EVENTS = new Set(['story_opened', 'story_page_listened', 'story_page_read', 'story_questions_done', 'story_done', 'story_shared']);
// What each event may keep (numbers and small enums only: never a word the child said, never a name).
const KEEP = {
  story_opened: { shelf_position: 'int', from_teacher: 'bool', grade: 'int', lang: 'lang', code: 'code' },
  story_page_listened: { ms: 'int', completed: 'bool', miss: 'bool', slow: 'one' },
  story_page_read: { words_total: 'int', words_read: 'int', skipped: 'int', ms: 'int', ended: 'ended', first: 'first', skipped_words: 'ints', absorbed: 'count' },
  story_questions_done: {},
  story_done: { pages_listened: 'int', pages_read: 'int', stars: 'int' },
  story_shared: {},
};
const ENDED = new Set(['last_word', 'quiet', 'done_tap', 'timer', 'line1', 'stuck', 'hidden', 'home', 'silent']);

const fail = (status, error) => { throw new WqError(status, { error }); };
let cache = null;

/** Only a literal true turns it on (app_settings.value is jsonb: the flip writes the boolean); a read error is off. */
function isTrue(value) {
  return value === true;
}

// A finish counts (the shelf's tick, the Book's sticker, "the first time") only if the child listened to or read a page.
function counted(row) {
  const d = (row && row.data) || {};
  return (Number(d.pages_listened) || 0) + (Number(d.pages_read) || 0) > 0;
}

function slowMs(v) {
  const pair = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 2000) && p[1] <= p[0];
  return v && typeof v === 'object' && pair(v.sentence) && pair(v.comma) ? { sentence: [...v.sentence], comma: [...v.comma] } : null;
}

async function readRows(keys) {
  const { data, error } = await supabase.from('app_settings').select('key, value').in('key', keys);
  if (error) throw new Error(error.message || 'app_settings read failed');
  return new Map((data || []).map((r) => [r.key, r.value]));
}

// One read on the normal path. If it fails, a fault on a switch folded into it never turns the stories off: the read is
// tried again without the riders (the last first: keep-audio, Your turn's word rules, then Slower's two), then without the live reader's two
// (lr3 off), then the main switch alone (band and steady off too). Only a failed read of the main switch itself is off.
const READS = [
  ...RIDERS.map((_, i) => [...HOST_KEYS, ...RIDERS.slice(0, RIDERS.length - i)]),
  HOST_KEYS,
  [FLAG_KEY, BAND_KEY, STEADY_KEY],
  [FLAG_KEY],
];

async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    let by = null;
    let last = null;
    for (const keys of READS) {
      try { by = await readRows(keys); break; } catch (err) {
        last = err;
        logToFile('⚠️ web quiz stories: settings lookup failed — reading fewer switches', { error: err.message, keys: keys.length });
      }
    }
    if (!by) throw last;
    const on = by.has(FLAG_KEY) && isTrue(by.get(FLAG_KEY));
    const lr3 = on && LR3_KEYS.every((k) => isTrue(by.get(k)));
    const gaps = on && isTrue(by.get(GAPS_KEY));
    cache = { at: now, on, band: on && by.has(BAND_KEY) && isTrue(by.get(BAND_KEY)), lr3, lrr: lr3 && isTrue(by.get(REPEAT_KEY)), keep: lr3 && isTrue(by.get(KEEP_KEY)), steady: on && isTrue(by.get(STEADY_KEY)), gaps, ms: gaps ? slowMs(by.get(MS_KEY)) : null, warm: on && by.get(WARM_KEY) === true, polish: on && by.get(POLISH_KEY) === true, lens: on && by.get(LENS_KEY) === true, mp3: on && by.get(MP3_KEY) === true };
  } catch (err) {
    logToFile('⚠️ web quiz stories: settings lookup failed — stories off', { error: err.message });
    cache = { at: now, on: false, band: false, lr3: false, lrr: false, keep: false, steady: false, gaps: false, ms: null, warm: false, lens: false, polish: false, mp3: false };
  }
  return cache;
}
async function storiesOn(now = Date.now()) { return (await flags(now)).on; }

const RESUME_DAYS = 7;
const PAGE_EVENTS = new Set(['story_page_listened', 'story_page_read']);

/** The newest ready book of the last 7 days with a page listened/read and no finish: {book_id, title, cover, page_n, pages}. */
async function resumeOf(studentId, now) {
  const since = new Date(now - RESUME_DAYS * DAY_MS).toISOString();
  const { data } = await supabase.from('story_events').select('book_id, page_n, event, data, at').eq('child_id', studentId).gte('at', since)
    .order('at', { ascending: false }).limit(300);
  const done = new Set(); const last = new Map();
  (data || []).forEach((r) => {
    if (r.event === 'story_done') { if (counted(r)) done.add(r.book_id); }
    else if (PAGE_EVENTS.has(r.event) && !(r.data && r.data.miss) && Number.isFinite(Number(r.page_n))) {
      const was = last.get(r.book_id) || { at: '', page: 0 };
      last.set(r.book_id, { at: String(r.at) > was.at ? String(r.at) : was.at, page: Math.max(was.page, Number(r.page_n)) });
    }
  });
  const open = [...last.entries()].filter(([id]) => !done.has(id) && UUID_RX.test(String(id))).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 5);
  if (!open.length) return null;
  // One read for the (up to 5) newest half-read books; the newest one still ready wins.
  const { data: rows } = await supabase.from('story_books').select('*').in('id', open.map(([id]) => id)).eq('status', 'ready');
  const ready = new Map((rows || []).map((b) => [b.id, b]));
  for (const [id, seen] of open) {
    const b = ready.get(id);
    if (b) {
      const pages = Number(b.pages) || 0;
      return { book_id: b.id, title: b.title, cover: fileUrl(b.id, b.cover_file), page_n: Math.max(1, Math.min(seen.page + 1, pages || seen.page + 1)), pages };
    }
  }
  return null;
}

/** The hub payload's Stories bit: {} off (the payload stays today's); on, {stories:{on:1, resume?}}. Never throws. */
async function hubBits({ studentId, now = Date.now() } = {}) {
  try {
    if (!(await storiesOn())) return {};
    const resume = studentId ? await resumeOf(studentId, now) : null;
    return { stories: { on: 1, ...(resume ? { resume } : {}) } };
  } catch (_) {
    return {};
  }
}

// web_quiz_practice_play: a grown-up's preview link (no child) is answered read-only for its grade; `route` names the
// refusal's log line (web_quiz.content_refused, with whether the token was a preview link).
async function guard(token, kid, device, route = 'stories') {
  if (!(await storiesOn())) fail(404, 'stories_off');
  const Practice = require('./web-quiz-practice-play');
  const preview = await Practice.who(token);
  if (preview) return preview;
  const who = await require('./web-quiz-hub').kidFromHub(token, kid, device);
  if (!who || !who.studentId) { Practice.refused(route, token); fail(401, 'bad_token'); }
  return who;
}

// ─── pure helpers ──────────────────────────────────────────────────────────────────────────────────────

/** The PKT calendar day number (UTC+5): the day the shelf's shuffle holds for. */
const pktDay = (ms) => Math.floor((ms + PKT_MS) / DAY_MS);
const fileUrl = (bookId, file) => (typeof file === 'string' && FILE_RX.test(file) ? `/s/${bookId}/${file}` : null);
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

/** A deterministic shuffle (Fisher–Yates on a sha256-seeded xorshift), stable for one seed. */
function seededShuffle(list, seed) {
  const out = list.slice();
  let x = crypto.createHash('sha256').update(String(seed)).digest().readUInt32BE(0) || 1;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Teacher's books first (in the order given), then unfinished in the (child, day) shuffle, then finished. */
function shelfOrder(books, { childId, day, done, teacher }) {
  const sorted = books.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const mixed = seededShuffle(sorted, `${childId}:${day}`);
  const byId = new Map(books.map((b) => [b.id, b]));
  const first = teacher.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const rest = mixed.filter((b) => !teacher.includes(b.id));
  return first.concat(rest.filter((b) => !done.has(b.id)), rest.filter((b) => done.has(b.id)));
}

/** The printed words with the voice's timings joined by `i` (never by position). */
function mergeWords(words, timings, endMs) {
  const at = new Map((Array.isArray(timings) ? timings : []).map((w) => [Number(w.i), w]));
  const ws = (Array.isArray(words) ? words : []).map((w) => {
    const out = { i: Number(w.i), t: String(w.t || '') };
    const tm = at.get(Number(w.i));
    // A silent word (a stage direction the voice does not read) keeps its place and box but never its voice's time.
    if (w.silent === true) out.silent = true;
    else if (tm && Number.isFinite(Number(tm.s_ms)) && Number.isFinite(Number(tm.e_ms))) { out.s_ms = Number(tm.s_ms); out.e_ms = Number(tm.e_ms); }
    if (Array.isArray(w.box) && w.box.length === 4) out.box = w.box.map(Number);
    // the printed spelling(s) of a word stored in its dictionary form: Your turn counts them as the word
    const alt = Array.isArray(w.alt) ? w.alt.filter((x) => typeof x === 'string' && x).slice(0, 3) : [];
    if (alt.length) out.alt = alt;
    return out;
  });
  // The player needs every word timed and in order: a silent word gets zero length at the next spoken word's start
  // (that later word is the lit one), or at the end of the voice when it is last. A page with no timings stays as is.
  if (!ws.some((w) => w.s_ms != null)) return ws;
  for (let k = ws.length - 1, next = Number(endMs) || null; k >= 0; k -= 1) {
    const w = ws[k];
    if (w.silent) { const t = next != null ? next : (ws.slice(0, k).reverse().find((x) => x.e_ms != null) || {}).e_ms; if (t != null) { w.s_ms = t; w.e_ms = t; } }
    else if (w.s_ms != null) next = w.s_ms;
  }
  return ws;
}

/** Effort stars: listened to the story, read a page aloud, answered the questions. Never how many were right. */
function effortStars({ listened = 0, read = 0, answered = false } = {}) {
  return (listened > 0 ? 1 : 0) + (read > 0 ? 1 : 0) + (answered ? 1 : 0);
}

function keep(event, data) {
  const out = {};
  const spec = KEEP[event] || {};
  const d = data && typeof data === 'object' ? data : {};
  Object.keys(spec).forEach((k) => {
    const v = d[k];
    if (v === undefined || v === null) return;
    if (spec[k] === 'int' && int(v) !== null) out[k] = Math.max(0, Math.min(int(v), 10000000));
    else if (spec[k] === 'bool' && typeof v === 'boolean') out[k] = v;
    else if (spec[k] === 'one' && v === 1) out[k] = 1;
    else if (spec[k] === 'lang' && (v === 'en' || v === 'ur')) out[k] = v;
    else if (spec[k] === 'ended' && ENDED.has(v)) out[k] = v;
    else if (spec[k] === 'code' && typeof v === 'string' && /^[A-Za-z0-9]{4,12}$/.test(v)) out[k] = v;
    else if (spec[k] === 'first' && (v === 'listen' || v === 'read')) out[k] = v;
    else if (spec[k] === 'count' && Number.isInteger(v) && v >= 0) out[k] = Math.min(v, 2000);   // words said again, absorbed
    else if (spec[k] === 'ints' && Array.isArray(v)) out[k] = v.filter((n) => Number.isInteger(n) && n >= 0 && n < 2000).slice(0, 10);
  });
  return out;
}

// ─── reads ─────────────────────────────────────────────────────────────────────────────────────────────

const BOOK_COLS = 'id, title, grade, lang, pages, minutes, cover_file, author, status';

async function readyBook(id) {
  if (!UUID_RX.test(String(id || ''))) return null;
  // '*': a column added later (questions_sprite) never empties the read on a database that lacks it.
  const { data } = await supabase.from('story_books').select('*').eq('id', id).eq('status', 'ready').maybeSingle();
  return data || null;
}

async function doneSet(studentId, bookIds) {
  if (!bookIds.length) return new Set();
  const { data } = await supabase.from('story_events').select('book_id, data').eq('child_id', studentId).eq('event', 'story_done').in('book_id', bookIds);
  return new Set((data || []).filter(counted).map((r) => r.book_id));
}

const gradeOf = (v) => { const m = /\d+/.exec(String(v == null ? '' : v)); const g = m ? Number(m[0]) : 0; return GRADES.includes(g) ? g : null; };

/** The ready books of one grade × language in this child's shelf order, and which of them the child finished. */
async function orderedBooks(studentId, { grade, lang, teacher = [], now = Date.now() }) {
  const { data } = await supabase.from('story_books').select(BOOK_COLS).eq('status', 'ready').eq('grade', grade).eq('lang', lang);
  const books = data || [];
  // a preview (no child) has finished nothing, and its events are never read
  const done = studentId ? await doneSet(studentId, books.map((b) => b.id)) : new Set();
  return { ordered: shelfOrder(books, { childId: studentId, day: pktDay(now), done, teacher }), done };
}

async function shelf(token, { kid, g, l, t, device, now = Date.now() } = {}) {
  const who = await guard(token, kid, device, 'stories_shelf');
  // web_quiz_grade_change: with no grade asked, a class child opens at the grade the family chose (off: the hub's, no read)
  // (a preview opens at its token's grade: there is no family choice to read)
  const grade = gradeOf(g) || gradeOf(g || who.practice ? who.grade : await require('./web-quiz-grade-change').browseGrade(who)) || 1;
  const lang = clampLanguage(l);
  const teacher = String(t || '').split(',').map((s) => s.trim()).filter((s) => UUID_RX.test(s)).slice(0, MAX_TEACHER);
  const { ordered, done } = await orderedBooks(who.studentId, { grade, lang, teacher, now });
  const out = {
    grade, lang, grades: GRADES.slice(),
    books: ordered.map((b, i) => ({
      id: b.id, title: b.title, grade: b.grade, lang: b.lang, dir: b.lang === 'ur' ? 'rtl' : 'ltr', pages: b.pages,
      minutes: b.minutes == null ? null : Number(b.minutes), cover: fileUrl(b.id, b.cover_file),
      done: done.has(b.id), from_teacher: teacher.includes(b.id), shelf_position: i + 1,
      ...(b.author ? { by: b.author } : {}),
    })),
  };
  // web_quiz_story_warm (from the stories' own read, cached by now): the shelf says warm, and each book its first page's
  // picture (`p1`), so the page asks for it the moment the child taps the book (wq-stories-w.js). Off: today's answer.
  if ((await flags(now)).warm) {
    out.warm = true;
    const ids = out.books.map((b) => b.id);
    const { data: firsts } = ids.length
      ? await supabase.from('story_pages').select('book_id, image_file').in('book_id', ids).eq('n', 1)
      : { data: [] };
    const p1 = new Map((firsts || []).filter((r) => r && r.image_file).map((r) => [r.book_id, fileUrl(r.book_id, r.image_file)]));
    out.books.forEach((b) => { if (p1.has(b.id)) b.p1 = p1.get(b.id); });
  }
  logEvent('web_quiz.stories_shelf', { g: grade, l: lang, n: out.books.length });
  if (who.practice) require('./web-quiz-practice-play').note('stories_shelf', { grade, lang, n: out.books.length });
  return out;
}

/** The covers of one grade × language for anyone (no token, no child): warms thumbnails before a child is known. */
async function shelfPublic({ g, l } = {}) {
  if (!(await storiesOn())) fail(404, 'stories_off');
  const grade = gradeOf(g) || 1;
  const lang = clampLanguage(l);
  const { data } = await supabase.from('story_books').select(BOOK_COLS).eq('status', 'ready').eq('grade', grade).eq('lang', lang);
  const books = (data || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    grade, lang,
    books: books.map((b) => ({ id: b.id, title: b.title, grade: b.grade, lang: b.lang, dir: b.lang === 'ur' ? 'rtl' : 'ltr', pages: b.pages,
      minutes: b.minutes == null ? null : Number(b.minutes), cover: fileUrl(b.id, b.cover_file) })),
  };
}

// One audio path: a voice is stored with its book (story/<env>/<book>/a<NN>-<hash8>.ogg) and the same-origin /s/ route
// serves it, immutable. Any other key is never signed: that page has no audio.
function audioUrl(key, bookId) {
  if (!key || !String(key).startsWith('story/')) return null;
  return fileUrl(bookId, String(key).split('/').pop());
}

// The band as one jsonb (text_band) or as columns (band_file, band_w, band_h, band_box): both read the same.
function bandOf(bookId, row) {
  const band = row && row.text_band ? row.text_band : row && row.band_file ? { file: row.band_file, w: row.band_w, h: row.band_h, box: row.band_box } : null;
  if (!band || typeof band !== 'object') return null;
  const url = fileUrl(bookId, band.file);
  if (!url || !Array.isArray(band.box) || band.box.length !== 4) return null;
  return { url, w: Number(band.w), h: Number(band.h), box: band.box.map(Number) };
}

/** The printed lines ({i0, i1, box} in 720-px page px): the reader zooms to a line even where word boxes are unsure. */
function linesOf(lines) {
  // A line with no reliable box keeps its word range: the reader sweeps it without zooming.
  const ok = (Array.isArray(lines) ? lines : []).filter((l) => l && Number.isInteger(l.i0) && Number.isInteger(l.i1) && l.i1 >= l.i0)
    .map((l) => ({ i0: l.i0, i1: l.i1, ...(Array.isArray(l.box) && l.box.length === 4 ? { box: l.box.map(Number) } : {}) }));
  return ok.length ? { lines: ok } : {};
}

/** All of a book's spoken questions in one clip ({file, clips:{q1:{s_ms,e_ms},…}}): one request on the questions screen. */
function spriteOf(bookId, sp) {
  const url = sp && typeof sp === 'object' ? fileUrl(bookId, sp.file) : null;
  if (!url || !sp.clips || typeof sp.clips !== 'object') return {};
  const clips = {};
  Object.keys(sp.clips).forEach((k) => {
    const c = sp.clips[k];
    if (/^q\d+(o\d+)?$/.test(k) && c && Number.isFinite(Number(c.s_ms)) && Number(c.e_ms) > Number(c.s_ms)) clips[k] = { s_ms: Number(c.s_ms), e_ms: Number(c.e_ms) };
  });
  return Object.keys(clips).length ? { questions_sprite: { url, clips } } : {};
}

/** The spoken question + options ({q, o[]} file names under the book): urls, or null until every clip exists. */
function qAudio(bookId, a) {
  if (!a || typeof a !== 'object' || !Array.isArray(a.o)) return null;
  const q = fileUrl(bookId, a.q); const o = a.o.map((f) => fileUrl(bookId, f));
  return q && o.length && o.every(Boolean) ? { q, o } : null;
}

function optionOf(bookId, o) {
  if (o && typeof o === 'object') {
    const img = fileUrl(bookId, o.img);
    return { t: String(o.t || ''), ...(img ? { img } : {}) };
  }
  return { t: String(o == null ? '' : o) };
}

async function reviewedQuestions(bookId) {
  const { data } = await supabase.from('story_questions').select('*').eq('book_id', bookId).eq('review_status', 'reviewed');
  return (data || []).slice().sort((a, b) => a.n - b.n);
}

// The share card's field (web-quiz-card-image.js, its own switch): {} when absent, off or failing.
let cardField = null;
async function cardBits() {
  try {
    const fn = cardField || require('./web-quiz-card-image').field; // eslint-disable-line global-require
    return (await fn()) || {};
  } catch (_) {
    return {};
  }
}

async function book(id, token, { kid, device } = {}) {
  const who = await guard(token, kid, device, 'stories_book');
  const out = await bookData(id);
  if (who.practice) return practiceBook(out);
  await keepMisses(who.studentId, out);
  return Object.assign(out, await cardBits());
}

// A preview's book: the pages, the voices and the questions as a child gets them, but no microphone ("Read it
// together" needs a speech key, which is counted against a child's own day) and no share card (it is a child's finish).
// No miss row is kept (keepMisses writes one under the child).
function practiceBook(out) {
  const { lrr, lr3_keep: keep, read_fb: fb, read_sheet: sheet, ...rest } = out;
  require('./web-quiz-practice-play').note('stories_book', { pages: (out.pages || []).length, voiced: (out.pages || []).filter((p) => p.audio).length });
  return { ...rest, lr3: false };
}

// A text page served without a voice is kept as a miss (story_page_listened {miss:true}) so it gets voiced; never counted.
// One row per page per child per PKT day: a reopen the same day adds none.
async function keepMisses(studentId, out, now = Date.now()) {
  const missing = out.pages.filter((p) => !p.is_picture && !p.audio && p.text).map((p) => p.n);
  if (!missing.length) return;
  const since = new Date(pktDay(now) * DAY_MS - PKT_MS).toISOString();
  const { data: kept } = await supabase.from('story_events').select('page_n, data').eq('child_id', studentId).eq('book_id', out.id)
    .eq('event', 'story_page_listened').gte('at', since);
  const seen = new Set((kept || []).filter((r) => r.data && r.data.miss === true).map((r) => r.page_n));
  const rows = missing.filter((n) => !seen.has(n))
    .map((n) => ({ child_id: studentId, book_id: out.id, page_n: n, event: 'story_page_listened', data: { miss: true } }));
  if (!rows.length) return;
  const { error } = await supabase.from('story_events').insert(rows);
  if (error) logToFile('⚠️ web quiz stories: miss not kept', { error: error.message });
  logEvent('web_quiz.story_page_miss', { pages: rows.length });
}

/** One ready book's payload with no child attached (the teacher's preview reuses it behind its own token). 404 otherwise. */
async function bookData(id) {
  const f = await flags();
  if (!f.on) fail(404, 'stories_off');
  const b = await readyBook(id);
  if (!b) fail(404, f.steady ? 'gone' : 'not_found');
  const { data: pageRows } = await supabase.from('story_pages')
    .select('*').eq('book_id', b.id);
  const pages = (pageRows || []).slice().sort((x, y) => x.n - y.n);
  const { data: voiceRows } = pages.length
    ? await supabase.from('story_page_voices').select('*').in('page_id', pages.map((p) => p.id)).eq('is_current', true)
    : { data: [] };
  const voiceOf = new Map((voiceRows || []).map((v) => [v.page_id, v]));
  const urls = pages.map((p) => (voiceOf.get(p.id) ? audioUrl(voiceOf.get(p.id).audio_key, b.id) : null));
  const questions = await reviewedQuestions(b.id);
  const wpms = (voiceRows || []).map((v) => Number(v.wpm)).filter((n) => Number.isFinite(n) && n > 0);
  logEvent('web_quiz.stories_book', { pages: pages.length, voiced: urls.filter(Boolean).length });
  return {
    id: b.id, title: b.title, lang: b.lang, dir: b.lang === 'ur' ? 'rtl' : 'ltr', grade: b.grade, cover: fileUrl(b.id, b.cover_file),
    pace_wpm: wpms.length ? Math.round(wpms.reduce((a, n) => a + n, 0) / wpms.length) : null, lr3: f.lr3, ...(f.lrr ? { lrr: true } : {}), ...(f.steady ? { steady: 1 } : {}), ...(f.lens ? { tx: 1 } : {}), ...(f.polish ? { pl: 1 } : {}), ...(f.mp3 ? { mp3: 1 } : {}), ...((await require('./web-quiz-read-feedback').on()) ? { read_fb: 1, ...((await require('./web-quiz-read-feedback').sheetOn()) ? { read_sheet: await require('./web-quiz-read-feedback').sheetLevel() } : {}) } : {}), ...(f.gaps ? { slow_gaps: f.ms || true } : {}),
    // the microphone notice's words (wq-liveread.js): does Jugnu keep its passage recordings? (only with lr3: off = today's)
    ...(f.lr3 ? { lr3_keep: f.keep } : {}),
    pages: pages.map((p, i) => {
      const v = voiceOf.get(p.id);
      return {
        n: p.n, image: { url: fileUrl(b.id, p.image_file), w: p.image_w, h: p.image_h }, text_band: f.band ? bandOf(b.id, p) : null,
        text: p.text || '', words: mergeWords(p.words, v && urls[i] ? v.timings : [], v && Number(v.ms)),
        audio: v && urls[i] ? { url: urls[i], ms: Number(v.ms) || 0 } : null, boxes_ok: Boolean(p.boxes_ok), is_picture: Boolean(p.is_picture),
        ...linesOf(p.lines),
        // the voice's word times are not trusted on this page: the player sweeps the line instead of a word box
        ...(v && urls[i] && v.quality === 'low' ? { quality: 'low' } : {}),
      };
    }),
    // page_ref: the page that answers it ("Look back" after a miss); it says where to look, not which option is right.
    ...spriteOf(b.id, b.questions_sprite),
    questions: questions.map((q) => ({ n: q.n, kind: q.kind, q: q.q, options: (Array.isArray(q.options) ? q.options : []).map((o) => optionOf(b.id, o)),
      ...(Number.isFinite(Number(q.page_ref)) && q.page_ref != null ? { page_ref: Number(q.page_ref) } : {}), audio: qAudio(b.id, q.audio) })),
  };
}

// ─── events ────────────────────────────────────────────────────────────────────────────────────────────

async function childEvents(studentId, bookId) {
  const { data } = await supabase.from('story_events').select('event, page_n, data, at').eq('child_id', studentId).eq('book_id', bookId);
  // Only real effort counts: a read with at least 10 % of its words heard, a listen to a page that had a voice.
  return (data || []).filter((r) => {
    const d = r.data || {};
    if (r.event === 'story_page_read') return Number(d.words_total) > 0 && Number(d.words_read) / Number(d.words_total) >= 0.1;
    if (r.event === 'story_page_listened') return d.miss !== true;
    return true;
  });
}

function effortOf(rows, answered) {
  const pages = (kind) => new Set(rows.filter((r) => r.event === kind).map((r) => r.page_n)).size;
  return effortStars({ listened: pages('story_page_listened'), read: pages('story_page_read'), answered });
}

async function bookOn() {
  try { return Boolean((await require('./web-quiz-book').flags()).book); } catch (_) { return false; }
}

// The storybook sheet showed the microphone notice (wq-liveread.js), and this page read says so (`notice`: its version):
// the Trail's own record "this child has seen it on this phone", only with lr3 + the notice and keep switches + the exact
// version. The story_events row never carries the field (keep() drops it). Best effort, never throws.
async function noticeShown(studentId, device, v) {
  try {
    const TrailPage = require('./web-quiz-trail-page');
    if (v !== TrailPage.NOTICE_V || !(await flags()).keep) return;
    const tp = await TrailPage.flags();
    if (tp.consent && tp.keep) await TrailPage.noteNoticeShown(studentId, device);
  } catch (_) { /* the phone's own mark still holds */ }
}

async function event(token, { kid, book_id: bookId, page_n: pageN, event: name, data } = {}, { device } = {}) {
  const who = await guard(token, kid, device, 'stories_event');
  if (!EVENTS.has(name) && name !== 'story_answer') fail(400, 'bad_event');
  const b = await readyBook(bookId);
  if (!b) fail(404, 'not_found');
  // One tap checked (the reader's "Look back" after a miss): right or not, no row kept, the answer never sent.
  if (name === 'story_answer') {
    const q = (await reviewedQuestions(b.id)).find((x) => x.n === int(data && data.n));
    if (!q) fail(400, 'bad_question');
    const pick = int(data.i != null ? data.i : data.pick);
    const right = pick === Number(q.answer_i);
    logEvent('web_quiz.story_answer', { n: q.n, kind: q.kind, right });
    // Only after a second miss is the answer shown (kindly, then the next question); a first miss earns a look back.
    // A second try needs a first one: another option, also wrong.
    const first = data.first == null ? null : int(data.first);
    const options = Array.isArray(q.options) ? q.options.length : 0;
    const second = int(data.try) === 2 && first !== null && first < options && first !== pick && first !== Number(q.answer_i);
    return { ok: true, right, ...(!right && second ? { show: Number(q.answer_i) } : {}) };
  }
  const page = pageN == null ? null : int(pageN);
  if (pageN != null && (page === null || page < 1 || page > (Number(b.pages) || 0))) fail(400, 'bad_page');
  if (who.practice) return practiceEvent(name, b, data);
  if (name === 'story_page_read' && data && data.notice != null) await noticeShown(who.studentId, device, data.notice);
  let kept = keep(name, data);
  // Listened with Slower on (`slow: 1`): kept only with the gaps switch on, else the row is today's
  if (kept.slow && !(await flags()).gaps) delete kept.slow;
  const out = { ok: true };
  if (name === 'story_questions_done') {
    const qs = await reviewedQuestions(b.id);
    // One pick per question, or its tries [first, second?]: the last try is the answer (right by the second try counts).
    const picks = Array.isArray(data && data.answers) ? data.answers.slice(0, qs.length).map((a) => int(Array.isArray(a) ? a[a.length - 1] : a)) : [];
    const correct = qs.filter((q, i) => picks[i] !== null && picks[i] === Number(q.answer_i)).length;
    const stars = effortOf(await childEvents(who.studentId, b.id), true);
    Object.assign(out, { correct, total: qs.length, stars });
    // Per kind as [right, total] ("finds facts / works out why") for the teacher's report; the child screen never shows it.
    const byKind = {};
    qs.forEach((q, i) => { const k = byKind[q.kind] || (byKind[q.kind] = [0, 0]); k[1] += 1; if (picks[i] !== null && picks[i] === Number(q.answer_i)) k[0] += 1; });
    out.by_kind = byKind;
    kept = { correct, total: qs.length, stars, by_kind: byKind };
  }
  if (name === 'story_done') {
    const before = await supabase.from('story_events').select('data').eq('child_id', who.studentId).eq('book_id', b.id).eq('event', 'story_done');
    const first = !before.error && !(before.data || []).some(counted);
    // Counted from the child's own events, never the page's numbers.
    const rows = await childEvents(who.studentId, b.id);
    const pagesOf = (kind) => new Set(rows.filter((r) => r.event === kind).map((r) => r.page_n)).size;
    const effort = effortOf(rows, rows.some((r) => r.event === 'story_questions_done'));
    kept = { pages_listened: pagesOf('story_page_listened'), pages_read: pagesOf('story_page_read'), stars: effort };
    // A finish counts only for a story the child listened to or read: with no page heard or read there is no row,
    // so no sticker, no shelf tick, and a later real finish is still the first.
    if (kept.pages_listened + kept.pages_read === 0) {
      logEvent('web_quiz.story_done_empty', {});
      return { ok: true, sticker: false };
    }
    out.sticker = first && (await bookOn());
    // the book's read answered at its end (web_quiz_read_feedback): its speed is kept for the next book's comparison
    const ReadFeedback = require('./web-quiz-read-feedback');
    if (await ReadFeedback.on()) {
      const reading = await ReadFeedback.storyReading(who.studentId, rows);
      if (reading) { out.reading = reading; if (reading.wcpm) kept.wcpm = reading.wcpm; }
    }
  }
  const { error } = await supabase.from('story_events').insert({ child_id: who.studentId, book_id: b.id, page_n: page, event: name, data: kept });
  if (error) logToFile('⚠️ web quiz stories: event not kept', { event: name, error: error.message });
  logEvent(`web_quiz.${name}`, { page: page == null ? undefined : page, ...kept });
  return out;
}

/**
 * A preview's story event (web_quiz_practice_play): answered as a child's would be and never kept. The questions are
 * counted from the picks sent (as a child's), the stars from that answer alone (no page events exist to count), and
 * a finish earns no sticker. No row, no notice mark.
 */
async function practiceEvent(name, b, data) {
  const Practice = require('./web-quiz-practice-play');
  Practice.note('stories_event', { event: name });
  if (name === 'story_questions_done') {
    const qs = await reviewedQuestions(b.id);
    const picks = Array.isArray(data && data.answers) ? data.answers.slice(0, qs.length).map((a) => int(Array.isArray(a) ? a[a.length - 1] : a)) : [];
    const right = (q, i) => picks[i] !== null && picks[i] === Number(q.answer_i);
    const byKind = {};
    qs.forEach((q, i) => { const k = byKind[q.kind] || (byKind[q.kind] = [0, 0]); k[1] += 1; if (right(q, i)) k[0] += 1; });
    return { ok: true, correct: qs.filter(right).length, total: qs.length, stars: effortStars({ answered: true }), by_kind: byKind };
  }
  if (name === 'story_done') return { ok: true, sticker: false };
  return { ok: true };
}

/** May a child read this page aloud? Stories on, the book ready, the page there and not a picture page. Never throws. */
async function pageReadable(bookId, pageN) {
  try {
    if (!(await storiesOn())) return false;
    const b = await readyBook(bookId);
    const n = int(pageN);
    if (!b || n === null) return false;
    const { data } = await supabase.from('story_pages').select('n, is_picture').eq('book_id', b.id).eq('n', n).maybeSingle();
    return Boolean(data) && !data.is_picture;
  } catch (_) {
    return false;
  }
}

/** The Book's storybook stickers: the first finish of each ready book, newest first. [] on any error. */
async function stickersFor(studentId) {
  try {
    const { data } = await supabase.from('story_events').select('book_id, data, at').eq('child_id', studentId).eq('event', 'story_done');
    const first = new Map();
    (data || []).filter(counted).forEach((r) => { if (!first.has(r.book_id) || String(r.at) < String(first.get(r.book_id))) first.set(r.book_id, r.at); });
    if (!first.size) return [];
    const { data: books } = await supabase.from('story_books').select('id, title, cover_file').in('id', [...first.keys()]).eq('status', 'ready');
    return (books || []).map((b) => ({ book_id: b.id, title: b.title, cover: fileUrl(b.id, b.cover_file), at: first.get(b.id) }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at))).map(({ at, ...rest }) => rest);
  } catch (err) {
    logToFile('⚠️ web quiz stories: stickers unavailable', { error: err.message });
    return [];
  }
}

module.exports = {
  shelf, shelfPublic, book, bookData, event, hubBits, stickersFor, storiesOn, pageReadable,
  pktDay, seededShuffle, shelfOrder, mergeWords, effortStars, FLAG_KEY, BAND_KEY, STEADY_KEY, MP3_KEY, RIDERS, flags, resumeOf, orderedBooks, gradeOf, fileUrl,
  _reset: () => { cache = null; },
  _cardField: (fn) => { cardField = fn; },
};
