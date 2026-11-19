'use strict';
/**
 * bd-snkn32.56 (queue #134 E) — "Make my own": start from a learning goal or topic, with no textbook in class.
 *
 * WHAT SHE CHOOSES. Her grade+subject's learning outcomes (each a catalogue lesson's own `slo_descriptions`, else its
 * subtopic title) or a topic she types. Grades 6-12 here; grades 1-5 bring the official matrix outcomes as the same
 * rows (lp-k5-own-goal, bd-snkn32.57). Behind portal_lp_own_goal_start (off for everyone but a pilot list).
 *
 * WHY THERE IS STILL A LESSON UNDER IT. A plan with no page to stand on is a plan whose facts nobody checked. So the
 * outcome she picks names its lesson, and her topic is matched to the lesson whose words it shares most (no shared
 * word = no match, never a guess). The rewrite runs over that lesson's pages as every own plan does; what changes is
 * the CLASS has no book: every passage, example and exercise is written into the plan. The reviewer adds a
 * content-accuracy check for these plans (lp612-own-accuracy).
 *
 * Pure: no I/O. The rows come from lp612-own-goal.store.
 */

const TOPIC_MIN = 3;
const TOPIC_MAX = 120;
const KINDS = ['outcome', 'topic'];
const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'about', 'what', 'how', 'why', 'their', 'they', 'this', 'that', 'are',
  'its', 'our', 'your', 'lesson', 'chapter', 'grade', 'class', 'students', 'children', 'learn', 'learning', 'about',
]);

const clean = (s) => String(s || '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();

/** Her goal from the request: { kind: outcome|topic, text } checked and bounded, else a refusal. */
function parseGoal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'goal is required' };
  if (!KINDS.includes(raw.kind)) return { ok: false, error: 'goal.kind is not one of the choices' };
  const text = clean(raw.text).slice(0, TOPIC_MAX);
  if (text.length < TOPIC_MIN) return { ok: false, error: 'goal.text is too short' };
  return { ok: true, goal: { kind: raw.kind, text } };
}

/** A lesson's outcome words: its first slo_description, else its subtopic or menu title. */
function outcomeOf(row) {
  const d = Array.isArray(row.slo_descriptions) ? row.slo_descriptions.find((x) => clean(x)) : null;
  return clean(d || row.subtopic_title || row.menu_title || '');
}

const bookOrder = (a, b) => (a.chapter_number ?? 0) - (b.chapter_number ?? 0) || (a.order_index ?? 0) - (b.order_index ?? 0);

/** One row per outcome, in the book's order, each naming the FIRST lesson that teaches it. */
function outcomeList(rows) {
  const seen = new Set();
  const out = [];
  for (const r of [...(rows || [])].sort(bookOrder)) {
    const text = outcomeOf(r);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    // bd-snkn32.58.1 — grades 1–5 skill rows carry their skill group and SLO code; 6–12 rows are unchanged.
    out.push({ segmentId: r.segment_id, text, chapter: clean(r.chapter_title) || null, ...(r.group ? { group: r.group, code: r.slo_code || null } : {}) });
  }
  return out;
}

// bd-snkn32.57 — grades 1–5 outcomes and topics are often Urdu: any script's letters make a word; Urdu's vowel marks
// (zer, zabar, pesh) are dropped first, so "گَھر" and "گھر" are one word. English words are as before.
const STOP_UR = new Set(['اور', 'میں', 'سکیں', 'سکے', 'کریں', 'کرنا', 'بارے', 'اپنے', 'والے']);
const words = (s) => new Set(clean(s).replace(/\p{M}+/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
  .filter((w) => w.length >= 3 && !STOP.has(w) && !STOP_UR.has(w))
  .map((w) => w.replace(/(?<=\p{L}{3})ing$/u, '').replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : ''))));

/** The lesson her topic shares most words with (outcome, titles, chapter); null when none shares one. */
function matchTopic(topic, rows) {
  const want = words(topic);
  if (!want.size) return null;
  let best = null;
  let bestScore = 0;
  for (const r of [...(rows || [])].sort(bookOrder)) {
    const have = words([outcomeOf(r), r.menu_title, r.subtopic_title, r.chapter_title].join(' '));
    let score = 0;
    for (const w of want) if (have.has(w)) score += 1;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

/** The instruction lines a goal start adds (and the book lines it replaces, lp612-own-instruction). */
function goalLines(goal) {
  const what = goal.kind === 'outcome' ? 'learning outcome' : 'topic';
  return [
    `START FROM HER GOAL: build the whole lesson around her ${what}: "${clean(goal.text)}". Every part works towards it.`,
    'Her class has NO TEXTBOOK. Never send the class to a book page or say "open your book". Write into the plan every passage, example, diagram description and exercise the children need, short enough for her to read aloud or copy on the board.',
    'Use only facts the pages support (the lesson pages you are given are your source, not the class\'s); if her goal goes beyond them, teach the part they support and say nothing you cannot check.',
  ];
}

module.exports = { parseGoal, outcomeList, matchTopic, goalLines, outcomeOf, TOPIC_MAX };
