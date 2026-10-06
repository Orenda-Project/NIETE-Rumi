/**
 * The web-quiz edge module loads where express-rate-limit is missing (the root CI run installs no
 * dashboard dependencies): only creating the router needs it.
 */
jest.mock('express-rate-limit', () => { throw new Error("Cannot find module 'express-rate-limit'"); }, { virtual: true });

test('routes/web-quiz.routes loads and renders a page without express-rate-limit', () => {
  let R;
  expect(() => { R = require('../routes/web-quiz.routes'); }).not.toThrow();
  const html = R.renderQuizPage({ payload: { quiz: { code: 'AB12CD', topic: 'Plants', lang: 'en', dir: 'ltr', n: 1, questions: [] }, cls: {}, live: {} }, code: 'AB12CD', view: 'quiz', origin: 'https://x.test', assetV: '1' });
  expect(html).toContain('og:title');
});
