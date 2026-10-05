'use strict';
/**
 * A paper's changes, made somewhere other than WhatsApp, applied with WhatsApp's rules.
 *
 * The portal sends WHAT she changed (ids from the version she opened), never a
 * rebuilt tree, so the portal needs to know nothing about question shapes. Every
 * rule lives in assessment-edit / assessment-selection; this file only fixes the
 * order: edits, then removals and restores, then additions — appended last, so
 * no id she was given moves while the list is applied.
 *
 * Every refusal is collected, not just the first, so she fixes them all in one go.
 */
const Edit = require('./assessment-edit');
const Selection = require('./assessment-selection');

const GONE = 'That question is no longer on this paper.';

function _rejected(err) {
  return err && err.code === 'EDIT_REJECTED';
}

function applyChanges(tree, changes = {}, { subject, grade } = {}) {
  const edits = changes.edits || [];
  const removed = changes.removed || [];
  const restored = changes.restored || [];
  const added = changes.added || [];
  if (!edits.length && !removed.length && !restored.length && !added.length) {
    return { ok: false, code: 'NO_CHANGES', errors: [] };
  }

  const known = new Set(Selection.indexQuestions(tree).map((q) => q.id));
  const errors = [];
  let next = JSON.parse(JSON.stringify(tree || {}));

  for (const { id, edit } of edits) {
    if (!known.has(id)) { errors.push({ id, message: GONE }); continue; }
    const current = Selection.indexQuestions(next).find((q) => q.id === id).question;
    try {
      next = Selection.replaceAt(next, id, Edit.applyEdit(current, edit));
    } catch (err) {
      if (!_rejected(err)) throw err;
      const e = { id, message: err.message };
      if (edit && edit.subIndex != null) e.subIndex = Number(edit.subIndex);
      errors.push(e);
    }
  }

  for (const [list, flag] of [[removed, true], [restored, false]]) {
    for (const id of list) {
      const t = known.has(id) ? Selection.setRemoved(next, id, flag) : null;
      if (!t) { errors.push({ id, message: GONE }); continue; }
      next = t;
    }
  }

  added.forEach((a, addedIndex) => {
    try {
      const question = Edit.newQuestion(a && a.kind, a && a.edit);
      next = Selection.appendQuestion(next, { kind: a.kind, subject, grade }, question).tree;
    } catch (err) {
      if (!_rejected(err)) throw err;
      errors.push({ addedIndex, message: err.message });
    }
  });

  if (errors.length) return { ok: false, code: 'INVALID_CHANGES', errors };
  if (!Selection.indexQuestions(next).some((q) => !q.removed)) {
    return { ok: false, code: 'EMPTY_SELECTION', errors: [] };
  }
  return { ok: true, tree: next };
}

module.exports = { applyChanges, GONE };
