'use strict';
/**
 * The task line of an item that carries its task in `main_question` (bd-5jmnfj.4.58.2, v26 finding 1).
 * Urdu Q4 (G5): the slot's heading is only «ہدایات کے مطابق حل کریں», and each item's own task
 * («دیے گئے الفاظ کے لیے گروہی لفظ منتخب کریں:») sits in `main_question` while `question` holds the
 * words: v26 printed four bare items. The paper prints the task before the item; an item whose kind
 * cannot be read from either field is never printed (its task would be missing).
 * Pure: item and slot in, text or boolean out.
 */

// Urdu Q4: four kinds, one item each, in FDE's order, with the heading the top-up note names them by.
const Q4_KINDS = [[/گروہی/, 'گروہی الفاظ'], [/شرط|جزا/, 'حروفِ شرط و جزا'], [/مستقبل/, 'فعلِ حال کو فعلِ مستقبل میں تبدیل کریں'], [/ارکان/, 'ارکان سازی']];

const textOf = (q) => `${(q && q.main_question) || ''} ${(q && q.question) || ''}`;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Slots whose items state their task in `main_question`: Urdu Q4's four grammar kinds. */
const carriesTask = (slot) => Boolean(slot) && slot.type === 'Rewrite Sentences'
  && Array.isArray(slot.kinds) && slot.kinds.includes('group_words');

/** The task to print before the item's own text; '' when the slot does not use it or the question has it. */
function taskLine(q, slot) {
  if (!carriesTask(slot) || !q || typeof q.main_question !== 'string') return '';
  const task = norm(q.main_question);
  if (!task || norm(q.question).includes(task)) return '';
  return task;
}

/**
 * True when a Q4 item states its task: its kind reads from heading or stem, or its `main_question`
 * is there to print. Held only when `main_question` is present and blank and no kind reads (a task
 * the paper cannot print). A reply with no `main_question` field at all is not judged: recorded
 * Q4 replies (fixtures/fde/urdu-gen-full.json) state the task inside `question`.
 */
const q4TaskKnown = (q) => !q || typeof q.main_question !== 'string' || norm(q.main_question) !== ''
  || Q4_KINDS.some(([re]) => re.test(textOf(q)));

module.exports = { Q4_KINDS, taskLine, q4TaskKnown, carriesTask };
