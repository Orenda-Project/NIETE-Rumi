'use strict';
/**
 * Observe — the second-person gender check on what the model wrote. LOG ONLY.
 *
 * Three observe surfaces are written by a model in the reader's language and
 * speak to a person whose gender we do not hold: the debrief guide (read to the
 * teacher by the coach), the coach-feedback card (to the coach) and the note
 * beside the teacher's report (to the teacher). Their prompts carry the Urdu
 * address rule (config/gender-neutral-address.js URDU_ADDRESS_RULE); this is
 * the deterministic half — the same second-person check the quiz runs
 * (services/quiz/transcript-quiz-address.js) — so the rate of «آپ … کرتے ہیں» /
 * «آپ … کرتی ہیں» that still gets through is a number on
 * `observe.gendered_address`, not a guess.
 *
 * It never fails, never blocks and never re-asks the model: a coach standing in
 * a school waits on the guide, and a teacher's report is not held back over a
 * verb. Nothing here changes what is sent. Measure first; if the rate stays up
 * after the prompt fix, a repair can be added where it is worth an LLM call.
 */

const StructuredLogger = require('../../utils/structured-logger');
const { logToFile } = require('../../utils/logger');
const { addressForms } = require('../quiz/transcript-quiz-address');

// How the check reads a line: a line SAID to someone (often a question) may
// leave آپ unsaid — «کل کیا آزمائیں گے؟» — so a subjectless future counts there;
// a line WRITTEN to someone counts one only once it already speaks to them as آپ.
const SAID = 'stem';
const WRITTEN = 'feedback';

/** The debrief guide, both shapes: the ur/en 3+1 sections and the six steps. */
function guideFields(guide) {
  const g = guide || {};
  const out = [['intro', WRITTEN, g.intro], ['outro', WRITTEN, g.outro], ['reflection_question', SAID, g.reflection_question]];
  Object.entries(g.sections || {}).forEach(([key, v]) => {
    const s = v || {};
    out.push([`sections.${key}.title`, WRITTEN, s.title], [`sections.${key}.body`, WRITTEN, s.body], [`sections.${key}.say_this`, SAID, s.say_this]);
  });
  (Array.isArray(g.steps) ? g.steps : []).forEach((v, i) => {
    const s = v || {};
    out.push([`steps.${i}.title`, WRITTEN, s.title], [`steps.${i}.body`, WRITTEN, s.body], [`steps.${i}.say_this`, SAID, s.say_this]);
  });
  return out;
}

/**
 * The coach-feedback card. The "evidence" fields are left out: the prompt asks
 * for the officer's OWN words there, and a verbatim line the officer really
 * said to the teacher («… آپ کلاس میں سوال پوچھیں گی») is a record of the
 * conversation, not the card guessing anyone's gender.
 */
function feedbackFields(fb) {
  const f = fb || {};
  const out = [['praise_line', WRITTEN, f.praise_line], ['reflection_question', SAID, f.reflection_question]];
  (Array.isArray(f.wins) ? f.wins : []).forEach((w, i) => out.push([`wins.${i}.behaviour`, WRITTEN, w && w.behaviour]));
  ['what_happened', 'why_it_matters', 'instead'].forEach((k) => out.push([`concern.${k}`, WRITTEN, f.concern && f.concern[k]]));
  ['move', 'instead'].forEach((k) => out.push([`try.${k}`, WRITTEN, f.try && f.try[k]]));
  return out;
}

/** The note beside the teacher's report. */
function notesFields(notes) {
  const n = notes || {};
  return [['discussed_sw', WRITTEN, n.discussed_sw], ['commitment_sw', WRITTEN, n.commitment_sw]];
}

/**
 * Run the check over one surface's fields and log what it finds.
 * @param {string} surface   'debrief_guide' | 'coach_feedback' | 'teacher_notes'
 * @param {[string, string, string][]} fields  [name, kind, text]
 * @param {object} meta      sessionId, language — carried onto the event
 * @returns {{field:string, forms:string[]}[]}  never throws
 */
function noteGenderedAddress(surface, fields, meta = {}) {
  try {
    const hits = [];
    (fields || []).forEach(([field, kind, text]) => {
      if (typeof text !== 'string' || !text.trim()) return;
      const forms = addressForms(text, { kind });
      if (forms.length) hits.push({ field, forms });
    });
    if (hits.length) {
      StructuredLogger.logEvent('observe.gendered_address', {
        surface,
        ...meta,
        fields: hits.map((h) => h.field),
        forms: [...new Set(hits.flatMap((h) => h.forms))].slice(0, 8),
        count: hits.reduce((n, h) => n + h.forms.length, 0),
      });
    }
    return hits;
  } catch (err) {
    logToFile('⚠️ observe: gendered-address check failed (non-fatal, nothing withheld)', { surface, error: err.message }, 'warn');
    return [];
  }
}

module.exports = {
  noteGenderedAddress, guideFields, feedbackFields, notesFields,
};
