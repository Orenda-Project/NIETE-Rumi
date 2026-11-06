'use strict';
// The board writer's real tree shape (trimmed from a live G9 FBISE 50% paper; every question is made up):
// passage groups carry their MCQs in stimulus.items and the group's stimulus has no id; every SRQ / ERQ is an
// internal-choice pair in q.or[]; a parts node carries (a)/(b) sub-questions. The layout is the fbise50 fixture's.
const fx = require('./_fixtures');

const tag = { chapter: 2, code: 'P-09-B-01', official_slo: 'P-09-B-01', blooms: 'U', difficulty: 'easy' };
const mcq = (slot, n) => ({
  main_question: 'Choose the correct answer.', question: `Made-up stem ${slot} #${n}?`,
  options: ['A) red cart', 'B) blue cart', 'C) green cart', 'D) grey cart'], answer: 'B) blue cart',
  marks: 0.5, tag, id: `${slot}#${n}`, type: 'mcq',
});
const branch = (id, text, marks, type) => ({
  main_question: 'Answer the following question.', question: text, marks, lines: 4,
  answer: `SECRET model answer for ${id}`,
  scheme: { points: [{ text: `point one of ${id}`, marks: marks / 2 }, { text: `point two of ${id}`, marks: marks / 2 }] },
  tag, id, type,
});
const pair = (slot, n, marks, type) => ({
  or: [branch(`${slot}#${n}/a`, `Made-up ${type} ${n} first choice?`, marks, type), branch(`${slot}#${n}/b`, `Made-up ${type} ${n} second choice?`, marks, type)],
  slot, id: `${slot}#${n}`,
});

function writerShape() {
  const exam = fx.fbise50();
  const groups = [];
  for (let g = 1; g <= 5; g++) {
    const items = [];
    for (let k = 1; k <= 4; k++) items.push({ ...mcq('A.Q41-60', g), question: `Passage ${g} item ${k}: made-up question?`, id: `A.Q41-60#${g}@s${k}`, type: 'scenario' });
    groups.push({ stimulus: { text: `Made-up passage ${g}. A toy cart rolls along a made-up track.`, items }, slot: 'A.Q41-60', id: `A.Q41-60#${g}` });
  }
  const srq = [];
  for (let n = 1; n <= 5; n++) srq.push(pair('B.Q1-6', n, 3, 'srq'));
  srq.push({
    question: 'Made-up parts question 6 lead.', slot: 'B.Q1-6', id: 'B.Q1-6#6',
    parts: [branch('B.Q1-6#6.p1', 'Made-up part (a) stem?', 1, 'srq'), branch('B.Q1-6#6.p2', 'Made-up part (b) stem?', 2, 'srq')],
  });
  return {
    unseen: {
      objective: { mcq: Array.from({ length: 40 }, (_, i) => ({ ...mcq('A.Q1-40', i + 1), slot: 'A.Q1-40' })), scenario: groups },
      subjective: { srq, erq: [pair('C.Q7-8', 1, 6, 'erq'), pair('C.Q7-8', 2, 6, 'erq')] },
    },
    _layout: exam._layout,
  };
}

module.exports = { writerShape };
