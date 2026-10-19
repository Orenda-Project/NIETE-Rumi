'use strict';
/**
 * The shared link's page answers in a few ms on any portal copy (app_settings web_quiz_card_fast, on top of the card
 * being ready at mint; default OFF): at mint the bot also keeps the page's facts in Redis under the token's hash (never
 * the token), 14 days, so a cold portal reads them in a few ms instead of a storage read. Redis away or the write
 * failing: the card is still stored as today. Off: Redis is never written.
 * Mocked only at the boundaries (Supabase, the screenshot, storage, Redis, loggers).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceTrusted: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-bank', () => ({ bank: jest.fn(async () => ({ rows: [] })) }));
jest.mock('../../../shared/storage/r2', () => ({ uploadBuffer: jest.fn(async () => 'u'), downloadFromR2: jest.fn() }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => true), set: jest.fn(async () => true), get: jest.fn(async () => null) }));

const crypto = require('crypto');
const sharp = require('sharp');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
const r2 = require('../../../shared/storage/r2');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const StoryStore = require('../../../shared/services/quiz/story-store');

let Card;
function seed({ fast = true } = {}) {
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_card_v3', value: true }, { key: 'web_quiz_share_v4', value: true }, { key: 'web_quiz_card_ready', value: true }, ...(fast === null ? [] : [{ key: 'web_quiz_card_fast', value: fast }])],
    students: [{ id: 'st-2', student_name: 'Noor Testwala' }],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Card._reset();
}
beforeAll(() => {
  process.env.INTERNAL_API_KEY = 'share-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  Card = require('../../../shared/services/quiz/web-quiz-card-image');
});
beforeEach(async () => {
  jest.clearAllMocks();
  redis.isAvailable.mockReturnValue(true);
  redis.set.mockResolvedValue(true);
  seed();
  htmlToImage.mockResolvedValue(await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#FFF8E7' } }).png().toBuffer());
});
const ct = () => T.signChallenge({ studentId: 'st-2', ex: 'read', runId: 'run-1' });
const mint = () => Card.mint({ kind: 'read', deed: 'read_all', ct: ct(), lang: 'ur' });
// the card's own work at mint, awaited (the prepare the mint started), never a fixed wait a loaded machine outruns
const settle = (token) => Card.prepare(token);
const cacheKey = (token) => `wq:card:${StoryStore.deployEnv()}:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
const cardWrites = () => redis.set.mock.calls.filter((c) => String(c[0]).startsWith('wq:card:'));

test('on: at mint the page\'s facts are kept in Redis under the token\'s hash, 14 days, the same facts as storage', async () => {
  const { token } = await mint();
  await settle(token);
  const w = cardWrites();
  expect(w).toHaveLength(1);
  expect(w[0][0]).toBe(cacheKey(token));
  expect(Card.cardCacheKey(token)).toBe(cacheKey(token));
  expect(JSON.parse(w[0][1])).toEqual(await Card.landing(token));
  expect(w[0][2]).toBe(14 * 24 * 3600);
  expect(w[0][0]).not.toContain(token);
  expect(r2.uploadBuffer).toHaveBeenCalledTimes(2);
});
test.each([['absent', null], ['false', false], ['the string "true"', 'true']])('%s: Redis is never written; storage as today', async (_, fast) => {
  seed({ fast });
  const { token } = await mint();
  await settle(token);
  expect(cardWrites()).toHaveLength(0);
  expect(r2.uploadBuffer).toHaveBeenCalledTimes(2);
});
test.each([['Redis away', () => redis.isAvailable.mockReturnValue(false)], ['the write failing', () => redis.set.mockRejectedValue(new Error('down'))]])('%s: the card is still stored, prepare answers true', async (_, set) => {
  set();
  const { token } = await mint();
  await settle(token);
  expect(await Card.prepare(token)).toBe(true);
  expect(r2.uploadBuffer).toHaveBeenCalledTimes(2);
});
