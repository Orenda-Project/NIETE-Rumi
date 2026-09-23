'use strict';
/**
 * bd-we73k — accept a lesson plan the teacher writes into the chat.
 *
 * Every other way in is keyed on a WhatsApp media id: the document webhook and
 * the LP-as-photo branch both go through handleLessonPlanMediaArrival, and the
 * lessonplan_yes_ tap asks for a file. A teacher who types her plan instead got
 * generic AI chat, or (a leader) the LP prompt sent again. has_lesson_plan
 * stayed false and Section B scored on nothing.
 *
 * WHAT COUNTS AS A PLAN IS NOT DECIDED HERE (operator, 2026-09-22).
 *
 * This module shipped with a content pre-filter — a length floor, a count of
 * lesson-plan words, a layout rule. Every one of them was a guess about how a
 * teacher writes, and each guess excluded a real teacher: a 222-code-point
 * Roman-Urdu plan was thrown away by a 280-point floor while her session sat
 * waiting for it. The operator's instruction is that whatever she sends at this
 * step is considered — we do not measure her plan before agreeing to read it.
 *
 * So the gate is now STATE, not CONTENT:
 *   · a session she DRIVES is at the lesson-plan step (media-session-resolver,
 *     kind 'lp' — the same ownership rule a photo obeys, bd-wwcgf), and
 *   · the message is not a slash command, which is explicit intent for another
 *     feature and is matched further down the handler.
 *
 * Whether the text turns out to BE a plan is settled downstream by the
 * extraction worker's isLikelyLessonPlan, reading the parsed content — the
 * same judge an uploaded PDF faces. A teacher who types "no" therefore gets
 * the same outcome she would have got from the No button: told plainly, and
 * her recording analysed without a plan.
 *
 * Cost: one keyed read per inbound non-slash text. The handler already makes a
 * comparable coaching_sessions read on every message, so this is in line with
 * what a text already costs — and it is the price of not guessing.
 */

const { logToFile } = require('../../../utils/logger');

/**
 * Is this message eligible to be read as a lesson plan at all?
 * Deliberately NOT a judgement about the content — see the header.
 *
 * @param {string} text - the RAW message body (not lower-cased/trimmed)
 * @returns {boolean}
 */
function isEligiblePastedText(text) {
  if (typeof text !== 'string') return false;
  const body = text.trim();
  if (!body) return false;
  // Slash commands are explicit intent for another feature and are matched
  // further down this handler; consuming one here would swallow it.
  return !body.startsWith('/');
}

/**
 * Attach a typed lesson plan to the session waiting for one.
 *
 * @param {{ user: {id:string}, from: string, text: string }} args
 * @returns {Promise<boolean>} true when the text was CONSUMED as a lesson plan;
 *   false means "not mine" and the caller continues its normal routing.
 */
async function tryAttachPastedLessonPlan({ user, from, text }) {
  if (!user || !user.id) return false;
  if (!isEligiblePastedText(text)) return false;

  const { resolveMediaSession } = require('../media-session-resolver');
  const r = await resolveMediaSession({ user, kind: 'lp' });

  if (r.outcome === 'none') return false;
  if (r.outcome === 'ambiguous') {
    // Two observations at the LP step and no media id to park. Say nothing and
    // let the existing path run — a wrong guess would attach one teacher's plan
    // to another teacher's observation (bd-wwcgf's failure, by another route).
    logToFile('📄 pasted LP: several sessions at the LP gate — standing down', {
      userId: user.id, candidates: (r.candidates || []).map((c) => c.id),
    });
    return false;
  }

  const LessonPlanProcessorService = require('../lesson-plan-processor.service');
  await LessonPlanProcessorService.handlePastedLessonPlan(r.session.id, from, text.trim());

  logToFile('📄 Lesson plan attached from typed text', {
    coachingSessionId: r.session.id, userId: user.id, chars: [...text.trim()].length,
  });
  return true;
}

module.exports = {
  isEligiblePastedText,
  tryAttachPastedLessonPlan,
};
