'use strict';
// Test support (fictional data only): builds small board-mode papers for the board-checks tests.
// Covered by walk.test.js (it builds every paper there).

// A complete item tag (item-tag.schema.json) so tag-complete passes a clean paper; fictional codes.
const tag = () => ({ chapter: 1, section: null, code: 'g9.maths.ch1.lo1', page: 1, official_slo: null, blooms: 'U', difficulty: 'easy' });

const mcq = (id, slot, key, opts, extra = {}) => ({
  id, slot, type: 'mcq', kind: null, main_question: 'Choose the correct option',
  question: `Question ${id}?`, options: opts || ['A) 1', 'B) 2', 'C) 3', 'D) 4'],
  marks: 1, answer: key, tag: tag(), ...extra,
});

const srq = (id, slot, marks, extra = {}) => ({
  id, slot, type: 'srq', kind: 'open', question: `Explain ${id}.`, marks, answer: 'x', tag: tag(), ...extra,
});

const row = (slot, o = {}) => ({
  slot, label: slot, type: 'mcq', attempt: 1, printed: 1, marks_each: 1, or: null, stimulus: null, ...o,
});

/** sections: [{id, marks, time_min?, slots:[row...]}] ; items: flat list placed under objective/subjective. */
function paper({ sections, items, total_marks, objective = ['mcq', 'scenario'] }) {
  const tree = { objective: {}, subjective: {} };
  for (const it of items) {
    const bucket = objective.includes(it.type) ? tree.objective : tree.subjective;
    (bucket[it.type] = bucket[it.type] || []).push(it);
  }
  const total = total_marks != null ? total_marks : sections.reduce((a, s) => a + s.marks, 0);
  return {
    unseen: tree,
    _layout: {
      profile: 'board', total_marks: total,
      sections: sections.map((s) => ({ time_min: null, answer_on: 'question_paper', parts: null, ...s })),
    },
  };
}

const ctxBoard = (extra = {}) => ({
  mode: 'board', P: null, subjectConfig: { code: 'maths' }, variant: { scheme_style: 'analytic_points', sections: [] }, ...extra,
});

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
};

module.exports = { tag, mcq, srq, row, paper, ctxBoard, deepFreeze };
