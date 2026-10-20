'use strict';
/**
 * bd-gzfdu9 (VIDREC): the header picture of the "watch this clip" message (SPEC §4.3): a 480×270 (16:9) video
 * card — the thumbnail, a play circle, the m:ss pill, the title on one line and the level chip — drawn with the
 * hero report's renderer (htmlToImage), fonts embedded (Nastaliq for Urdu), nothing fetched at render time.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockHtmlToImage = jest.fn();
jest.mock('../../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: (...a) => mockHtmlToImage(...a) }));
const card = require('../../../bot/shared/services/coaching/video-reco/card-image');

const thumb = path.join(os.tmpdir(), `vr-thumb-${process.pid}.jpg`);
beforeAll(() => fs.writeFileSync(thumb, Buffer.from([0xff, 0xd8, 0xff, 0xd9])));
afterAll(() => fs.rmSync(thumb, { force: true }));
beforeEach(() => mockHtmlToImage.mockReset().mockResolvedValue(Buffer.from('PNG')));

const VM = { thumbPath: thumb, title: 'Asking why-questions <b>', durationS: 134, levelLabel: 'Level 1', language: 'en' };

test('the html: a 480×270 card, the title escaped on one line, the m:ss pill, the level chip, the play circle', () => {
  const html = card.buildVideoCardHtml(VM);
  expect(html).toMatch(/\.vcard\{[^}]*width:480px[^}]*height:270px/);
  expect(html).toContain('Asking why-questions &lt;b&gt;');
  expect(html).toContain('>2:14<');
  expect(html).toContain('Level 1');
  expect(html).toContain('class="play"');
  expect(html).toMatch(/text-overflow:ellipsis/);
});

test('fonts embedded, the thumbnail embedded (data: URIs), nothing fetched over the network', () => {
  const html = card.buildVideoCardHtml(VM);
  expect(html).toContain('@font-face');
  expect(html).toContain("font-family:'NastaliqUrdu'");
  expect(html).toContain('data:image/jpeg;base64,');
  expect(html).not.toMatch(/(src=|url\()["']?https?:/i);
});

test('no thumbnail file → a plain gradient card, still renders', () => {
  const html = card.buildVideoCardHtml({ ...VM, thumbPath: '/nope/missing.jpg' });
  expect(html).not.toContain('data:image/jpeg');
  expect(html).toContain('class="play"');
});

test('Urdu: right to left, Nastaliq first, the title\'s English runs isolated, the clock stays left to right', () => {
  const html = card.buildVideoCardHtml({ ...VM, title: 'سوال پوچھنا: open-ended questions', language: 'ur', levelLabel: 'لیول ۱' });
  expect(html).toMatch(/<html lang="ur" dir="rtl">/);
  expect(html).toContain("'NastaliqUrdu','Lexend'");
  expect(html).toContain('<span class="ltr">open-ended questions</span>');
  expect(html).toMatch(/class="pill[^"]*"[^>]*>2:14</);
  expect(html).toMatch(/\.pill\{[^}]*direction:ltr/);
});

test('renderVideoCard: htmlToImage on .vcard at 480 wide, the PNG comes back', async () => {
  const png = await card.renderVideoCard(VM);
  expect(png).toEqual(Buffer.from('PNG'));
  expect(mockHtmlToImage).toHaveBeenCalledWith(expect.stringContaining('class="vcard"'), expect.objectContaining({ selector: '.vcard', width: 480 }));
});

test('a render failure returns null (the sender drops to the button without a picture)', async () => {
  mockHtmlToImage.mockRejectedValue(new Error('no chromium'));
  await expect(card.renderVideoCard(VM)).resolves.toBeNull();
});
