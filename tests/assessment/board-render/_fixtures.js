'use strict';
// Hand-built fictional papers for the board renderers. _layout is built by board-layout.js from the real pattern
// entries (slice 7); every question below is made up.
const { buildLayout } = require('../../../bot/shared/services/assessment/board-layout');
const C = require('../../../bot/shared/services/assessment/patterns/board/chrome');
const ssc1 = require('../../../bot/shared/services/assessment/patterns/board/fbise-ssc1');

const clone = (o) => JSON.parse(JSON.stringify(o));

function layoutOf(key, V, extraSections = []) {
  const variant = { ...clone(V), sections: [...clone(V.sections), ...extraSections.map(clone)] };
  variant.total_marks = variant.sections.reduce((n, s) => n + s.marks, 0);
  return buildLayout(ssc1, variant, { subject: key });
}

function itemsFor(slot, n, style) {
  const mcq = slot.type === 'mcq' || slot.type === 'scenario';
  const out = [];
  for (let i = 0; i < n; i++) {
    const q = {
      slot: slot.slot,
      question: `Fictional question ${slot.slot} #${i + 1}?`,
      tag: { chapter: 1, code: `LO-${i}`, official_slo: `S-09-${i}`, blooms: 'U', difficulty: 'easy' },
    };
    if (mcq) {
      q.options = ['alpha', 'beta', 'gamma', 'delta'];
      q.key = 'B';
      q.answer = 'beta-SECRET';
    } else {
      q.answer = `model-answer-SECRET ${slot.slot} ${i}`;
      q.scheme = style === 'holistic_bands'
        ? { bands: [{ marks: String(slot.marks_each), descriptor: 'Complete answer' }, { marks: '0', descriptor: 'No credit' }] }
        : { points: [{ text: 'point one', marks: slot.marks_each / 2 }, { text: 'point two', marks: slot.marks_each / 2 }] };
    }
    out.push(q);
  }
  return out;
}

function attach(layout) {
  const list = [];
  for (const slot of layout.slots) {
    const n = slot.or ? slot.or.branches.length : slot.generate;
    const its = itemsFor(slot, n, layout.scheme_style);
    if (slot.stimulus) {
      its.forEach((q, i) => {
        const g = Math.floor(i / slot.stimulus.mcqs_per_stimulus);
        q.stimulus = { id: `S${g}`, kind: 'passage', text: `Fictional passage ${g}.` };
      });
    }
    list.push(...its);
  }
  return { seen: { all: { items: list } }, _layout: layout };
}

const D = C.makeSection({
  id: 'D', label_en: 'Section D', time_min: 30, answer_on: 'e_sheet',
  slots: [
    { slot: 'D.Q9', label_en: 'Q9', or: { branches: [{ type: 'erq', marks_each: 6 }, { type: 'erq', marks_each: 6 }] } },
    { slot: 'D.Q10', label_en: 'Q10', type: 'srq', printed: 5, attempt: 3, marks_each: 2 },
    { slot: 'D.Q11', label_en: 'Q11', project: { marks: 4, instruction_en: 'Teacher-marked project work.', instruction_ur: 'استاد کے جانچے جانے والا پروجیکٹ۔' } },
  ],
});
D.parts = [
  { part: 'D1', marks: 12, time_min: 20, handover_note_en: 'Hand in Part D1 now.', handover_note_ur: 'حصہ D1 جمع کرائیں۔' },
  { part: 'D2', marks: 4, time_min: 10, handover_note_en: null, handover_note_ur: null },
];

const { physics, chemistry, urdu } = ssc1.subjects;

module.exports = {
  // 50% English-medium: bubbles on the question paper, stimulus MCQs, fractional marks
  fbise50: () => attach(layoutOf('physics', physics.variants[0])),
  // non-50%: OR, attempt-any, teacher-marked project, timed parts (Section D is added to the variant)
  fbiseNon: () => attach(layoutOf('chemistry', chemistry.variants[1], [D])),
  // Urdu medium, right to left; scheme style overridden to exercise the band table
  urdu: () => attach(layoutOf('urdu', { ...urdu.variants[0], scheme_style: 'holistic_bands' })),
};
