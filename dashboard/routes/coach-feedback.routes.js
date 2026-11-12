'use strict';
/**
 * bd-whlsm0 — a coach reports an issue from the portal's More page ("Report an issue"; operator, 30 Oct: "add a form
 * they can fill on the issues ... collect that feedback"). Behind the coach app's guards; the store is injected.
 *
 *   POST /coach/feedback  { kind, message, page? } → { success: true }
 *                         For the logged-in coach (the SESSION user, never an id in the body). kind is one of KINDS;
 *                         message 1–MAX_MESSAGE characters after trimming; page (where she was) kept only when it is a
 *                         portal address of at most 200 characters, else null. A bad body is a 400, nothing stored.
 *
 * bd-370733 — teachers and principals too (operator, 12 Nov: "Report an issue on the portal only appearing for Coaches
 * only. Should be for teacher as well."):
 *
 *   POST /report-issue    the same body, rules and table, for ANY signed-in user (`anyoneGuards`: the portal's one
 *                         sign-in check). The coach's address keeps its coach-app guards.
 *
 * Both record WHO sent it: `role`, read by the server through `roleOf(userId)` (users.role), never from the body. A
 * tester's role switch rewrites users.role, so it is read at send time, not joined later. No role recorded counts as a
 * teacher (the app's rule, useTeacherV2 isTeacherV2For); a read that fails keeps the report with role null.
 */
const express = require('express');

const KINDS = Object.freeze(['broken', 'numbers', 'idea', 'other']);
const MAX_MESSAGE = 2000;
const MAX_PAGE = 200;

const notFound = (res) => res.status(404).json({ success: false, error: 'Not found' });
const bad = (res, error) => res.status(400).json({ success: false, error });
const failed = (res) => res.status(500).json({ success: false, error: 'Something went wrong' });

const pageOf = (raw) => (typeof raw === 'string' && raw.startsWith('/portal/') && raw.length <= MAX_PAGE ? raw : null);
const roleName = (raw) => (typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : 'teacher');

function createCoachFeedbackRouter(deps) {
  const { guards = [], anyoneGuards = [], save, roleOf } = deps;
  const router = express.Router();
  const body = express.json({ limit: '16kb' });

  const coach = (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const uid = req.session && req.session.portalUserId;
    if (!uid) return notFound(res);
    req.coachId = uid;
    return next();
  };

  const roleFor = async (userId) => {
    if (!roleOf) return null;
    try {
      return roleName(await roleOf(userId));
    } catch (err) {
      console.error('[coach-feedback] role not read; kept without it:', err.message);
      return null;
    }
  };

  const report = async (req, res) => {
    const b = req.body || {};
    if (!KINDS.includes(b.kind)) return bad(res, 'Unknown kind');
    const message = typeof b.message === 'string' ? b.message.trim() : '';
    if (!message) return bad(res, 'Message is empty');
    if (message.length > MAX_MESSAGE) return bad(res, 'Message is too long');
    try {
      const role = await roleFor(req.coachId);
      await save({ userId: req.coachId, kind: b.kind, message, page: pageOf(b.page), role });
      return res.json({ success: true });
    } catch (err) {
      console.error('[coach-feedback] save failed:', err.message);
      return failed(res);
    }
  };

  router.post('/coach/feedback', ...guards, coach, body, report);
  // bd-370733: the teacher's (and a principal's) More → Report an issue.
  router.post('/report-issue', ...anyoneGuards, coach, body, report);

  return router;
}

module.exports = { createCoachFeedbackRouter, KINDS, MAX_MESSAGE };
