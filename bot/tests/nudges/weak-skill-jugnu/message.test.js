'use strict';
/**
 * bd-ptl6x9.7 — the template and the call built from it: no child count or rate anywhere, Urdu digits on an Urdu
 * message, Meta's caps, the button carrying the teacher's report token + class list + game.
 */
const T = require('../../../shared/templates/weak-skill-jugnu.template');
const { buildMessage } = require('../../../shared/services/nudges/weak-skill-jugnu/message');

const cp = (s) => [...s].length;
const vars = (body) => (body.match(/\{\{\d+\}\}/g) || []).length;
const LIST = '11111111-2222-3333-4444-555555555555';
const args = (lang, game = 'missing') => ({
  picked: { egma: 'ma.missing4', game }, grade: 3, token: 'tok.en', listId: LIST, teacher: { name: 'Ayesha Khan', preferred_language: lang },
});

test('one template, en_US and ur, four body variables each, under Meta\'s caps', () => {
  expect(T.TEMPLATE.name).toBe('weak_skill_jugnu_v1');
  for (const code of ['en_US', 'ur']) {
    expect(vars(T.TEMPLATE.bodies[code])).toBe(4);
    expect(cp(T.TEMPLATE.bodies[code])).toBeLessThanOrEqual(1024);
    expect(cp(T.TEMPLATE.buttons[code])).toBeLessThanOrEqual(20);
    expect(T.TEMPLATE.examples[code]).toHaveLength(4);
  }
});

test('the fixed words carry no digit (no count can hide in the template)', () => {
  for (const code of ['en_US', 'ur']) {
    expect(T.TEMPLATE.bodies[code].replace(/\{\{\d+\}\}/g, '')).not.toMatch(/[0-9۰-۹٠-٩]/);
  }
});

test('the wording stays soft: never "weak", "fail" or "behind"', () => {
  expect(T.TEMPLATE.bodies.en_US).not.toMatch(/weak|fail|behind|poor/i);
});

test('English: name, grade, skill, game, and the button suffix', () => {
  const m = buildMessage(args('en'));
  expect(m).toMatchObject({ template: 'weak_skill_jugnu_v1', languageCode: 'en_US', language: 'en', game: 'missing' });
  const [body, button] = m.components;
  expect(body.parameters.map((p) => p.text)).toEqual(['Ayesha', '3', 'finding the missing number', 'Missing number']);
  expect(button).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: `tok.en/sfwd?class=${LIST}&ex=missing&lang=en` }] });
});

test('Urdu: Urdu digits, Urdu words, the Urdu template', () => {
  const m = buildMessage(args('ur', 'numbers'));
  expect(m.languageCode).toBe('ur');
  const p = m.components[0].parameters.map((x) => x.text);
  expect(p[1]).toBe('۳');
  expect(p[3]).toBe('گنتی کا کھیل');
  expect(m.components[1].parameters[0].text).toMatch(/&ex=numbers&lang=ur$/);
});

test('every game has words in both languages', () => {
  for (const game of ['missing', 'numbers', 'bigger']) {
    for (const lang of ['en', 'ur']) {
      const p = buildMessage(args(lang, game)).components[0].parameters.map((x) => x.text);
      expect(p[2] && p[3]).toBeTruthy();
    }
  }
});

test('no name → "Teacher"; an unknown game or no token → null', () => {
  expect(buildMessage({ ...args('en'), teacher: {} }).components[0].parameters[0].text).toBe('Teacher');
  expect(buildMessage({ ...args('en'), picked: { game: 'read' } })).toBeNull();
  expect(buildMessage({ ...args('en'), token: null })).toBeNull();
});
