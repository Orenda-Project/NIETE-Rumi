'use strict';
/**
 * «ٹیچر» is the one word for a teacher in everything a child reads, including the bot's WhatsApp lines to a child:
 * the expired quiz link, the join form's name help, and the "who helped you?" button. The English is unchanged.
 * Exact bytes per line (each string is matched whole, so a stray space or a changed joiner fails too).
 */
const { resolveUx } = require('../../shared/config/ux-strings');
// the senders' own read: ux(key, language) = resolveUx(key, { language })
const getUxString = (key, language) => resolveUx(key, { language });

const CASES = [
  ['vqExpired', 'That quiz link has expired. Ask your teacher for a new one!', 'یہ quiz link ختم ہو چکا ہے۔ اپنے ٹیچر سے نیا link لیں!'],
  ['vqJoinNameHelp', 'So your teacher can see how you did', 'تاکہ آپ کے ٹیچر دیکھ سکیں کہ آپ نے کیسا کیا'],
  ['vqHelpedTeacher', 'My teacher', 'ٹیچر'],
];

describe('the teacher word in the child\'s WhatsApp lines', () => {
  test.each(CASES)('%s: Urdu says «ٹیچر» (never «استاد»); English unchanged', (key, en, ur) => {
    expect(getUxString(key, 'ur')).toBe(ur);
    expect(getUxString(key, 'ur')).not.toContain('استاد');
    expect(getUxString(key, 'en')).toBe(en);
  });
});
