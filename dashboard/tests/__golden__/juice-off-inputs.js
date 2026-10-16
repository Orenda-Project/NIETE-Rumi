// Fixed inputs for the web_quiz_juice golden (web-quiz-juice-edge.service.test.js): the pages the edge draws with the switch off.
const QUIZ = { quiz: { code: 'TEST01', lang: 'en', topic: 'Plants', n: 2, questions: [] }, cls: { label: 'Class 3' }, brand: 'niete', rt: true };
const QUIZ_UR = { ...QUIZ, quiz: { ...QUIZ.quiz, lang: 'ur' }, ui: { ur2: true } };
const MENU = { lang: 'en', exercises: [{ id: 'read', name: 'Read', mins: 2 }], rt: true, v2: { story: null } };
const MENU_V1 = { lang: 'ur', exercises: [{ id: 'read', name: 'Read', mins: 2 }], rt: false };
module.exports = {
  quiz: (R, extra = {}) => R.renderQuizPage({ payload: { ...QUIZ, ...extra }, code: 'TEST01', view: 'quiz', origin: 'https://x.test', assetV: 'abc1234567', url: 'https://x.test/q/TEST01' }),
  quizUr: (R, extra = {}) => R.renderQuizPage({ payload: { ...QUIZ_UR, ...extra }, code: 'TEST01', view: 'quiz', origin: 'https://x.test', assetV: 'abc1234567', url: 'https://x.test/q/TEST01' }),
  challenge: (R, extra = {}) => R.renderChallengePage({ menu: { ...MENU, ...extra }, token: 'tok12345.abcdefghijklmnopqrstuv', kid: null, origin: 'https://x.test', assetV: 'abc1234567', chV: 'chv1234567', brandKey: 'niete' }),
  challengeV1: (R, extra = {}) => R.renderChallengePage({ menu: { ...MENU_V1, ...extra }, token: 'tok12345.abcdefghijklmnopqrstuv', kid: 'abcdef0123456789', origin: 'https://x.test', assetV: 'abc1234567', chV: 'chv1234567', brandKey: 'niete' }),
};
