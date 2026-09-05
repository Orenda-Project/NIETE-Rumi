'use strict';
/**
 * The eval plan for the assessment generator: which chapters of a book get an
 * exam, and what each exam asks for. Pure functions; the runner
 * (`eval-run.js`) does the fetching, generating and rendering.
 *
 * Two exams per book:
 *   A — the first chapter, asked for the way teachers actually asked on 1 Sep
 *       2026: a mix of seen + unseen, 15 questions, the default type mix
 *       (MCQs / Fill in the Blanks / True-False), answer key on.
 *   B — the middle chapter, new questions only, 20 questions, two objective
 *       types plus one subjective type, so the subjective half of every
 *       subject prompt is exercised too.
 */

const QuestionTypes = require('../../bot/shared/services/assessment/question-types');

function pickChapters(chapters) {
  const list = [...chapters].sort((a, b) => a.n - b.n);
  if (list.length === 0) throw new Error('book has no chapters');
  const A = list[0];
  const B = list[Math.floor(list.length / 2)];
  return { A, B };
}

/** Two objective types (MCQs and True/False when the subject has them) and the
 * first subjective type the catalogue offers this grade. */
function bTypeIds(subject, grade) {
  const all = QuestionTypes.forSubject(subject, grade);
  const objective = all.filter((t) => t.category === 'objective').map((t) => t.id);
  const subjective = all.filter((t) => t.category === 'subjective').map((t) => t.id);
  const preferred = ['MCQs', 'True/False'].filter((id) => objective.includes(id));
  const obj = [...preferred, ...objective.filter((id) => !preferred.includes(id))].slice(0, 2);
  return [...obj, subjective[0]].filter(Boolean);
}

function examSpecs({ grade, subject, chapters }) {
  const { A, B } = pickChapters(chapters);
  return [
    {
      label: 'A',
      chapterNumber: A.n, chapterTitle: A.title, pageStart: A.start, pageEnd: A.end,
      contentSource: 'both',
      questionCount: 15,
      questionTypes: QuestionTypes.defaultMix(subject, grade, 15),
      includeAnswerKey: true,
      answerLines: true,
    },
    {
      label: 'B',
      chapterNumber: B.n, chapterTitle: B.title, pageStart: B.start, pageEnd: B.end,
      contentSource: 'unseen',
      questionCount: 20,
      questionTypes: QuestionTypes.withCounts(bTypeIds(subject, grade), 20, subject, grade),
      includeAnswerKey: true,
      answerLines: true,
    },
  ];
}

/** How many questions of each type came back, per section. A subjective entry
 * is either a list or a map of sub-type to list (Long Question). */
function summariseCounts(examJson) {
  const out = { seen: {}, unseen: {}, seenTotal: 0, unseenTotal: 0, total: 0 };
  for (const section of ['seen', 'unseen']) {
    const branch = examJson?.[section];
    if (!branch || typeof branch !== 'object') continue;
    for (const category of Object.values(branch)) {
      if (!category || typeof category !== 'object') continue;
      for (const [type, entry] of Object.entries(category)) {
        let n = 0;
        if (Array.isArray(entry)) n = entry.filter((q) => q && typeof q === 'object').length;
        else if (entry && typeof entry === 'object') {
          for (const sub of Object.values(entry)) {
            if (Array.isArray(sub)) n += sub.filter((q) => q && typeof q === 'object').length;
          }
        }
        if (n) out[section][type] = (out[section][type] || 0) + n;
      }
    }
    out[`${section}Total`] = Object.values(out[section]).reduce((s, v) => s + v, 0);
  }
  out.total = out.seenTotal + out.unseenTotal;
  return out;
}

module.exports = { pickChapters, examSpecs, summariseCounts, bTypeIds };
