/**
 * bd-7l7ne -- A PENDING SURFACE IS NOT PRINTED ON A PRIMARY PLAN.
 *
 * OPERATOR, on reading the first G1-5 plan rendered end-to-end from its live ICT traces:
 * *"what is pending is not relevant for Primary."*
 *
 * WHAT SHE IS RULING ON. Stage-C enrichment for grades 1-5 does not carry seven of the
 * surfaces the v9 schema makes required, so `d0_page2.py` fills each with the sentinel
 * `"design pending -- not carried by primary Stage-C enrichment"` rather than inventing a
 * proxy. On G6-12 that sentinel is the right thing to print: the surface exists, the author
 * owes it, and a teacher seeing the blank is how it gets written. A primary teacher is owed
 * none of them. On her plan the same sentinel is nine lines of apology for surfaces that
 * were never part of her lesson.
 *
 * WHERE THE SUPPRESSION LIVES, AND WHY IT IS HERE AND NOT IN D0. `d0_page2.py` already
 * settled this for `board_final`: *"The suppression is the RENDERER's, not this module's,
 * and deliberately so ... a D0 that emitted nothing would be asking the schema to bend for
 * one grade band."* The document keeps every sentinel -- the schema requires the property,
 * lint reads it, and the enrichment backlog IS that list. Only the paint changes, so a
 * stored lesson re-renders without them at no model cost, and the day enrichment starts
 * carrying a surface it appears with no render change at all.
 *
 * WHAT THIS SUITE DEFENDS:
 *
 *   1. G6-12 IS UNTOUCHED. The sentinel prints verbatim on a grade 9 plan, as it always has.
 *      This is scoped by `isPrimary(doc)` -- read off `provenance.grade`, never a flag.
 *   2. NOTHING PENDING REACHES THE PAGE of a primary plan -- not a block, not a card, not a
 *      list item, not a paragraph.
 *   3. IT CASCADES, AND IT STOPS WHERE CONTENT STARTS. A container emptied by the drop goes
 *      too, up to and including a section whose every block was pending. A container that
 *      still holds real content prints, holding exactly its real content.
 *   4. EVERY DROP IS LOUD. Each one is a render warning naming what went. A silent drop and
 *      an authoring gap look identical from the outside, which is the failure this whole
 *      pipeline exists to prevent.
 *   5. LIVE CONTENT IS NEVER TOUCHED. The control is the same document with the sentinels
 *      replaced by real strings: every surface prints.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const T = require(path.join(VENDOR, 'lib', 'template'));
const { buildHtml, setPageFormat } = T;
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** The exact string `d0_blocks.DESIGN_PENDING` writes. Matching is on the prefix, not on this. */
const PEND = 'design pending — not carried by primary Stage-C enrichment';

const BI = (fill) => ({
  type: 'big_idea',
  id: 'big-idea',
  distinction: fill,
  misconception: fill,
  demo: fill,
});

/**
 * The G3 Maths Ch.2 Day 5 shape, reduced: every surface d0_page2 leaves dark, plus the two
 * blocks in the flow that primary fills with the sentinel. `fill` is the sentinel for the
 * subject document and a real string for the control.
 */
function primaryDoc(fill = PEND) {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 3, subject: 'Math' };

  const dev = d.sections.find((s) => s.id === 'development');
  dev.blocks = [BI(fill), ...dev.blocks];

  // A section whose ONLY block is pending. This is the real shape of that lesson's Check: one
  // `key_points` block titled "Remember", and every item in it the sentinel.
  d.sections = d.sections.map((s) => (s.id !== 'conclusion' ? s : {
    id: 'conclusion',
    title: 'Check',
    minutes: 3,
    blocks: [{ type: 'key_points', id: 'remember', title: 'Remember', items: [fill] }],
  }));

  d.page2 = {
    ...d.page2,
    homework_key: [{ ref: fill, answer: fill }],
    coaching_lookfor: fill,
    coaching_reflection: 'Did every pupil write the regrouping mark before subtracting?',
    differentiation: {
      stuck: 'Hand her the place-value grid and say the column names aloud with her.',
      barrier: fill,
      early: 'Ask her to write a subtraction whose answer is 1,234 and prove it.',
    },
    mistakes: [{ pupil_says: fill, you_ask: 'Can 0 ones give away 7 ones? Show me where the ten comes from.' }],
  };
  return d;
}

const built = (d, opts = {}) =>
  buildHtml(d, { docDir: path.dirname(FIXTURE), lang: 'en', ...opts });
const build = (d, opts = {}) => built(d, opts).html;
const body = (html) => html.split('</style>').pop();
const hasClass = (h, c) => new RegExp(`class="(?:[^"]*\\s)?${c}(?:\\s[^"]*)?"`).test(h);

afterEach(() => setPageFormat('phone'));

/* ------------------------------------------------------------------ 1. the G6-12 control */

describe('a G6-12 plan still prints the sentinel verbatim', () => {
  const g9 = () => {
    const d = primaryDoc();
    d.provenance = { ...d.provenance, grade: 9 };
    return d;
  };

  test('the pending paragraph is on the page', () => {
    expect(body(build(g9()))).toContain(PEND);
  });

  test('and nothing was dropped', () => {
    expect(built(g9()).warnings.filter((w) => /pending/i.test(w))).toEqual([]);
  });

  /**
   * OPERATOR, the same day: *"pls make sure the 1-5 work is separate from 6-12."*
   *
   * "Looks the same" is not an answer to that, so this is the byte test. The whole primary rule
   * lives in `lib/pending.js` and is entered only behind `ctx.primary`, which means a grade 6-12
   * document must render IDENTICALLY whether that module works or explodes on contact. The second
   * build below re-requires the renderer against a `./pending` that throws if anything calls it:
   * if it survives, no 6-12 document ever reaches the primary path, and if the two HTMLs match
   * byte for byte, this work has not moved a pixel of what teachers of grades 6-12 receive.
   */
  test('a grade-9 render is byte-identical with the primary module sabotaged', () => {
    const plain = build(g9());

    let sabotaged;
    jest.isolateModules(() => {
      jest.doMock(path.join(VENDOR, 'lib', 'pending'), () => ({
        PENDING: /never/,
        isPending: () => { throw new Error('the primary rule ran on a grade 9 document'); },
        prunePending: () => { throw new Error('the primary rule ran on a grade 9 document'); },
      }));
      const T2 = require(path.join(VENDOR, 'lib', 'template'));
      sabotaged = T2.buildHtml(g9(), { docDir: path.dirname(FIXTURE), lang: 'en' }).html;
    });
    jest.dontMock(path.join(VENDOR, 'lib', 'pending'));

    expect(sabotaged).toBe(plain);
  });
});

/* ------------------------------------------------------------------ 2. nothing pending paints */

describe('a primary plan carries no pending text at all', () => {
  const h = () => body(build(primaryDoc()));

  test('the sentinel appears nowhere on the page', () => {
    expect(h()).not.toContain(PEND);
    expect(h()).not.toMatch(/design pending — not carried/);
  });

  test('a wholly pending Big Idea does not paint its surface', () => {
    expect(hasClass(h(), 'bigidea')).toBe(false);
  });

  test('a wholly pending homework key does not paint its section', () => {
    expect(h()).not.toContain(LABELS.en.p2Hw);
  });

  test('a section whose every block was pending does not paint its bar', () => {
    expect(h()).not.toMatch(/data-sec="conclusion"/);
  });
});

/* ------------------------------------------------------------------ 3. it stops at content */

describe('a partly-filled surface keeps every live half', () => {
  const h = () => body(build(primaryDoc()));
  const D = primaryDoc().page2.differentiation;
  const M = primaryDoc().page2.mistakes[0];

  test('the two live differentiation cards print', () => {
    expect(h()).toContain(D.stuck);
    expect(h()).toContain(D.early);
  });

  test('the pending third card does not, label included', () => {
    expect(h()).not.toContain(LABELS.en.barrier);
  });

  test('a misconception keeps the question you ask back', () => {
    expect(h()).toContain(M.you_ask);
  });

  test('the coaching corner keeps its reflection when the look-for is dark', () => {
    expect(h()).toContain(primaryDoc().page2.coaching_reflection);
  });

  /**
   * THE REAL G3 SAMPLE, WHICH THE REDUCED FIXTURE ABOVE DOES NOT REACH. Its `conclusion` holds one
   * wholly-pending `key_points` block AND an authored `exit_ticket` as a sibling key. The section
   * therefore has real content and must print -- bar, minutes and exit ticket -- with only the
   * pending list gone. Caught by rendering the actual lesson: the emptied `blocks` key is removed,
   * not blanked, so every reader of it has to be null-safe the same way the painters are.
   */
  test('a section that keeps a sibling surface survives losing all of its blocks', () => {
    const d = primaryDoc();
    const TICKET = 'Write 4,002 - 5 and ring the column you renamed.';
    d.sections = d.sections.map((x) => (x.id !== 'conclusion' ? x
      : { ...x, exit_ticket: [{ q: TICKET, a: '3,997, with the thousand renamed once.' }] }));
    const out = built(d);
    const h = body(out.html);
    expect(h).toMatch(/data-sec="conclusion"/);
    expect(h).toContain(TICKET);
    expect(h).not.toContain('Remember');
    // the whole `blocks` array, not a block inside it -- the drop is reported at the level it
    // happened, so the enrichment backlog reads "this lesson's Check is a placeholder".
    expect(out.warnings.filter((w) => /pending/i.test(w) && /\/blocks$/.test(w)))
      .toEqual(['primary: dropped design-pending sections[3]/blocks']);
  });
});

/* ------------------------------------------------------------------ 4. every drop is loud */

describe('the renderer says what it dropped', () => {
  const warn = () => built(primaryDoc()).warnings.filter((w) => /pending/i.test(w));

  test('there is a warning per dropped surface, not one summary line', () => {
    expect(warn().length).toBeGreaterThanOrEqual(6);
  });

  test('each names the surface it dropped', () => {
    const all = warn().join('\n');
    for (const needle of ['big_idea', 'homework_key', 'coaching_lookfor', 'differentiation', 'mistakes', 'conclusion']) {
      expect(all).toContain(needle);
    }
  });
});

/* ------------------------------------------------------------------ 5. live content is safe */

describe('the same document with real content loses nothing', () => {
  const REAL = 'Ten ones become one ten, and the total never changes.';
  const h = () => body(build(primaryDoc(REAL)));

  test('every surface prints', () => {
    expect(hasClass(h(), 'bigidea')).toBe(true);
    expect(h()).toContain(LABELS.en.p2Hw);
    expect(h()).toContain(LABELS.en.barrier);
    expect(h()).toMatch(/data-sec="conclusion"/);
  });

  test('and nothing is reported dropped', () => {
    expect(built(primaryDoc(REAL)).warnings.filter((w) => /pending/i.test(w))).toEqual([]);
  });
});
