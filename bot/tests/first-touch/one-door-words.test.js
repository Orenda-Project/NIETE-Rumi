'use strict';
/**
 * Which words are a quiz request under the one door, and which source they carry (the quiz_cmd event's src):
 * the class message's line prefills exactly `quiz` (class_msg), the shared card's `quiz please` / «کوئز دکھائیں»
 * (card_share); `/quiz` and every other spelling are typed. The bot's own name `jugnu` / «جگنو», a JUGNU- or QUIZ- code
 * and STOP are NEVER quiz-shaped, so they keep their own handlers and never reach the resolver.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const fs = require('fs');
const path = require('path');
const { isQuizMenuRequest } = require('../../shared/services/quiz/quiz-menu-request');
const OneDoor = require('../../shared/services/first-touch/one-door.service');
const Words = require('../../shared/services/first-touch/one-door.words');
const Strings = require('../../shared/services/first-touch/one-door.strings');

test.each([
  ['/quiz', 'text', 'typed'], ['/Quiz fractions', 'text', 'typed'], ['quiz', 'text', 'class_msg'], ['Quiz', 'text', 'class_msg'],
  ['quiz please', 'text', 'card_share'], ['Quiz please!', 'text', 'card_share'], ['کوئز دکھائیں', 'text', 'card_share'],
  ['mera quiz', 'text', 'typed'], ['کوئز', 'text', 'typed'], ['', 'menu', 'menu'], ['', 'home', 'home'],
])('%s via %s → src %s', (body, door, src) => {
  expect(OneDoor.srcOf(body, door)).toBe(src);
});

test.each(['quiz please', 'کوئز دکھائیں', 'quiz', '/quiz'])('%s is quiz-shaped today (the door needs no new word)', (t) => {
  expect(isQuizMenuRequest(t)).toBe(true);
});

test.each(['jugnu', 'Jugnu', 'جگنو', 'JUGNU-7KQ2', 'jugnu-abcd', 'QUIZ-AB12CD', 'quiz-ab12', 'STOP', 'stop', 'jugnu what is a noun'])('%s is not quiz-shaped (its own handler keeps it)', (t) => {
  expect(isQuizMenuRequest(t)).toBe(false);
});

test('the card words are ONE list: the card module\'s CARD_RETURN_WORDS when it is on this branch', () => {
  const card = path.join(__dirname, '..', '..', 'shared', 'services', 'quiz', 'web-quiz-card-image.js');
  if (!fs.existsSync(card)) return;
  const src = fs.readFileSync(card, 'utf8');
  if (!/CARD_RETURN_WORDS/.test(src)) return;
  for (const w of Words.CARD_WORDS) expect(src).toContain(w);
});

test('the reply body per side and script: teacher / unknown in Urdu or both; buttons ≤ 20 code points; no URL in a body', () => {
  for (const side of ['teacher', 'unknown', 'child', 'join']) {
    for (const lang of ['ur', 'bi', 'en']) {
      const m = OneDoor.messageFor(side, lang);
      expect(m.body.length).toBeGreaterThan(10);
      expect(m.body.length).toBeLessThanOrEqual(1024);
      expect([...m.button].length).toBeLessThanOrEqual(20);
      expect(m.body).not.toMatch(/https?:\/\//);
    }
  }
  expect(OneDoor.messageFor('teacher', 'ur')).toEqual({ body: expect.stringContaining('آپ کا کوئز ہوم'), button: 'کوئز ہوم کھولیں' });
  expect(OneDoor.messageFor('child', 'en')).toEqual({ body: 'Your stories, games and videos are here.', button: 'Open' });
  expect(OneDoor.messageFor('child', 'ur').body).not.toContain('چیلنج');
});

test('the three notice sentences are the child page\'s signed words, verbatim', () => {
  const bind = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'dashboard', 'public', 'wq', 'wq-bind.js'), 'utf8');
  const pieces = (id, lang) => Strings.str(id, lang).split('{first}');
  for (const lang of ['en', 'ur']) {
    for (const id of ['cl.notice.save', 'cl.notice.stop', 'cl.notice.readings']) {
      for (const piece of pieces(id, lang)) {
        const p = piece.replace(/[\u2066-\u2069]/g, '');
        if (p.trim()) expect(bind.replace(/[\u2066-\u2069]/g, '')).toContain(p.length > 60 ? p.slice(0, 60) : p);
      }
    }
  }
});

describe('the known child\'s /quiz reply names the home\'s doors, in the home\'s own words and order', () => {
  // the home's door words, read from the child home's own copy (never copied here): stories · games · videos
  const home = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'dashboard', 'public', 'wq', 'wq-home.js'), 'utf8');
  const doors = (lang) => {
    const block = home.split(new RegExp(`\\n\\s*${lang}: \\{`))[1] || '';
    const m = block.match(/stories: '([^']+)', games: '([^']+)', videos: '([^']+)'/);
    return m ? m.slice(1, 4) : null;
  };

  test('the exact lines (EN and the signed Urdu)', () => {
    expect(Strings.str('od.child.body', 'en')).toBe('Your stories, games and videos are here.');
    expect(Strings.str('od.child.body', 'ur')).toBe('آپ کی کہانیاں، کھیل اور ویڈیوز یہاں ہیں۔');
  });

  test.each([['en'], ['ur']])('%s: the three door words appear in the bar\'s order, and no quiz word', (lang) => {
    const words = doors(lang);
    expect(words).toHaveLength(3);
    const body = Strings.str('od.child.body', lang);
    const at = words.map((w) => body.toLocaleLowerCase().indexOf(w.toLocaleLowerCase()));
    at.forEach((i) => expect(i).toBeGreaterThanOrEqual(0));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(body).not.toMatch(/quiz|کوئز/i);
  });
});
