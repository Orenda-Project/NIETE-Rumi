'use strict';
/**
 * STORIES — storybooks a child reads with Jugnu (app_settings `web_quiz_stories`, only a literal true; fails closed:
 * off, every answer is 404 `stories_off` and nothing about the child is read).
 *
 *   shelf(token, {kid, g, l, t, device, now})   the books of one grade × language for the child a hub chip names
 *   book(id, token, {kid, device})              one ready book: pages, words with the voice's timings, questions (no answers)
 *   bookData(id)                                the same payload with no child (the teacher's preview, behind its own token)
 *   event(token, {kid, book_id, page_n, event, data}, {device})  one story event; questions are checked here
 *   hubBits()                                   {} off; {stories: {on: 1}} for the hub payload (the page loads wq-stories.js)
 *   stickersFor(studentId)                      the child's storybook stickers (first finish of each book) for the Book
 *   pageReadable(bookId, n)                     may this page be read aloud (the live-read key checks before it spends)
 *
 * Content lives in the database and the storage bucket (story_books, story_pages, story_page_voices, story_questions);
 * pictures are served by the same-origin `/s/<book>/<file>` route, audio as a short-lived signed URL. Rules:
 *   - the shelf lists only `status='ready'` books: books the teacher sent first, then the unfinished ones in a shuffle
 *     seeded by (child, PKT day), finished last; every book carries its `shelf_position`;
 *   - a book's `words[]` are the printed words merged with the CURRENT voice's timings by `i`; a page with no voice
 *     has `audio: null` (the reader skips Listen);
 *   - only `reviewed` questions are sent, and never their answer: `story_questions_done` sends the child's picks and
 *     the server counts them;
 *   - stars are effort stars (listened, read aloud, answered), never a score;
 *   - `story_done` gives the storybook sticker the first time a child finishes a book, only with Jugnu's Book on.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { WqError } = require('./web-quiz-error');

const FLAG_KEY = 'web_quiz_stories';
// The 2× crop of the printed words under the picture: held back on its own switch while a reading expert rules on
// showing the words twice (COS 17:34Z). Off ⇒ every page's text_band is null and the reader shows the picture only.
const BAND_KEY = 'web_quiz_stories_band';
const TTL_MS = 30 * 1000;
const PKT_MS = 5 * 3600 * 1000;
const DAY_MS = 86400000;
const AUDIO_TTL_S = 6 * 3600;
const GRADES = [1, 2, 3, 4, 5];
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_RX = /^[a-z0-9-]+\.(webp|ogg|mp3)$/;
const MAX_TEACHER = 5;
const EVENTS = new Set(['story_opened', 'story_page_listened', 'story_page_read', 'story_questions_done', 'story_done', 'story_shared']);
// What each event may keep (numbers and small enums only: never a word the child said, never a name).
const KEEP = {
  story_opened: { shelf_position: 'int', from_teacher: 'bool', grade: 'int', lang: 'lang', code: 'code' },
  story_page_listened: { ms: 'int', completed: 'bool' },
  story_page_read: { words_total: 'int', words_read: 'int', skipped: 'int', ms: 'int', ended: 'ended' },
  story_questions_done: {},
  story_done: { pages_listened: 'int', pages_read: 'int', stars: 'int' },
  story_shared: {},
};
const ENDED = new Set(['last_word', 'quiet', 'done_tap', 'timer', 'line1', 'stuck', 'hidden', 'home', 'silent']);

const fail = (status, error) => { throw new WqError(status, { error }); };
let cache = null;

/** Only a literal true (or "true") turns it on; a read error is off. */
function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true;
}

async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [FLAG_KEY, BAND_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = new Map((data || []).map((r) => [r.key, r.value]));
    const on = by.has(FLAG_KEY) && isTrue(by.get(FLAG_KEY));
    cache = { at: now, on, band: on && by.has(BAND_KEY) && isTrue(by.get(BAND_KEY)) };
  } catch (err) {
    logToFile('⚠️ web quiz stories: settings lookup failed — stories off', { error: err.message });
    cache = { at: now, on: false, band: false };
  }
  return cache;
}
async function storiesOn(now = Date.now()) { return (await flags(now)).on; }

const RESUME_DAYS = 7;
const PAGE_EVENTS = new Set(['story_page_listened', 'story_page_read']);

/** The newest ready book of the last 7 days with a page listened/read and no finish: {book_id, title, cover, page_n, pages}. */
async function resumeOf(studentId, now) {
  const since = new Date(now - RESUME_DAYS * DAY_MS).toISOString();
  const { data } = await supabase.from('story_events').select('book_id, page_n, event, at').eq('child_id', studentId).gte('at', since)
    .order('at', { ascending: false }).limit(300);
  const done = new Set(); const last = new Map();
  (data || []).forEach((r) => {
    if (r.event === 'story_done') done.add(r.book_id);
    else if (PAGE_EVENTS.has(r.event) && Number.isFinite(Number(r.page_n))) {
      const was = last.get(r.book_id) || { at: '', page: 0 };
      last.set(r.book_id, { at: String(r.at) > was.at ? String(r.at) : was.at, page: Math.max(was.page, Number(r.page_n)) });
    }
  });
  const open = [...last.entries()].filter(([id]) => !done.has(id)).sort((a, b) => b[1].at.localeCompare(a[1].at));
  for (const [id, seen] of open.slice(0, 5)) {
    const b = await readyBook(id); // eslint-disable-line no-await-in-loop
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

async function guard(token, kid, device) {
  if (!(await storiesOn())) fail(404, 'stories_off');
  const who = await require('./web-quiz-hub').kidFromHub(token, kid, device);
  if (!who || !who.studentId) fail(401, 'bad_token');
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
function mergeWords(words, timings) {
  const at = new Map((Array.isArray(timings) ? timings : []).map((w) => [Number(w.i), w]));
  return (Array.isArray(words) ? words : []).map((w) => {
    const out = { i: Number(w.i), t: String(w.t || '') };
    const tm = at.get(Number(w.i));
    if (tm && Number.isFinite(Number(tm.s_ms)) && Number.isFinite(Number(tm.e_ms))) { out.s_ms = Number(tm.s_ms); out.e_ms = Number(tm.e_ms); }
    if (Array.isArray(w.box) && w.box.length === 4) out.box = w.box.map(Number);
    return out;
  });
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
    else if (spec[k] === 'lang' && (v === 'en' || v === 'ur')) out[k] = v;
    else if (spec[k] === 'ended' && ENDED.has(v)) out[k] = v;
    else if (spec[k] === 'code' && typeof v === 'string' && /^[A-Za-z0-9]{4,12}$/.test(v)) out[k] = v;
  });
  return out;
}

// ─── reads ─────────────────────────────────────────────────────────────────────────────────────────────

const BOOK_COLS = 'id, title, grade, lang, pages, minutes, cover_file, author, status';

async function readyBook(id) {
  if (!UUID_RX.test(String(id || ''))) return null;
  const { data } = await supabase.from('story_books').select(BOOK_COLS).eq('id', id).eq('status', 'ready').maybeSingle();
  return data || null;
}

async function doneSet(studentId, bookIds) {
  if (!bookIds.length) return new Set();
  const { data } = await supabase.from('story_events').select('book_id').eq('child_id', studentId).eq('event', 'story_done').in('book_id', bookIds);
  return new Set((data || []).map((r) => r.book_id));
}

const gradeOf = (v) => { const m = /\d+/.exec(String(v == null ? '' : v)); const g = m ? Number(m[0]) : 0; return GRADES.includes(g) ? g : null; };

async function shelf(token, { kid, g, l, t, device, now = Date.now() } = {}) {
  const who = await guard(token, kid, device);
  const grade = gradeOf(g) || gradeOf(who.grade) || 1;
  const lang = l === 'ur' ? 'ur' : 'en';
  const { data } = await supabase.from('story_books').select(BOOK_COLS).eq('status', 'ready').eq('grade', grade).eq('lang', lang);
  const books = data || [];
  const teacher = String(t || '').split(',').map((s) => s.trim()).filter((s) => UUID_RX.test(s)).slice(0, MAX_TEACHER);
  const done = await doneSet(who.studentId, books.map((b) => b.id));
  const ordered = shelfOrder(books, { childId: who.studentId, day: pktDay(now), done, teacher });
  const out = {
    grade, lang, grades: GRADES.slice(),
    books: ordered.map((b, i) => ({
      id: b.id, title: b.title, grade: b.grade, lang: b.lang, dir: b.lang === 'ur' ? 'rtl' : 'ltr', pages: b.pages,
      minutes: b.minutes == null ? null : Number(b.minutes), cover: fileUrl(b.id, b.cover_file),
      done: done.has(b.id), from_teacher: teacher.includes(b.id), shelf_position: i + 1,
      ...(b.author ? { by: b.author } : {}),
    })),
  };
  logEvent('web_quiz.stories_shelf', { g: grade, l: lang, n: out.books.length });
  return out;
}

async function signAudio(key, bookId) {
  if (!key) return null;
  // Stored with the book (story/<env>/<book>/a<NN>-<hash8>.ogg): the same-origin /s/ route serves it, immutable.
  if (String(key).startsWith('story/')) return fileUrl(bookId, String(key).split('/').pop());
  try {
    const bucket = require('./web-quiz-audio-store').quizAudioBucket();
    return await require('../../storage/r2').presignKey(key, AUDIO_TTL_S, { bucket });
  } catch (err) {
    logToFile('⚠️ web quiz stories: audio sign failed', { error: err.message });
    return null;
  }
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
  const ok = (Array.isArray(lines) ? lines : []).filter((l) => l && Number.isInteger(l.i0) && Number.isInteger(l.i1) && l.i1 >= l.i0 && Array.isArray(l.box) && l.box.length === 4)
    .map((l) => ({ i0: l.i0, i1: l.i1, box: l.box.map(Number) }));
  return ok.length ? { lines: ok } : {};
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

// The share card's field (m-scorecard's web-quiz-card-image.js, its own switch): {} when absent, off or failing.
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
  await guard(token, kid, device);
  const out = await bookData(id);
  return Object.assign(out, await cardBits());
}

/** One ready book's payload with no child attached (the teacher's preview reuses it behind its own token). 404 otherwise. */
async function bookData(id) {
  const f = await flags();
  if (!f.on) fail(404, 'stories_off');
  const b = await readyBook(id);
  if (!b) fail(404, 'not_found');
  const { data: pageRows } = await supabase.from('story_pages')
    .select('*').eq('book_id', b.id);
  const pages = (pageRows || []).slice().sort((x, y) => x.n - y.n);
  const { data: voiceRows } = pages.length
    ? await supabase.from('story_page_voices').select('page_id, audio_key, ms, timings, wpm, is_current').in('page_id', pages.map((p) => p.id)).eq('is_current', true)
    : { data: [] };
  const voiceOf = new Map((voiceRows || []).map((v) => [v.page_id, v]));
  const urls = await Promise.all(pages.map((p) => (voiceOf.get(p.id) ? signAudio(voiceOf.get(p.id).audio_key, b.id) : null)));
  const questions = await reviewedQuestions(b.id);
  const wpms = (voiceRows || []).map((v) => Number(v.wpm)).filter((n) => Number.isFinite(n) && n > 0);
  logEvent('web_quiz.stories_book', { pages: pages.length, voiced: urls.filter(Boolean).length });
  return {
    id: b.id, title: b.title, lang: b.lang, dir: b.lang === 'ur' ? 'rtl' : 'ltr', grade: b.grade, cover: fileUrl(b.id, b.cover_file),
    pace_wpm: wpms.length ? Math.round(wpms.reduce((a, n) => a + n, 0) / wpms.length) : null,
    pages: pages.map((p, i) => {
      const v = voiceOf.get(p.id);
      return {
        n: p.n, image: { url: fileUrl(b.id, p.image_file), w: p.image_w, h: p.image_h }, text_band: f.band ? bandOf(b.id, p) : null,
        text: p.text || '', words: mergeWords(p.words, v && urls[i] ? v.timings : []),
        audio: v && urls[i] ? { url: urls[i], ms: Number(v.ms) || 0 } : null, boxes_ok: Boolean(p.boxes_ok), is_picture: Boolean(p.is_picture),
        ...linesOf(p.lines),
      };
    }),
    // page_ref: the page that answers it ("Look back" after a miss); it says where to look, not which option is right.
    questions: questions.map((q) => ({ n: q.n, kind: q.kind, q: q.q, options: (Array.isArray(q.options) ? q.options : []).map((o) => optionOf(b.id, o)),
      ...(Number.isFinite(Number(q.page_ref)) && q.page_ref != null ? { page_ref: Number(q.page_ref) } : {}), audio: qAudio(b.id, q.audio) })),
  };
}

// ─── events ────────────────────────────────────────────────────────────────────────────────────────────

async function childEvents(studentId, bookId) {
  const { data } = await supabase.from('story_events').select('event, page_n').eq('child_id', studentId).eq('book_id', bookId);
  return data || [];
}

function effortOf(rows, answered) {
  const pages = (kind) => new Set(rows.filter((r) => r.event === kind).map((r) => r.page_n)).size;
  return effortStars({ listened: pages('story_page_listened'), read: pages('story_page_read'), answered });
}

async function bookOn() {
  try { return Boolean((await require('./web-quiz-book').flags()).book); } catch (_) { return false; }
}

async function event(token, { kid, book_id: bookId, page_n: pageN, event: name, data } = {}, { device } = {}) {
  const who = await guard(token, kid, device);
  if (!EVENTS.has(name) && name !== 'story_answer') fail(400, 'bad_event');
  const b = await readyBook(bookId);
  if (!b) fail(404, 'not_found');
  // One tap checked (the reader's "Look back" after a miss): right or not, no row kept, the answer never sent.
  if (name === 'story_answer') {
    const q = (await reviewedQuestions(b.id)).find((x) => x.n === int(data && data.n));
    if (!q) fail(400, 'bad_question');
    const right = int(data.i != null ? data.i : data.pick) === Number(q.answer_i);
    logEvent('web_quiz.story_answer', { n: q.n, kind: q.kind, right });
    return { ok: true, right };
  }
  const page = pageN == null ? null : int(pageN);
  if (pageN != null && (page === null || page < 0 || page > (Number(b.pages) || 0) + 1)) fail(400, 'bad_page');
  let kept = keep(name, data);
  const out = { ok: true };
  if (name === 'story_questions_done') {
    const qs = await reviewedQuestions(b.id);
    const picks = Array.isArray(data && data.answers) ? data.answers.slice(0, qs.length).map(int) : [];
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
    const before = await supabase.from('story_events').select('id').eq('child_id', who.studentId).eq('book_id', b.id).eq('event', 'story_done').limit(1);
    const first = !before.error && !(before.data || []).length;
    // A sticker is for a story the child listened to or read: a finish with no page heard or read earns none.
    const tried = first && effortOf(await childEvents(who.studentId, b.id), false) > 0;
    out.sticker = tried && (await bookOn());
  }
  const { error } = await supabase.from('story_events').insert({ child_id: who.studentId, book_id: b.id, page_n: page, event: name, data: kept });
  if (error) logToFile('⚠️ web quiz stories: event not kept', { event: name, error: error.message });
  logEvent(`web_quiz.${name}`, { page: page == null ? undefined : page, ...kept });
  return out;
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
    const { data } = await supabase.from('story_events').select('book_id, at').eq('child_id', studentId).eq('event', 'story_done');
    const first = new Map();
    (data || []).forEach((r) => { if (!first.has(r.book_id) || String(r.at) < String(first.get(r.book_id))) first.set(r.book_id, r.at); });
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
  shelf, book, bookData, event, hubBits, stickersFor, storiesOn, pageReadable,
  pktDay, seededShuffle, shelfOrder, mergeWords, effortStars, FLAG_KEY, BAND_KEY,
  _reset: () => { cache = null; },
  _cardField: (fn) => { cardField = fn; },
};
