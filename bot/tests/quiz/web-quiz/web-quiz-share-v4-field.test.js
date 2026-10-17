'use strict';
/**
 * The one share's switch on the quiz finish and the Jugnu menu (app_settings web_quiz_share_v4, on top of
 * web_quiz_card_v3; default OFF): the field says `share_v4` only when both are JSON true, read in the card's own one
 * settings read (the same 30 s cache), so the number of settings reads is today's whatever the new key holds.
 * Switch off (absent, false, the string "true", 1): the field is today's, byte for byte.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Card = require('../../../shared/services/quiz/web-quiz-card-image');

let reads = 0;
function useSettings(rows) {
  const fake = makeFake({ app_settings: rows });
  reads = 0;
  Object.assign(supabase, { from: (t) => { if (t === 'app_settings') reads += 1; return fake.from(t); } });
  Card._reset();
}
const CARD_ON = { key: 'web_quiz_card_v3', value: true };

describe('the field', () => {
  test('both on: {card_v3, share_v4}; one settings read for both, cached', async () => {
    useSettings([CARD_ON, { key: 'web_quiz_share_v4', value: true }]);
    expect(await Card.field()).toEqual({ card_v3: true, share_v4: true });
    expect(await Card.shareOn()).toBe(true);
    expect(await Card.field()).toEqual({ card_v3: true, share_v4: true });
    expect(reads).toBe(1);
  });
  test.each([
    ['absent', []],
    ['false', [{ key: 'web_quiz_share_v4', value: false }]],
    ['the string "true"', [{ key: 'web_quiz_share_v4', value: 'true' }]],
    ['1', [{ key: 'web_quiz_share_v4', value: 1 }]],
    ['{}', [{ key: 'web_quiz_share_v4', value: {} }]],
  ])('share key %s: today\'s field and today\'s one read', async (_, rows) => {
    useSettings([CARD_ON, ...rows]);
    expect(await Card.field()).toEqual({ card_v3: true });
    expect(await Card.shareOn()).toBe(false);
    expect(await Card.field()).toEqual({ card_v3: true });
    expect(reads).toBe(1);
  });
  test('the card off: nothing, even with the share key on', async () => {
    useSettings([{ key: 'web_quiz_share_v4', value: true }]);
    expect(await Card.field()).toEqual({});
    expect(await Card.shareOn()).toBe(false);
  });
  test('a failed read: off, nothing added', async () => {
    Object.assign(supabase, { from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'down' } }) }) }) });
    Card._reset();
    expect(await Card.field()).toEqual({});
    expect(await Card.shareOn()).toBe(false);
  });
});
