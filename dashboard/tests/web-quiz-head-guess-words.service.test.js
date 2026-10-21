/**
 * The honest guessed head's words live in the string catalog, not in a language branch (web_quiz_head_guess_honest):
 * the generic title and description are two catalog keys (bot/shared/config/ux-strings.js quizHeadGuessTitle /
 * quizHeadGuessDesc) resolved for the page's language, and the link's language goes through the catalog's one clamp.
 * The words and every head are unchanged (web-quiz-head-guess-honest.service.test.js drives the route); this pins the
 * shape the language rule asks for: no `=== 'ur' ?` decision in the guessed head's code.
 */
const fs = require('fs');
const path = require('path');
const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'web-quiz.routes.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const TERNARY = /===?\s*['"]ur['"]\s*\?/;

test('the catalog holds the guessed head\'s words, EN + UR, the same words as before', () => {
  expect(UX_STRINGS.quizHeadGuessTitle).toEqual({ en: 'Quiz', ur: 'کوئز' });
  expect(UX_STRINGS.quizHeadGuessDesc).toEqual({ en: '{mascot} reads it with you', ur: '{mascot} کے ساتھ پڑھیں' });
  expect(resolveUx('quizHeadGuessDesc', { language: 'en', params: { mascot: 'Jugnu' } })).toBe('Jugnu reads it with you');
  expect(resolveUx('quizHeadGuessDesc', { language: 'ur', params: { mascot: 'جگنو' } })).toBe('جگنو کے ساتھ پڑھیں');
});
test('guessText resolves the catalog keys, with no language ternary', () => {
  const m = /const guessText = [^\n]*(?:\n(?!const |function )[^\n]*)*/.exec(SRC);
  expect(m).not.toBeNull();
  expect(m[0]).not.toMatch(TERNARY);
  expect(m[0]).toContain("resolveUx('quizHeadGuessTitle'");
  expect(m[0]).toContain("resolveUx('quizHeadGuessDesc'");
});
test('the generic guess takes the link\'s language through the catalog\'s clamp, with no language ternary', () => {
  const line = SRC.split('\n').find((l) => l.includes('quiz: { lang: generic'));
  expect(line).toBeDefined();
  expect(line).not.toMatch(TERNARY);
  expect(line).toContain('clampLanguage(linkLang)');
});
