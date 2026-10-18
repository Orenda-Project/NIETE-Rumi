'use strict';
/**
 * The words of "Send to teacher" (PR-E), both languages. The text is the approved template `fln_plan_open_v1`
 * (UTILITY; submitted as `en` and `ur`). The in-window cta_url message uses the SAME body and button, filled.
 *
 * {{1}} = the sender's role word in the RECIPIENT's language; {{2}} = the plan title in the PLAN's language.
 * Gender-neutral: no pronoun for the sender or the teacher (the Urdu «نے … بھیجا ہے» agrees with «منصوبہ»).
 * Change a body here only together with a new template version: the template text is fixed at Meta.
 */
const FLN_SEND_STRINGS = Object.freeze({
  en: Object.freeze({
    body: 'Your {{1}} has sent you a lesson plan: *{{2}}*. Tap the button to open it in the teacher app. The button works for 24 hours.',
    button: 'Open the lesson',
    // The template's language code as it was submitted to Meta (NOT config/languages templateCodeFor → 'en_US').
    templateLang: 'en',
    roles: Object.freeze({
      coach: 'coach', principal: 'principal', aeo: 'AEO', school_leader: 'school leader', supervisor: 'supervisor',
    }),
  }),
  ur: Object.freeze({
    body: 'آپ کے {{1}} نے آپ کو سبق کا منصوبہ بھیجا ہے: *{{2}}*۔ ٹیچر ایپ میں کھولنے کے لیے نیچے بٹن دبائیں۔ یہ بٹن ۲۴ گھنٹے تک کام کرے گا۔',
    button: 'سبق کھولیں',
    templateLang: 'ur',
    roles: Object.freeze({
      coach: 'کوچ', principal: 'پرنسپل', aeo: 'اے ای او', school_leader: 'اسکول لیڈر', supervisor: 'سپروائزر',
    }),
  }),
});

/** The language pack for a recipient: Urdu for `ur`, English for everything else (NIETE offers en + ur only). */
const FLN_SEND_LANG = Object.freeze({ ur: 'ur' });

module.exports = { FLN_SEND_STRINGS, FLN_SEND_LANG };
