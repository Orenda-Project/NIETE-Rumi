'use strict';
/**
 * The card is ready before Send (app_settings web_quiz_card_ready, on top of the one share; default OFF): a token minted
 * with it on is marked, and right then the bot draws its picture and its page's facts and stores both in the stories'
 * bucket under the token's hash (immutable), so a cold portal answers the link's preview from storage and never waits
 * on a draw. Never awaited by the mint; a storage failure leaves today's way (drawn on the first preview).
 * Off: the token, the mint answer and storage are today's (nothing stored).
 * Mocked only at the boundaries (Supabase, the screenshot, storage, loggers).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceTrusted: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-bank', () => ({ bank: jest.fn(async () => ({ rows: [] })) }));
jest.mock('../../../shared/storage/r2', () => ({ uploadBuffer: jest.fn(async () => 'u'), downloadFromR2: jest.fn() }));

const crypto = require('crypto');
const sharp = require('sharp');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
const r2 = require('../../../shared/storage/r2');
const T = require('../../../shared/services/quiz/web-quiz-token');
const StoryStore = require('../../../shared/services/quiz/story-store');

let Card;
function seed({ ready = true, readyValue } = {}) {
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_card_v3', value: true }, { key: 'web_quiz_share_v4', value: true }, ...(ready ? [{ key: 'web_quiz_card_ready', value: readyValue === undefined ? true : readyValue }] : [])],
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
  r2.uploadBuffer.mockResolvedValue('u');
  seed();
  htmlToImage.mockResolvedValue(await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#FFF8E7' } }).png().toBuffer());
});
const ct = () => T.signChallenge({ studentId: 'st-2', ex: 'read', runId: 'run-1' });
const mint = () => Card.mint({ kind: 'read', deed: 'read_all', ct: ct(), lang: 'ur' });
const settle = () => new Promise((r) => setTimeout(r, 30));
const keyOf = (token, ext) => `wq-card/${StoryStore.deployEnv()}/${crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)}.${ext}`;

describe('the switch', () => {
  test.each([['absent', { ready: false }], ['false', { readyValue: false }], ['the string "true"', { readyValue: 'true' }]])('%s: nothing is drawn or stored at mint; the token is unmarked', async (_, o) => {
    seed(o);
    const { token } = await mint();
    await settle();
    expect(Card.facts(token)).not.toHaveProperty('ready');
    expect(htmlToImage).not.toHaveBeenCalled();
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
  });
});

describe('on', () => {
  test('at mint: the picture and the page\'s facts are stored under the token\'s hash, immutable, never the token itself', async () => {
    const { token } = await mint();
    expect(Card.facts(token).ready).toBe(true);
    await settle();
    expect(r2.uploadBuffer).toHaveBeenCalledTimes(2);
    const [png, json] = ['png', 'json'].map((ext) => r2.uploadBuffer.mock.calls.find((c) => c[1] === keyOf(token, ext)));
    expect(png[2]).toBe('image/png');
    expect(png[3]).toEqual({ bucket: StoryStore.storyBucket() || undefined, cacheControl: StoryStore.IMMUTABLE });
    expect(png[0]).toEqual((await Card.image(token)).bytes);
    expect(json[2]).toBe('application/json');
    expect(JSON.parse(json[0].toString('utf8'))).toEqual(await Card.landing(token));
    for (const c of r2.uploadBuffer.mock.calls) expect(c[1]).not.toContain(token);
  });
  test('the mint never waits on it; a second ask for the same card stores nothing more', async () => {
    const held = [];
    r2.uploadBuffer.mockImplementation(() => new Promise((r) => { held.push(r); }));
    const { token } = await mint();
    expect(token).toEqual(expect.any(String));
    await settle();
    expect(held).toHaveLength(2);
    const again = Card.prepare(token);
    held.forEach((r) => r('u'));
    expect(await again).toBe(true);
    expect(r2.uploadBuffer).toHaveBeenCalledTimes(2);
  });
  test('storage away: the mint still answers, and the next ask tries again', async () => {
    r2.uploadBuffer.mockRejectedValue(new Error('down'));
    const { token } = await mint();
    await settle();
    expect(await Card.prepare(token)).toBe(false);
    r2.uploadBuffer.mockResolvedValue('u');
    expect(await Card.prepare(token)).toBe(true);
  });
});
