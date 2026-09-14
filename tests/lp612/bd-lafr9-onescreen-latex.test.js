/**
 * bd-lafr9 — the WhatsApp body must not ship raw TeX to a teacher.
 *
 * WHAT ARRIVES TODAY. `one_screen` is authored with TeX maths in it, and `buildBody` in
 * `lp612-serving.service.js` pushes the string through verbatim — it trims, appends the video
 * url, and joins. So a Grade 6 maths teacher gets the literal characters
 *
 *     $-6 \times \square = -540$
 *
 * on her phone, ahead of the document those characters are supposed to introduce. Measured on
 * `niete_lp612_renders` (one_screen non-empty, created_at >= 2026-09-01, n=642): 59 messages
 * carry raw TeX, 44 of them maths — 44% of every maths lesson sent. Both languages.
 *
 * SCOPE IS THE TEXT PATH ONLY. The PDF typesets the same maths correctly; it got a KaTeX pass
 * and this field never did. `one_screen` never reaches the page at all (`visual_check.js:328`
 * skips it by name as "the WhatsApp MESSAGE BODY, not the page"), so nothing here can disturb
 * the document.
 *
 * WHY UNICODE AND NOT KATEX. WhatsApp cannot typeset. There is no markup that renders a radical
 * or a real fraction bar in a message body, so the only readable destination is the Unicode the
 * teacher's keyboard already shows her: × ÷ · √ ² ₁ ≤ π. Anything we cannot map faithfully
 * degrades to plain ASCII a person can still read (`a/b`, `^(n+1)`) rather than to a backslash.
 *
 * THE SAMPLES BELOW ARE PRODUCTION STRINGS, not invented ones — each is quoted in the bead with
 * the segment that shipped it.
 */

const mockLogToFile = jest.fn();

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogToFile(...a) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(),
  sendDocument: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn(), getSignedUrl: jest.fn() }));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({}));
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));

const { buildBody } = require('../../bot/shared/services/lp612-serving.service');

/** The body for a one-paragraph `one_screen`, with no video appended. */
const body = (oneScreen) => buildBody({ oneScreen, segment: {} });

describe('bd-lafr9 — buildBody never puts TeX source on a handset', () => {
  // Every confirmed production sample from the bead, with the reading a teacher should get.
  const SAMPLES = [
    ['grade_6_mathematics.c02.p040-041', '$-6 \\times \\square = -540$', '-6 × □ = -540'],
    ['grade_9_mathematics.c01.p015-016', '$\\sqrt{2} \\cdot \\sqrt{8} = 4$', '√2 · √8 = 4'],
    ['grade_7_mathematics.c06.p129-131', '$4x(x+y)$', '4x(x+y)'],
    ['grade_8_mathematics.c06.r990', '$3^5\\times3^8$', '3⁵×3⁸'],
    ['grade_11_mathematics.c02.p033-034', '$k=1$', 'k=1'],
  ];

  test.each(SAMPLES)('%s renders readably', (_segment, tex, expected) => {
    expect(body(tex)).toBe(expected);
  });

  // The one sample whose exponent cannot become a Unicode superscript — there is no superscript
  // form for "n(A × B)". It must still lose the backslash and the dollars, and say what it means.
  test('an exponent too complex for superscripts degrades to ^(...), not to a backslash', () => {
    const out = body('$2^{n(A \\times B)}$');
    expect(out).toBe('2^(n(A × B))');
  });

  test('no sample leaves a dollar delimiter or a backslash command behind', () => {
    for (const [, tex] of SAMPLES) {
      const out = body(tex);
      expect(out).not.toMatch(/\$/);
      expect(out).not.toMatch(/\\[a-zA-Z]/);
    }
  });

  test('maths inside a real six-beat body is converted in place, prose untouched', () => {
    const oneScreen = [
      '*Objective* Multiply integers with unlike signs.',
      '*Worked example* Solve $-6 \\times \\square = -540$ on the board, step by step.',
      '*Practice* Ask the class for $\\frac{3}{4}$ of 80.',
    ].join('\n\n');

    const out = body(oneScreen);
    expect(out).toContain('*Objective* Multiply integers with unlike signs.');
    expect(out).toContain('-6 × □ = -540');
    expect(out).toContain('3/4');
    expect(out).not.toMatch(/\$/);
    // The bold cues WhatsApp renders are single asterisks and must survive untouched (bd-uu4lr).
    expect(out.match(/\*/g)).toHaveLength(6);
  });

  test('a body with no maths in it is returned byte-for-byte', () => {
    const prose = '*Objective* Read the passage aloud.\n\n*Exit* Name one new word.';
    expect(body(prose)).toBe(prose);
  });

  test('the video url still rides along after conversion', () => {
    const out = buildBody({
      oneScreen: 'Solve $2 \\times 3$.',
      segment: { yt: { url: 'https://youtu.be/abc123' } },
    });
    expect(out).toBe('Solve 2 × 3.\n\n\u{1F4FA} https://youtu.be/abc123');
  });

  // Urdu carries the same TeX from the same authoring path (grade_7 c06 above is an [ur] render).
  // The conversion is script-agnostic: it rewrites the maths and leaves the prose alone.
  test('an Urdu body keeps its script and loses its TeX', () => {
    const out = body('*مقصد* حل کریں $4x(x+y)$ تختے پر۔');
    expect(out).toBe('*مقصد* حل کریں 4x(x+y) تختے پر۔');
  });

  test('empty and absent one_screen still return an empty body', () => {
    expect(buildBody({ oneScreen: '', segment: {} })).toBe('');
    expect(buildBody({ oneScreen: null, segment: {} })).toBe('');
  });
});
