'use strict';
/**
 * v10 coaching test (bd-v0toag.55): why the thing to try matters, one line per high-leverage practice
 * (practice-tag.js PRACTICES). A teacher who swaps the plan's move for one of her own still gets credit
 * (the grader's substituted_* verdicts); this line tells her what the move is FOR, so her swap can do the
 * same job (Amena, 14 Oct). Shown under the move on the report page. Pure, no imports.
 */

const WHY = {
  C1: {
    en: 'A good question makes every child think, not only the one who answers, and shows you who has understood.',
    ur: 'اچھا سوال ہر بچے کو سوچنے پر لگاتا ہے، صرف جواب دینے والے کو نہیں، اور آپ کو دکھاتا ہے کہ کس نے سمجھا۔',
  },
  C3: {
    en: 'Checking work while children are still learning lets you fix a mistake today, before it sets in.',
    ur: 'بچوں کا کام سیکھنے کے دوران دیکھنے سے آپ غلطی آج ہی ٹھیک کر سکتی ہیں، اس سے پہلے کہ وہ پکی ہو جائے۔',
  },
  C4: {
    en: 'When every child has to answer, quiet children learn too, and you can see who is lost.',
    ur: 'جب ہر بچے کو جواب دینا ہو تو خاموش بچے بھی سیکھتے ہیں، اور آپ دیکھ سکتی ہیں کہ کون پیچھے رہ گیا ہے۔',
  },
  C6: {
    en: 'A clear routine saves minutes in every lesson, and those minutes go to learning.',
    ur: 'واضح معمول ہر سبق میں کچھ منٹ بچاتا ہے، اور وہ منٹ سیکھنے میں لگتے ہیں۔',
  },
  C8: {
    en: 'Children copy what they see. Showing each step out loud lets them do it on their own.',
    ur: 'بچے وہی کرتے ہیں جو دیکھتے ہیں۔ ہر قدم بول کر دکھانے سے وہ اسے خود کر پاتے ہیں۔',
  },
  C9: {
    en: 'Working with a partner makes children put the idea in their own words, and that is how it sticks.',
    ur: 'ساتھی کے ساتھ کام کرنے سے بچے بات اپنے لفظوں میں کہتے ہیں، اور اسی طرح وہ یاد رہتی ہے۔',
  },
  C11: {
    en: 'Checking their own or a partner\'s work teaches children what good work looks like.',
    ur: 'اپنا یا ساتھی کا کام جانچنے سے بچے سیکھتے ہیں کہ اچھا کام کیسا ہوتا ہے۔',
  },
};

/** The why line for a practice tag, in en or ur (anything else is English); null for an unknown tag. */
function practiceWhy(tag, language) {
  const line = WHY[tag];
  if (!line) return null;
  return language === 'ur' ? line.ur : line.en;
}

module.exports = { practiceWhy, WHY };
