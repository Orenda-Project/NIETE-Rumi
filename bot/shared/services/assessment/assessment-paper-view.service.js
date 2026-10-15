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
const Patterns = require('./patterns');

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

/** The live (not removed) items of each slot, in tree order — the order the paper prints them. */
function itemsBySlot(examJson, L) {
  const bySlot = new Map();
  for (const sec of L.sections) for (const slot of sec.slots) bySlot.set(slot.slot, []);
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((examJson && examJson[branch]) || {})) {
      for (const items of Object.values(types || {})) {
        if (!Array.isArray(items)) continue;
        for (const q of items) if (q && typeof q === 'object' && !q.removed && bySlot.has(q.slot)) bySlot.get(q.slot).push(q);
      }
    }
  }
  return bySlot;
}

/**
 * A board-pattern paper: one section per slot, the section's heading on its first slot, and the
 * slot's instruction with the choice line the PRINTED paper carries (the renderer's choiceLine),
 * so the phone and the paper can never disagree about "any eight of the following eleven".
 * Read in the paper's own medium.
 */
function buildPatternView(examJson) {
  const L = examJson._layout;
  const lang = L.medium === 'ur' ? 'ur' : 'en';
  const FdeRenderer = require('./assessment-paper-fde.renderer');
  const bySlot = itemsBySlot(examJson, L);
  const sections = [];
  let number = 1;
  for (const sec of L.sections) {
    const marks = sec.slots.reduce((sum, slot) => sum + Math.min(slot.attempt, bySlot.get(slot.slot).length) * slot.marks_each, 0);
    const heading = [sec[`label_${lang}`] || sec.label_en, sec[`time_${lang}`] || sec.time_en,
      lang === 'ur' ? `${marks} نمبر` : `${marks} marks`].filter(Boolean).join(' · '); // needs fluent-Urdu review
    sec.slots.forEach((slot, i) => {
      const items = bySlot.get(slot.slot);
      const label = lang === 'ur' ? (slot.label_ur || slot.label_en) : Patterns.shortLabel(slot.label_en);
      const choice = FdeRenderer.choiceLine(slot, items.length, lang).text;
      sections.push({
        slot: slot.slot,
        heading: i === 0 ? heading : null,
        lead: [label, choice].filter(Boolean).join(' ') || null,
        questions: items.map((q) => { const v = viewQuestion(q, number); number += 1; return v; }),
      });
    });
  }
  return sections;
}

/** What the teacher adds by hand (a diagram to label), and the paper page it is on when known. */
function youAddOf(L, subject) {
  const summary = Patterns.summaryFor(L.preset_id, L.subject || subject);
  const add = summary && summary.youAdd;
  if (!add) return null;
  const page = L.frame_pages && Number.isFinite(Number(L.frame_pages[add.slot])) ? Number(L.frame_pages[add.slot]) : null;
  return { en: add.en, ur: add.ur, page };
}

/** Sections, one per run of one question type (as the PDF groups them), numbered straight through. */
function buildPaperView(examJson) {
  if (examJson && examJson._layout && Array.isArray(examJson._layout.sections)) return buildPatternView(examJson);
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
  const paper = {
    paperId, version: await Revision.versionNumberOf(p), grade: grade ? Number(grade[1]) : null,
    subject: req.subject_code, chapterNumber: req.chapter_number ?? null, rtl: Renderer.isRtl(req.subject_code),
    questionCount: active.length, marks: Renderer.totalMarks(active),
  };
  const L = p.exam_json && p.exam_json._layout;
  if (L) {
    // The pattern's total, never the sum of every generated item (a choice slot prints 12 and counts 8).
    const total = require('./assessment-paper-fde.renderer').totalMarks(p.exam_json);
    Object.assign(paper, {
      pattern: L.preset_id, totalMarks: total, marks: total, pages: L.pages || null, youAdd: youAddOf(L, req.subject_code),
    });
  }
  return { paper, sections: buildPaperView(p.exam_json) };
}

module.exports = { view, buildPaperView };
