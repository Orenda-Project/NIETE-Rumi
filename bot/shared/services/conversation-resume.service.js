'use strict';

/**
 * Offering an interrupted task back.
 *
 * The state core made a paused task *storable*. Nothing paused one and nothing
 * offered one back, so the capability was inert — real code with no caller. This is
 * the half a teacher feels.
 *
 * What it replaces: every feature's answer to "she stopped halfway" was to tell her
 * to start over. That same instruction is repeated across the menu, reading,
 * training, quizzes and exam marking. Meanwhile work simply strands — abandoned
 * requests and half-finished forms sit in non-terminal states for weeks — and the one
 * surface that lists a teacher's open work offers only to CANCEL it.
 *
 * The shape:
 *
 *   1. A step's deadline passes.
 *   2. The sweeper transitions that row to `offered_resume`, keeping the original
 *      step in the payload, and sends two buttons.
 *   3. "Pick up" restores the step. "Start fresh" clears it.
 *   4. If she answers neither, the OFFER expires too and is cleared. We ask once.
 *
 * Step 2 is a state transition in the SAME store rather than a side-channel
 * "already asked?" flag, for two reasons: the buttons then resolve against real
 * state, and one store keeps meaning one store — which is the whole point of the
 * core this builds on.
 */

const supabase = require('../config/supabase');
const ConversationState = require('./conversation-state.service');
const WhatsAppService = require('./whatsapp.service');
const { resolveUx } = require('../config/ux-strings');
const { logToFile } = require('../utils/logger');

/** The step that marks "we have asked her". Also a real step, so it has a deadline. */
const OFFERED = 'offered_resume';

/** How long the OFFER itself stands before we stop waiting. One school day. */
const OFFER_TTL_SECONDS = 21600;

/** What a teacher gets back after tapping "Pick up" — enough to actually reply. */
const RESUMED_TTL_SECONDS = 3600;

/**
 * Flow id → the words a teacher reads. Never show an internal id: "lesson_plan" is
 * our name for it, "lesson plan" is hers. A flow missing from here is deliberately
 * NOT offered — see shouldOffer() — because an offer we cannot name is a mystery
 * message, and a mystery message is worse than silence.
 */
const TASK_LABEL = Object.freeze({
  lesson_plan: { en: 'lesson plan',       ur: 'لیسن پلان' },
  coaching:    { en: 'classroom observation', ur: 'کلاس روم مشاہدہ' },
  reading:     { en: 'reading assessment', ur: 'قرائت کا جائزہ' },
  video:       { en: 'teaching video',    ur: 'تدریسی ویڈیو' },
  quiz:        { en: 'class quiz',        ur: 'کلاس کوئز' },
});

function taskLabel(flow, language) {
  const entry = TASK_LABEL[flow];
  if (!entry) return null;
  return entry[language] || entry.en;
}

/** A flow is offerable only if we can name it to her. */
function shouldOffer(flow) {
  return Boolean(TASK_LABEL[flow]);
}

/** `resume_yes:<flow>` / `resume_no:<flow>` → {decision, flow}, or null. */
function parseResumeButton(buttonId) {
  const m = /^resume_(yes|no):([a-z_]+)$/.exec(String(buttonId || ''));
  if (!m) return null;
  return { decision: m[1], flow: m[2] };
}

/**
 * Sweep expired state and offer each interrupted task back.
 *
 * Called on an interval from the always-on worker. Never throws: a sweep that dies
 * on one teacher must not stop the rest, and must not take the worker with it.
 *
 * @returns {Promise<{offered:number, expired:number, skipped:number, failed:number}>}
 */
async function sweepAndOffer({ limit = 100 } = {}) {
  const tally = { offered: 0, expired: 0, skipped: 0, failed: 0 };

  let rows = [];
  try {
    rows = await ConversationState.sweepExpired({ limit });
  } catch (err) {
    logToFile('⚠️ resume sweep: could not read expired state', { error: err.message });
    return tally;
  }
  if (rows.length === 0) return tally;

  // One lookup for the whole batch rather than per row — the sweeper runs on a
  // timer and has no reason to be chatty.
  const byId = new Map();
  try {
    const { data } = await supabase
      .from('users')
      .select('id, phone_number, preferred_language')
      .in('id', rows.map((r) => r.userId));
    for (const u of data || []) byId.set(u.id, u);
  } catch (err) {
    logToFile('⚠️ resume sweep: teacher lookup failed', { error: err.message });
    return tally;
  }

  for (const row of rows) {
    try {
      // Already asked and she didn't answer. Close it rather than asking forever —
      // a nag every 15 minutes is worse than the original problem.
      if (row.step === OFFERED) {
        await ConversationState.clearState(row.userId, { flow: row.flow });
        tally.expired += 1;
        continue;
      }

      if (!shouldOffer(row.flow)) {
        // Deliberately silent: expired, unnameable, so we just let it go.
        await ConversationState.clearState(row.userId, { flow: row.flow });
        tally.skipped += 1;
        continue;
      }

      const user = byId.get(row.userId);
      if (!user || !user.phone_number) {
        tally.skipped += 1;
        continue;
      }

      const language = user.preferred_language || 'en';
      const task = taskLabel(row.flow, language);

      // Record the ask BEFORE sending. If the send then fails we have asked-state
      // with no message, and the next sweep closes it quietly — which is a better
      // failure than sending and forgetting, which would ask her twice.
      await ConversationState.setState(row.userId, {
        flow: row.flow,
        step: OFFERED,
        payload: { ...(row.payload || {}), resumeStep: row.step },
        ttlSeconds: OFFER_TTL_SECONDS,
      });

      await WhatsAppService.sendInteractiveButtons(user.phone_number, {
        body: resolveUx('resumeOfferBody', { language, params: { task } }),
        buttons: [
          { id: `resume_yes:${row.flow}`, title: resolveUx('resumeYesLabel', { language }) },
          { id: `resume_no:${row.flow}`,  title: resolveUx('resumeNoLabel',  { language }) },
        ],
      });

      tally.offered += 1;
      logToFile('🔄 Offered an interrupted task back', { userId: row.userId, flow: row.flow, step: row.step });
    } catch (err) {
      tally.failed += 1;
      logToFile('⚠️ resume sweep: one teacher failed, continuing', {
        userId: row.userId, flow: row.flow, error: err.message,
      });
    }
  }

  return tally;
}

/**
 * Handle a tap on the resume offer.
 *
 * Intent-first, like every other button: the id names the decision AND the flow, so
 * this works even when the stored state has gone in the meantime. It returns false
 * for ids it does not own so the caller can keep routing.
 *
 * @returns {Promise<boolean>} true if this was a resume decision and was handled
 */
async function handleResumeButton(user, from, buttonId) {
  const parsed = parseResumeButton(buttonId);
  if (!parsed) return false;

  const { decision, flow } = parsed;
  const language = (user && user.preferred_language) || 'en';
  const task = taskLabel(flow, language) || flow;

  if (decision === 'no') {
    await ConversationState.clearState(user.id, { flow });
    await WhatsAppService.sendMessage(from, resolveUx('resumeDiscarded', { language }));
    logToFile('🗑️ Teacher discarded an interrupted task', { userId: user.id, flow });
    return true;
  }

  const current = await ConversationState.getState(user.id);

  // She tapped, but it is gone — the offer outlived the state, or she tapped an old
  // message. Say so plainly instead of pretending to resume nothing.
  if (!current || current.flow !== flow) {
    await WhatsAppService.sendMessage(from, resolveUx('resumeGone', { language }));
    logToFile('🔄 Resume tapped but state was gone', { userId: user.id, flow });
    return true;
  }

  const { resumeStep, ...rest } = current.payload || {};

  await ConversationState.setState(user.id, {
    flow,
    step: resumeStep || current.step,
    payload: rest,
    ttlSeconds: RESUMED_TTL_SECONDS,
  });

  await WhatsAppService.sendMessage(from, resolveUx('resumeRestored', { language, params: { task } }));
  logToFile('✅ Teacher resumed an interrupted task', { userId: user.id, flow, step: resumeStep });
  return true;
}

module.exports = {
  sweepAndOffer,
  handleResumeButton,
  parseResumeButton,
  shouldOffer,
  TASK_LABEL,
  OFFERED,
  OFFER_TTL_SECONDS,
};
