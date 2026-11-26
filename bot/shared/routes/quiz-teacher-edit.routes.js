'use strict';
/**
 * /api/internal/wqedit/* — a teacher edits their own lesson quiz (quiz-teacher-edit.js; switch web_quiz_teacher_edit,
 * off → 404 {off:true}). Called only by the portal, which has already checked the signed-in teacher and forwards
 * their users.id; the service checks again that the quiz is theirs.
 *
 *   GET  /quiz/:quizId?t=<teacher users.id>   every question with its key, the lock, edit_v and the PDF state
 *   POST /save  {quizId, teacherUserId, v, ops, surface}   one save (text / option / key / remove)
 *   POST /pdf   {quizId, teacherUserId}        the PDF for the current version, remade when it is missing
 */
const express = require('express');
const { requireInternalKey } = require('../middleware/require-internal-key');
const { logToFile } = require('../utils/logger');
const Edit = require('../services/quiz/quiz-teacher-edit');

function createRouter() {
  const router = express.Router();
  router.use(requireInternalKey);
  router.use(express.json({ limit: '32kb' }));
  const wrap = (fn) => async (req, res) => {
    try {
      const { status, body } = await fn(req);
      return res.status(status).json(body);
    } catch (err) {
      logToFile('❌ teacher quiz edit route failed', { route: req.path, error: err.message }, 'error');
      return res.status(500).json({ ok: false, reason: 'failed' });
    }
  };
  const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
  router.get('/quiz/:quizId', wrap((req) => Edit.view({ quizId: req.params.quizId, teacherUserId: typeof req.query.t === 'string' ? req.query.t : null })));
  router.post('/save', wrap((req) => Edit.save(body(req))));
  router.post('/pdf', wrap((req) => Edit.ensurePdf(body(req))));
  return router;
}

module.exports = { createRouter };
