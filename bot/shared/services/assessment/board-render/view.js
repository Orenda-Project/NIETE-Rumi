'use strict';
/**
 * A G9-12 board paper for the portal's paper page (bd-5jmnfj.38.25.5): the same entries shape the FDE view
 * returns ({slot, heading, lead, questions}), read from the board layout's flat slots[]. Numbers restart per slot,
 * as the printed paper numbers them; a new stimulus starts its own entry led by its passage. Never reads an
 * item's key, answer, scheme or tag. Pure, no I/O.
 */
const { layoutOf, itemsBySlot, slotsOf, langOf } = require('./layout');
const { WORDS } = require('./items');
const { fmtMarks } = require('./text');
const Print = require('./print');

// ur: needs fluent-Urdu review (design_pending)
const MARKS = { en: 'marks', ur: 'نمبر' };
const OR_LEAD = { en: '(answer one: OR)', ur: '(ایک کا جواب دیں: یا)' };

function boardLayout(examJson) {
  const L = layoutOf(examJson);
  if (L.profile !== 'board') layoutOf(null);
  return L;
}

const join = (parts, sep = ' ') => parts.filter(Boolean).join(sep) || null;

function heading(sec, lang) {
  const w = WORDS[lang];
  const time = sec.time_min == null ? null : `${sec.time_min} ${w.min}`;
  return join([`${w.section} ${sec.id}`, time, `${fmtMarks(sec.marks)} ${MARKS[lang]}`], ' · ');
}

function question(q, number, slot) {
  const marks = Number(q.marks) || slot.marks_each || null;
  const base = { number, shape: 'standard', text: String(q.question ?? '').trim(), marks };
  const options = Array.isArray(q.options) ? q.options.map((o) => String(o ?? '').trim()).filter(Boolean) : [];
  return options.length ? { ...base, shape: 'options', options } : base;
}

function slotLead(slot, lang) {
  const label = (lang === 'ur' && slot.label_ur) || slot.label;
  if (slot.teacher_marked) {
    const p = slot.project || {};
    return join([label, p[`instruction_${lang}`] || p.instruction_en]);
  }
  if (slot.or) return join([label, OR_LEAD[lang]]);
  return join([label, slot.attempt < slot.printed ? WORDS[lang].any(slot.attempt) : null]);
}

function slotEntries(slot, items, lang, head) {
  const first = { slot: slot.slot, heading: head, lead: slotLead(slot, lang), questions: [] };
  if (slot.teacher_marked) return [first];
  const out = [first];
  let current = first;
  let lastStim = null;
  items.forEach((q, i) => {
    const stim = q.stimulus && q.stimulus.id !== lastStim ? q.stimulus : null;
    if (stim) {
      lastStim = stim.id;
      const text = String(stim.text ?? '').trim();
      if (current.questions.length) {
        current = { slot: slot.slot, heading: null, lead: text || null, questions: [] };
        out.push(current);
      } else {
        current.lead = join([current.lead, text], '\n');
      }
    }
    current.questions.push(question(q, i + 1, slot));
  });
  return out;
}

function sections(examJson) {
  const L = boardLayout(examJson);
  const lang = langOf(L);
  const by = itemsBySlot(examJson);
  const out = [];
  for (const sec of L.sections) {
    slotsOf(L, sec.id).forEach((slot, i) => {
      out.push(...slotEntries(slot, by.get(slot.slot) || [], lang, i === 0 ? heading(sec, lang) : null));
    });
  }
  return out;
}

/** The paper-level fields the FDE view sets: the board total (quarters kept), pages, no FDE-only extras. */
function paperFields(examJson) {
  const L = boardLayout(examJson);
  const total = Print.totalMarks(examJson);
  return { pattern: L.preset_id || null, totalMarks: total, marks: total, pages: L.pages || null, youAdd: null };
}

module.exports = { sections, paperFields };
