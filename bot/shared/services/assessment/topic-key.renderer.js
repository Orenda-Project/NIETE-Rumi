'use strict';
/**
 * The topic paper's answer-key extras: which topic each question belongs to, and the one-line-per-topic
 * summary ("Rhyming words: Q1-3, 3 marks"). Questions carry an SLO code, not a topic name, so a question's
 * topic is the first ticked topic (in topic order) that lists its code. No match goes under "Other".
 * Pure: no I/O.
 */
const OTHER = 'Other';

/** Ticked topics, in order, rebuilt from a job's scope. Undefined for a chapter job. */
function topicsFromScope(scope) {
  if (!scope || scope.kind !== 'topics') return undefined;
  const byId = new Map();
  for (const s of scope.slos || []) {
    if (!byId.has(s.topicId)) byId.set(s.topicId, { topicId: s.topicId, name: s.topicName, sloCodes: [] });
    const t = byId.get(s.topicId);
    if (!t.sloCodes.includes(s.code)) t.sloCodes.push(s.code);
  }
  return (scope.topicIds || []).filter((id) => byId.has(id)).map((id) => byId.get(id));
}

/** Index of the first topic whose codes include the question's slo, or -1. */
function topicIndex(question, topics) {
  const slo = question && typeof question === 'object' ? question.slo : null;
  if (!slo) return -1;
  return topics.findIndex((t) => (t.sloCodes || []).includes(slo));
}

/** [1,2,3,5] -> "1-3, 5" */
function runs(numbers) {
  const out = [];
  for (let i = 0; i < numbers.length;) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j += 1;
    out.push(j > i ? `${numbers[i]}-${numbers[j]}` : `${numbers[i]}`);
    i = j + 1;
  }
  return out.join(', ');
}

/** `questions` is collectQuestions' output, in paper order; numbers match the key's. */
function renderTopicSummary({ questions, topics }) {
  const { esc, questionMarks } = require('./assessment-paper.renderer');
  const groups = topics.map((t) => ({ name: t.name, nums: [], marks: 0 }));
  const other = { name: OTHER, nums: [], marks: 0 };
  questions.forEach(({ question }, i) => {
    const idx = topicIndex(question, topics);
    const g = idx >= 0 ? groups[idx] : other;
    g.nums.push(i + 1);
    g.marks += questionMarks(question);
  });
  const lines = (other.nums.length ? [...groups, other] : groups).map((g) => {
    const where = g.nums.length ? `Q${runs(g.nums)}` : 'no questions';
    return `<div class="ts-line">${esc(g.name)}: ${where}, ${g.marks} ${g.marks === 1 ? 'mark' : 'marks'}</div>`;
  });
  return `<div class="topic-summary"><b>By topic</b>${lines.join('')}</div>`;
}

module.exports = { renderTopicSummary, topicsFromScope, topicIndex, OTHER };
