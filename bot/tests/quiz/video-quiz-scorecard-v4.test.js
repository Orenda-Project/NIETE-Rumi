'use strict';
/**
 * Scorecard v4 — one ground for every score, and a card that is actually
 * aligned.
 *
 * Two complaints from the review of v3, and one thing found while looking at
 * the v3 renders:
 *
 *  1. THE GROUND STOPPED CARRYING THE TIER. v3 gave each tier its own
 *     background: green for >=80, navy-slate for 60-79, charcoal below. Seen
 *     side by side the charcoal card reads as switched off — a child who got
 *     3/8 receives a visibly *worse-looking* picture than the one who got 8/8,
 *     which is a punishment dressed as a design. And because the palette was
 *     keyed off `pct`, "which card did I get?" became a second, invisible
 *     scoring axis. v4: ONE ground for every score. The tier lives where a
 *     child can read it and where the caption can repeat it — the star count,
 *     the badge word, and how far round the ring is filled.
 *  2. NOTHING LINED UP. v3 split the card down the middle: name on the left,
 *     ring on the right, stars centred, badge bottom-left. Every block had a
 *     different edge. v4 sets every block on ONE edge — the start edge of the
 *     card's own direction — and hangs exactly two things off the far edge:
 *     the mark (top) and the badge chip (bottom). Urdu is the exact mirror,
 *     which means the card itself carries `dir`, rather than each text block
 *     being force-aligned left regardless of the language.
 *  3. THE URDU EYEBROW READ "•• کوئز مکمل". The brand lockup's two nuqtas were
 *     emitted after the words in DOCUMENT order inside a row that was laid out
 *     left-to-right whatever the language, so in Urdu — read right to left —
 *     they arrived first. They were also drawn in translucent white, which on
 *     a dark ground reads as two specks of dirt rather than a brand mark. v4
 *     gives the row the card's direction (so document order IS reading order
 *     in both languages) and draws the nuqtas in the brand's pale green.
 *
 * These tests exercise the template directly. Every one of them fails on v3.
 */

const renderHtml = require('../../shared/templates/video-quiz-scorecard.template');
const { PALETTE } = require('../../shared/templates/niete-brand');

/** The card's own `background:` shorthand, from the `.card { … }` rule. */
function groundOf(html) {
  const m = html.match(/\.card \{[^}]*background:([^;]+);/);
  return m ? m[1].trim() : null;
}

/** The stylesheet, with the base64 @font-face blobs and the comments stripped
 *  out so a rule can be found by the `}` that precedes it. */
function cssOf(html) {
  return html.match(/<style>([\s\S]*?)<\/style>/)[1]
    .replace(/@font-face\{[^}]*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The body of one CSS rule, by selector. */
function rule(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|[},])\\s*${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

const CARD = (over = {}) => renderHtml({
  topic: 'Proper Fraction', subject: 'Maths', takerName: 'Ayesha Khan',
  correct: 7, total: 8, pct: 88, language: 'en', ...over,
});

/** The five review scores, out of 8 — the matrix the renders are made from. */
const SCORES = [
  { correct: 8, total: 8, pct: 100 },
  { correct: 7, total: 8, pct: 88 },
  { correct: 5, total: 8, pct: 63 },
  { correct: 3, total: 8, pct: 38 },
  { correct: 1, total: 8, pct: 13 },
];

describe('v4 D2 — one ground for every score', () => {
  test('all five review scores render the SAME ground', () => {
    const grounds = SCORES.map((s) => groundOf(CARD(s)));
    grounds.forEach((g) => expect(g).not.toBeNull());
    expect(new Set(grounds).size).toBe(1);
  });

  test('the ground is never the charcoal "switched off" card, at any score', () => {
    SCORES.forEach((s) => {
      const g = groundOf(CARD(s));
      expect(g).not.toMatch(new RegExp(PALETTE.charcoal, 'i'));
      expect(g).not.toMatch(new RegExp(PALETTE.charcoalLight, 'i'));
      expect(g).not.toMatch(/#000|black/i);
    });
  });

  test('both gradient stops come from the NIETE book — navy-slate and/or the green family', () => {
    const allowed = [
      PALETTE.slate, PALETTE.slateLight, PALETTE.green,
      PALETTE.greenDeep, PALETTE.greenMuted,
    ].map((h) => h.toLowerCase());
    const stops = groundOf(CARD()).match(/#[0-9A-Fa-f]{6}/g) || [];
    expect(stops.length).toBeGreaterThanOrEqual(2);
    stops.forEach((s) => expect(allowed).toContain(s.toLowerCase()));
  });

  test('a 1/8 card and an 8/8 card differ only in score, stars, badge and ring — never in colour', () => {
    const low = CARD({ correct: 1, total: 8, pct: 13 });
    const high = CARD({ correct: 8, total: 8, pct: 100 });
    // Same stylesheet, character for character: no colour anywhere on the
    // card may be a function of how she did.
    expect(cssOf(low)).toBe(cssOf(high));
  });

  test('no other product\'s palette sneaks in as the "celebration" accent', () => {
    SCORES.forEach((s) => {
      // Rumi's navy and Rumi's three golds — the card this one is measured
      // against is Rumi-branded, and borrowing its hexes is how a NIETE
      // artefact quietly becomes a Rumi one.
      expect(CARD(s)).not.toMatch(/#F5B301|#D9A233|#B98B3D|#001F3F|#1D57A6/i);
    });
  });
});

describe('v4 D2 — the tier is still readable, without the ground carrying it', () => {
  const filled = (html) => (html.match(/class="star star--filled"/g) || []).length;
  const badgeOf = (html) => html.match(/class='badge'>([^<]*)</)[1];
  const ringFrac = (html) => {
    const m = html.match(/class=['"]ring-fill['"][^>]*stroke-dasharray=['"]([\d.]+)['"][^>]*stroke-dashoffset=['"]([\d.]+)['"]/);
    return 1 - Number(m[2]) / Number(m[1]);
  };

  test('the five scores give five different star counts', () => {
    const counts = SCORES.map((s) => filled(CARD(s)));
    expect(counts).toEqual([5, 4, 3, 2, 1]);
  });

  test('the badge word still moves with the tier', () => {
    expect(badgeOf(CARD({ correct: 8, total: 8, pct: 100 })))
      .not.toBe(badgeOf(CARD({ correct: 5, total: 8, pct: 63 })));
    expect(badgeOf(CARD({ correct: 5, total: 8, pct: 63 })))
      .not.toBe(badgeOf(CARD({ correct: 1, total: 8, pct: 13 })));
  });

  test('the ring fills to the score, so the five cards are five different rings', () => {
    const fracs = SCORES.map((s) => Number(ringFrac(CARD(s)).toFixed(2)));
    expect(new Set(fracs).size).toBe(5);
    expect(fracs[0]).toBeCloseTo(1, 2);
    expect(fracs[4]).toBeCloseTo(0.13, 2);
  });
});

describe('v4 D3 — every block on one edge, two things on the far edge', () => {
  test('the card element itself carries the quiz language\'s direction', () => {
    expect(CARD({ language: 'en' })).toMatch(/class='card' dir='ltr'/);
    expect(CARD({ language: 'ur' })).toMatch(/class='card' dir='rtl'/);
  });

  test('en aligns every text block to the left; ur mirrors it to the right', () => {
    expect(rule(cssOf(CARD({ language: 'en' })), '.card .align')).toMatch(/text-align:left/);
    expect(rule(cssOf(CARD({ language: 'ur' })), '.card .align')).toMatch(/text-align:right/);
  });

  test('a Latin name inside an Urdu card sits on the card\'s edge, not its own', () => {
    // The NAME's script decides its font and its bidi direction; the CARD's
    // language decides which edge it hangs off. Conflating the two is how "Ali"
    // ended up floating in the middle of an otherwise right-aligned card.
    const html = CARD({ language: 'ur', takerName: 'Ali', topic: 'کسریں' });
    expect(html).toMatch(/class='name content align' dir='ltr'>Ali</);
    expect(rule(cssOf(html), '.card .align')).toMatch(/text-align:right/);
  });

  test('the blocks run eyebrow, name, topic, score, stars, foot in document order', () => {
    const html = CARD();
    const order = ['t1', 'name', 'topic', 'scorerow', 'stars', 'foot']
      .map((c) => html.indexOf(`class='${c}`) >= 0 ? html.indexOf(`class='${c}`) : html.indexOf(`class="${c}`));
    order.forEach((i, n) => expect(i).toBeGreaterThan(n === 0 ? -1 : order[n - 1]));
  });

  test('the mark and the badge chip are the only two things on the far edge', () => {
    const css = cssOf(CARD());
    // Header: eyebrow at the start, mark pushed to the end.
    expect(rule(css, '.hdr')).toMatch(/justify-content:space-between/);
    // Foot: subject at the start, chip pushed to the end.
    expect(rule(css, '.foot')).toMatch(/justify-content:space-between/);
    // and nothing else is allowed to float: the stars row is a start-edge row
    // like every other block, not the centred row v3 had.
    expect(rule(css, '.stars')).not.toMatch(/justify-content:center/);
  });

  test('the score is one row: the big fraction, with the percentage beside it', () => {
    const html = CARD();
    const row = html.match(/class='scorerow'>([\s\S]*?)<div class='stars'/)[1];
    expect(row).toMatch(/class='score'/);
    expect(row).toMatch(/class='gauge'/);
    expect(row).toMatch(/class='pct'/);
    expect(row.indexOf("class='score'")).toBeLessThan(row.indexOf("class='gauge'"));
  });

  test('the fraction never mirrors, in either language', () => {
    ['en', 'ur'].forEach((language) => {
      expect(rule(cssOf(CARD({ language })), '.score')).toMatch(/direction:ltr/);
    });
    expect(CARD({ language: 'ur', correct: 7, total: 8 }))
      .toMatch(/class='score'>7<span>\/8<\/span>/);
  });

  test('the subject sits at the start of the foot, the badge at the end', () => {
    const html = CARD();
    const foot = html.match(/class='foot'>([\s\S]*?)<\/body>/)[1];
    expect(foot.indexOf("class='subj")).toBeLessThan(foot.indexOf("class='badge'"));
  });
});

describe('v4 — the eyebrow reads cleanly in both languages', () => {
  test('the eyebrow row takes the card\'s direction, so its nuqtas trail the words in READING order', () => {
    // v3 laid this row out left-to-right in every language: the two nuqtas were
    // emitted after the words, so in Urdu they were read FIRST — "•• کوئز مکمل".
    expect(rule(cssOf(CARD({ language: 'en' })), '.t1')).toMatch(/direction:ltr/);
    expect(rule(cssOf(CARD({ language: 'ur' })), '.t1')).toMatch(/direction:rtl/);
    // Document order is unchanged: words, then nuqtas. The direction is what
    // turns that into "after" on both sides.
    const html = CARD({ language: 'ur' });
    const row = html.match(/class='t1'>([\s\S]*?)<\/div>\s*<img/)[1];
    expect(row.indexOf('کوئز')).toBeLessThan(row.indexOf('<svg'));
  });

  test('the nuqtas are drawn in the brand\'s pale green, not translucent white specks', () => {
    const html = CARD();
    const nuqtas = html.match(/class="dia nuqta[^"]*"[\s\S]*?<\/svg>/g) || [];
    expect(nuqtas.length).toBe(2);
    nuqtas.forEach((n) => expect(n.toLowerCase()).toMatch(PALETTE.greenPale.toLowerCase()));
    expect(html).not.toMatch(/fill="rgba\(255,255,255,\.45\)"/);
  });

  test('the eyebrow carries no typed symbol character — only catalog words and SVG', () => {
    ['en', 'ur'].forEach((language) => {
      const row = CARD({ language }).match(/class='t1'>([\s\S]*?)<\/div>\s*<img/)[1];
      expect(row.replace(/<svg[\s\S]*?<\/svg>/g, '')).not.toMatch(/[•·◆◇–—*]/);
    });
  });
});

describe('v4 — legible at the size a phone actually shows it', () => {
  /**
   * The card is 540 CSS px wide and ships as a 1080 px PNG. A phone showing
   * that PNG across ~360 dp of chat bubble scales it by 1/1.5 in CSS-px terms,
   * so a 15 px CSS type sets at ~10 dp there and ~13 dp when a child taps the
   * image open. v3's smallest type was 11.5 px — ~7.7 dp in the bubble, which
   * is below what anybody reads without opening the picture. 15 px is the
   * floor the 400 px-tall canvas can carry with every block still on it; the
   * exact trade-off is written up in the PR.
   */
  const MIN_CARD_FONT_PX = 15;

  test('no text on the card is set below the floor', () => {
    const css = cssOf(CARD({ language: 'ur' })) + cssOf(CARD({ language: 'en' }));
    const sizes = (css.match(/font-size:([\d.]+)px/g) || [])
      .map((d) => Number(d.match(/([\d.]+)/)[1]));
    expect(sizes.length).toBeGreaterThan(4);
    sizes.forEach((s) => expect(s).toBeGreaterThanOrEqual(MIN_CARD_FONT_PX));
  });

  test('the name and the score are the two things readable from across a room', () => {
    const css = cssOf(CARD());
    expect(Number(rule(css, '.name').match(/font-size:([\d.]+)px/)[1])).toBeGreaterThanOrEqual(34);
    expect(Number(rule(css, '.score').match(/font-size:([\d.]+)px/)[1])).toBeGreaterThanOrEqual(46);
  });
});

describe('v4 — a long name is set smaller, not cut off', () => {
  /**
   * Found by looking at the render, not by reasoning about it: "Muhammad Abdul
   * Rehman" at the hero size overran 480 px of card and came out as "Muhammad
   * Abdul Reh…". A child's own name is the one thing on this card that must
   * never be truncated — it is the reason she keeps the picture. So the size
   * steps down with the length instead. The ellipsis rule stays as the last
   * resort for something absurd.
   */
  const nameSize = (html) => Number(
    html.match(/\.name \{[^}]*font-size:([\d.]+)px/)[1],
  );

  test('a short name gets the hero size; a long one steps down to fit', () => {
    expect(nameSize(CARD({ takerName: 'Ali' }))).toBe(38);
    expect(nameSize(CARD({ takerName: 'Ayesha Khan' }))).toBe(38);
    expect(nameSize(CARD({ takerName: 'Muhammad Abdul Rehman' }))).toBeLessThan(34);
  });

  test('the step is measured in code points, so Urdu is measured as Urdu', () => {
    // "محمد عبدالرحمٰن" is 15 code points and sets in Nastaliq, which runs
    // wider per character than Lexend at the same px — it steps down where a
    // 15-character Latin name would not.
    expect(nameSize(CARD({ language: 'ur', takerName: 'عائشہ' }))).toBe(34);
    expect(nameSize(CARD({ language: 'ur', takerName: 'محمد عبدالرحمٰن' }))).toBeLessThan(34);
  });

  test('the name still never wraps, and the ellipsis stays as the last resort', () => {
    const r = rule(cssOf(CARD()), '.name');
    expect(r).toMatch(/white-space:nowrap/);
    expect(r).toMatch(/text-overflow:ellipsis/);
  });

  test('the size follows the NAME\'s script, not the quiz language', () => {
    // A Latin name inside an Urdu card is measured by the Latin steps.
    expect(nameSize(CARD({ language: 'ur', takerName: 'Ali' }))).toBe(38);
  });
});
