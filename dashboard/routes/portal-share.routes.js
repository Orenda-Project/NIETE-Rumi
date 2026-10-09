'use strict';
/**
 * bd-fmf24g.30 — "Send on WhatsApp" from a teacher-app screen (the kit's ShareActions). Mounted at /api/portal by
 * dashboard/index.js beside the other teacher modules.
 *
 *   POST /api/portal/share/whatsapp  { kind: 'lesson'|'paper'|'dc'|'observation', id }
 *     → { success, status: 'sent', at } | { status: 'unavailable', reason } | { status: 'failed', reason }
 *
 * The user is ALWAYS the session's. Dark unless portal_teacher_v2 is on for her (404, nothing asked of the bot). The bot
 * decides everything (template configured? hers? Meta's answer): a template only, and the REAL result. A bot that cannot
 * be reached is 502 (the app shows "Couldn't send"), never "sent".
 */
const express = require('express');
const supabase = require('../config/supabase');
const { isFlagEnabledForUser, PORTAL_TEACHER_V2_KEY } = require('../lib/feature-flags');

const router = express.Router();
const KINDS = ['lesson', 'paper', 'dc', 'observation'];

function requirePortalAuth(req, res, next) {
  if (!req.session || !req.session.portalUserId) {
    return res.status(401).json({ success: false, error: 'Not authenticated. Please log in.' });
  }
  return next();
}

async function requireTeacherV2(req, res, next) {
  let on = false;
  try { on = await isFlagEnabledForUser(supabase, PORTAL_TEACHER_V2_KEY, req.session.portalUserId); } catch (_) { on = false; }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

async function callBot(body, path = 'send') {
  const axios = require('axios');
  const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
  const apiKey = process.env.INTERNAL_API_KEY || '';
  if (!baseUrl || !apiKey) throw new Error('share API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  const res = await axios.post(`${baseUrl}/api/internal/share/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 25000, validateStatus: () => true,
  });
  return res;
}

/** GET /api/portal/share/availability → { kinds: { lesson, paper, dc, observation } }: true where a template is configured. */
router.get('/share/availability', requirePortalAuth, requireTeacherV2, async (req, res) => {
  try {
    const r = await callBot({}, 'availability');
    const kinds = r && r.status === 200 && r.data && r.data.kinds;
    if (!kinds || typeof kinds !== 'object') throw new Error(`share/availability failed (HTTP ${r && r.status})`);
    return res.json({ success: true, kinds: Object.fromEntries(KINDS.map((k) => [k, kinds[k] === true])) });
  } catch (error) {
    console.error('❌ Portal share/availability failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not reach sharing.' });
  }
});

router.post('/share/whatsapp', requirePortalAuth, requireTeacherV2, async (req, res) => {
  const b = req.body || {};
  if (!KINDS.includes(b.kind) || typeof b.id !== 'string' || !b.id.trim() || b.id.length > 200) {
    return res.status(400).json({ success: false, error: 'kind and id are required' });
  }
  try {
    const r = await callBot({ userId: req.session.portalUserId, kind: b.kind, id: b.id.trim() });
    const data = r && r.data;
    if (r && r.status === 404) return res.status(404).json({ success: false, status: 'not_found' });
    if (!r || r.status >= 400 || !data || !['sent', 'unavailable', 'failed'].includes(data.status)) {
      throw new Error(`share/send failed (HTTP ${r && r.status})`);
    }
    return res.json({ success: true, status: data.status, ...(data.at ? { at: data.at } : {}), ...(data.reason ? { reason: data.reason } : {}) });
  } catch (error) {
    console.error('❌ Portal share/whatsapp failed', { kind: b.kind, error: error && error.message });
    return res.status(502).json({ success: false, status: 'failed', reason: 'unreachable' });
  }
});

module.exports = router;
