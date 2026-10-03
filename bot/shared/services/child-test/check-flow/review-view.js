'use strict';

/**
 * Child test v2 — the end-of-visit review, its pure half (bd-s1oo0.46.4): which answers are doubtful, and every
 * word the coach reads (results, the message, the form's data). No reads or writes here, so the Flow generator
 * can build its example from the same code that fills the real form. review.js does the I/O.
 */

const Thresholds = require('../scoring/thresholds');
const { t, clip, blockName } = require('../conversation/copy');
const { childLabel, childName } = require('../conversation/identity');

const BLOCKS = ['urdu', 'english', 'maths'];
const READING = ['urdu', 'english'];
const ORAL = [['compare', 'compare'], ['sums', 'sum'], ['word_problems', 'word_problem']];
const VERDICTS = ['correct', 'wrong', 'none'];
const MAX_ITEMS = 15;
// Until scoring/thresholds.js carries an oral-maths bar (L27): the numbers-read-aloud bar, the closest
// measured oral item (synthetic >= 0.65: 98%, thresholds BAR_EVIDENCE).
const ORAL_DEFAULT_BAR = 0.75;
const QUESTIONS_DEFAULT_BAR = 0.9;
const COMPARE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];
// The review's length, said in the message: about 6 s per item (a tap after the coach has heard the note),
// so "about a minute" holds up to 10 items and anything longer is said in whole minutes (L31).
const SECONDS_PER_ITEM = 6;

const langOf = (l) => (l === 'en' ? 'en' : 'ur');

// ── what is doubtful ──────────────────────────────────────────────────────────────────────────

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(Number(x)) ? Number(x) : 0));

function barOf(item) {
  if (item.field === 'questions') {
    const b = Thresholds.barFor('questions', item.block);
    return b == null ? QUESTIONS_DEFAULT_BAR : b;
  }
  const b = Thresholds.barFor(`maths.oral.${item.group}`) ?? Thresholds.barFor('maths.oral');
  return b == null ? ORAL_DEFAULT_BAR : b;
}

/**
 * The non-reader fallback ran on this block, so the coach skipped its questions by design ("Skip the
 * questions"): they were never asked, so they are never review items, never counted in the summary, and
 * coach_marks scores them 'not_asked' (L31, shot_v2 10).
 */
const questionsSkipped = (ai) => Boolean(ai && ai.fallback);

/** Every verdict the review could ask about, for one child, in test order. */
function candidates(entry) {
  const sid = entry.session.id;
  const out = [];
  for (const block of READING) {
    const ai = entry.blocks[block] && entry.blocks[block].ai_marks;
    if (questionsSkipped(ai)) continue;
    (ai && Array.isArray(ai.questions) ? ai.questions : []).forEach((mark, i) => {
      const itemId = mark.id || `#${i + 1}`;
      out.push({ sessionId: sid, block, field: 'questions', group: 'questions', kind: 'question', number: i + 1, itemId, mark, path: `questions[${itemId}].verdict` });
    });
  }
  const m = entry.blocks.maths && entry.blocks.maths.ai_marks;
  const oral = m && m.maths && m.maths.oral;
  for (const [group, kind] of ORAL) {
    (oral && Array.isArray(oral[group]) ? oral[group] : []).forEach((mark, i) => {
      const itemId = mark.id || `#${i + 1}`;
      out.push({ sessionId: sid, block: 'maths', field: 'maths.oral', group, kind, number: i + 1, itemId, mark, path: `maths.oral.${group}[${itemId}].verdict` });
    });
  }
  for (const c of out) c.key = [c.sessionId, c.block, c.group, c.itemId].join('|');
  return out;
}

function isDoubtful(c) {
  if (!VERDICTS.includes(c.mark.verdict)) return true;
  return clamp01(c.mark.confidence) < barOf(c);
}

/**
 * The items the form asks, in visit order: at most 15; past that, the 15 lowest-confidence are asked and
 * the rest stay AI-only (returned as aiOnly, written to coach_marks.meta.ai_only).
 */
function selectDoubtful(entries) {
  const all = [];
  entries.forEach((e) => candidates(e).forEach((c) => all.push({ ...c, entry: e })));
  const doubtful = all.map((c, seq) => ({ ...c, seq })).filter(isDoubtful);
  let asked = doubtful;
  let aiOnly = [];
  if (doubtful.length > MAX_ITEMS) {
    const byConf = [...doubtful].sort((a, b) => clamp01(a.mark.confidence) - clamp01(b.mark.confidence) || a.seq - b.seq);
    const keep = new Set(byConf.slice(0, MAX_ITEMS).map((c) => c.seq));
    asked = doubtful.filter((c) => keep.has(c.seq));
    aiOnly = doubtful.filter((c) => !keep.has(c.seq));
  }
  return { all, items: asked, aiOnly };
}

const publicItem = ({ entry, mark, seq, ...rest }) => ({ ...rest, verdict: mark.verdict, heard: mark.heard == null ? '' : String(mark.heard), confidence: mark.confidence });

// ── words for the coach ───────────────────────────────────────────────────────────────────────

const nameFor = (lang, child) => childName(lang, child) || childLabel(lang, child);
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : '—');

function readingPart(lang, block, ai) {
  const B = blockName(lang, block);
  if (!ai) return t(lang, 'childTestSumNotScored', { block: B });
  const fb = ai.fallback;
  if (questionsSkipped(ai)) {
    const l = fb.letters || {};
    const w = fb.words || {};
    return t(lang, 'childTestSumLetters', { block: B, letters: num(l.correct), lof: num(l.of ?? 10), words: num(w.correct), wof: num(w.of ?? 10) });
  }
  const parts = [];
  const s = ai.story;
  if (s && Number.isFinite(Number(s.words_correct)) && s.words_correct !== null) {
    const secs = Number(s.seconds);
    const wpm = secs > 0 && secs < 60 ? (Number(s.words_correct) * 60) / secs : Number(s.words_correct);
    parts.push(t(lang, 'childTestSumWords', { block: B, wpm: Math.round(wpm) }));
  } else parts.push(t(lang, 'childTestSumStoryNotScored', { block: B }));
  const qs = Array.isArray(ai.questions) ? ai.questions : [];
  if (qs.length) parts.push(t(lang, 'childTestSumAnswers', { right: qs.filter((q) => q.verdict === 'correct').length, of: qs.length }));
  return parts.join(lang === 'en' ? ', ' : '، ');
}

function mathsPart(lang, ai) {
  const B = blockName(lang, 'maths');
  const m = ai && ai.maths;
  let marks = [];
  if (m && m.oral) marks = ORAL.flatMap(([g]) => (Array.isArray(m.oral[g]) ? m.oral[g] : []));
  else if (m) marks = [...(m.numbers || []), ...(m.written || []), ...(m.word_problem ? [m.word_problem] : [])];
  if (!marks.length) return t(lang, 'childTestSumNotScored', { block: B });
  return t(lang, 'childTestSumMaths', { block: B, right: marks.filter((x) => x && x.verdict === 'correct').length, of: marks.length });
}

function summaryLine(lang, entry) {
  const ai = (b) => (entry.blocks[b] && entry.blocks[b].ai_marks) || null;
  const parts = [readingPart(lang, 'urdu', ai('urdu')), readingPart(lang, 'english', ai('english')), mathsPart(lang, ai('maths'))];
  return t(lang, 'childTestSumLine', { child: childLabel(lang, entry.child), parts: parts.join(' · ') });
}

function summaryText(lang, entries) {
  if (!entries.length) return t(lang, 'childTestSumNone');
  return entries.map((e) => summaryLine(lang, e)).join('\n');
}

function partOf(lang, c) {
  if (c.kind === 'question') return t(lang, 'childTestReviewPartQuestion', { block: blockName(lang, c.block), n: c.number });
  if (c.kind === 'compare') return t(lang, 'childTestReviewPartCompare', { n: COMPARE_LABELS[c.number - 1] || c.number });
  if (c.kind === 'sum') return t(lang, 'childTestReviewPartSum', { n: c.number });
  return t(lang, 'childTestReviewPartWordProblem', { n: c.number });
}

/** The question or problem as the coach asked it: from the item bank, else what the mark carries. */
function itemText(lang, c) {
  const form = c.entry && c.entry.items;
  const find = (list) => (Array.isArray(list) ? list.find((x) => x && x.id === c.itemId) : null);
  let item = null;
  if (c.kind === 'question') item = find(form && form[c.block] && form[c.block].questions);
  else item = find(form && form.maths && form.maths.oral && form.maths.oral[c.group]);
  const src = item || c.mark;
  let text = null;
  if (c.kind === 'compare' && src.a != null && src.b != null) text = t(lang, 'childTestReviewCompareText', { a: src.a, b: src.b });
  else if (c.kind === 'word_problem') text = (lang === 'en' ? src.prompt_en : src.prompt_ur) || src.prompt || null;
  else text = src.prompt || null;
  return text ? clip(text, 600) : t(lang, 'childTestReviewNoText');
}

function heardLine(lang, c) {
  const h = String(c.mark.heard == null ? '' : c.mark.heard).replace(/\s+/g, ' ').trim();
  if (!h) return t(lang, 'childTestReviewHeardNothing');
  return clip(t(lang, 'childTestReviewHeard', { heard: clip(h, 240) }), 300);
}

/** The REVIEW screen's data: every slot supplied (navigate mode has no endpoint to fill the rest). */
function reviewScreenData(lang, items, ref) {
  const data = {
    heading: t(lang, 'childTestReviewHeading'),
    intro: t(lang, 'childTestReviewIntro'),
    t_mark: t(lang, 'childTestReviewMark'),
    save: t(lang, 'childTestReviewSave'),
    verdicts: [
      { id: 'correct', title: t(lang, 'childTestReviewRight') },
      { id: 'wrong', title: t(lang, 'childTestReviewWrong') },
      { id: 'none', title: t(lang, 'childTestReviewNone') },
    ],
    review_ref: ref,
  };
  for (let i = 1; i <= MAX_ITEMS; i += 1) {
    const c = items[i - 1];
    data[`i${i}_v`] = Boolean(c);
    data[`i${i}_who`] = c ? clip(t(lang, 'childTestReviewWho', { child: nameFor(lang, c.entry.child), part: partOf(lang, c) }), 80) : '—';
    data[`i${i}_q`] = c ? itemText(lang, c) : '—';
    data[`i${i}_h`] = c ? heardLine(lang, c) : '—';
    data[`i${i}_k`] = c ? c.key : '';
  }
  return data;
}

/** "about a minute" up to 10 items, then "about 2 minutes" (whole minutes, rounded up). */
function reviewTime(lang, n) {
  const minutes = Math.max(1, Math.ceil((Number(n) * SECONDS_PER_ITEM) / 60));
  return minutes === 1 ? t(lang, 'childTestReviewTimeMinute') : t(lang, 'childTestReviewTimeMinutes', { m: minutes });
}

function reviewMessage(lang, n, summary, intro) {
  const header = clip(n === 1 ? t(lang, 'childTestReviewHeaderOne') : t(lang, 'childTestReviewHeader', { n }), 60);
  const tail = t(lang, 'childTestReviewAsk', { n, time: reviewTime(lang, n) });
  const head = [intro, t(lang, 'childTestReviewResults'), summary].filter(Boolean).join('\n');
  const room = 1024 - [...tail].length - 2;
  return { header, body: `${clip(head, room)}\n\n${tail}` };
}

module.exports = {
  BLOCKS, READING, ORAL, VERDICTS, MAX_ITEMS, ORAL_DEFAULT_BAR, SECONDS_PER_ITEM, langOf,
  questionsSkipped, reviewTime, candidates, isDoubtful, selectDoubtful, publicItem, summaryText, reviewScreenData, reviewMessage,
};
