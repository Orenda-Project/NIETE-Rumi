'use strict';
/**
 * A finished paper's own questions, for the portal's paper page (bd-fmf24g.31).
 *
 * Reads the same tree the PDF and the editor read (assessment_papers.exam_json) and walks it with the
 * renderer's own collectQuestions, so the numbers, the skipped (removed) questions and the type groups
 * agree with the printed paper. Holds no rule of its own and sends nothing. Looking at a paper is not
 * editing it, so it is NOT behind the editing switch; ownership is checked in the query (loadVersion).
 * The model answers never leave: the answer key is its own document.
 */
const Revision = require('./assessment-revision.service');
const Renderer = require('./assessment-paper.renderer');
const Selection = require('./assessment-selection');

const text = (v) => String(v ?? '').trim();
const list = (v) => (Array.isArray(v) ? v.map((x) => text(x)).filter(Boolean) : []);

function sub(s, i) {
  const o = typeof s === 'string' ? { question: s } : (s || {});
  return {
    letter: String.fromCharCode(97 + i), text: text(o.question), marks: Number(o.marks) || null, options: list(o.options),
  };
}

function viewQuestion(question, number) {
  if (typeof question === 'string') return { number, shape: 'standard', text: text(question), marks: null };
  const base = { number, text: text(question.question), marks: Selection.marksOf(question) || null };
  if (list(question.options).length) return { ...base, shape: 'options', options: list(question.options) };
  if (question.column_a || question.column_b) {
    const a = question.column_a || [];
    const b = question.column_b || [];
    const pairs = [];
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) pairs.push({ left: text(a[i]), right: text(b[i]) });
    return { ...base, shape: 'columns', pairs };
  }
  if (list(question.words).length) return { ...base, shape: 'words', words: list(question.words) };
  if (question.passage && Array.isArray(question.questions)) {
    return { ...base, shape: 'comprehension', passage: String(question.passage), subs: question.questions.map(sub) };
  }
  if (question.passage) return { ...base, shape: 'passage', passage: String(question.passage) };
  return { ...base, shape: 'standard' };
}

/** Sections, one per run of one question type (as the PDF groups them), numbered straight through. */
function buildPaperView(examJson) {
  const sections = [];
  let number = 1;
  let lastType = null;
  let lastMain = null;
  let current = null;
  for (const { type, question } of Renderer.collectQuestions(examJson)) {
    if (!current || type !== lastType) {
      const generic = !type || Renderer.GENERIC_TYPES.has(String(type).trim().toLowerCase());
      current = { heading: generic ? null : String(type), lead: null, questions: [] };
      sections.push(current);
      lastType = type;
      lastMain = null;
    }
    const main = question && question.main_question;
    if (main && main !== lastMain) {
      // A new shared instruction mid-group starts its own group so the lead sits above its questions.
      if (current.questions.length) {
        current = { heading: null, lead: text(main), questions: [] };
        sections.push(current);
      } else {
        current.lead = text(main);
      }
      lastMain = main;
    }
    current.questions.push(viewQuestion(question, number));
    number += 1;
  }
  return sections;
}

async function view({ userId, paperId }) {
  const loaded = await Revision.loadVersion({ paperId, userId });
  if (!loaded.paper) return { code: loaded.code };
  const p = loaded.paper;
  const req = p.assessment_requests || {};
  const grade = String(req.grade_code || '').match(/(\d+)/);
  const active = Renderer.collectQuestions(p.exam_json);
  return {
    paper: {
      paperId, version: await Revision.versionNumberOf(p), grade: grade ? Number(grade[1]) : null,
      subject: req.subject_code, chapterNumber: req.chapter_number ?? null, rtl: Renderer.isRtl(req.subject_code),
      questionCount: active.length, marks: Renderer.totalMarks(active),
    },
    sections: buildPaperView(p.exam_json),
  };
}

module.exports = { view, buildPaperView };
