'use strict';
/**
 * The share card's picture in design A (app_settings web_quiz_share_card_a, on top of the one share; default OFF): a
 * token minted with it on is marked, and its picture is drawn from web-quiz-card-a.js — the land colour, the medal with
 * the finish's result (the score, else the words, else the sticker), its stars and badge, who did what, the dare, the
 * "Tap to play" pill and the join line — under its own 120 KB budget. Off: the token and the picture are today's.
 * Mocked only at the boundaries (Supabase, the screenshot, storage, the lesson picture, loggers).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceTrusted: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-bank', () => ({ bank: jest.fn(async () => ({ rows: [] })) }));
jest.mock('../../../shared/services/quiz/web-quiz-video-thumb', () => ({ thumb: jest.fn(async () => null), VERSION: '1' }));
jest.mock('../../../shared/storage/r2', () => ({ downloadFromR2: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-media', () => ({ videoKey: () => ({ key: 'student-videos/lesson-1.mp4', foreign: false }) }));

const sharp = require('sharp');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
const { thumb } = require('../../../shared/services/quiz/web-quiz-video-thumb');
const r2 = require('../../../shared/storage/r2');
const { bank } = require('../../../shared/services/quiz/web-quiz-bank');
const T = require('../../../shared/services/quiz/web-quiz-token');

const BOOK = '3b9c1e2a-7d4f-4a1b-9c2d-5e6f7a8b9c0d';
const VID = 'a1b2c3d4-0000-4000-8000-00000000abcd';
const BANNED = /\btest\b|\bexam\b|assessment|امتحان|ٹیسٹ|wcpm|per minute|undefined|null/i;
let Card; let A;
function seed({ cardA = true, cardAValue } = {}) {
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_card_v3', value: true }, { key: 'web_quiz_share_v4', value: true }, ...(cardA ? [{ key: 'web_quiz_share_card_a', value: cardAValue === undefined ? true : cardAValue }] : [])],
    students: [{ id: 'st-2', student_name: 'Noor Testwala' }],
    story_books: [{ id: BOOK, status: 'ready', title: 'The lost kite', cover_file: 'cover.webp' }],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Card._reset();
}
beforeAll(() => {
  process.env.INTERNAL_API_KEY = 'share-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  Card = require('../../../shared/services/quiz/web-quiz-card-image');
  A = require('../../../shared/services/quiz/web-quiz-card-a');
});
let shot;
beforeEach(async () => {
  jest.clearAllMocks();
  seed();
  shot = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#3a9d4f' } }).png().toBuffer();
  htmlToImage.mockResolvedValue(shot);
});
const ct = () => T.signChallenge({ studentId: 'st-2', ex: 'read', runId: 'run-1' });
const f = (extra = {}) => ({ kind: 'quiz', deed: 'quiz_done', lang: 'en', first: 'Noor', v4: true, a: true, item: null, ...extra });
const html = (x, art = null) => A.renderCardA(f(x), { fonts: false, art });

describe('the switch', () => {
  test.each([['absent', { cardA: false }], ['false', { cardAValue: false }], ['the string "true"', { cardAValue: 'true' }]])('%s: the token is unmarked and its picture is today\'s card', async (_, o) => {
    seed(o);
    const { token } = await Card.mint({ kind: 'read', deed: 'read_all', ct: ct(), lang: 'en' });
    expect(Card.facts(token)).not.toHaveProperty('a');
    await Card.image(token);
    expect(htmlToImage.mock.calls[0][0]).not.toContain('class="med"');
  });
  test('on: the token is marked and its picture is design A, under its own budget', async () => {
    const { token } = await Card.mint({ kind: 'read', deed: 'read_all', ct: ct(), lang: 'en' });
    expect(Card.facts(token).a).toBe(true);
    const out = await Card.image(token);
    const page = htmlToImage.mock.calls[0][0];
    expect(page).toContain('class="med"');
    expect(page).toContain('data-land="sp"');
    expect(out.contentType).toBe('image/png');
    expect(out.bytes.length).toBeLessThanOrEqual(Card.MAX_BYTES_A);
    expect(Card.MAX_BYTES_A).toBe(120 * 1024);
  });
});

describe('what the picture says', () => {
  test('a score: the fraction on the medal, its caption, the stars, the badge on the ribbon, the dare to beat it', () => {
    const h = html({ data: { r: 9, o: 10, s: 3, b: 'game_champ' }, kind: 'game', deed: 'game_done' });
    expect(h).toContain('<span dir="ltr" class="frac">9<i>/</i>10</span>');
    expect(h).toContain('9 out of 10 right');
    expect((h.match(/class="st"/g) || []).length).toBe(3);
    expect(h).toContain('>Game champ</div>');
    expect(h).toContain('Can you get 10 out of 10?');
    expect(h).toContain('<bdi>Noor</bdi> played a game!');
    expect(h).toContain('Tap to play');
    expect(h).toContain('Join me on Jugnu');
    expect(h).toContain('data-land="gm"');
    expect(h).not.toMatch(BANNED);
  });
  test('no badge: the ribbon names the activity; a read\'s words when the whole story was read', () => {
    expect(html({ data: { r: 8, o: 10, s: 2 } })).toContain('>Quiz</div>');
    const r = html({ kind: 'read', deed: 'read_all', data: { s: 3, b: 'star_reader', w: 42 } });
    expect(r).toContain('<div class="big" data-ink>42</div>');
    expect(r).toContain('words read out loud');
    expect(r).toContain('Can you read 42 words too?');
    expect(r).toContain('class="side jar"');
  });
  test('no result: the sticker on the medal, no stars; the dare by the activity; a stop played again: no sticker words', () => {
    const v = html({ kind: 'video', deed: 'video_watched', item: { type: 'video', id: VID } });
    expect(v).toContain('class="bigstar"');
    expect(v).not.toContain('class="stars"');
    expect(v).toContain('A new sticker!');
    expect(v).toContain('Can you watch it too?');
    expect(html({ kind: 'game', deed: 'game_practice' })).not.toContain('A new sticker!');
    expect(html({ kind: 'book', deed: 'book_read', item: { type: 'book', id: BOOK } })).toContain('Can you read it too?');
    expect(html({ kind: 'game', deed: 'game_done' })).toContain('Can you play too?');
  });
  test('a card that names nobody: the deed in the first person', () => {
    expect(html({ first: '' })).toContain("I finished my teacher&#39;s quiz today!");
  });
  test('the item\'s picture: a book\'s cover, a lesson\'s frame; none: the activity\'s badge disc', () => {
    const art = { type: 'image/jpeg', b64: 'QUJD' };
    expect(html({ kind: 'book', deed: 'book_read', item: { type: 'book', id: BOOK } }, art)).toContain('<img class="side cover" src="data:image/jpeg;base64,QUJD"');
    expect(html({ kind: 'video', deed: 'video_watched', item: { type: 'video', id: VID } }, art)).toContain('<img class="side frame"');
    expect(html({ kind: 'video', deed: 'video_watched' })).toContain('class="side pad"');
  });
  test('Urdu: Urdu digits, the native-read lines, «صحیح» and "!" set tight, Nastaliq with room for its ink', () => {
    const h = A.renderCardA(f({ lang: 'ur', first: 'نور', data: { r: 3, o: 4, s: 2 }, kind: 'book', deed: 'book_read' }), { fonts: false });
    expect(h).toContain('<html lang="ur" dir="rtl">');
    expect(h).toContain('<span dir="ltr" class="frac">۳<i>/</i>۴</span>');
    expect(h).toContain('<bdi>نور</bdi> نے کہانی کی کتاب پڑھی⁠<span class="ex">!</span>');
    expect(h).toContain('آپ ۴ کے ۴ <span class="sah">صحیح</span> کر کے دکھائیں⁠<span class="ex">!</span>');
    expect(h).toContain('دبائیں اور کھیلیں⁠<span class="ex">!</span>');
    expect(h).toContain('جگنو پر میرے ساتھ آئیں');
    expect(h).toContain('[data-ink]{font-weight:400;line-height:2.1;');
    expect(h).not.toMatch(BANNED);
    expect(A.renderCardA(f({ lang: 'ur', first: 'نور', kind: 'read', deed: 'read_tried' }), { fonts: false })).toContain('<bdi>نور</bdi> نے ایک نئی کہانی پڑھی');
  });
  test('a long first name is clamped (at most 12 letters, then …) so the deed and the CTA stay on the card', () => {
    expect(html({ first: 'Muhammadabdullah' })).toContain('<bdi>Muhammadabd…</bdi> finished a quiz!');
    expect(A.renderCardA(f({ lang: 'ur', first: 'محمدعبداللہخانصاحب' }), { fonts: false })).toContain('<bdi>محمدعبداللہ…</bdi> نے کوئز مکمل کیا');
    expect(html({ first: 'Noor' })).toContain('<bdi>Noor</bdi>');
  });
  test('no result and no badge: the activity\'s word once (the ribbon), never again on the medal', () => {
    const h = html({ kind: 'read', deed: 'read_tried' });
    expect((h.match(/>Reading</g) || []).length).toBe(1);
    expect(h).toContain('<div class="cap" data-ink></div>');
  });
  test('the deed and the dare wrap balanced, so a long line never leaves its last word alone (EN and UR)', () => {
    for (const lang of ['en', 'ur']) {
      const h = A.renderCardA(f({ lang, first: lang === 'ur' ? 'محمدعبداللہ' : 'Muhammadabd', kind: 'book', deed: 'book_read' }), { fonts: false });
      expect(h).toMatch(/\.deed\{[^}]*text-wrap:balance/);
      expect(h).toMatch(/\.dare\{[^}]*text-wrap:balance/);
    }
  });
  test('a name that is markup is only text', () => {
    expect(html({ first: '<img src=x>' })).not.toContain('<img src=x>');
  });
});

describe('the item\'s picture (artOf)', () => {
  test('a ready book\'s cover from storage, shrunk; storage away: none', async () => {
    r2.downloadFromR2.mockResolvedValue(await sharp({ create: { width: 400, height: 600, channels: 3, background: '#e97f2e' } }).webp().toBuffer());
    const art = await A.artOf({ item: { type: 'book', id: BOOK } });
    expect(art.type).toBe('image/jpeg');
    expect((await sharp(Buffer.from(art.b64, 'base64')).metadata()).width).toBe(260);
    r2.downloadFromR2.mockRejectedValue(new Error('down'));
    expect(await A.artOf({ item: { type: 'book', id: BOOK } })).toBeNull();
  });
  test('a lesson\'s own poster, 480 px wide for the medal\'s corner; no poster: the shelf\'s small picture', async () => {
    bank.mockResolvedValueOnce({ rows: [{ id: VID, r2_url: 'https://x/student-videos/lesson-1.mp4' }] });
    r2.downloadFromR2.mockResolvedValueOnce(await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#2a86de' } }).jpeg().toBuffer());
    const art = await A.artOf({ item: { type: 'video', id: VID } });
    expect(r2.downloadFromR2).toHaveBeenCalledWith('student-videos/lesson-1_poster.jpg');
    expect(art.type).toBe('image/jpeg');
    expect((await sharp(Buffer.from(art.b64, 'base64')).metadata()).width).toBe(480);
    bank.mockResolvedValueOnce({ rows: [{ id: VID, r2_url: 'https://x/student-videos/lesson-1.mp4' }] });
    r2.downloadFromR2.mockRejectedValueOnce(new Error('NoSuchKey'));
    thumb.mockResolvedValueOnce({ bytes: Buffer.from('w'), contentType: 'image/webp' });
    expect(await A.artOf({ item: { type: 'video', id: VID } })).toEqual({ type: 'image/webp', b64: Buffer.from('w').toString('base64') });
  });
  test('the frame\'s slot is wide; an Urdu card\'s Jugnu sits higher and smaller, clear of the deed', () => {
    expect(html({ kind: 'video', deed: 'video_watched', item: { type: 'video', id: VID } }, { type: 'image/jpeg', b64: 'QUJD' })).toContain('.side.frame{width:216px;height:122px;');
    expect(A.renderCardA(f({ lang: 'ur', first: 'نور' }), { fonts: false })).toContain('.jug{width:170px;height:170px;top:4px}');
    expect(html({})).not.toContain('.jug{width:170px');
  });
  test('the rays are drawn without dithering, within the budget', async () => {
    const sharpMod = require('sharp');
    const big = await sharpMod({ create: { width: 1200, height: 630, channels: 3, background: '#3a9d4f' } }).png().toBuffer();
    const spy = jest.spyOn(sharpMod.prototype, 'png');
    await Card.toPngA(big, {});
    expect(spy.mock.calls[0][0]).toMatchObject({ palette: true, colors: 192, dither: 0 });
    spy.mockRestore();
  });
  test('a lesson\'s small picture; none: none', async () => {
    thumb.mockResolvedValueOnce({ bytes: Buffer.from('w'), contentType: 'image/webp' });
    expect(await A.artOf({ item: { type: 'video', id: VID } })).toEqual({ type: 'image/webp', b64: Buffer.from('w').toString('base64') });
    expect(await A.artOf({ item: { type: 'video', id: VID } })).toBeNull();
    expect(await A.artOf({ item: null })).toBeNull();
  });
});
