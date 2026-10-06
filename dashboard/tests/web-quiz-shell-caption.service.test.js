/**
 * Web quiz page shell: until wq.js boots (about 1.5 s on slow 4G, longer on a cold phone) the page is
 * the server-rendered shell. It showed a lone Jugnu with no words, which reads as a blank, stuck page,
 * most of all right after "Watch another video". The shell now says what is happening, in the quiz's
 * language, under Jugnu.
 */
const { renderQuizPage } = require('../routes/web-quiz.routes');
const { rule } = require('./wq-page-harness');

const quiz = (lang) => ({
  quiz: { id: 'q-1', code: 'AB12CD', topic: lang === 'ur' ? 'پودے' : 'Plants', lang, grade: '3', n: 1, questions: [] },
  cls: { label: 'Class 3', teacher: 'T', chips: [] }, live: {}, video: null,
});
const shell = (lang) => {
  const html = renderQuizPage({ payload: quiz(lang), code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });
  return html.slice(html.indexOf('<main'), html.indexOf('</main>'));
};

describe('the page shell says it is opening', () => {
  test('English: Jugnu and "Opening the quiz…" before the script runs', () => {
    const m = shell('en');
    expect(m).toContain('/wq/jugnu/hello.webp');
    expect(m).toMatch(/<p class="wq-bootsay">Opening the quiz…<\/p>/);
  });

  test('Urdu: the same line in Urdu', () => {
    expect(shell('ur')).toMatch(/<p class="wq-bootsay">کوئز کھل رہا ہے…<\/p>/);
  });

  test('the line sits under Jugnu, readable, in the page font', () => {
    expect(rule('.wq-bootsay')).toMatch(/font-weight:\s*800/);
  });
});
