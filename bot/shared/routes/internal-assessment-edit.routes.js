'use strict';
/**
 * Editing a paper from the portal. Five routes, all behind the shared secret, all
 * thin: the editor service owns the behaviour, these only map its answers onto
 * HTTP. Kept out of internal-api.routes.js, which is already very long and whose
 * test counts its generator routes exactly.
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const { requireInternalKey } = require('../middleware/require-internal-key');

const router = express.Router();

const STATUS = {
  EDITING_DISABLED: 403, NOT_FOUND: 404, NOT_READY: 409,
  INVALID_CHANGES: 400, EMPTY_SELECTION: 400, NO_CHANGES: 400, EDIT_REJECTED: 400,
};

function refuse(res, code, extra = {}) {
  return res.status(STATUS[code] || 502).json({ success: false, code, ...extra });
}

function editRoute(name, handler) {
  return async (req, res) => {
    const body = req.body || {};
    const userId = String(body.userId || '').trim();
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
    try {
      const Editor = require('../services/assessment/assessment-editor.service');
      return await handler(Editor, { ...body, userId }, res);
    } catch (error) {
      logToFile('❌ Internal assessment edit API failed', { route: name, error: error?.message }, 'error');
      return res.status(500).json({ success: false, error: 'Assessment edit failed' });
    }
  };
}

router.post('/assessment/edit/versions', requireInternalKey, editRoute('versions', async (Editor, b, res) => {
  const out = await Editor.versions({ userId: b.userId, paperId: b.paperId });
  return out.code ? refuse(res, out.code) : res.json({ success: true, ...out });
}));

router.post('/assessment/edit/questions', requireInternalKey, editRoute('questions', async (Editor, b, res) => {
  const out = await Editor.questions({ userId: b.userId, paperId: b.paperId });
  return out.code ? refuse(res, out.code) : res.json({ success: true, ...out });
}));

router.post('/assessment/edit/add-kinds', requireInternalKey, editRoute('add-kinds', async (Editor, b, res) => {
  const out = await Editor.addKinds({ userId: b.userId, paperId: b.paperId });
  return out.code ? refuse(res, out.code) : res.json({ success: true, ...out });
}));

router.post('/assessment/edit/validate', requireInternalKey, editRoute('validate', async (Editor, b, res) => {
  if (!b.edit || typeof b.edit !== 'object' || Array.isArray(b.edit)) {
    return refuse(res, 'EDIT_REJECTED', { error: 'That change could not be read.' });
  }
  const out = await Editor.validateEdit({ userId: b.userId, paperId: b.paperId, id: b.id, kind: b.kind, edit: b.edit });
  if (out.code) return refuse(res, out.code);
  if (!out.ok) return refuse(res, 'EDIT_REJECTED', { error: out.message });
  return res.json({ success: true, ...out });
}));

router.post('/assessment/edit/save', requireInternalKey, editRoute('save', async (Editor, b, res) => {
  const out = await Editor.saveVersion({ userId: b.userId, parentId: b.parentId, changes: b.changes || {} });
  if (out.status !== 'ready') return refuse(res, out.code, out.errors ? { errors: out.errors } : {});
  return res.json({ success: true, ...out });
}));

module.exports = router;
