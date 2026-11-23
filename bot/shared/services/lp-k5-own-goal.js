'use strict';
/**
 * bd-snkn32.57 (queue #154) — "Start from a learning goal or topic" for grades 1–5 (Amena 19 Nov: "it should be for 1-5
 * also pls, remember we are an FLN company first"). The twin of lp612-own-goal for the primary book.
 *
 * WHERE THE GOALS COME FROM. The official grade 1–5 learning outcomes are the NIETE curriculum matrix, already loaded as
 * data in assessment_topics (V1.6.18; one row per topic: chapter, pages, teaching days, SLO codes and their
 * descriptions in the book's language). No new table: the goal list reads those rows (lp612-own-goal.store).
 *
 * WHICH DAY IT IS WRITTEN OVER. As at 6–12, a goal never stands alone: it names the day whose stored plan grounds the
 * facts (19 Nov: all 1,161 ICT topics map to a day; 87% to a day whose own plan carries one of the topic's SLO codes).
 * The matrix's `days` count every row of the book, worksheets and revisions too; a day that is a teaching day of the
 * topic's chapter wins, else the chapter's first teaching day sharing its pages, else the chapter's first teaching day.
 *
 * Pure: no I/O. Rows come out in lp612-own-goal's shape, so outcomeList and matchTopic serve both bands.
 */

/** The catalogue's subject key → the matrix's. Urdu, English and Maths first (early reading and numeracy). */
const MATRIX_SUBJECTS = { urdu: 'urdu', english: 'english', math: 'maths', general_science: 'science' };

const matrixSubject = (subjectKey) => MATRIX_SUBJECTS[subjectKey] || null;

const nums = (a) => (Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : []);

/** The day (a catalogue lesson) an official outcome is written over, or null. */
function dayFor(topic, book) {
  if (!topic || !book || !Array.isArray(book.chapters)) return null;
  const chapter = book.chapters.find((c) => Number(c.number) === Number(topic.chapter_number));
  if (!chapter) return null;
  const teaching = (chapter.lessons || []).filter((l) => l.lp_type === 'content');
  if (!teaching.length) return null;
  const all = book.chapters.flatMap((c) => c.lessons || []);
  for (const d of nums(topic.days)) {
    const hit = all[d - 1];
    if (hit && teaching.includes(hit)) return hit;
  }
  const pages = new Set(nums(topic.pages));
  return teaching.find((l) => nums(l.pages).some((p) => pages.has(p))) || teaching[0];
}

/** An outcome as she reads it: no matrix working note ("[DERIVED …]"), no "I can" lead-in. */
function tidy(text) {
  const t = String(text || '').replace(/\s*\[[^\]]*\]/g, '').replace(/^\s*I can\s+/i, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** The matrix rows as goal rows (lp612-own-goal's shape), in the book's order; a topic with no day is left out. */
function k5GoalRows(topics, book) {
  const all = book && Array.isArray(book.chapters) ? book.chapters.flatMap((c) => c.lessons || []) : [];
  const out = [];
  for (const t of topics || []) {
    const day = dayFor(t, book);
    if (!day) continue;
    out.push({
      segment_id: day.lesson_id,
      chapter_number: Number(t.chapter_number),
      chapter_title: t.chapter_title || (book.chapters.find((c) => Number(c.number) === Number(t.chapter_number)) || {}).title || null,
      order_index: all.indexOf(day) * 1000 + (Number(t.sort_order) || 0),
      menu_title: t.name || null,
      subtopic_title: t.name || null,
      slo_descriptions: (Array.isArray(t.slo_descriptions) ? t.slo_descriptions : []).map(tidy).filter(Boolean),
    });
  }
  return out;
}

/** The request lines a grades 1–5 goal start adds (lp-k5-own.k5Messages): her goal, and a class with no book. */
function k5GoalLines(goal) {
  const what = goal.kind === 'outcome' ? 'learning outcome' : 'topic';
  const text = String(goal.text || '').replace(/["“”]/g, '').trim();
  return [
    `START FROM HER GOAL: teach this day towards her ${what}: "${text}". Every part works towards it.`,
    'Her class has NO TEXTBOOK. Never send the children to a book page or say "open your book". Write into the plan the letters, words, sentences, short passage or sums the children read, say or solve, short enough for her to say aloud, show with objects or write on the board if she has one.',
    'Wherever these rules say the children work or hold up "the book", they use their copies instead.',
    'Use only facts the day\'s plan supports; if her goal goes beyond it, teach the part it supports and say nothing you cannot check.',
  ];
}

module.exports = { MATRIX_SUBJECTS, matrixSubject, dayFor, k5GoalRows, k5GoalLines };
