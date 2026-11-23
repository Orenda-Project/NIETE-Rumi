'use strict';
/**
 * bd-ptl6x9.7 — the UTILITY template of the weekly weak-skill Jugnu nudge (nudges/weak-skill-jugnu/job.js).
 *
 * A template, not free text: on a Saturday most teachers are outside the 24h window. There is NO free-form fallback;
 * an unapproved template means a logged skip. ONE definition, read by the sender and by whoever submits it to Meta.
 *
 * Body parameters, in order:
 *   {{1}} first name · {{2}} the grade (Urdu digits on the Urdu one) · {{3}} the skill, in words · {{4}} the game's name
 * Button 0 (URL, dynamic suffix): https://<portal>/r/{{1}} with the suffix
 *   <teacher report token>/sfwd?class=<class list id>&ex=<game>&lang=<en|ur>
 *   → the teacher's own phone opens WhatsApp's share sheet with the class link to that game. We send nothing to families.
 *
 * The fixed words carry no digit and no child count; the results behind it are AI-scored and PROPOSED benchmarks
 * from a small sample, so it says "the hardest part" and asks the teacher to take it as a hint.
 * NEVER delete-and-recreate a name: Meta locks a deleted name+language for ~4 weeks. Bump to _v2.
 */

const TEMPLATE = {
  name: 'weak_skill_jugnu_v1',
  category: 'UTILITY',
  bodies: {
    en_US:
      'Assalam o Alaikum {{1}}!\n\nIn the recent maths check at your school, the hardest part for Grade {{2}} '
      + 'children was {{3}}.\n\nJugnu has a short game that practises just this: {{4}}. Children can play it at '
      + 'home on a family phone.\n\nTap the button to send the game to your class\'s families on WhatsApp. It comes '
      + 'from a small check, so please take it as a hint.',
    ur:
      'السلام علیکم {{1}}!\n\nآپ کے سکول میں حالیہ ریاضی کی جانچ میں جماعت {{2}} کے بچوں کے لیے سب سے مشکل حصہ '
      + '{{3}} تھا۔\n\nجگنو کے پاس اسی کی مشق کا ایک چھوٹا سا کھیل ہے: {{4}}۔ بچے اسے گھر پر کسی گھر والے کے فون پر '
      + 'کھیل سکتے ہیں۔\n\nیہ کھیل اپنی جماعت کے والدین کو WhatsApp پر بھیجنے کے لیے بٹن دبائیں۔ یہ ایک چھوٹی سی '
      + 'جانچ سے ہے، اس لیے اسے صرف ایک اشارہ سمجھیں۔',
  },
  buttons: {
    en_US: 'Send to families',
    ur: 'والدین کو بھیجیں',
  },
  examples: {
    en_US: ['Ayesha', '3', 'finding the missing number', 'Missing number'],
    ur: ['عائشہ', '۳', 'غائب عدد تلاش کرنا', 'غائب نمبر'],
  },
};

/** The skill in words, and the game's own name as the child's page shows it (ux-strings wqCh*Name; the trail's warm-up title). */
const WORDS = {
  missing: {
    en: { skill: 'finding the missing number', game: 'Missing number' },
    ur: { skill: 'غائب عدد تلاش کرنا', game: 'غائب نمبر' },
  },
  numbers: {
    en: { skill: 'reading numbers', game: 'Number warm-up' },
    ur: { skill: 'اعداد پہچاننا', game: 'گنتی کا کھیل' },
  },
  bigger: {
    en: { skill: 'telling which number is bigger', game: 'Which is bigger?' },
    ur: { skill: 'بڑا عدد پہچاننا', game: 'کون سا بڑا ہے؟' },
  },
};

module.exports = { TEMPLATE, WORDS };
