'use strict';
/**
 * Does the catalogue already hold what the teacher typed? — the free-form seam's first question.
 *
 * A typed lesson-plan topic that either catalogue already holds keeps getting the catalogue: a HIT
 * is never changed. Only a MISS may go to the free-form engine (and only when its switch says so).
 *
 * Ranked by token overlap against two title sets:
 *   - the K-5 v8 catalogue (bot/data/lp_catalog.json — static, read once): chapter titles and
 *     lesson topics;
 *   - the Grades 6-12 segments (niete_lp612_segments: subtopic_title, menu_title, chapter_title) with
 *     the SAME filters the 6-12 browser applies (lp612-browse.service.js `servable`): is_current,
 *     the grade band, and the religious hold unless it is lifted. Paged (PostgREST answers an
 *     unbounded select with at most 1,000 rows and says nothing). Cached TITLES_TTL_MS per process.
 *
 * score = |content words of the topic ∩ words of one title| / |content words of the topic|;
 * HIT when the best score reaches THRESHOLD. A topic with no content word ("lesson plan please") is a
 * HIT: the catalogue is the answer to a bare ask. A lookup that cannot run is a HIT too — on any
 * doubt, today's answer.
 *
 * Load: only reached with the switch ON for this teacher. One read of three short text columns per
 * process per TITLES_TTL_MS (~10k rows × ~120 bytes ≈ 1.2 MB per 10 min per replica).
 */
const path = require('path');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { isReligiousEnabled, LP612_MIN_GRADE, LP612_MAX_GRADE } = require('../../config/lp612-flags');

const THRESHOLD = 0.5;
const TITLES_TTL_MS = 10 * 60 * 1000;
const PAGE = 1000;
const SEGMENTS = 'niete_lp612_segments';

// Words that say "I want a lesson plan" or name a class/subject rather than a topic.
const STOP = new Set([
  // English
  'a', 'an', 'the', 'and', 'or', 'of', 'on', 'in', 'for', 'to', 'about', 'with', 'my', 'me', 'i', 'we', 'our', 'is', 'are',
  'please', 'pls', 'plz', 'make', 'create', 'give', 'send', 'need', 'want', 'can', 'you', 'write', 'prepare', 'generate',
  'lesson', 'lessons', 'plan', 'plans', 'lp', 'class', 'grade', 'std', 'standard', 'chapter', 'unit', 'topic', 'subject',
  'day', 'week', 'teach', 'teaching', 'students', 'student', 'kids', 'children', 'today', 'tomorrow', 'new',
  'math', 'maths', 'mathematics', 'science', 'english', 'urdu', 'islamiat', 'islamiyat', 'social', 'studies', 'general',
  'knowledge', 'computer', 'physics', 'chemistry', 'biology', 'history', 'geography',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'one', 'two', 'three',
  'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  // Urdu (ی/ک/ہ already folded)
  'سبق', 'اسباق', 'پلان', 'لیسن', 'منصوبہ', 'منصوبے', 'کلاس', 'جماعت', 'باب', 'مضمون', 'موضوع', 'کے', 'کی', 'کا', 'پر', 'میں',
  'اور', 'کو', 'سے', 'لیے', 'لئے', 'برائے', 'بنائیں', 'بنا', 'بنادیں', 'دیں', 'دے', 'چاہیے', 'ہے', 'ہیں', 'یہ', 'ایک', 'مجھے',
  'ریاضی', 'سائنس', 'انگریزی', 'اردو', 'اسلامیات', 'معاشرتی', 'علوم',
  'اول', 'دوم', 'سوم', 'چہارم', 'پنجم', 'ششم', 'ہفتم', 'ہشتم', 'نہم', 'دہم',
]);

/** Lower-case; strip Latin diacritics and Arabic-script harakat; fold ي/ى→ی, ك→ک, ه→ہ, ة→ہ. */
function normalise(text) {
  return String(text == null ? '' : text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٰٟۖ-ۭ]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[هة]/g, 'ہ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const LATIN = /^[a-z]+$/;
function stem(w) {
  return LATIN.test(w) && w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
}

/** The content words of a text, in order, de-duplicated. */
function tokens(text) {
  const out = [];
  for (const w of normalise(text).split(' ')) {
    if (!w || /^\p{N}+$/u.test(w) || [...w].length < 2 || STOP.has(w)) continue;
    const s = stem(w);
    if (!STOP.has(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Rank a topic against [{title, source}] (pure). */
function match(topic, titles) {
  const q = tokens(topic);
  if (!q.length) return { hit: true, score: 1, title: null, source: null, reason: 'no_topic' };
  let best = { score: 0, title: null, source: null };
  for (const t of titles || []) {
    const words = t._words || (t._words = new Set(tokens(t.title)));
    let n = 0;
    for (const w of q) if (words.has(w)) n += 1;
    const score = n / q.length;
    if (score > best.score) best = { score, title: t.title, source: t.source };
    if (score === 1) break;
  }
  const hit = best.score >= THRESHOLD;
  return { hit, ...best, reason: hit ? 'match' : 'below_threshold' };
}

function v8Titles() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const cat = require(path.join(__dirname, '..', '..', '..', 'data', 'lp_catalog.json'));
  const out = [];
  for (const book of cat.books || []) {
    for (const ch of book.chapters || []) {
      if (ch.title) out.push({ title: ch.title, source: 'v8' });
      for (const l of ch.lessons || []) if (l.topic) out.push({ title: l.topic, source: 'v8' });
    }
  }
  return out;
}

async function lp612Titles() {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from(SEGMENTS)
      .select('subtopic_title, menu_title, chapter_title')
      .eq('is_current', true)
      .gte('grade', LP612_MIN_GRADE)
      .lte('grade', LP612_MAX_GRADE);
    if (!isReligiousEnabled()) q = q.eq('is_religious', false);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`lp612 titles: ${error.message || error}`);
    const page = data || [];
    for (const r of page) {
      for (const t of [r.subtopic_title, r.menu_title, r.chapter_title]) if (t) out.push({ title: t, source: 'lp612' });
    }
    if (page.length < PAGE) return out;
  }
}

let cache = { at: 0, titles: null };
function _resetCache() { cache = { at: 0, titles: null }; }

async function titles() {
  const now = Date.now();
  if (cache.titles && now - cache.at < TITLES_TTL_MS) return cache.titles;
  const all = [...v8Titles(), ...(await lp612Titles())];
  cache = { at: now, titles: all };
  return all;
}

/** The live lookup. Never throws: a lookup that cannot run is a HIT (today's answer). */
async function matchTopic(topic) {
  if (!tokens(topic).length) return match(topic, []);
  try {
    return match(topic, await titles());
  } catch (err) {
    logToFile('fflp catalogue match: lookup failed, treating as a hit (today\'s catalogue)', { error: err.message }, 'warn');
    return { hit: true, score: null, title: null, source: null, reason: 'lookup_failed' };
  }
}

module.exports = { THRESHOLD, normalise, tokens, match, matchTopic, _resetCache };
