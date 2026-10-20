'use strict';
/**
 * The four reasons a C/D teacher can tick when she does not agree with her coaching report — v10 coaching
 * test, bd-v0toag.38.9 (the teammate's "Do you agree?" prototype). Pure.
 *
 * Codes are stored in coach_visit_requests.reasons and counted by the tracker; the words are shown to her
 * (en/ur) and sent to her coach in the coach's language. `short` is the coach's version where the teacher's
 * one carries an aside.
 */

const REASONS = {
  score: { en: 'My score doesn’t seem right', ur: 'میرا اسکور درست نہیں لگتا' },
  missed: { en: 'I did this, but the report missed it', ur: 'میں نے یہ کیا تھا، رپورٹ نے نہیں پکڑا' },
  wont_work: {
    en: 'This won’t work in my class (too many children, too little time)',
    ur: 'یہ کام میری کلاس میں ممکن نہیں (بچے زیادہ، وقت کم)',
    short: { en: 'This won’t work in my class', ur: 'یہ کام میری کلاس میں ممکن نہیں' },
  },
  unclear: { en: 'I didn’t understand what to do', ur: 'سمجھ نہیں آیا کہ کرنا کیا ہے' },
};

const CODES = Object.keys(REASONS);
const VOICE_ONLY = { en: 'a voice note', ur: 'وائس نوٹ' };

/** Only known codes, once each, in the design order. Accepts one code or a list (a form sends either). */
function cleanReasons(raw) {
  const given = new Set((Array.isArray(raw) ? raw : [raw]).map((x) => String(x == null ? '' : x)));
  return CODES.filter((c) => given.has(c));
}

/** Her reasons on one line for the coach, in the coach's language (en unless 'ur'). */
function reasonText(codes, language) {
  const l = language === 'ur' ? 'ur' : 'en';
  const list = cleanReasons(codes);
  if (!list.length) return VOICE_ONLY[l];
  return list.map((c) => (REASONS[c].short ? REASONS[c].short[l] : REASONS[c][l])).join('; ');
}

module.exports = { REASONS, CODES, cleanReasons, reasonText };
