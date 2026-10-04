'use strict';

/**
 * Child test v3 — the end-of-visit results and review for the full battery (bd-s1oo0.50.5, CONTRACT §21.6).
 * The pure half: no reads or writes, so tests and the Flow generator build from the same code review.js sends.
 *
 * A v3 visit stores one child_test_blocks row per task (block = task id, tasks.js), each with ai-marks-v3
 * (§21.5). From those rows:
 *
 *   summaryLines / summaryMessages   per child, one line per block (Urdu / English / Maths), one part per task:
 *                                    timed tasks as a rate "/min", untimed as "x/of", the story with the §20
 *                                    "answers r of a asked"; provisional tasks marked "≈", skipped tasks
 *                                    "skipped", gap tasks left out. Messages split between children under
 *                                    WhatsApp's 4096 code points.
 *   candidates / pages               every item in a row's review[] (L37 puts there what the AI could not settle;
 *                                    provisional tasks never go to the coach, R8 §4), grouped child → task in
 *                                    visit order, packed into pages of whole tasks, at most 15 slots each (the v2
 *                                    REVIEW screen). A task with more than 15 keeps its 15 least sure; the rest
 *                                    stay AI-only.
 *   coachMarksForTask                coach_marks in the coach-marks-v2 shape, generalised to a task: ai_marks with
 *                                    the reviewed verdicts replaced and the task's score recomputed from them.
 *
 * Assumed of §21.5 (lanes/L39/CHANGE_REQUEST.md): items[].i is the 0-based position in the printed items
 * (spec.items; spec.questions for listening); review[] names items by i, and story questions by their id.
 * Names go to the coach's WhatsApp only, never into a log line.
 */

const T = require('../tasks');
const { t, clip, digits, blockName } = require('../conversation/copy');
const { childLabel, childName } = require('../conversation/identity');

const VERDICTS = ['correct', 'wrong', 'none'];
const PAGE_SLOTS = 15;
const TEXT_CAP = 4096;
const COUNTED = (q) => !(q && q.reached === false) && !(q && q.asked === false);

const KIND_KEY = {
  listening: 'Listening', letters: 'Letters', nonwords: 'Nonwords', words: 'Words', story: 'Story',
  number_id: 'NumberId', discrimination: 'Discrimination', missing: 'Missing', add1: 'Add1', sub1: 'Sub1',
  add2: 'Add2', sub2: 'Sub2', word_problems: 'WordProblems',
};
const OP = { add1: '+', add2: '+', sub1: '−', sub2: '−' };

const isV3Row = (row) => Boolean(row && T.isTask(row.block));
const isV3Entry = (entry) => Object.keys((entry && entry.blocks) || {}).some((b) => T.isTask(b));
const taskLabel = (lang, task) => t(lang, `childTestL39Task${KIND_KEY[T.kindOf(task)]}`);
const partLabel = (lang, task) => t(lang, 'childTestL39Part', { block: blockName(lang, T.blockOf(task)), task: t(lang, `childTestL39Name${KIND_KEY[T.kindOf(task)]}`) });
const isNum = (v) => v !== null && v !== '' && Number.isFinite(Number(v));
const confOf = (m) => Number(m && (m.conf != null ? m.conf : m.confidence)) || 0;
const nameFor = (lang, child) => childName(lang, child) || childLabel(lang, child);

/** The task's row is a gap (no official item, §21.3) or was never given: it has no place in the results. */
const isGap = (ai, spec) => Boolean((ai && ai.gap) || (spec && spec.gap));

// ── results ───────────────────────────────────────────────────────────────────────────────────

function storyPart(lang, ai, rate, approx) {
  const head = t(lang, approx ? 'childTestL39RateApprox' : 'childTestL39Rate', { task: taskLabel(lang, ai.task), rate });
  const qs = Array.isArray(ai.comprehension) ? ai.comprehension : [];
  if (!qs.length) return head;
  const asked = qs.filter(COUNTED);
  const notReached = qs.filter((q) => q && q.reached === false).length;
  let tail = asked.length
    ? t(lang, 'childTestSumAnswersAsked', { right: asked.filter((q) => q.verdict === 'correct').length, asked: asked.length })
    : t(lang, 'childTestSumNoneAsked');
  if (notReached) tail = `${tail} ${t(lang, 'childTestSumNotReached', { n: notReached })}`;
  return `${head}${lang === 'en' ? ', ' : '، '}${tail}`;
}

/** One task's part of a block line, or null when the task has no place in the results (gap, never recorded). */
function taskPart(lang, task, row, spec) {
  const ai = (row && row.ai_marks) || null;
  if (isGap(ai, spec)) return null;
  if (!row) return null;
  const label = taskLabel(lang, task);
  if (!ai) return t(lang, 'childTestL39NotScored', { task: label });
  if (ai.skipped_by_coach) return t(lang, 'childTestL39Skipped', { task: label });
  const approx = ai.quality === 'provisional';
  if (ai.timed) {
    if (!isNum(ai.timed.rate)) return t(lang, 'childTestL39NotScored', { task: label });
    const rate = Math.round(Number(ai.timed.rate));
    if (T.kindOf(task) === 'story') return storyPart(lang, ai, rate, approx);
    return t(lang, approx ? 'childTestL39RateApprox' : 'childTestL39Rate', { task: label, rate });
  }
  const s = ai.score;
  if (s && isNum(s.correct) && isNum(s.of)) {
    return t(lang, approx ? 'childTestL39ScoreApprox' : 'childTestL39Score', { task: label, right: Number(s.correct), of: Number(s.of) });
  }
  return t(lang, 'childTestL39NotScored', { task: label });
}

/** "*Ayesha Khan*" then "Urdu: …", "English: …", "Maths: …" — the blocks with at least one part. */
function childLines(lang, entry, specFor = () => null) {
  const out = [t(lang, 'childTestL39SumChild', { child: childLabel(lang, entry.child) })];
  for (const block of ['urdu', 'english', 'maths']) {
    const parts = T.tasksOfBlock(block)
      .map((task) => taskPart(lang, task, entry.blocks[task] || null, specFor(entry, task)))
      .filter(Boolean);
    if (parts.length) out.push(t(lang, 'childTestL39SumBlock', { block: blockName(lang, block), parts: parts.join(' · ') }));
  }
  return out;
}

/** The results as WhatsApp text messages: children packed in order, never split inside a child, each ≤ 4096. */
function summaryMessages(lang, entries, specFor) {
  if (!entries.length) return [t(lang, 'childTestSumNone')];
  const msgs = [];
  let cur = '';
  for (const e of entries) {
    const block = clip(childLines(lang, e, specFor).join('\n'), TEXT_CAP);
    const joined = cur ? `${cur}\n${block}` : block;
    if (cur && [...joined].length > TEXT_CAP) { msgs.push(cur); cur = block; } else cur = joined;
  }
  if (cur) msgs.push(cur);
  return msgs;
}

const summaryText = (lang, entries, specFor) => summaryMessages(lang, entries, specFor).join('\n');

// ── what the coach is asked ───────────────────────────────────────────────────────────────────

/**
 * Every review[] item of one child's v3 rows, in task order. Provisional tasks are never reviewed (R8 §4);
 * a row the coach skipped has nothing to review.
 */
function candidates(entry, specFor = () => null) {
  const sid = entry.session.id;
  const out = [];
  for (const task of T.TASKS_V3) {
    const row = entry.blocks[task];
    const ai = row && row.ai_marks;
    if (!ai || ai.skipped_by_coach || ai.quality === 'provisional' || !Array.isArray(ai.review)) continue;
    const items = Array.isArray(ai.items) ? ai.items : [];
    const comp = Array.isArray(ai.comprehension) ? ai.comprehension : [];
    const seen = new Set();
    for (const ref of ai.review) {
      let c = null;
      if (typeof ref === 'string' && comp.length) {
        const k = comp.findIndex((q) => q && q.id === ref);
        if (k >= 0 && COUNTED(comp[k])) {
          c = { field: 'comprehension', itemId: ref, number: k + 1, mark: comp[k], path: `comprehension[${ref}].verdict` };
        }
      } else if (isNum(ref)) {
        const mark = items.find((x) => x && Number(x.i) === Number(ref));
        if (mark && mark.verdict !== 'not_reached') {
          c = { field: 'items', itemId: `i${mark.i}`, number: Number(mark.i) + 1, mark, path: `items[${mark.i}].verdict` };
        }
      }
      if (!c || seen.has(c.path)) continue;
      seen.add(c.path);
      out.push({ ...c, sessionId: sid, task, block: task, kind: T.kindOf(task), key: [sid, task, c.itemId].join('|'), entry, spec: specFor(entry, task) });
    }
  }
  return out;
}

/** One group per (child, task); a group past 15 keeps its 15 least sure and hands the rest to aiOnly. */
function groups(entries, specFor) {
  const out = [];
  const aiOnly = [];
  for (const e of entries) {
    const byTask = new Map();
    for (const c of candidates(e, specFor)) {
      if (!byTask.has(c.task)) byTask.set(c.task, []);
      byTask.get(c.task).push(c);
    }
    for (const list of byTask.values()) {
      if (list.length <= PAGE_SLOTS) { out.push(list); continue; }
      const order = list.map((c, seq) => ({ c, seq })).sort((a, b) => confOf(a.c.mark) - confOf(b.c.mark) || a.seq - b.seq);
      const keep = new Set(order.slice(0, PAGE_SLOTS).map((x) => x.seq));
      out.push(list.filter((_, seq) => keep.has(seq)));
      aiOnly.push(...list.filter((_, seq) => !keep.has(seq)));
    }
  }
  return { groups: out, aiOnly };
}

/** Pages of whole tasks, ≤ 15 slots each, in visit order. @returns {{pages: object[][], all: object[], aiOnly: object[]}} */
function paginate(entries, specFor) {
  const g = groups(entries, specFor);
  const pages = [];
  let cur = [];
  for (const list of g.groups) {
    if (cur.length && cur.length + list.length > PAGE_SLOTS) { pages.push(cur); cur = []; }
    cur.push(...list);
  }
  if (cur.length) pages.push(cur);
  return { pages, all: pages.flat(), aiOnly: g.aiOnly };
}

// ── the item as the child saw it ──────────────────────────────────────────────────────────────

function printedItem(c) {
  const spec = c.spec;
  if (c.field === 'comprehension') {
    const qs = spec && Array.isArray(spec.questions) ? spec.questions : [];
    return qs.find((q) => q && q.id === c.itemId) || c.mark;
  }
  const i = Number(c.mark.i);
  const list = c.kind === 'listening' ? spec && spec.questions : spec && spec.items;
  const fromBank = Array.isArray(list) ? list[i] : null;
  if (fromBank != null) return fromBank;
  if (c.kind === 'listening' && Array.isArray(spec && spec.questions)) {
    const q = spec.questions.find((x) => x && x.id === c.mark.ref);
    if (q) return q;
  }
  return c.mark.ref;
}

function promptOf(lang, item) {
  if (item == null) return null;
  if (typeof item !== 'object') return String(item);
  if (lang === 'en' && item.prompt_en) return item.prompt_en;
  if (lang !== 'en' && item.prompt_ur) return item.prompt_ur;
  return item.prompt || item.prompt_ur || item.prompt_en || item.text || null;
}

function itemText(lang, c) {
  const item = printedItem(c);
  const n = c.number;
  let text = null;
  const obj = item && typeof item === 'object' ? item : null;
  if (c.field === 'comprehension' || c.kind === 'listening') {
    const p = promptOf(lang, item && obj ? item : null);
    if (p) text = t(lang, 'childTestL39ItemQuestion', { n, text: p });
  } else if (c.kind === 'discrimination' && obj && obj.a != null && obj.b != null) {
    text = t(lang, 'childTestReviewCompareText', { a: obj.a, b: obj.b });
  } else if (OP[c.kind] && obj && obj.a != null && obj.b != null) {
    text = t(lang, 'childTestL39ItemSum', { n, a: obj.a, op: OP[c.kind], b: obj.b });
  } else if (c.kind === 'missing' && obj && Array.isArray(obj.seq)) {
    text = t(lang, 'childTestL39ItemMissing', { seq: digits(lang, obj.seq.map((x) => (x == null ? '_' : x)).join(lang === 'en' ? ', ' : '، ')) });
  } else if (c.kind === 'word_problems') {
    const p = promptOf(lang, item);
    if (p) text = t(lang, 'childTestL39ItemProblem', { n, text: p });
  } else if (c.kind === 'number_id' && item != null && !obj) {
    text = t(lang, 'childTestL39ItemNumber', { n, value: item });
  } else if (item != null && !obj) {
    text = t(lang, 'childTestL39ItemPrinted', { n, value: item });
  }
  return text ? clip(text, 600) : t(lang, 'childTestReviewNoText');
}

function heardLine(lang, c) {
  const h = String(c.mark.heard == null ? '' : c.mark.heard).replace(/\s+/g, ' ').trim();
  if (!h) return t(lang, 'childTestReviewHeardNothing');
  return clip(t(lang, 'childTestReviewHeard', { heard: clip(h, 240) }), 300);
}

/** The REVIEW screen's data for one page (the v2 Flow, unchanged: 15 slots, navigate mode). */
function pageScreenData(lang, items, ref, page, pages) {
  const data = {
    heading: pages > 1 ? t(lang, 'childTestL39ReviewHeading', { p: page, pages }) : t(lang, 'childTestReviewHeading'),
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
  for (let i = 1; i <= PAGE_SLOTS; i += 1) {
    const c = items[i - 1];
    data[`i${i}_v`] = Boolean(c);
    data[`i${i}_who`] = c ? clip(t(lang, 'childTestReviewWho', { child: nameFor(lang, c.entry.child), part: partLabel(lang, c.task) }), 80) : '—';
    data[`i${i}_q`] = c ? itemText(lang, c) : '—';
    data[`i${i}_h`] = c ? heardLine(lang, c) : '—';
    data[`i${i}_k`] = c ? c.key : '';
  }
  return data;
}

// ── coach_marks ───────────────────────────────────────────────────────────────────────────────

/** The task's score from its (reviewed) verdicts: timed correct + rate, untimed correct, the story's questions. */
function rescore(marks) {
  const changed = [];
  const items = Array.isArray(marks.items) ? marks.items : [];
  const correct = items.filter((x) => x && x.verdict === 'correct').length;
  if (marks.timed && T.kindOf(marks.task) !== 'story') {
    if (marks.timed.correct !== correct) {
      const used = 60 - (Number(marks.timed.time_remaining) || 0);
      marks.timed = { ...marks.timed, correct, rate: used > 0 ? (correct / used) * 60 : marks.timed.rate };
      changed.push('timed.correct', 'timed.rate');
    }
  } else if (Array.isArray(marks.comprehension) && marks.comprehension.length) {
    const asked = marks.comprehension.filter(COUNTED);
    const right = asked.filter((q) => q.verdict === 'correct').length;
    if (!marks.score || marks.score.correct !== right) {
      marks.score = { ...(marks.score || {}), correct: right, asked: asked.length };
      changed.push('score.correct');
    }
  } else if (marks.score && items.length && marks.score.correct !== correct) {
    marks.score = { ...marks.score, correct };
    changed.push('score.correct');
  }
  return changed;
}

/**
 * coach_marks for one task row. asked: [{c, verdict}] for this row; aiOnly: candidates past the cap.
 * meta.source 'review' when the coach was asked about this row, 'ai_unreviewed' otherwise.
 */
function coachMarksForTask(task, row, asked, aiOnly) {
  const ai = (row && row.ai_marks) || null;
  if (!ai) {
    return {
      coachMarks: { version: 'coach-marks-v2', task, meta: { source: 'ai_unreviewed', task, no_ai_marks: true, ai_status: (row && row.ai_status) || 'missing', reviewed: [], ai_only: [] } },
      edits: [],
    };
  }
  const marks = JSON.parse(JSON.stringify(ai));
  const edits = [];
  const reviewed = [];
  const unanswered = [];
  for (const { c, verdict } of asked) {
    const list = c.field === 'comprehension' ? marks.comprehension : marks.items;
    const m = Array.isArray(list) ? list.find((x) => (c.field === 'comprehension' ? x.id === c.itemId : `i${x.i}` === c.itemId)) : null;
    if (!m) continue;
    if (!VERDICTS.includes(verdict)) { unanswered.push(c.path); continue; }
    reviewed.push(c.path);
    if (m.verdict !== verdict) edits.push({ path: c.path, ai: m.verdict == null ? null : m.verdict, coach: verdict });
    m.verdict = verdict;
    m.reviewed = true;
  }
  const recomputed = edits.length ? rescore(marks) : [];
  marks.version = 'coach-marks-v2';
  marks.meta = {
    source: asked.length ? 'review' : 'ai_unreviewed',
    task,
    reviewed,
    ai_only: aiOnly.map((c) => c.path),
    ...(unanswered.length ? { unanswered } : {}),
    ...(recomputed.length ? { recomputed } : {}),
    ...(ai.skipped_by_coach ? { skipped_by_coach: true } : {}),
  };
  return { coachMarks: marks, edits };
}

module.exports = {
  PAGE_SLOTS, TEXT_CAP, isV3Row, isV3Entry, taskPart, childLines, summaryMessages, summaryText,
  candidates, paginate, itemText, pageScreenData, coachMarksForTask, rescore,
};
