'use strict';
/**
 * bd-we73k — accept a lesson plan the teacher PASTES as a chat message.
 *
 * Every other way in is keyed on a WhatsApp media id: the document webhook and
 * the LP-as-photo branch both go through handleLessonPlanMediaArrival, and the
 * lessonplan_yes_ tap asks for a file. A teacher who types her plan into the
 * chat instead — which the DC feedback sheet (row 136) reported and prod
 * confirms teachers do — got generic AI chat, or (a leader) the LP prompt sent
 * again. has_lesson_plan stayed false and Section B scored on nothing: the same
 * outcome bd-5azz0 fixed for the photo paths, reached by a different door.
 *
 * Two-stage by design:
 *   1. looksLikePastedLessonPlan — pure, DB-free, runs on EVERY inbound text.
 *      It is the cost guard, not the verdict: no query is made for ordinary
 *      chat. Deliberately strict, because a false positive eats a message.
 *   2. the authoritative verdict stays where it already lives — the extraction
 *      worker's isLikelyLessonPlan, which reads the PARSED plan. A
 *      paste that turns out to be a leave letter is handled exactly as an
 *      uploaded one is, by the same code, with the same reply.
 *
 * Session resolution reuses media-session-resolver (kind 'lp'), so a paste
 * obeys the same ownership rule as a photo: only a session the sender DRIVES
 * (bd-wwcgf), tapped target first. An AMBIGUOUS gate stands down rather than
 * guessing — text cannot be parked the way media is (media-target stores a
 * media id), so the caller keeps its existing fall-through.
 *
 * Load (pre-merge Class R): zero reads for text that fails the pre-filter; for
 * text that passes, the resolver's usual at-most-two keyed reads.
 */

const { logToFile } = require('../../../utils/logger');

// A plan pasted into WhatsApp is long. Short answers at this step ("no",
// "wait", a teacher's name and number) must never be mistaken for one.
// Measured in CODE POINTS — `.length` over-counts Urdu and emoji.
const MIN_PASTED_LP_CHARS = 280;

// Independent lesson-plan signals, English + Urdu. Counted DISTINCTLY: it is
// how many different parts of a plan the text names, not how often.
const LP_MARKERS = [
  /lesson\s*plan/i,
  /\bobjectives?\b/i,
  /\blearning\s+outcomes?\b/i,
  /\bactivit(?:y|ies)\b/i,
  /\bmaterials?\b/i,
  /\bassessment\b/i,
  /\bhomework\b/i,
  /\bwarm[\s-]?up\b/i,
  /\bstarter\b/i,
  /\bduration\b/i,
  /\bsubject\b/i,
  /\bchapter\b/i,
  /\bgrade\b/i,
  /\bclass\b/i,
  /\blesson\b/i,
  /سبق/,
  /منصوبہ/,
  /مقاصد/,
  /سرگرمی|سرگرمیاں/,
  /مضمون/,
  /جماعت/,
  /دورانیہ/,
  /جانچ/,
  /\bباب\b/,
];

const MIN_MARKERS = 3;
// A plan that names only two parts still reads as a plan when it is LAID OUT
// as one (objectives on their own lines, a numbered activity list).
const MIN_MARKERS_WITH_LAYOUT = 2;
const MIN_LINES_FOR_LAYOUT = 4;

/**
 * Cheap, pure "is this text even worth a database query?" test.
 * @param {string} text - the RAW message body (not lower-cased/trimmed)
 * @returns {boolean}
 */
function looksLikePastedLessonPlan(text) {
  if (typeof text !== 'string') return false;
  const body = text.trim();
  if (!body) return false;
  // Slash commands are explicit intent and are matched further down the
  // handler; consuming one here would swallow it.
  if (body.startsWith('/')) return false;
  if ([...body].length < MIN_PASTED_LP_CHARS) return false;

  const markers = LP_MARKERS.filter((re) => re.test(body)).length;
  if (markers >= MIN_MARKERS) return true;

  const lines = body.split('\n').filter((l) => l.trim()).length;
  return markers >= MIN_MARKERS_WITH_LAYOUT && lines >= MIN_LINES_FOR_LAYOUT;
}

/**
 * Attach a pasted lesson plan to the session waiting for one.
 *
 * @param {{ user: {id:string}, from: string, text: string }} args
 * @returns {Promise<boolean>} true when the text was CONSUMED as a lesson plan;
 *   false means "not mine" and the caller continues its normal routing.
 */
async function tryAttachPastedLessonPlan({ user, from, text }) {
  if (!user || !user.id) return false;
  if (!looksLikePastedLessonPlan(text)) return false;

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

  logToFile('📄 Lesson plan attached from pasted text', {
    coachingSessionId: r.session.id, userId: user.id, chars: [...text.trim()].length,
  });
  return true;
}

module.exports = {
  looksLikePastedLessonPlan,
  tryAttachPastedLessonPlan,
  MIN_PASTED_LP_CHARS,
};
