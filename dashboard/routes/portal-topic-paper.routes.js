'use strict';
/**
 * bd-pw1ccr.26 — the teacher Home's "Make my paper" card for a topic-end nudge held by a shut WhatsApp window.
 * Mounted at /api/portal by dashboard/index.js (one line), beside portal-teacher-notices.routes.js.
 *
 *   GET  /api/portal/me/topic-paper          → { success, held }  { topicId, topicName, grade, subject, chapter } or null
 *   POST /api/portal/me/topic-paper/opened   { topicId } she tapped the card: her pending WhatsApp retries for it skip
 *
 * Dark (404, nothing asked) unless the card's own switch (topic_nudge_portal_card_enabled, off by default) AND the
 * nudge's switch (topic_end_nudge_enabled) are on for her. Group B is in the lookup (services/held-topic-nudge.service.js),
 * so a control teacher never sees it. The teacher is ALWAYS the session's user. Nothing here sends a WhatsApp message.
 */

const express = require('express');
const supabase = require('../config/supabase');
const pool = require('../config/database');
const { isFlagEnabledForUser } = require('../lib/feature-flags');
const { heldTopicNudge } = require('../services/held-topic-nudge.service');
const { requirePortalAuth } = require('../lib/portal-auth');

const router = express.Router();
const dbQuery = (sql, params) => pool.query(sql, params);

const CARD_KEY = 'topic_nudge_portal_card_enabled';
const NUDGE_KEY = 'topic_end_nudge_enabled';
const KIND = 'topic_end_nudge';

async function requireCardOn(req, res, next) {
  const userId = req.session.portalUserId;
  let on = false;
  try {
    on = (await isFlagEnabledForUser(supabase, CARD_KEY, userId)) && (await isFlagEnabledForUser(supabase, NUDGE_KEY, userId));
  } catch (error) {
    on = false; // a failed read is OFF, as every flag read is
  }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

router.get('/me/topic-paper', requirePortalAuth, requireCardOn, async (req, res) => {
  try {
    const held = await heldTopicNudge(dbQuery, req.session.portalUserId);
    return res.json({ success: true, held });
  } catch (error) {
    console.error('❌ Portal me/topic-paper failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not load this. Please try again.' });
  }
});

router.post('/me/topic-paper/opened', requirePortalAuth, requireCardOn, async (req, res) => {
  const topicId = req.body && req.body.topicId;
  if (typeof topicId !== 'string' || !topicId || topicId.length > 200) {
    return res.status(400).json({ success: false, code: 'BAD_TOPIC' });
  }
  try {
    // Required here, not at load: the bot store opens its own Supabase client.
    const store = require('../../bot/shared/services/nudges/teacher-nudges.store');
    const skipped = await store.skipPendingForTopic({ userId: req.session.portalUserId, kind: KIND, topicId, reason: 'card_used' });
    return res.json({ success: true, skipped });
  } catch (error) {
    console.error('❌ Portal me/topic-paper/opened failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not save that. Please try again.' });
  }
});

module.exports = router;
