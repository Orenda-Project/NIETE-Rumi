'use strict';
/**
 * bd-fmf24g.7 — class attendance for the teacher portal, behind the shared secret. Thin: the rules
 * live in services/attendance-portal.service.js; these map its answers onto HTTP. Mounted from
 * internal-api.routes.js (router.use), like internal-assessment-edit.routes.js.
 *
 *   POST /api/internal/attendance/classes        { userId, date? }
 *   POST /api/internal/attendance/roster         { userId, listId }
 *   POST /api/internal/attendance/mark           { userId, listId, date, absentIds, leaveIds }
 *   POST /api/internal/attendance/day            { userId, listId, date }
 *   POST /api/internal/attendance/month          { userId, listId, month }
 *   POST /api/internal/attendance/register       { userId, listId, month } → { fileName, base64 }
 *   POST /api/internal/attendance/register/send  { userId, listId, month }
 *
 * userId is the portal SESSION's teacher; the portal never takes it from its own request.
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const { requireInternalKey } = require('../middleware/require-internal-key');

const router = express.Router();

const STATUS = { NOT_FOUND: 404, BAD_DATE: 400, BAD_MONTH: 400, EMPTY_ROSTER: 409 };

function attendanceRoute(name, call) {
  return async (req, res) => {
    const body = req.body || {};
    const userId = String(body.userId || '').trim();
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
    try {
      const Portal = require('../services/attendance-portal.service');
      const out = await call(Portal, { ...body, userId });
      if (out && out.code) return res.status(STATUS[out.code] || 400).json({ success: false, code: out.code });
      return res.json({ success: true, ...out });
    } catch (error) {
      logToFile('❌ Internal attendance API failed', { route: name, userId, error: error?.message }, 'error');
      return res.status(500).json({ success: false, error: 'Attendance failed' });
    }
  };
}

router.post('/attendance/classes', requireInternalKey,
  attendanceRoute('classes', (P, b) => P.listClasses({ userId: b.userId, date: b.date == null ? undefined : b.date })));
router.post('/attendance/roster', requireInternalKey,
  attendanceRoute('roster', (P, b) => P.roster({ userId: b.userId, listId: b.listId })));
router.post('/attendance/mark', requireInternalKey,
  attendanceRoute('mark', (P, b) => P.mark({
    userId: b.userId, listId: b.listId, date: b.date, absentIds: b.absentIds, leaveIds: b.leaveIds,
  })));
router.post('/attendance/day', requireInternalKey,
  attendanceRoute('day', (P, b) => P.day({ userId: b.userId, listId: b.listId, date: b.date })));
router.post('/attendance/month', requireInternalKey,
  attendanceRoute('month', (P, b) => P.month({ userId: b.userId, listId: b.listId, month: b.month })));
router.post('/attendance/register', requireInternalKey,
  attendanceRoute('register', (P, b) => P.registerFile({ userId: b.userId, listId: b.listId, month: b.month })));
router.post('/attendance/register/send', requireInternalKey,
  attendanceRoute('register-send', (P, b) => P.sendRegister({ userId: b.userId, listId: b.listId, month: b.month })));

module.exports = router;
