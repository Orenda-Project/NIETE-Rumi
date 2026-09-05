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

describe('starsAndBadge (score -> stars/badge mapping)', () => {
  test('12/15 = 80% reproduces the approved mockup: 4 stars', () => {
    expect(renderHtml.starsAndBadge(80).stars).toBe(4);
  });
  test('the badge word comes from the string catalog, in the quiz language', () => {
    // bd-mg9c7.28 — an Urdu quiz used to end on an English card. The words
    // come from the same catalog the caption underneath it is built from, so
    // the two can never say different things in different languages.
    const { UX_STRINGS } = require('../../shared/config/ux-strings');
    expect(renderHtml.starsAndBadge(90, 'en').badge).toBe(UX_STRINGS.vqBadgeMastered.en);
    expect(renderHtml.starsAndBadge(90, 'ur').badge).toBe(UX_STRINGS.vqBadgeMastered.ur);
    expect(renderHtml.starsAndBadge(65, 'ur').badge).toBe(UX_STRINGS.vqBadgeDeveloping.ur);
    expect(renderHtml.starsAndBadge(20, 'ur').badge).toBe(UX_STRINGS.vqBadgeNeedsPractice.ur);
  });
  test('a low score still gets a positive badge, never a defeat framing', () => {
    const { badge } = renderHtml.starsAndBadge(20, 'en');
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
describe('bd-mg9c7.28 / v4 D2 — the card is NIETE, and one card for every score', () => {
  // The three per-tier grounds this describe used to lock (green >=80,
  // navy-slate 60-79, charcoal below) are GONE — see
  // video-quiz-scorecard-v4.test.js, which locks the single ground that
  // replaced them and the three places the tier moved to. What survives from
  // here is the pair of invariants that were never about the tiers: the ground
  // is drawn from the NIETE book, and the ink on it stays white.
  test('no gold, no coral, no other product\'s navy anywhere on the card', () => {
    [90, 65, 20].forEach((pct) => {
      const html = renderHtml({ topic: 'x', correct: 1, total: 1, pct });
      expect(html).not.toMatch(/#F5B301|#D9A233|#B98B3D|#001F3F|#1D57A6/i);
    });
  });

  test('white text at every score — the score must stay legible on the ground', () => {
    [90, 65, 20].forEach((pct) => {
      const html = renderHtml({ topic: 'x', correct: 1, total: 1, pct });
      expect(html).toMatch(/\.card \{[^}]*color:#fff/);
    });
  });
});

describe('bd-mg9c7.28 — the child\'s own language on her own card', () => {
  const { UX_STRINGS } = require('../../shared/config/ux-strings');

  test('an Urdu name renders inside an RTL element led by the Nastaliq face', () => {
    const html = renderHtml({ topic: 'کسریں', correct: 6, total: 8, pct: 75, takerName: 'علی', language: 'ur' });
    expect(html).toMatch(/class='name content align' dir='rtl'>علی</);
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/@font-face\{[^}]*\}/g, '');
    expect(css).toMatch(/\.content\[dir="rtl"\]\{[^}]*font-family:'NastaliqUrdu'/);
  });

  test('embeds Nastaliq as a non-empty base64 face alongside Lexend', () => {
    const html = renderHtml({ topic: 'x', correct: 1, total: 1, pct: 100, language: 'ur' });
    expect(html).toMatch(/@font-face\{font-family:'NastaliqUrdu';font-weight:400;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/=]{100,}/);
  });

  test('every font-family declaration names both families', () => {
    const html = renderHtml({ topic: 'x', correct: 1, total: 1, pct: 100, language: 'ur' });
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/@font-face\{[^}]*\}/g, '');
    const decls = css.match(/font-family:[^;}]+/g) || [];
    expect(decls.length).toBeGreaterThan(1);
    decls.forEach((d) => {
      expect(d).toMatch(/NastaliqUrdu/);
      expect(d).toMatch(/Lexend/);
    });
  });

  test('the eyebrow and the badge are the catalog words for that language', () => {
    const html = renderHtml({ topic: 'کسریں', correct: 8, total: 8, pct: 100, language: 'ur' });
    expect(html).toMatch(new RegExp(UX_STRINGS.vqScorecardEyebrow.ur));
    expect(html).toMatch(new RegExp(UX_STRINGS.vqBadgeMastered.ur));
    expect(html).not.toMatch(/QUIZ COMPLETE/);
  });

  test('the foot names the subject only — never a grade, never another org', () => {
    const html = renderHtml({ topic: 'Fractions', correct: 1, total: 1, pct: 100, grade: 'Grade 4', subject: 'Maths' });
    expect(html).not.toMatch(/Taleemabad/);
    expect(html).not.toMatch(/Grade 4/);
    expect(html).toMatch(/Maths/);
  });
});

describe('the NIETE mark appears white-on-transparent, top right', () => {
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

  test('bd-mg9c7.28: forwards the quiz language into the rendered HTML', async () => {
    await scorecard.renderScorecardImage({
      topic: 'کسریں', correct: 1, total: 1, pct: 100, takerName: 'علی', language: 'ur',
    });
    const [html] = htmlToImage.mock.calls[0];
    expect(html).toMatch(/class='name content align' dir='rtl'>علی</);
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

/**
 * bd-mg9c7.44 — the card a child would screenshot, and a name in the script
 * it was written in.
 *
 * Two separate asks in one pass:
 *
 *  1. The card was correct but flat: a fraction, five stars and a badge on a
 *     flat gradient. It is the only artefact of the whole quiz a child keeps,
 *     so the score gets a real treatment (a ring filled to the percentage),
 *     the stars become the hero row, her name gets the size, and the single
 *     large outline diamond gives way to the brand book's lattice.
 *  2. A child who types "Ali" into an Urdu quiz is not writing Urdu, and a
 *     child who types "عائشہ" into an English quiz is not writing English.
 *     The card's language is the QUIZ's; the SCRIPT of a name or a topic is
 *     the text's own. Keying the name's font off the quiz language put Latin
 *     letters through Nastaliq metrics and Perso-Arabic through a Latin-first
 *     stack — the same "no glyphs" trap the file's docstring already names,
 *     just triggered by the wrong axis.
 */
describe('bd-mg9c7.44 — scriptOf: a text names its own script', () => {
  const { scriptOf } = require('../../shared/templates/niete-brand');

  test('Perso-Arabic letters make it Urdu, Latin letters make it English', () => {
    expect(scriptOf('عائشہ')).toBe('ur');
    expect(scriptOf('علی')).toBe('ur');
    expect(scriptOf('Ali')).toBe('en');
    expect(scriptOf('Ayesha Khan')).toBe('en');
  });

  test('a single Perso-Arabic letter anywhere wins — a mixed string is set in Nastaliq', () => {
    expect(scriptOf('Ali علی')).toBe('ur');
  });

  test('digits and punctuation alone are not a script', () => {
    expect(scriptOf('')).toBe('en');
    expect(scriptOf(null)).toBe('en');
    expect(scriptOf('12/15')).toBe('en');
    // U+060C/U+061F/U+06F1 are Arabic-block punctuation and digits, not letters.
    expect(scriptOf('، ؟ ۱۲')).toBe('en');
  });
});

describe('bd-mg9c7.44 — the name renders in the script it was written in', () => {
  test('an English name inside an Urdu quiz card is LTR and Latin-first', () => {
    const html = renderHtml({
      topic: 'کسریں', correct: 6, total: 8, pct: 75, takerName: 'Ali', language: 'ur',
    });
    expect(html).toMatch(/class='name content align' dir='ltr'>Ali</);
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/@font-face\{[^}]*\}/g, '');
    expect(css).toMatch(/\.content\[dir="ltr"\]\{[^}]*font-family:'Lexend'/);
  });

  test('an Urdu name inside an English quiz card is RTL and Nastaliq-first', () => {
    const html = renderHtml({
      topic: 'Proper Fraction', correct: 6, total: 8, pct: 75, takerName: 'عائشہ', language: 'en',
    });
    expect(html).toMatch(/class='name content align' dir='rtl'>عائشہ</);
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/@font-face\{[^}]*\}/g, '');
    expect(css).toMatch(/\.content\[dir="rtl"\]\{[^}]*font-family:'NastaliqUrdu'/);
  });

  test('the topic follows its own script too, independently of the quiz language', () => {
    const urTopicEnQuiz = renderHtml({ topic: 'کسریں', correct: 1, total: 1, pct: 100, language: 'en' });
    expect(urTopicEnQuiz).toMatch(/class='topic content align' dir='rtl'>کسریں</);

    const enTopicUrQuiz = renderHtml({ topic: 'Proper Fraction', correct: 1, total: 1, pct: 100, language: 'ur' });
    expect(enTopicUrQuiz).toMatch(/class='topic content align' dir='ltr'>Proper Fraction</);
  });

  test('the catalog words stay in the QUIZ language even when the name is the other script', () => {
    const { UX_STRINGS } = require('../../shared/config/ux-strings');
    const html = renderHtml({
      topic: 'Proper Fraction', correct: 6, total: 8, pct: 75, takerName: 'Ali', language: 'ur',
    });
    expect(html).toMatch(new RegExp(UX_STRINGS.vqBadgeDeveloping.ur));
    expect(html).toMatch(new RegExp(UX_STRINGS.vqScorecardEyebrow.ur));
    expect(html).not.toMatch(/Nicely done|QUIZ COMPLETE/);
  });

  // v4: the sentence itself is no longer printed ON the card — the chip carries
  // the word, and vqScoreCaption carries the whole sentence in the message
  // directly under the picture. The de-duplication rule is still the caption
  // side's, so it is still exported and still tested.
  test('tierMessage strips the clause the badge already says, in both languages', () => {
    expect(renderHtml.tierMessage(75, 'en')).toBe('A little more practice and you\u2019ll have it.');
    expect(renderHtml.tierMessage(100, 'en')).toBe('');
    expect(renderHtml.tierMessage(100, 'ur')).toBe('');
    expect(renderHtml.tierMessage(75, 'ur')).not.toMatch(/بہت اچھا/);
  });
});

describe('bd-mg9c7.44 — the redesign: gauge, hero stars, lattice', () => {
  function ring(html) {
    const m = html.match(/class=['"]ring-fill['"][^>]*stroke-dasharray=['"]([\d.]+)['"][^>]*stroke-dashoffset=['"]([\d.]+)['"]/);
    return m ? { dash: Number(m[1]), off: Number(m[2]) } : null;
  }

  test('the score is a ring gauge filled to the percentage, not a bare number', () => {
    const r = ring(renderHtml({ topic: 'x', correct: 6, total: 8, pct: 75 }));
    expect(r).not.toBeNull();
    expect(1 - r.off / r.dash).toBeCloseTo(0.75, 2);
  });

  test('a full score closes the ring and a zero score leaves it empty', () => {
    expect(1 - ring(renderHtml({ topic: 'x', correct: 8, total: 8, pct: 100 })).off
      / ring(renderHtml({ topic: 'x', correct: 8, total: 8, pct: 100 })).dash).toBeCloseTo(1, 2);
    const empty = ring(renderHtml({ topic: 'x', correct: 0, total: 8, pct: 0 }));
    expect(empty.off / empty.dash).toBeCloseTo(1, 2);
  });

  test('the fraction still reads verbatim beside the ring', () => {
    const html = renderHtml({ topic: 'x', correct: 12, total: 15, pct: 80 });
    expect(html).toMatch(/class='score'>12<span>\/15<\/span>/);
  });

  test('the stars are the hero row — bigger, and lit with a glow', () => {
    const html = renderHtml({ topic: 'x', correct: 4, total: 5, pct: 80 });
    const size = Number(html.match(/class="star star--filled"[^>]*width="(\d+)"/)[1]);
    expect(size).toBeGreaterThanOrEqual(34);
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    expect(css).toMatch(/\.star--filled\s*\{[^}]*drop-shadow/);
  });

  test('the ground carries the brand lattice, not one large outline diamond', () => {
    const html = renderHtml({ topic: 'x', correct: 1, total: 1, pct: 100 });
    expect(html).toMatch(/<svg class="lattice"/);
    expect(html).toMatch(/pattern id="niete-lattice/);
    expect(html).not.toMatch(/class='ghost'/);
  });
});
