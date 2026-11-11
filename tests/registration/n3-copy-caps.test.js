'use strict';
/**
 * "Is this you?": the words fit WhatsApp's Flow limits in both languages, and the Urdu keeps mixed-direction pieces in
 * order (plan N3, section 4; language-protocol sections 3 and 9). Measured in code points, never .length.
 *   heading 80, radio label 30, each option 30, footer 35, body 4096.
 * In Urdu, the name and the school are isolated with FSI..PDI (their direction is unknowable when the copy is written)
 * and the two digits, a piece of a phone number, with LRI..PDI. Fewer than two digits picks the body without digits.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({}));
jest.mock('../../bot/shared/services/reading/passage-generation.service', () => ({}));
jest.mock('../../bot/shared/services/reading/auto-level-orchestrator.service', () => ({}));

const { screenCopy } = require('../../bot/shared/routes/registration-endpoint');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');

const cp = (s) => [...String(s)].length;
const FSI = '⁨';
const LRI = '⁦';
const PDI = '⁩';
const LONG = { en: { name: 'Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', school: 'Bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  ur: { name: 'عائشہعائشہعائشہعائشہعائشہعائشہ', school: 'سکولسکولسکولسکولسکولسکولسکولسک' } };

test.each(['en', 'ur'])('C1: every IS_THIS_YOU string fits its field in %s, with a 30-character name and school', (lang) => {
  const c = screenCopy('IS_THIS_YOU', lang, { ...LONG[lang], last2: '47' });
  expect(cp(c.t_heading)).toBeLessThanOrEqual(80);
  expect(cp(c.t_answer_label)).toBeLessThanOrEqual(30);
  for (const a of c.answers) expect(cp(a.title)).toBeLessThanOrEqual(30);
  expect(cp(c.t_next)).toBeLessThanOrEqual(35);
  expect(cp(c.t_body)).toBeLessThanOrEqual(4096);
  expect(c.answers.map((a) => a.id)).toEqual(['yes', 'no', 'not_sure']);
});

test('C1: a name or school over 30 characters is cut to 30 before it reaches the body', () => {
  const c = screenCopy('IS_THIS_YOU', 'en', { name: 'N'.repeat(45), school: 'S'.repeat(45), last2: '47' });
  expect(c.t_body).not.toContain('N'.repeat(31));
  expect(c.t_body).not.toContain('S'.repeat(31));
});

test('C2: the Urdu body isolates name and school with FSI..PDI and the digits with LRI..PDI', () => {
  const c = screenCopy('IS_THIS_YOU', 'ur', { name: 'عائشہ', school: 'IMSG G-9/1', last2: '47' });
  expect(c.t_body).toContain(`${FSI}عائشہ${PDI}`);
  expect(c.t_body).toContain(`${FSI}IMSG G-9/1${PDI}`);
  expect(c.t_body).toContain(`${LRI}47${PDI}`);
  const raw = UX_STRINGS.regFormItuBody.ur;
  expect(raw).toContain(`${FSI}{name}${PDI}`);
  expect(raw).toContain(`${FSI}{school}${PDI}`);
  expect(raw).toContain(`${LRI}{last2}${PDI}`);
});

test.each([[null], [''], ['7'], ['abc'], ['4']])('C3: last2 %p picks the body with no digits', (last2) => {
  for (const lang of ['en', 'ur']) {
    const school = 'IMSG Shahzad Town';                    // a school name without digits of its own
    const c = screenCopy('IS_THIS_YOU', lang, { name: 'Ayesha', school, last2 });
    expect(c.t_body).toBe(screenCopy('IS_THIS_YOU', lang, { name: 'Ayesha', school, last2: null }).t_body);
    expect(c.t_body).not.toMatch(/\d/);
    expect(c.t_body).not.toContain(LRI);
  }
});

test('the new strings exist in both languages, with no em or en dash', () => {
  const keys = ['regFormItuHeading', 'regFormItuBody', 'regFormItuBodyNoDigits', 'regFormItuLabel', 'regFormItuYes',
    'regFormItuNo', 'regFormItuNotSure', 'regDoneClaimed', 'regDoneReview'];
  for (const k of keys) {
    for (const lang of ['en', 'ur']) {
      expect(typeof (UX_STRINGS[k] && UX_STRINGS[k][lang])).toBe('string');
      expect(UX_STRINGS[k][lang]).not.toMatch(/[–—]/);
    }
  }
});
