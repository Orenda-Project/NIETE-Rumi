'use strict';
/**
 * bd-v0toag.45 — the UTILITY template that asks a coach to observe a teacher who disagreed with her AI
 * coaching report (v10 coaching test, groups C and D only).
 *
 * A template, not free text: a coach has usually not messaged the bot in the last 24h, and outside that
 * window Meta only delivers an approved template.
 *
 * ONE definition, read by both the sender (dashboard/services/coach-visit-request.js) and the registrar
 * (bot/scripts/register-coach-visit-request-template.js), so the body Meta approved and the parameters we
 * fill cannot drift apart.
 *
 * Parameters, always in this order:
 *   {{1}} coach first name · {{2}} teacher name · {{3}} school
 *
 * Keys are META template language codes (`en_US`, not `en` — see config/languages.templateCodeFor).
 *
 * NEVER delete-and-recreate a name — Meta locks a deleted name+language for ~4 weeks (error 2388023).
 * To change a body, bump the name (_v2).
 */

const TEMPLATE = {
  name: 'coach_visit_request_v1',
  bodies: {
    en_US:
      'Assalam o Alaikum {{1}}!\n\n{{2}} at {{3}} disagreed with an AI coaching report on their class and has '
      + 'asked for a classroom observation visit.\n\nPlease plan a visit when you can.',
    ur:
      'السلام علیکم {{1}}!\n\n{{3}} سے {{2}} اپنی کلاس کی AI کوچنگ رپورٹ سے متفق نہیں ہیں اور انہوں نے کلاس کے '
      + 'مشاہدے کے دورے کی درخواست کی ہے۔\n\nبراہِ کرم جب ممکن ہو دورہ طے کریں۔',
  },
};

// Meta needs an example value for every variable when a template is submitted.
const EXAMPLES = {
  en_US: ['Sana', 'Ayesha Khan', 'IMSG I-8/1'],
  ur: ['ثنا', 'عائشہ خان', 'IMSG I-8/1'],
};

/**
 * bd-v0toag.38.9 — v2, sent from the "Do you agree?" ping: the coach also sees her score, the reasons she
 * ticked and a link to the coach card (her section scores and voice note). Until Meta approves v2 the sender
 * falls back to v1, so the coach is still pinged.
 *   {{1}} coach first name · {{2}} teacher name · {{3}} school · {{4}} score · {{5}} her reasons · {{6}} card link
 */
const TEMPLATE_V2 = {
  name: 'coach_visit_request_v2',
  bodies: {
    en_US:
      'Assalam o Alaikum {{1}}!\n\n{{2}} at {{3}} does not agree with their AI coaching report ({{4}}).\n\n'
      + 'What they said: {{5}}\n\nTheir report and voice note: {{6}}\n\nPlease visit the class when you can.',
    ur:
      'السلام علیکم {{1}}!\n\n{{3}} سے {{2}} اپنی AI کوچنگ رپورٹ ({{4}}) سے متفق نہیں ہیں۔\n\n'
      + 'انہوں نے کہا: {{5}}\n\nان کی رپورٹ اور وائس نوٹ: {{6}}\n\nبراہِ کرم جب ممکن ہو ان کی کلاس کا دورہ کریں۔',
  },
};

const EXAMPLES_V2 = {
  en_US: ['Sana', 'Ayesha Khan', 'IMSG I-8/1', '64%', 'My score doesn’t seem right', 'https://portal.niete.edu.pk/cv/abc'],
  ur: ['ثنا', 'عائشہ خان', 'IMSG I-8/1', '64%', 'میرا اسکور درست نہیں لگتا', 'https://portal.niete.edu.pk/cv/abc'],
};

module.exports = { TEMPLATE, EXAMPLES, TEMPLATE_V2, EXAMPLES_V2 };
