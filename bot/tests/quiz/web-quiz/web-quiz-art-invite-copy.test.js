'use strict';
/**
 * The invite picture's words: gender-neutral Urdu toward the friend (no «آپ … سکتے ہیں»), and a
 * challenger who scored nothing is never a score to beat. Checked with the quiz lane's own
 * address checker (transcript-quiz-address.js addressForms) on the rendered words.
 */
const { renderArt, COPY } = require('../../../shared/templates/web-quiz-art.template');
const { addressForms } = require('../../../shared/services/quiz/transcript-quiz-address');

const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<\/(p|h1|div)>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
const invite = (lang, correct) => text(renderArt({ kind: 'invite', size: 'og', brand: 'niete', lang, d: { first: lang === 'ur' ? 'سعدیہ' : 'Sadia', correct, total: 6, topic: 'Plants' } }));

describe('the invite picture', () => {
  test('every Urdu line of the share pictures is gender-neutral toward the reader', () => {
    const lines = Object.values(COPY.ur).map((v) => (typeof v === 'function' ? v('سعدیہ', '4/6', 'Plants') : v));
    const bad = lines.filter((s) => addressForms(s, { kind: 'explanation' }).length);
    expect(bad).toEqual([]);
    expect(addressForms(invite('ur', 4), { kind: 'explanation' })).toEqual([]);
  });
  test('a real score is the one to beat', () => {
    expect(invite('en', 4)).toContain("Can you beat Sadia's 4/6?");
    expect(invite('ur', 4)).toContain('سعدیہ کے 4/6 سے آگے نکلیں!');
  });
  test('a challenger who scored 0 is not offered as a score to beat, nor shown as a zero', () => {
    const en = invite('en', 0);
    expect(en).toContain('Sadia challenged you!');
    expect(en).not.toContain('0/6');
    expect(invite('ur', 0)).toContain('سعدیہ نے آپ کو چیلنج کیا ہے!');
  });
});
