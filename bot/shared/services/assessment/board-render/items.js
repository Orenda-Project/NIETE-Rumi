'use strict';
/**
 * One section of the child paper: slot heads, "Attempt any N" lines, MCQ rows (with bubbles when the section is
 * answered on the paper), stimulus once above its MCQs, OR between branches, teacher-marked slots (instruction
 * and marks only) and timed parts with the handover line. Prints only question, options and stimulus: never an
 * item's tag, key, answer or scheme.
 *
 * design_pending (SPEC §7 gives no field list): item.stimulus = {id, kind, text}; section.parts walk the slots in
 * order and a part closes when its marks are reached; the "Attempt any N questions." and marks lines are computed
 * from slot.attempt / printed / marks_each (the layout carries no instruction text).
 */
const { textOf, marksText } = require('./text');
const { slotsOf } = require('./layout');
const { noteFor } = require('./header');

const WORDS = {
  en: { section: 'Section', marks: 'Total Marks', min: 'min', part: 'Part', or: 'OR', any: (n) => `Attempt any ${n} questions.` },
  // ur: needs fluent-Urdu review (design_pending)
  ur: { section: 'حصہ', marks: 'کل نمبر', min: 'منٹ', part: 'حصہ', or: 'یا', any: (n) => `کوئی سے ${n} سوال حل کریں۔` },
};
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const isMcq = (slot) => slot.type === 'mcq' || slot.type === 'scenario';
const orWord = (rtl) => WORDS[rtl ? 'ur' : 'en'].or;

/** "(40 × 0.5 = 20)" for an attempt-N slot, "(6)" for a single one, as a raw atom line for marksText. */
function marksLine(slot) {
  const each = slot.project ? slot.project.marks : slot.marks_each;
  return slot.attempt > 1 ? `({n:${slot.attempt}} × ${each} = {t:${slot.marks}})` : `({t:${slot.marks}})`;
}

function mcqRow(q, n, onPaper, rtl) {
  const opts = (q.options || []).map((o, i) => `<span>${LETTERS[i]}. ${textOf(o, rtl)}${onPaper ? ' <span class="bub"></span>' : ''}</span>`).join('');
  return `<div class="q"><span class="qn">${textOf(`${n}.`, rtl)}</span> ${textOf(q.question, rtl)}<div class="opts">${opts}</div></div>`;
}

function plainRow(q, n, rtl) {
  return `<div class="q"><span class="qn">${textOf(`${n}.`, rtl)}</span> ${textOf(q.question, rtl)}</div>`;
}

function itemsHtml(slot, items, onPaper, rtl) {
  const out = [];
  let lastStim = null;
  items.forEach((q, i) => {
    if (slot.or && i > 0) out.push(`<div class="or">${orWord(rtl)}</div>`);
    if (q.stimulus && q.stimulus.id !== lastStim) {
      lastStim = q.stimulus.id;
      out.push(`<div class="stim">${textOf(q.stimulus.text, rtl)}</div>`);
    }
    out.push(isMcq(slot) ? mcqRow(q, i + 1, onPaper, rtl) : plainRow(q, i + 1, rtl));
  });
  return out.join('');
}

function slotHtml(slot, by, sec, ctx) {
  const { rtl, lang } = ctx;
  const w = WORDS[lang];
  const label = (rtl && slot.label_ur) || slot.label;
  if (slot.teacher_marked) {
    const p = slot.project || {};
    const ins = p[`instruction_${lang}`] || p.instruction_en || '';
    return `<div class="teacher-slot"><b>${textOf(label, rtl)}</b> ${textOf(ins, rtl)} <span class="ml">${marksText(marksLine(slot), rtl)}</span></div>`;
  }
  const any = !slot.or && slot.attempt < slot.printed ? `<div class="note">${textOf(w.any(slot.attempt), rtl)}</div>` : '';
  const head = `<div class="slot-head"><span>${textOf(label, rtl)}</span><span class="ml">${marksText(marksLine(slot), rtl)}</span></div>`;
  return head + any + itemsHtml(slot, by.get(slot.slot) || [], sec.answer_on === 'question_paper' && isMcq(slot), rtl);
}

function partHead(part, ctx) {
  const w = WORDS[ctx.lang];
  const time = part.time_min == null ? '' : ` · ${textOf(`${part.time_min} ${w.min}`, ctx.rtl)}`;
  return `<div class="part-head">${w.part} ${textOf(part.part, ctx.rtl)}${time}</div>`;
}

function sectionBlock(layout, sec, by, ctx) {
  const { rtl, lang } = ctx;
  const w = WORDS[lang];
  const parts = sec.parts || [];
  const time = sec.time_min == null ? '' : `<span>${textOf(`${sec.time_min} ${w.min}`, rtl)}</span>`;
  const out = [`<section class="sec"><div class="sec-head"><span>${w.section} ${textOf(sec.id, rtl)}</span>${time}<span>${w.marks}: ${marksText(`{t:${sec.marks}}`, rtl)}</span></div>`];
  const note = noteFor(sec, lang);
  if (note) out.push(`<div class="note">${textOf(note, rtl)}</div>`);
  let acc = 0;
  let pi = 0;
  let open = false;
  for (const slot of slotsOf(layout, sec.id)) {
    if (parts[pi] && !open) { out.push(partHead(parts[pi], ctx)); open = true; }
    out.push(slotHtml(slot, by, sec, ctx));
    acc += Math.round(slot.marks * 4);
    if (parts[pi] && acc >= Math.round(parts[pi].marks * 4)) {
      const hand = parts[pi][`handover_note_${lang}`];
      if (hand) out.push(`<div class="handover">${textOf(hand, rtl)}</div>`);
      acc -= Math.round(parts[pi].marks * 4);
      pi += 1;
      open = false;
    }
  }
  out.push('</section>');
  return out.join('');
}

module.exports = { sectionBlock, orWord, marksLine, WORDS };
