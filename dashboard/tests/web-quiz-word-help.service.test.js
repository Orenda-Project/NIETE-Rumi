/**
 * bd-0q8b4x — Urdu word help on the child quiz page. The page loads wq-words.js only when a
 * question carries `words` (the server sends them only while app_settings quiz_word_help is on);
 * otherwise the page is exactly today's. WQW.html draws each word with its Urdu meaning, escaped.
 */
const { renderQuizPage } = require('../routes/web-quiz.routes');
const WQW = require('../public/wq/wq-words');

const page = (questions) => renderQuizPage({
  payload: { quiz: { id: 'q', code: 'AB12CD', topic: 'The farmer', lang: 'en', dir: 'ltr', grade: '4', n: questions.length, questions }, cls: { label: 'Class 4', teacher: null, chips: [] }, live: {} },
  code: 'AB12CD', view: 'quiz', origin: 'https://example.test', assetV: 'v1',
});
const Q = { qid: 'a', i: 1, text: 'When does the farmer harvest wheat?', options: [] };

test('no words: the page does not load the word strip', () => {
  expect(page([Q])).not.toContain('wq-words.js');
});

test('words: the page loads the word strip before wq.js', () => {
  const html = page([{ ...Q, words: [{ en: 'harvest', ur: 'فصل کاٹنا' }] }]);
  expect(html).toContain('/wq/wq-words.js?v=v1');
  expect(html.indexOf('wq-words.js')).toBeLessThan(html.indexOf('/wq/wq.js'));
});

describe('WQW.html', () => {
  test('nothing for a question without words', () => {
    expect(WQW.html(Q)).toBe('');
    expect(WQW.html({ ...Q, words: [{ en: 'x' }] })).toBe('');
  });
  test('each word in English with its Urdu meaning, at most 3, escaped', () => {
    const h = WQW.html({ ...Q, words: [{ en: 'harvest', ur: 'فصل کاٹنا' }, { en: '<b>', ur: 'ا' }, { en: 'c', ur: 'ب' }, { en: 'd', ur: 'پ' }] });
    expect(h).toContain('<b lang="en">harvest</b><span lang="ur" dir="rtl">فصل کاٹنا</span>');
    expect(h).toContain('&lt;b&gt;');
    expect((h.match(/class="wq-word"/g) || []).length).toBe(3);
  });
});
