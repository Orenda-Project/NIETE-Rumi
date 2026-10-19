'use strict';
/**
 * The corrected Urdu share words (app_settings web_quiz_ur_share_copy, default OFF): the switch rides the finish
 * card's one settings read (the same 30 s cache, no read of its own), and every page payload that carries the card's
 * field names `ur_share: true` only when the key is JSON true, with the card on or off. The share preview's facts keep
 * it, so a class link's preview speaks the same words. Off (absent, false, the string "true", 1): today's field.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Card = require('../../../shared/services/quiz/web-quiz-card-image');
const Og = require('../../../shared/services/quiz/web-quiz-og');

let reads = 0;
function useSettings(rows) {
  const fake = makeFake({ app_settings: rows });
  reads = 0;
  Object.assign(supabase, { from: (t) => { if (t === 'app_settings') reads += 1; return fake.from(t); } });
  Card._reset();
}
const CARD_ON = { key: 'web_quiz_card_v3', value: true };
const SHARE_ON = { key: 'web_quiz_share_v4', value: true };
const UR_ON = { key: 'web_quiz_ur_share_copy', value: true };

describe('the field', () => {
  test('on with the card: {card_v3, ur_share}; one settings read, cached', async () => {
    useSettings([CARD_ON, UR_ON]);
    expect(await Card.field()).toEqual({ card_v3: true, ur_share: true });
    expect(await Card.field()).toEqual({ card_v3: true, ur_share: true });
    expect(reads).toBe(1);
  });
  test('on with the card and the one share: all three', async () => {
    useSettings([CARD_ON, SHARE_ON, UR_ON]);
    expect(await Card.field()).toEqual({ card_v3: true, share_v4: true, ur_share: true });
  });
  test('on with the card off: {ur_share} alone (the words are fixed where the card is not drawn too); the card stays off', async () => {
    useSettings([UR_ON]);
    expect(await Card.field()).toEqual({ ur_share: true });
    expect(await Card.on()).toBe(false);
    expect(await Card.shareOn()).toBe(false);
    expect(reads).toBe(1);
  });
  test.each([
    ['absent', []],
    ['false', [{ key: 'web_quiz_ur_share_copy', value: false }]],
    ['the string "true"', [{ key: 'web_quiz_ur_share_copy', value: 'true' }]],
    ['1', [{ key: 'web_quiz_ur_share_copy', value: 1 }]],
    ['{}', [{ key: 'web_quiz_ur_share_copy', value: {} }]],
  ])('key %s: today\'s field, card on or off, and one read', async (_, rows) => {
    useSettings([CARD_ON, ...rows]);
    expect(await Card.field()).toEqual({ card_v3: true });
    expect(reads).toBe(1);
    useSettings(rows);
    expect(await Card.field()).toEqual({});
    expect(reads).toBe(1);
  });
  test('the combined read fails: off (the card\'s own key read after it never names the words)', async () => {
    Object.assign(supabase, { from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'down' } }), eq: async () => ({ data: [CARD_ON], error: null }) }) }) });
    Card._reset();
    expect(await Card.field()).toEqual({ card_v3: true });
  });
});

describe('the preview facts', () => {
  const P = { quiz: { lang: 'ur', topic: 'پودے', questions: [{}, {}] }, cls: { label: 'جماعت ۳' }, art: {} };
  test('named only when on', () => {
    expect(Og.facts({ ...P, ur_share: true })).toHaveProperty('ur_share', true);
    for (const v of [undefined, false, 'true', 1]) expect(Og.facts({ ...P, ur_share: v })).not.toHaveProperty('ur_share');
  });
});
