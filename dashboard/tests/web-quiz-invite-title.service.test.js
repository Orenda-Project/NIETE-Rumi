/**
 * The invite link's preview title (og:title): gender-neutral Urdu toward the friend, and no "beat 0/N".
 */
const { renderQuizPage } = require('../routes/web-quiz.routes');
const { addressForms } = require('../../bot/shared/services/quiz/transcript-quiz-address');

const payload = (lang, correct) => ({
  quiz: { id: 'q', code: 'CH12AB', topic: 'Plants', lang, dir: lang === 'ur' ? 'rtl' : 'ltr', n: 1, questions: [] },
  cls: { label: null, teacher: null, chips: [] }, live: {}, invited: true,
  challenge: { first: lang === 'ur' ? 'سعدیہ' : 'Sadia', correct, total: 6 },
  art: { invite: 'i.CH12AB.abcdefghijkl' },
});
const title = (lang, correct) => {
  const html = renderQuizPage({ payload: payload(lang, correct), code: 'CH12AB', view: 'quiz', origin: 'https://x.test', assetV: '1' });
  return (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '';
};

test('Urdu invite title is an imperative, never «آپ … سکتے ہیں»', () => {
  const t = title('ur', 4);
  expect(t).toContain('سعدیہ کے 4/6 سے آگے نکلیں!');
  expect(addressForms(t, { kind: 'explanation' })).toEqual([]);
});
test('a 0/N challenger: "X challenged you", never "beat X\'s 0/6"', () => {
  expect(title('en', 0)).toMatch(/^Sadia challenged you/);
  expect(title('en', 0)).not.toContain('0/6');
  expect(title('ur', 0)).toContain('سعدیہ نے آپ کو چیلنج کیا ہے');
  expect(title('en', 4)).toMatch(/^Can you beat Sadia(&#39;|')s 4\/6\?/);
});
