'use strict';
/**
 * A do-as-directed item on a Grade 3–4 paper prints its task (bd-5jmnfj.33.2).
 * v30 G4 English Q2 printed "A ___ of birds sat on the wire." under "Do as directed." with the
 * task ("Fill in the blank with the correct collective noun.") only in main_question, which the
 * renderer never prints. When every live item of such a slot carries one task, the slot's
 * instruction becomes that task; otherwise each item's task is written after its stem in
 * brackets. Grade 5 papers (g5_rules not false) and slots that offer a choice are untouched.
 *
 * Pure: returns a new paper and the notes; never throws.
 */

const DIRECTED = /do as directed|ہدایت کے مطابق/i;
const END = /[.۔]\s*$/;

const bare = (s) => String(s ?? '').trim().replace(END, '').trim();
const same = (a, b) => bare(a).toLowerCase() === bare(b).toLowerCase();

/** Live items of one slot, in paper order, under seen/unseen → category → type → [items]. */
function itemsOf(paper, slotId) {
  const out = [];
  ['seen', 'unseen'].forEach((part) => {
    const cats = paper[part];
    if (!cats || typeof cats !== 'object') return;
    Object.values(cats).forEach((types) => {
      if (!types || typeof types !== 'object') return;
      Object.values(types).forEach((list) => {
        if (!Array.isArray(list)) return;
        list.forEach((q) => { if (q && typeof q === 'object' && q.slot === slotId && q.removed !== true) out.push(q); });
      });
    });
  });
  return out;
}

/** The task an item carries: a main_question that is not the slot's own instruction. */
function taskOf(q, instruction) {
  const t = typeof q.main_question === 'string' ? q.main_question.trim() : '';
  return t && !same(t, instruction) ? t : null;
}

function langOf(slot) {
  if (DIRECTED.test(String(slot.instruction_en ?? ''))) return 'en';
  if (DIRECTED.test(String(slot.instruction_ur ?? ''))) return 'ur';
  return null;
}

function fixSlot(paper, slot, notes) {
  const lang = langOf(slot);
  if (!lang) return;
  const key = `instruction_${lang}`;
  const live = itemsOf(paper, slot.slot);
  if (!live.length) return;
  const tasks = live.map((q) => taskOf(q, slot[key]));
  if (tasks.every(Boolean) && tasks.every((t) => same(t, tasks[0]))) {
    slot[key] = tasks[0];
    notes.push({ slot: slot.slot, kind: 'instruction', task: tasks[0] });
    return;
  }
  live.forEach((q, n) => {
    const task = tasks[n];
    if (!task) return;
    const stem = String(q.question ?? '');
    if (stem.toLowerCase().includes(bare(task).toLowerCase())) return;
    q.question = `${stem.trim()} (${bare(task)})`;
    notes.push({ slot: slot.slot, n, kind: 'item', task });
  });
}

/**
 * directedTasks(examJson, P) → { examJson, notes }. Notes: { slot, kind: 'instruction', task }
 * when the slot instruction took the task; { slot, n, kind: 'item', task } per rewritten stem.
 */
function directedTasks(examJson, P) {
  try {
    if (!P || P.g5_rules !== false || !examJson || typeof examJson !== 'object') return { examJson, notes: [] };
    const out = JSON.parse(JSON.stringify(examJson));
    const notes = [];
    const sections = out._layout && Array.isArray(out._layout.sections) ? out._layout.sections : [];
    sections.forEach((section) => {
      if (!section || !Array.isArray(section.slots)) return;
      section.slots.forEach((slot) => {
        if (slot && typeof slot === 'object' && slot.or !== true) fixSlot(out, slot, notes);
      });
    });
    return { examJson: out, notes };
  } catch (_) {
    return { examJson, notes: [] };
  }
}

module.exports = { directedTasks };
