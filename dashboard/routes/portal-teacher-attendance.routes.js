'use strict';
/**
 * bd-fmf24g.7 — teacher app v2: class attendance. Mounted at /api/portal by dashboard/index.js (one
 * line), beside portal.routes.js, so it shares the portal's CORS / rate-limit / session stack.
 * (The /api/portal/attendance/* prefix is the principal's TEACHER-attendance router; this is the
 * teacher's CLASS attendance, so it lives under /teacher/attendance.)
 *
 *   GET  /api/portal/teacher/attendance/classes[?date=]                 → { date, classes: [{ listId, label,
 *        gradeCode, section, subjectCodes, students, marked, present, absent, leave }] }
 *   GET  /api/portal/teacher/attendance/classes/:listId/roster          → { listId, label, students: [{ id, name, roll }] }
 *   POST /api/portal/teacher/attendance/classes/:listId/mark            { date, absentIds, leaveIds }
 *        → { date, present, absent, leave, replaced }
 *   GET  /api/portal/teacher/attendance/classes/:listId/day?date=       → { date, marked, present, absent, leave, statuses }
 *   GET  /api/portal/teacher/attendance/classes/:listId/month?month=    → { month, days, students }
 *   GET  /api/portal/teacher/attendance/classes/:listId/register?month= → the .xlsx register (attachment)
 *   POST /api/portal/teacher/attendance/classes/:listId/register/send   { month } → { delivered }
 *
 * The teacher is ALWAYS the session's user. Dark unless portal_teacher_v2 is on for her (404, and
 * nothing is asked of the bot). Rules live in the bot (services/attendance-portal.service.js),
 * reached through services/teacher-attendance.service.js.
 */

const express = require('express');
const supabase = require('../config/supabase');
const { isFlagEnabledForUser, PORTAL_TEACHER_V2_KEY } = require('../lib/feature-flags');
const pool = require('../config/database');
const Attendance = require('../services/teacher-attendance.service');
const GradeSubjects = require('../services/grade-subjects.service');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const STATUS = { NOT_FOUND: 404, BAD_DATE: 400, BAD_MONTH: 400, EMPTY_ROSTER: 409 };

// Self-contained duplicate of portal.routes.js's guard (not exported there), as the other teacher modules do.
function requirePortalAuth(req, res, next) {
  if (!req.session || !req.session.portalUserId) {
    return res.status(401).json({ success: false, error: 'Not authenticated. Please log in.' });
  }
  return next();
}

async function requireTeacherV2(req, res, next) {
  let on = false;
  try {
    on = await isFlagEnabledForUser(supabase, PORTAL_TEACHER_V2_KEY, req.session.portalUserId);
  } catch (error) {
    on = false; // a failed read is OFF, as every flag read is
  }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

function requireListId(req, res, next) {
  if (!UUID.test(String((req.params && req.params.listId) || ''))) {
    return res.status(400).json({ success: false, error: 'Unknown class.' });
  }
  return next();
}

/** A YYYY-MM-DD that names a real calendar day, or null. */
function realDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

const idList = (v) => (v === undefined ? [] : (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null));

/** Run a bot call and answer: its { code } as the right status, a failure as 502. */
function answer(name, run, render = (res, out) => res.json({ success: true, ...out })) {
  return async (req, res) => {
    try {
      const out = await run(req.session.portalUserId, req);
      if (out && out.code) return res.status(STATUS[out.code] || 400).json({ success: false, code: out.code });
      return render(res, out);
    } catch (error) {
      console.error(`❌ Portal teacher/attendance ${name} failed`, { error: error && error.message });
      return res.status(502).json({ success: false, error: 'Could not reach attendance. Please try again.' });
    }
  };
}

const guard = [requirePortalAuth, requireTeacherV2];
const guardList = [requirePortalAuth, requireTeacherV2, requireListId];

router.get('/teacher/attendance/classes', ...guard, (req, res, next) => {
  const raw = req.query && req.query.date;
  if (raw !== undefined && !realDate(raw)) return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
  return next();
}, answer('classes', async (userId, req) => {
  const [out, lang] = await Promise.all([
    Attendance.classes(userId, (req.query && req.query.date) || null),
    GradeSubjects.defaultDeps((sql, params) => pool.query(sql, params)).language(userId),
  ]);
  return out && out.code ? out : { ...out, classes: Attendance.withNames(out.classes, lang) };
}));

router.get('/teacher/attendance/classes/:listId/roster', ...guardList,
  answer('roster', (userId, req) => Attendance.roster(userId, req.params.listId)));

router.post('/teacher/attendance/classes/:listId/mark', ...guardList, (req, res, next) => {
  const b = req.body || {};
  if (!realDate(b.date) || idList(b.absentIds) === null || idList(b.leaveIds) === null) {
    return res.status(400).json({ success: false, error: 'date (YYYY-MM-DD) and lists of ids are required' });
  }
  return next();
}, answer('mark', (userId, req) => Attendance.mark(userId, req.params.listId, {
  date: req.body.date, absentIds: idList(req.body.absentIds), leaveIds: idList(req.body.leaveIds),
})));

router.get('/teacher/attendance/classes/:listId/day', ...guardList, (req, res, next) => {
  if (!realDate(req.query && req.query.date)) return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
  return next();
}, answer('day', (userId, req) => Attendance.day(userId, req.params.listId, req.query.date)));

function requireMonth(from) {
  return (req, res, next) => {
    const m = from(req);
    if (typeof m !== 'string' || !MONTH.test(m)) return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
    return next();
  };
}

router.get('/teacher/attendance/classes/:listId/month', ...guardList, requireMonth((req) => req.query && req.query.month),
  answer('month', (userId, req) => Attendance.month(userId, req.params.listId, req.query.month)));

router.get('/teacher/attendance/classes/:listId/register', ...guardList, requireMonth((req) => req.query && req.query.month),
  answer('register', (userId, req) => Attendance.registerFile(userId, req.params.listId, req.query.month), (res, out) => {
    const name = out.fileName || 'Attendance register.xlsx';
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="register.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    return res.send(Buffer.from(out.base64 || '', 'base64'));
  }));

router.post('/teacher/attendance/classes/:listId/register/send', ...guardList, requireMonth((req) => req.body && req.body.month),
  answer('register-send', (userId, req) => Attendance.sendRegister(userId, req.params.listId, req.body.month), (res, out) => {
    if (out && out.delivered) return res.json({ success: true, delivered: true });
    return res.status(502).json({ success: false, delivered: false, error: (out && out.error) || 'not_delivered' });
  }));

module.exports = router;
