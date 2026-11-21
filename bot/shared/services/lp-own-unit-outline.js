'use strict';
/**
 * bd-snkn32.59 (queue #165) — "Make my own → A whole unit": a chapter range of her grades 1–5 book → a day-by-day
 * outline she can change before any plan is made. Pure (no I/O): the book is a catalogue book (lp_catalog.json).
 *
 *   buildOutline({ book, from, to, pace, period, bookMinutes }) → { ok: true, days } | { ok: false, error }
 *   paceCounts({ book, from, to, period, bookMinutes })         → { recommended, slower, faster|null }
 *
 * A day is { kind: lesson|practice|review|test, chapter, lesson_ids, topic, part? }.
 *  - recommended: the book's days in order; each chapter ends with its review day, then its test worksheet.
 *  - slower: one practice day after each topic (a "Topic N" section starts one; a book without them = the chapter).
 *  - faster: a practice day of the book (Skill Sharpener / Discovery Playground) joins the day before. Review and test
 *    days are never removed. A range with nothing to join has no faster pace ('no_faster').
 *  - period well below the book day's own minutes (< 85%): the heaviest lesson days split in two (part 1, part 2),
 *    as many as keep the unit's total time: round(lessonDays × (bookMinutes − period) / bookMinutes).
 */

const PACES = ['recommended', 'slower', 'faster'];
const PERIODS = { min: 20, max: 90 };
const MAX_CHAPTERS = 3;
const SPLIT_BELOW = 0.85;
const TOPIC_START = /^\s*topic\s+\d+/i;
const PRACTICE_DAY = /skill sharpener|discovery playground/i;

const kindOf = (l) => (l.lp_type === 'assessment' ? 'test' : l.lp_type === 'revision' ? 'review' : 'lesson');
const ORDER = { lesson: 0, review: 1, test: 2 };

/** The chapter's days as the teacher teaches them: lessons, then review, then test. */
function chapterDays(ch) {
  return ch.lessons
    .map((l, i) => ({ l, i }))
    .sort((a, b) => ORDER[kindOf(a.l)] - ORDER[kindOf(b.l)] || a.i - b.i)
    .map(({ l }) => ({ kind: kindOf(l), chapter: ch.number, lesson_ids: [l.lesson_id], topic: l.topic || l.topic_short || '', _l: l }));
}

/** Indexes (into days) of the last lesson day of each topic in one chapter's days. */
function topicEnds(days) {
  const lessons = days.map((d, i) => ({ d, i })).filter(({ d }) => d.kind === 'lesson');
  const ends = [];
  lessons.forEach(({ d, i }, n) => {
    const next = lessons[n + 1];
    if (!next || TOPIC_START.test(next.d._l.section || '')) ends.push(i);
  });
  return ends;
}

function addPractice(days) {
  const ends = new Set(topicEnds(days));
  const out = [];
  let topic = [];
  days.forEach((d, i) => {
    out.push(d);
    if (d.kind === 'lesson') topic.push(...d.lesson_ids);
    if (ends.has(i)) {
      out.push({ kind: 'practice', chapter: d.chapter, lesson_ids: topic, topic: days[days.indexOf(d) - topic.length + 1].topic });
      topic = [];
    }
  });
  return out;
}

const isPracticeDay = (d) => d.kind === 'lesson' && PRACTICE_DAY.test(`${d._l.section || ''} ${d._l.topic || ''}`);

function joinPractice(days) {
  const out = [];
  let joined = 0;
  for (const d of days) {
    const prev = out[out.length - 1];
    if (isPracticeDay(d) && prev && prev.kind === 'lesson' && prev.chapter === d.chapter && prev.lesson_ids.length === 1) {
      out[out.length - 1] = { ...prev, lesson_ids: [...prev.lesson_ids, ...d.lesson_ids], topic: `${prev.topic} + ${d.topic}` };
      joined += 1;
    } else out.push(d);
  }
  return { days: out, joined };
}

const weight = (d) => ((d._l && d._l.pages) || []).length * 10 + String((d._l && d._l.section) || '').split('+').length;

function splitHeaviest(days, period, bookMinutes) {
  if (!(bookMinutes > 0) || period >= SPLIT_BELOW * bookMinutes) return days;
  const singles = days.filter((d) => d.kind === 'lesson' && d.lesson_ids.length === 1);
  const n = Math.min(singles.length, Math.round(singles.length * (bookMinutes - period) / bookMinutes));
  const heavy = new Set(singles.map((d, i) => ({ d, i })).sort((a, b) => weight(b.d) - weight(a.d) || a.i - b.i).slice(0, n).map((x) => x.d));
  return days.flatMap((d) => (heavy.has(d) ? [{ ...d, part: 1 }, { ...d, part: 2 }] : [d]));
}

const clean = ({ _l, ...d }) => d;

function buildOutline({ book, from, to, pace, period, bookMinutes } = {}) {
  if (!book || !Array.isArray(book.chapters)) return { ok: false, error: 'no_book' };
  const lo = Number(from);
  const hi = Number(to);
  const numbers = book.chapters.map((c) => c.number);
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi || !numbers.includes(lo) || !numbers.includes(hi)) return { ok: false, error: 'bad_range' };
  const chapters = book.chapters.filter((c) => c.number >= lo && c.number <= hi);
  if (chapters.length > MAX_CHAPTERS) return { ok: false, error: 'too_many_chapters' };
  if (!PACES.includes(pace)) return { ok: false, error: 'bad_pace' };
  const p = Number(period);
  if (!Number.isFinite(p) || p < PERIODS.min || p > PERIODS.max) return { ok: false, error: 'bad_period' };

  let days = chapters.flatMap((c) => {
    const own = chapterDays(c);
    return pace === 'slower' ? addPractice(own) : own;
  });
  if (pace === 'faster') {
    const j = joinPractice(days);
    if (!j.joined) return { ok: false, error: 'no_faster' };
    days = j.days;
  }
  days = splitHeaviest(days, p, Number(bookMinutes));
  return { ok: true, days: days.map(clean) };
}

function paceCounts(q = {}) {
  const count = (pace) => {
    const out = buildOutline({ ...q, pace });
    return out.ok ? out.days.length : null;
  };
  return { recommended: count('recommended'), slower: count('slower'), faster: count('faster') };
}

module.exports = { buildOutline, paceCounts, PACES, MAX_CHAPTERS, PERIODS };
