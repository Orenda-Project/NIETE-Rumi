'use strict';
/**
 * FLN Send to teacher (PR-E) — POST /api/internal/fln/send
 *   { sender:{id, role}, plan:{id, title, lang}, teachers:[{id, key}] (1..30) } → { success, queued, failed:[key] }
 *
 * The portal (dashboard/routes/portal-fln-send.routes.js) has already checked the leader's access, that every
 * teacher is in the leader's own scope, that the plan is not hidden, and the rate limit. This route only resolves
 * each teacher's phone number and language HERE, in the bot (they never cross the wire), and hands the batch to
 * fln-send.service.js. Mounted from internal-api.routes.js (router.use), like internal-share.routes.js.
 *
 *   400 {error:'bad_request'} for a malformed body; a teacher who is unknown or deleted is failed by key.
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const { requireInternalKey } = require('../middleware/require-internal-key');

const router = express.Router();
const MAX_TEACHERS = 30;
const PLAN_RX = /^\d{1,9}$/;

function parse(body) {
  const b = body || {};
  const sender = b.sender && typeof b.sender === 'object' ? b.sender : null;
  const plan = b.plan && typeof b.plan === 'object' ? b.plan : null;
  const teachers = Array.isArray(b.teachers) ? b.teachers : null;
  const { KEY_RX } = require('../services/fln-keys');
  if (!sender || typeof sender.id !== 'string' || !sender.id.trim()) return null;
  if (!plan || !PLAN_RX.test(String(plan.id)) || typeof plan.title !== 'string') return null;
  if (!teachers || teachers.length < 1 || teachers.length > MAX_TEACHERS) return null;
  if (!teachers.every((t) => t && typeof t.id === 'string' && t.id.trim() && KEY_RX.test(String(t.key)))) return null;
  return {
    sender: { id: sender.id.trim(), role: String(sender.role || '') },
    plan: { id: String(plan.id), title: plan.title, lang: plan.lang === 'ur' ? 'ur' : 'en' },
    teachers: teachers.map((t) => ({ id: t.id.trim(), key: String(t.key) })),
  };
}

router.post('/fln/send', requireInternalKey, async (req, res) => {
  const input = parse(req.body);
  if (!input) return res.status(400).json({ success: false, error: 'bad_request' });
  try {
    const supabase = require('../config/supabase');
    const ids = [...new Set(input.teachers.map((t) => t.id))];
    const { data, error } = await supabase.from('users').select('id, phone_number, preferred_language, deleted_at').in('id', ids);
    if (error) throw new Error(error.message || 'users lookup failed');
    const byId = new Map((data || []).filter((u) => u && !u.deleted_at).map((u) => [u.id, u]));
    const teachers = input.teachers.map((t) => {
      const u = byId.get(t.id);
      return { id: t.id, key: t.key, phone_number: (u && u.phone_number) || null, preferred_language: (u && u.preferred_language) || null };
    });
    const { userKey } = require('../services/fln-keys');
    const out = await require('../services/fln-send.service').sendPlanToTeachers({
      sender: { ...input.sender, keyedId: userKey(input.sender.id) },
      plan: input.plan,
      teachers,
    });
    return res.json({ success: true, queued: out.queued, failed: out.failed });
  } catch (err) {
    logToFile('❌ Internal FLN send failed', { error: err && err.message }, 'error');
    return res.status(500).json({ success: false, error: 'error' });
  }
});

module.exports = router;
