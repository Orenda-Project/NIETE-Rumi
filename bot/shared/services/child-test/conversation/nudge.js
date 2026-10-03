'use strict';

/**
 * The unsent-draft nudge (bd-s1oo0.46.2, design/COACH_JOURNEY_V2.md §3.1). A voice note that is
 * interrupted (a call, the screen locking, a slip of the thumb) becomes an unsent draft that never
 * reaches us; the coach waits for a reply that cannot come. So when a step has been open for
 * CHILD_TEST_STEP_NUDGE_MS (default 4 min) with no note for it, the coach is told once.
 *
 * The timer is the one the child test already trusts: recovery.js's sweep (once ~20 s after boot, then
 * every 30 s). Nothing here is an in-process setTimeout, so a redeploy mid-step loses nothing
 * (pre-merge Class P). Each tick:
 *   store.listOpenSessions (WhatsApp, in progress, started in the last 3 h; ≤ 50 narrow rows)
 *   → the coach's Redis state still points at that session's step, and promptAt + delay has passed
 *   → no voice note has claimed that block (S.blockClaim)
 *   → ctst:nudged:<session>:<block> is set once (setNX) → the nudge is sent.
 * State is read, never written: the conversation stays the only writer of the coach's state (Class O).
 */

const WhatsAppService = require('../../whatsapp.service');
const { logToFile, logError } = require('../../../utils/logger');
const ports = require('./ports');
const S = require('./state');
const SW = require('./switches');
const steps = require('./steps');
const { langOf, t } = require('./copy');
const { isEnabled } = require('./gate');
const redis = require('../../cache/railway-redis.service');

const LOOKBACK_MS = 3 * 3600 * 1000;
const LIMIT = 50;

/** One pass. Never throws. → { sent, checked } or { skipped }. */
async function sweepOnce({ now = new Date() } = {}) {
  if (!isEnabled()) return { skipped: 'disabled', sent: 0 };
  if (!SW.journeyV2()) return { skipped: 'v1', sent: 0 };
  const out = { sent: 0, checked: 0 };
  try {
    const r = await ports.store.listOpenSessions({ since: new Date(now.getTime() - LOOKBACK_MS), limit: LIMIT });
    if (!r || !r.ok) {
      logError('child_test.nudge_sweep_failed', { stage: 'scan', error: r && r.error });
      return out;
    }
    const delay = SW.nudgeMs();
    for (const session of r.sessions || []) {
      out.checked += 1;
      try {
        if (await nudgeIfDue(session, now, delay)) out.sent += 1;
      } catch (err) {
        logError('child_test.nudge_failed', { sessionId: session.id, error: err.message });
      }
    }
  } catch (err) {
    logError('child_test.nudge_sweep_failed', { error: err.message });
  }
  if (out.sent) logToFile('child_test.nudge_sweep', out);
  return out;
}

async function nudgeIfDue(session, now, delay) {
  const state = await S.get(session.coach_user_id);
  const cur = state && state.current;
  if (!state || state.step !== 'block' || !cur || cur.sessionId !== session.id || !cur.block || !cur.promptAt) return false;
  if (now.getTime() - Date.parse(cur.promptAt) < delay) return false;
  if (await S.blockClaim(session.id, cur.block)) return false;   // the note is in (or on its way)
  if (!(await redis.setNX(`ctst:nudged:${session.id}:${cur.block}`, now.toISOString(), 24 * 3600))) return false;
  const CS = require('../check-flow/check-store');
  const coach = await CS.getCoach(session.coach_user_id);
  if (!coach || !coach.phone_number) {
    logError('child_test.nudge_no_coach', { sessionId: session.id });
    return false;
  }
  const lang = langOf(coach);
  const text = t(lang, 'childTestL26Nudge', { title: steps.stepTitle(lang, cur.block, steps.nameOf(lang, cur)) });
  const ok = await WhatsAppService.sendMessage(coach.phone_number, text);
  if (ok === false) {
    logError('child_test.nudge_send_failed', { sessionId: session.id, block: cur.block });
    return false;
  }
  try { await ports.store.recordTiming(session.id, `${cur.block}.nudged`, now); } catch (err) { /* timing only */ }
  logToFile('child_test.nudged', { sessionId: session.id, block: cur.block });
  return true;
}

module.exports = { sweepOnce };
