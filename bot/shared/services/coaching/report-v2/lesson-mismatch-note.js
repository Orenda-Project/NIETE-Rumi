'use strict';
/**
 * bd-r2uzg1.12 (ICT sheet DC row 142, plan #10) — one soft line on a report the grader read as a different lesson.
 *
 * The grader sets `lp_fidelity.moderators.note = 'lesson_mismatch'` when it judges the recording to be a different
 * lesson from the chosen plan. Section B then scores low and its why-line explains that with the plan's moves. The
 * operator (13 Nov): "I dont know how reliably we can tell if the lesson was mismatched. How about if we add both?
 * We say low score but also Perhaps you chose a different lesson?" So nothing is taken away — the score and the
 * model's why stay — and this catalogue sentence follows the why-line, in the report's language.
 *
 * Only on the teacher's own (Digital Coach) recording: on a coach visit (`observation_type` set) the coach chose the
 * plan, and "the lesson plan you chose" would be addressed to the wrong person. The line claims nothing about the
 * score, so a flagged Section B that kept some marks gets it too.
 *
 * Written in code, from the catalogue (Rule 20), never asked of the narrative model: the line must say the same thing
 * every time. Pure: the hero image (hero-report.service.js) and the portal's report page (coaching-report-view.js)
 * both read it, so the two surfaces cannot drift.
 */

const SECTION_B = 'lesson_plan_fidelity';

function isFlagged(analysis) {
  const lp = analysis && analysis.lp_fidelity;
  return !!(lp && lp.moderators && lp.moderators.note === 'lesson_mismatch');
}

/** The line in the report's language, or null when this report does not get it. Never throws on a render path. */
function lessonMismatchNote(analysis, session, language) {
  if (!isFlagged(analysis)) return null;
  if (session && session.observation_type) return null;
  const { resolveUx } = require('../../../config/ux-strings');
  return resolveUx('reportLpMismatchSoft', { language });
}

/** `why` followed by the line; the line alone when there is no why; unchanged when the line is already there. */
function withNote(why, note) {
  const existing = typeof why === 'string' ? why.trim() : '';
  if (existing.includes(note)) return why;
  return existing ? `${existing} ${note}` : note;
}

/** Appends the line to the Section B row's why. Mutates and returns `groups`; idempotent; a no-op when not flagged. */
function attachLessonMismatchNote(groups, analysis, session, language) {
  const note = lessonMismatchNote(analysis, session, language);
  if (!note) return groups;
  for (const g of (groups || [])) {
    // A not-assessed Section B keeps its own code-written line ("no lesson plan was provided …").
    if (!g || g.notAssessed || (g.domainKey || g.key) !== SECTION_B) continue;
    g.why = withNote(g.why, note);
  }
  return groups;
}

module.exports = { lessonMismatchNote, attachLessonMismatchNote, withNote };
