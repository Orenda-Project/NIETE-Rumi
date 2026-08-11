'use strict';
/**
 * bd-2474 — the child scorecard (mockups/out/scorecard_src.html, approved
 * design) was never wired into finish(). These tests cover the new
 * template + service in isolation; wiring into finish() is covered by
 * video-quiz-scorecard-wiring.test.js.
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('fake-png')),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const { htmlToImage } = require('../../shared/utils/html-to-pdf');
const renderHtml = require('../../shared/templates/video-quiz-scorecard.template');
const scorecard = require('../../shared/services/quiz/video-quiz-scorecard.service');

beforeEach(() => jest.clearAllMocks());

describe('bd-2474 — starsAndBadge (score -> stars/badge mapping)', () => {
  test('12/15 = 80% reproduces the approved mockup: 4 stars, SUPER!', () => {
    expect(renderHtml.starsAndBadge(80)).toEqual({ stars: 4, badge: 'SUPER!' });
  });
  test('a mid score gets a mid badge, never a defeat framing', () => {
    expect(renderHtml.starsAndBadge(65)).toEqual({ stars: 3, badge: 'NICE!' });
  });
  test('a low score still gets a positive badge, never "FAILED" or similar', () => {
    const { badge } = renderHtml.starsAndBadge(20);
    expect(badge).toBe('KEEP GOING!');
    expect(badge).not.toMatch(/fail|wrong|bad/i);
  });
  test('stars is clamped to [0,5] even at the extremes', () => {
    expect(renderHtml.starsAndBadge(100).stars).toBe(5);
    expect(renderHtml.starsAndBadge(0).stars).toBe(0);
  });
});

describe('bd-2474 — renderScorecardHtml', () => {
  test('escapes a topic containing HTML-special characters', () => {
    const html = renderHtml({ topic: '<script>alert(1)</script>', correct: 5, total: 10, pct: 50 });
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toMatch(/&lt;script&gt;/);
  });
  test('the score and total render verbatim', () => {
    const html = renderHtml({ topic: 'Addition', correct: 12, total: 15, pct: 80 });
    expect(html).toMatch(/>12</);
    expect(html).toMatch(/\/15</);
  });
  test('embeds Lexend as base64 @font-face — never trusts a system font', () => {
    // The mockup used -apple-system/Segoe UI, which don't exist on the
    // Railway Linux container Playwright actually renders on.
    const html = renderHtml({ topic: 'x', correct: 1, total: 1, pct: 100 });
    expect(html).not.toMatch(/-apple-system|Segoe UI/);
    expect(html).toMatch(/@font-face\{font-family:'Lexend'/);
  });
});

describe('bd-2481 — the quiz-taker\'s name on the card', () => {
  test('renders the name when provided', () => {
    const html = renderHtml({ topic: 'Addition', correct: 5, total: 10, pct: 50, takerName: 'Ayesha Khan' });
    expect(html).toMatch(/Ayesha Khan/);
  });
  test('escapes HTML-special characters in the name', () => {
    const html = renderHtml({
      topic: 'x', correct: 1, total: 1, pct: 100, takerName: '<script>alert(1)</script>',
    });
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toMatch(/&lt;script&gt;/);
  });
  test('omits the name line entirely when no name is given (never renders "undefined" or "null")', () => {
    const html = renderHtml({ topic: 'x', correct: 1, total: 1, pct: 100 });
    expect(html).not.toMatch(/undefined|null/i);
  });
});

/**
 * bd-2477 #2 — stars rendered as tofu/missing-glyph boxes in production.
 *
 * Root cause: the Unicode star characters (&#9733; / &#9734;, U+2605/2606)
 * are outside the Lexend font's coverage (Lexend is Latin-script only), so
 * the browser falls back to a system symbol font for them. That fallback
 * exists on macOS (where this was verified) but does NOT exist on the
 * Railway Linux container that actually renders this in production — the
 * same "never trust a system font on Linux" trap the file's own docstring
 * already documents for Lexend, just not yet applied to the stars.
 */
describe('bd-2477 #2 — stars must not depend on ANY font (system or embedded)', () => {
  test('never emits the Unicode star character entities', () => {
    const html = renderHtml({ topic: 'x', correct: 4, total: 5, pct: 80 });
    expect(html).not.toMatch(/&#9733;|&#9734;|★|☆/);
  });

  test('draws stars as inline SVG shapes instead', () => {
    const html = renderHtml({ topic: 'x', correct: 4, total: 5, pct: 80 });
    expect(html).toMatch(/<svg[^>]*class=["']star(?: star--filled)?["']/);
  });

  test('renders exactly 5 star shapes, with the correct count filled for the score', () => {
    // 80% -> 4 stars per starsAndBadge.
    const html = renderHtml({ topic: 'x', correct: 12, total: 15, pct: 80 });
    const svgCount = (html.match(/<svg[^>]*class=["']star(?: star--filled)?["']/g) || []).length;
    expect(svgCount).toBe(5);
    const filledCount = (html.match(/class=["']star star--filled["']/g) || []).length;
    expect(filledCount).toBe(4);
  });
});

/**
 * bd-2477 #4 — GIF feasibility. Full write-up: the animated star-reveal +
 * confetti GIF is NOT built (see bead notes — WhatsApp rejects GIF outright,
 * and finish() renders synchronously inside the shared webhook process, so a
 * 10-15 frame animation would add real backlog risk at peak hour). This is
 * the fallback the operator offered in the same message: "if [GIF] would be
 * too heavy... then we simply just change the background color based on how
 * you did" — same one-frame render cost as today, tier-differentiated look.
 */
/** Relative luminance (0-1) of a #RRGGBB hex string — for measuring whether
 * two backgrounds are ACTUALLY visually distinct, not just different strings. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function bgOf(html) {
  return html.match(/\.card \{[^}]*background:([^;]+);/)[1];
}

describe('bd-2477 #4 / bd-2480 — score-tier background as the lightweight GIF fallback', () => {
  test('a mastered score (>=80%) gets the most vivid, most celebratory palette', () => {
    const html = renderHtml({ topic: 'x', correct: 9, total: 10, pct: 90 });
    expect(html).toMatch(/#F5B301/); // full-saturation brand gold
  });

  test('a developing score (60-79%) gets a visibly different, calmer accent than mastered', () => {
    const masteredBg = bgOf(renderHtml({ topic: 'x', correct: 9, total: 10, pct: 90 }));
    const developingBg = bgOf(renderHtml({ topic: 'x', correct: 6, total: 10, pct: 65 }));
    expect(developingBg).not.toBe(masteredBg);
  });

  test('a needs_practice score (<60%) gets the calmest palette — still gold-family accent, never red/green', () => {
    const needsPractice = renderHtml({ topic: 'x', correct: 2, total: 10, pct: 20 });
    const masteredBg = bgOf(renderHtml({ topic: 'x', correct: 9, total: 10, pct: 90 }));
    const needsPracticeBg = bgOf(needsPractice);
    expect(needsPracticeBg).not.toBe(masteredBg);
    // The accent (badge/stars) stays in the gold family even as the canvas
    // itself moves toward neutral — never introduces a red/green hue.
    expect(needsPractice).toMatch(/#B98B3D/);
  });

  // bd-2480: caught in review — the first pass put all three backgrounds
  // within a ~15-value navy hue band, imperceptible at a glance ("I dont see
  // any real background color change?"). A string-inequality check alone
  // would never catch that regression, so this measures the ACTUAL visual
  // gap: the first gradient stop's luminance must jump meaningfully tier to
  // tier, not just differ by a rounding error.
  test('each tier is a REAL visible jump in brightness, not an imperceptible shade', () => {
    const masteredFrom = bgOf(renderHtml({ topic: 'x', correct: 9, total: 10, pct: 90 }))
      .match(/#[0-9A-Fa-f]{6}/)[0];
    const developingFrom = bgOf(renderHtml({ topic: 'x', correct: 6, total: 10, pct: 65 }))
      .match(/#[0-9A-Fa-f]{6}/)[0];
    const needsPracticeFrom = bgOf(renderHtml({ topic: 'x', correct: 2, total: 10, pct: 20 }))
      .match(/#[0-9A-Fa-f]{6}/)[0];

    const lumMastered = luminance(masteredFrom);
    const lumDeveloping = luminance(developingFrom);
    const lumNeedsPractice = luminance(needsPracticeFrom);

    // A gap under ~0.03 reads as "the same card" on a phone screen — the
    // exact bug bd-2480 fixes. Require each step to clear that bar.
    const MIN_PERCEPTIBLE_GAP = 0.03;
    expect(Math.abs(lumMastered - lumDeveloping)).toBeGreaterThan(MIN_PERCEPTIBLE_GAP);
    expect(Math.abs(lumDeveloping - lumNeedsPractice)).toBeGreaterThan(MIN_PERCEPTIBLE_GAP);
    expect(Math.abs(lumMastered - lumNeedsPractice)).toBeGreaterThan(MIN_PERCEPTIBLE_GAP * 2);
  });

  test('all three tiers still render as valid on-brand hex colors', () => {
    [90, 65, 20].forEach((pct) => {
      const html = renderHtml({ topic: 'x', correct: 1, total: 1, pct });
      const bg = bgOf(html);
      const hexes = bg.match(/#[0-9A-Fa-f]{6}/g) || [];
      expect(hexes.length).toBeGreaterThan(0);
    });
  });
});

describe('bd-2477 #2 — the Rumi mark appears white-on-transparent, top right', () => {
  test('embeds the canonical white-on-transparent mark as base64, never redrawn', () => {
    const html = renderHtml({ topic: 'x', correct: 1, total: 1, pct: 100 });
    expect(html).toMatch(/<img[^>]*class=["']logo["'][^>]*src=["']data:image\/png;base64,[A-Za-z0-9+/=]+["']/);
  });

  test('is positioned in the top-right of the card, not overlapping the topic', () => {
    const html = renderHtml({ topic: 'x', correct: 1, total: 1, pct: 100 });
    // The logo lives in a header row that puts it at the end (right) of a
    // flex row alongside the "QUIZ COMPLETE" eyebrow — never absolutely
    // stacked on top of readable text.
    expect(html).toMatch(/class=["']hdr["'][^>]*>[\s\S]*?class=["']t1["'][\s\S]*?class=["']logo["']/);
  });
});

describe('bd-2474 — renderScorecardImage', () => {
  test('calls htmlToImage with the .card selector at 540px, 2x scale', async () => {
    await scorecard.renderScorecardImage({ topic: 'x', correct: 1, total: 1, pct: 100 });
    expect(htmlToImage).toHaveBeenCalledWith(expect.any(String),
      { width: 540, deviceScaleFactor: 2, selector: '.card' });
  });
  test('a render failure returns null, never throws', async () => {
    htmlToImage.mockRejectedValueOnce(new Error('playwright timeout'));
    const png = await scorecard.renderScorecardImage({ topic: 'x', correct: 1, total: 1, pct: 100 });
    expect(png).toBeNull();
  });

  test('bd-2481: forwards takerName into the rendered HTML', async () => {
    await scorecard.renderScorecardImage({
      topic: 'x', correct: 1, total: 1, pct: 100, takerName: 'Ayesha Khan',
    });
    const [html] = htmlToImage.mock.calls[0];
    expect(html).toMatch(/Ayesha Khan/);
  });
});

describe('bd-2474 — sendScorecard', () => {
  test('sends the rendered PNG with a caption naming the score and stars', async () => {
    const ok = await scorecard.sendScorecard('923001234567',
      { topic: 'Addition Level 1', correct: 12, total: 15, pct: 80, grade: 'Grade 1', subject: 'Maths' });
    expect(ok).toBe(true);
    expect(WhatsAppService.sendImageFromBuffer).toHaveBeenCalledTimes(1);
    const [phone, buf, caption] = WhatsAppService.sendImageFromBuffer.mock.calls[0];
    expect(phone).toBe('923001234567');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(caption).toMatch(/12 out of 15/);
    expect(caption).toMatch(/4 stars/);
  });

  test('falls back gracefully (returns false, does not throw) when render fails', async () => {
    htmlToImage.mockResolvedValueOnce(null);
    const ok = await scorecard.sendScorecard('923001234567',
      { topic: 'x', correct: 1, total: 1, pct: 100 });
    expect(ok).toBe(false);
    expect(WhatsAppService.sendImageFromBuffer).not.toHaveBeenCalled();
  });

  test('falls back gracefully when the WhatsApp send itself throws', async () => {
    WhatsAppService.sendImageFromBuffer.mockRejectedValueOnce(new Error('rate limited'));
    const ok = await scorecard.sendScorecard('923001234567',
      { topic: 'x', correct: 1, total: 1, pct: 100 });
    expect(ok).toBe(false);
  });
});
