'use strict';
/**
 * WHAT A SHARED CARD SAYS THE CHILD DID (app_settings web_quiz_share_data, on top of the one share; default OFF).
 *
 * The result of the finish, read from the server's own rows at mint and sealed into the card's token, so the landing
 * (and the card picture the operator picks) can show a score, stars, words read and a badge, and dare the friend to
 * beat it. Never a number the page sends, and never a reading speed (words a minute, or what gives it back).
 *
 *   resultOf({ kind, deed, item, w, ct }) -> { r?, o?, s?, w?, b? } | null   never throws
 *     r/o  right of how many (a quiz, a game, a listen's or a story's questions)
 *     s    stars 0–3            w  words read (a storybook's pages; a Jugnu read only when the whole story was read)
 *     b    a badge id (BADGES)
 *   words(x, lang) -> { score, words, stars, badge, dare } the landing's lines in the card's language; {} for none
 *
 * Sources, per finish:
 *   quiz          its quiz_sessions row (correct_answers / total_questions_answered); a video's quiz: the video badge
 *   read / story  its web_quiz_challenge_runs row (score.attempted / correct → the read band; meta.comp → questions)
 *   listen, game  its web_quiz_challenge_runs row (score.correct / n)
 *   book          the child's story_events for the book in the last RECENT_MS (questions, effort stars, words read)
 *   video         the child's newest finished quiz on that video in the last RECENT_MS; none: no result (watched only)
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const RECENT_MS = 30 * 60 * 1000;
// the read band's lines (web-quiz-read-feedback.js STAR_AT): accuracy 0.9 → 3 stars, 0.7 → 2
const STAR_AT = [0.7, 0.9];
const BADGES = Object.freeze({
  game_champ: { en: 'Game champ', ur: 'کھیلوں کا چیمپئن' },
  quiz_champ: { en: 'Quiz champ', ur: 'کوئز کا چیمپئن' },
  video_star: { en: 'Video star', ur: 'ویڈیو کا ستارہ' },
  star_reader: { en: 'Star reader', ur: 'پڑھائی کا ستارہ' },
  brave_reader: { en: 'Brave reader', ur: 'ہمت کا تمغہ' },
  brave_try: { en: 'Brave try', ur: 'ہمت والی کوشش' },
  listen_star: { en: 'Listening star', ur: 'سننے کا ستارہ' },
});
const READ_BADGE = Object.freeze({ star: 'star_reader', reader: 'brave_reader', try: 'brave_try' });

const int = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };
const starsOf = (r, o) => (!o || !r ? 0 : r / o >= STAR_AT[1] ? 3 : r / o >= STAR_AT[0] ? 2 : 1);
// right of how many, as the card keeps it: a whole number of at most the total, and a total of at least one
function score(r, o) {
  const right = int(r);
  const of = int(o);
  return of && right !== null ? { r: Math.min(right, of), o: of } : null;
}

async function runOf(runId, sid) {
  if (!runId || !sid) return null;
  const { data } = await supabase.from('web_quiz_challenge_runs').select('id, student_id, exercise, status, score, meta').eq('id', String(runId)).maybeSingle();
  return data && String(data.student_id) === String(sid) && data.status === 'scored' && data.score && typeof data.score === 'object' ? data : null;
}

// A Jugnu read (read, story): the read band's stars and badge; the words only when the whole story was read (a
// timer-ended minute's count is the speed itself, so a part read says no number); the story's questions when asked.
async function fromRead(run, ct) {
  const s = run.score;
  const tried = int(s.attempted) || 0;
  const right = s.correct == null ? tried : Math.min(int(s.correct) || 0, tried);
  const implausible = Boolean(run.meta && run.meta.quality === 'implausible');
  const out = {};
  if (!right || implausible) Object.assign(out, { s: 0, b: READ_BADGE.try });
  else {
    const st = right / tried >= STAR_AT[1] ? 3 : right / tried >= STAR_AT[0] ? 2 : 1;
    Object.assign(out, { s: st, b: st === 3 ? READ_BADGE.star : READ_BADGE.reader });
    const len = await require('./web-quiz-challenge').readLength(ct).catch(() => 0);
    if (len > 0 && tried >= len) out.w = len;
  }
  const comp = run.meta && run.meta.comp;
  const q = comp ? score(comp.correct, comp.asked) : null;
  return q ? { ...q, ...out } : out;
}

function fromCounted(run, badge) {
  const q = score(run.score.correct, run.score.n);
  if (!q) return null;
  const s = starsOf(q.r, q.o);
  return { ...q, s, ...(s === 3 ? { b: badge } : {}) };
}

// A storybook: its questions (the server's own count), its effort stars (the server's recount) and the words read on
// its pages (each page's best, at most its words), since the child last opened it, within RECENT_MS.
async function fromBook(sid, bookId) {
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const { data } = await supabase.from('story_events').select('event, page_n, data, at').eq('child_id', sid).eq('book_id', bookId).gte('at', since).order('at', { ascending: true });
  const rows = Array.isArray(data) ? data : [];
  let from = 0;
  rows.forEach((r, i) => { if (r.event === 'story_opened') from = i; });
  const mine = rows.slice(from);
  const last = (ev) => mine.filter((r) => r.event === ev).pop();
  const qd = last('story_questions_done');
  const done = last('story_done');
  const best = new Map();
  mine.filter((r) => r.event === 'story_page_read' && r.data).forEach((r) => {
    const n = Math.min(int(r.data.words_read) || 0, int(r.data.words_total) || 0);
    best.set(r.page_n, Math.max(best.get(r.page_n) || 0, n));
  });
  const words = [...best.values()].reduce((a, b) => a + b, 0);
  const q = qd && qd.data ? score(qd.data.correct, qd.data.total) : null;
  const stars = int(((done && done.data) || (qd && qd.data) || {}).stars);
  const out = { ...(q || {}) };
  if (stars !== null) out.s = Math.min(stars, 3);
  if (words > 0) out.w = words;
  if (out.s === 3) out.b = 'star_reader';
  return Object.keys(out).length ? out : null;
}

// A video: the child's newest finished quiz on it, within RECENT_MS (watching leaves no row of its own).
async function fromVideo(sid, videoId) {
  const { data: qs } = await supabase.from('quizzes').select('id').eq('video_id', videoId).limit(20);
  const ids = (qs || []).map((q) => q.id).filter(Boolean);
  if (!ids.length) return null;
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const { data } = await supabase.from('quiz_sessions').select('correct_answers, total_questions_answered, completed_at')
    .eq('student_id', sid).eq('status', 'completed').in('quiz_id', ids).gte('completed_at', since).order('completed_at', { ascending: false }).limit(1);
  const row = (data || [])[0];
  if (!row) return null;
  const q = score(row.correct_answers, row.total_questions_answered);
  if (!q) return null;
  const s = starsOf(q.r, q.o);
  return { ...q, s, ...(s === 3 ? { b: 'video_star' } : {}) };
}

/** The finish's result from the server's rows, or null. w: who() (sid, session row, run). Never throws. */
async function resultOf({ kind, item, w, ct }) {
  try {
    if (!w) return null;
    if (kind === 'quiz') {
      const row = w.session;
      const q = row ? score(row.correct_answers, row.total_questions_answered) : null;
      if (!q) return null;
      const s = starsOf(q.r, q.o);
      return { ...q, s, ...(s === 3 ? { b: w.video ? 'video_star' : 'quiz_champ' } : {}) };
    }
    if (item && item.t === 'book' && w.sid) return await fromBook(w.sid, item.id);
    if (item && item.t === 'video' && w.sid) return await fromVideo(w.sid, item.id);
    const run = await runOf(w.run, w.sid);
    if (!run) return null;
    if (kind === 'read' || kind === 'story') return run.score && 'attempted' in run.score ? await fromRead(run, ct) : fromCounted(run, 'star_reader');
    if (kind === 'listen') return fromCounted(run, 'listen_star');
    if (kind === 'game') return fromCounted(run, 'game_champ');
    return null;
  } catch (err) {
    logToFile('⚠️ web quiz card data: no result (the card goes without one)', { error: err.message });
    return null;
  }
}

/** The result as the token keeps it: only the known fields, as whole numbers and a known badge. */
function clean(x) {
  if (!x || typeof x !== 'object') return null;
  const out = {};
  const q = score(x.r, x.o);
  if (q) Object.assign(out, q);
  const s = int(x.s);
  if (s !== null) out.s = Math.min(s, 3);
  const w = int(x.w);
  if (w) out.w = Math.min(w, 9999);
  if (BADGES[x.b]) out.b = x.b;
  return Object.keys(out).length ? out : null;
}

const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const num = (n, lang) => (lang === 'ur' ? String(n).replace(/[0-9]/g, (d) => UR_DIGITS[d]) : String(n));
const LINES = {
  en: {
    score: (r, o) => `${r} out of ${o} right`,
    words: (w) => `${w} words read`,
    stars: (s, n) => (s === 0 ? 'No stars yet' : s === 1 ? '1 star' : `${n} stars`),
    dareScore: (o) => `Can you get ${o} out of ${o}?`,
    dareOne: 'Can you get it right too?',
    dareWords: (w) => `Can you read ${w} words too?`,
    dareStars: 'Can you get 3 stars too?',
    dareStory: 'Can you read it too?',
  },
  ur: {
    score: (r, o) => `${o} میں سے ${r} صحیح`,
    words: (w) => `${w} لفظ پڑھے`,
    stars: (s, n) => (s === 0 ? 'کوئی ستارہ نہیں' : s === 1 ? '۱ ستارہ' : `${n} ستارے`),
    dareScore: (o) => `آپ ${o} کے ${o} صحیح کر کے دکھائیں!`,
    // one question: «۱ کے ۱» is not natural Urdu (native read, 18 Oct)
    dareOne: 'آپ بھی صحیح جواب دے کر دکھائیں!',
    dareWords: (w) => `آپ بھی ${w} لفظ پڑھ کر دکھائیں!`,
    dareStars: 'آپ بھی ۳ ستارے لے کر دکھائیں!',
    dareStory: 'آپ بھی یہ کہانی پڑھ کر دکھائیں!',
  },
};
const READS = new Set(['read', 'story', 'book']);

/** The landing's lines for a kept result, in the card's language (Urdu digits in Urdu); {} for none. */
function words(x, kind, lang) {
  const c = clean(x);
  if (!c) return {};
  const l = lang === 'ur' ? 'ur' : 'en';
  const L = LINES[l];
  const out = c.s == null ? {} : { stars: c.s, stars_text: L.stars(c.s, num(c.s, l)) };
  if (c.o) out.score = L.score(num(c.r, l), num(c.o, l));
  if (c.w) out.words = L.words(num(c.w, l));
  if (c.b) out.badge = BADGES[c.b][l];
  // the dare: the score to beat; else a reader's words, its story, or the stars
  if (c.o) out.dare = c.o === 1 ? L.dareOne : L.dareScore(num(c.o, l));
  else if (c.w) out.dare = L.dareWords(num(c.w, l));
  else if (READS.has(kind)) out.dare = L.dareStory;
  else if (c.s != null) out.dare = L.dareStars;
  return out;
}

module.exports = { resultOf, clean, words, BADGES, RECENT_MS, LINES };
