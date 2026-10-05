'use strict';
/**
 * The paper editor, for a surface that is not WhatsApp (the portal).
 *
 * Holds no rule of its own: shapes and fields come from assessment-edit, ids and
 * removal from assessment-selection, the changes list from assessment-changes,
 * and the version from assessment-revision's buildVersion — which sends nothing.
 * Gated on the same switch as WhatsApp editing; fail-closed.
 */
const Revision = require('./assessment-revision.service');
const Edit = require('./assessment-edit');
const Selection = require('./assessment-selection');
const { applyChanges } = require('./assessment-changes');
const { isRtl } = require('./assessment-paper.renderer');
const { isAssessmentEditingEnabled } = require('../../config/feature-flags');

const KIND_LABEL = { mcq: 'Multiple choice', fill: 'Fill in the blank', short: 'Short question', long: 'Long question' };

async function _gate() {
  return (await isAssessmentEditingEnabled()) ? null : { code: 'EDITING_DISABLED' };
}

function _gradeOf(req) {
  const m = String(req?.grade_code || '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function _item(q) {
  const section = q.id.split('.')[1] === 'subjective' ? 'subjective' : 'objective';
  const item = {
    id: q.id, number: q.number, removed: q.removed, type: q.type, section,
    marks: q.marks, text: q.text, fields: Edit.fieldsFor(q.question, { type: q.type }),
  };
  if (Array.isArray(q.question?.questions)) {
    item.subs = q.question.questions.map((sub, index) => ({
      index, fields: Edit.fieldsFor(typeof sub === 'string' ? { question: sub } : sub, { type: '' }),
    }));
  }
  return item;
}

const _isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** True only when `changes` has the shape applyChanges expects; a malformed payload must not become a 500. */
function _readable(changes) {
  if (!_isObj(changes)) return false;
  for (const key of ['edits', 'removed', 'restored', 'added']) {
    if (changes[key] !== undefined && !Array.isArray(changes[key])) return false;
  }
  if ((changes.edits || []).some((e) => !_isObj(e) || typeof e.id !== 'string')) return false;
  if ((changes.added || []).some((a) => !_isObj(a))) return false;
  if ((changes.removed || []).some((id) => typeof id !== 'string')) return false;
  if ((changes.restored || []).some((id) => typeof id !== 'string')) return false;
  return true;
}

async function versions({ userId, paperId }) {
  return (await _gate()) || Revision.listFamily({ paperId, userId });
}

async function questions({ userId, paperId }) {
  const gate = await _gate(); if (gate) return gate;
  const out = await Revision.listVersionItems({ paperId, userId });
  if (!out.paper) return { code: out.code };
  const req = out.paper.assessment_requests || {};
  const active = out.items.filter((q) => !q.removed);
  return {
    paper: {
      paperId, version: out.version, grade: _gradeOf(req), subject: req.subject_code,
      chapterNumber: req.chapter_number ?? null, rtl: isRtl(req.subject_code),
      questionCount: active.length, marks: active.reduce((s, q) => s + q.marks, 0),
    },
    items: out.items.map(_item),
  };
}

async function addKinds({ userId, paperId }) {
  const gate = await _gate(); if (gate) return gate;
  const loaded = await Revision.loadVersion({ paperId, userId });
  if (!loaded.paper) return { code: loaded.code };
  return {
    kinds: Object.entries(Edit.NEW_DEFAULTS).map(([kind, d]) => ({
      kind, label: KIND_LABEL[kind] || kind, marks: d.marks, lines: d.lines, needsOptions: kind === 'mcq',
    })),
    slotCap: Edit.SLOT_CAP,
  };
}

async function validateEdit({ userId, paperId, id, kind, edit }) {
  const gate = await _gate(); if (gate) return gate;
  const loaded = await Revision.loadVersion({ paperId, userId });
  if (!loaded.paper) return { code: loaded.code };
  try {
    let question;
    if (kind) {
      question = Edit.newQuestion(kind, edit);
    } else {
      const hit = Selection.indexQuestions(loaded.paper.exam_json).find((q) => q.id === id);
      if (!hit) return { ok: false, message: 'That question is no longer on this paper.' };
      question = Edit.applyEdit(hit.question, edit);
    }
    return {
      ok: true, question, marks: Selection.marksOf(question),
      text: String(question.question || question.main_question || '').trim(),
    };
  } catch (err) {
    if (err.code !== 'EDIT_REJECTED') throw err;
    return { ok: false, message: err.message };
  }
}

async function saveVersion({ userId, parentId, changes }) {
  const gate = await _gate(); if (gate) return { status: 'failed', ...gate };
  if (!_readable(changes)) {
    return { status: 'failed', code: 'INVALID_CHANGES', errors: [{ message: 'That change could not be read.' }] };
  }
  const loaded = await Revision.loadVersion({ paperId: parentId, userId });
  if (!loaded.paper) return { status: 'failed', code: loaded.code };
  const req = loaded.paper.assessment_requests || {};
  const applied = applyChanges(loaded.paper.exam_json, changes, { subject: req.subject_code, grade: _gradeOf(req) });
  if (!applied.ok) return { status: 'failed', code: applied.code, errors: applied.errors };
  const built = await Revision.buildVersion({ parentId, userId, tree: applied.tree });
  if (built.status !== 'ready') return { status: 'failed', code: built.code };
  return { status: 'ready', paperId: built.paperId, version: built.version, questionCount: built.questionCount, marks: built.marks };
}

module.exports = { versions, questions, addKinds, validateEdit, saveVersion };
