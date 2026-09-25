/**
 * bd-8sfwj — THE TWO-PASS FILL GATE FOR THE bd-oyqb2 ARRAY FORM.
 *
 * Operator ruling, 2026-09-24: *"Use the new readable format on a page only if that lesson has
 * spare room; leave it as-is where the lesson is already full. Nothing gets longer, but the
 * improvement is uneven — some lessons keep the dense block."*
 *
 * Two standing rulings bound the mechanism and rule out every cheaper one:
 *   *"dont cut anything, increase the page cap for those 14"* — the gate chooses a FORM, never
 *   a SUBSET. Nothing here may drop a word.
 *   *"I want lower, we cant go beyond 8, its too much to read and remember!"* — the cap is real,
 *   so "spare room" cannot be guessed at. It is measured, by rendering both ways.
 *
 * WHICH SLOTS THE GATE COVERS, AND WHY ONE IS MISSING. Measured over all 335 ch9-10 documents by
 * rendering each one twice and md5-ing the HTML (2026-09-24):
 *
 *   faded_example.prompt   array form BYTE-IDENTICAL on 335/335 documents, 0 page changes
 *   ask.question           +1 page on 18/335
 *   differentiation.*      +1 page on 15/335
 *   coaching_reflection    +1 page on  4/335   (richLines, <br>-joined — the mildest)
 *   worked_example.cfu     +1 page on  3/335
 *   objectives.outcome     +1 page on  2/335, and −1 page on 1
 *   all six together       +1 page on 38/335 (11.3%)
 *
 * `faded_example.prompt` is therefore DELIBERATELY OUTSIDE the gate. Its string branch already
 * splits on " · " into the same <ul class="setup">, so the two shapes are the same markup and
 * gating it would spend two render passes to decide nothing. Worse, joining it with a space
 * would WELD a list that prints as separate rows today — the gate would make that field worse.
 *
 * A ONE-ELEMENT array still costs 9/335 documents a page, so the cost is the <ul class="kp">
 * chrome itself and not merely the extra rows. That is why no fill-percentage heuristic can
 * stand in for the measurement.
 *
 * THE BROWSER IS MOCKED at the `playwright-core` boundary — the pattern render.test.js and
 * page-count-advice.test.js already use. Nothing here claims a pixel: the unit tests are pure,
 * and the integration tests drive the REAL gate with page counts the test supplies, so what is
 * proved is the DECISION, not the layout that feeds it.
 */

const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

// Successive probe results, one per browser pass: [joined measurement, array measurement, real].
let mockProbeQueue = [];
let mockMeasured = null;
let mockLaunches = 0;
// When set, the probe is computed FROM THE HTML THAT WAS LOADED rather than from the queue, so a
// test can prove the gate measured the variant it says it measured — not merely that it rendered
// twice. Without this, swapping the two variants is invisible to a queue-driven mock.
let mockProbeFor = null;
let mockLoadedPath = null;

jest.mock('playwright-core', () => {
  const stubPage = () => ({
    goto: jest.fn(async (url) => { mockLoadedPath = String(url).replace(/^file:\/\//, '').replace(/\?t=\d+$/, ''); return null; }),
    emulateMedia: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn(async (src) => {
      const s = String(src);
      if (s.includes('document.fonts.ready')) return true;
      if (s.includes("classList.add('measuring')")) return mockMeasured;
      if (s.includes('minBodyFontPx')) {
        if (mockProbeFor) return mockProbeFor(require('fs').readFileSync(mockLoadedPath, 'utf8'));
        return mockProbeQueue.shift();
      }
      return undefined;
    }),
    pdf: jest.fn(async () => Buffer.from('%PDF-1.4\n/Type /Page \n')),
    $$: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  });
  return {
    chromium: {
      launch: jest.fn(async () => {
        mockLaunches += 1;
        return {
          newPage: jest.fn(async () => stubPage()),
          close: jest.fn().mockResolvedValue(undefined),
        };
      }),
    },
  };
}, { virtual: true });

// bd-8sfwj: a LITERAL relative require, deliberately NOT the `path.join(VENDOR, …)` form the 57
// sibling lp612 suites use. That computed form is unresolvable to a static require-graph, so every
// one of those suites is an offender row inside the already-red `tests/setup/unresolved-requires`
// guard — and a new row in an already-red guard is still a regression. This resolves statically.
const R = require('../../bot/vendor/lp-v9/render_lp.js');

const CLEAN = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const clone = (d) => JSON.parse(JSON.stringify(d));
const askBlock = (d) => {
  for (const sec of d.sections || []) for (const b of sec.blocks || []) if (b.type === 'ask') return b;
  throw new Error('fixture has no ask block');
};
const fadedBlock = (d) => {
  for (const sec of d.sections || []) for (const b of sec.blocks || []) if (b.type === 'faded_example') return b;
  throw new Error('fixture has no faded_example block');
};

// ── the slot walker, the join, and the comparison ────────────────────────────────────────────

describe('hasArrayForm — which documents the gate is allowed to spend a render pass on', () => {
  test('the corpus shape today: every widened slot is a string, so the gate never fires', () => {
    expect(R.hasArrayForm(CLEAN)).toBe(false);
  });

  test('an array on ask.question puts the document in scope', () => {
    const d = clone(CLEAN);
    askBlock(d).question = ['Which shop is cheaper?', 'How do you know?'];
    expect(R.hasArrayForm(d)).toBe(true);
  });

  test('an array on objectives.outcome puts the document in scope', () => {
    const d = clone(CLEAN);
    d.objectives.outcome = ['You can read a table.', 'You can add two columns.'];
    expect(R.hasArrayForm(d)).toBe(true);
  });

  test('an array on differentiation.stuck puts the document in scope', () => {
    const d = clone(CLEAN);
    d.page2.differentiation.stuck = ['Point at each word.', 'Read it again slowly.'];
    expect(R.hasArrayForm(d)).toBe(true);
  });

  test('an array on coaching_reflection puts the document in scope', () => {
    const d = clone(CLEAN);
    d.page2.coaching_reflection = ['Did every pupil answer?', 'Who did not?'];
    expect(R.hasArrayForm(d)).toBe(true);
  });

  test('an array on worked_example.cfu puts the document in scope', () => {
    const d = clone(CLEAN);
    for (const sec of d.sections) for (const b of sec.blocks) if (b.type === 'worked_example') b.cfu = ['Why?', 'Show me.'];
    expect(R.hasArrayForm(d)).toBe(true);
  });

  test('an array on exit_ticket.q puts the document in scope', () => {
    const d = clone(CLEAN);
    for (const sec of d.sections) for (const x of sec.exit_ticket || []) x.q = ['Write the entry.', 'Say which row it came from.'];
    expect(R.hasArrayForm(d)).toBe(true);
  });

  test('an array on worked_example.prompt puts the document in scope', () => {
    const d = clone(CLEAN);
    for (const sec of d.sections) for (const b of sec.blocks) if (b.type === 'worked_example') b.prompt = ['Find $AB$.', 'Show each step.'];
    expect(R.hasArrayForm(d)).toBe(true);
  });

  test('an array on differentiation.early puts the document in scope', () => {
    const d = clone(CLEAN);
    d.page2.differentiation.early = ['Ask for $A(BC)$.', 'Ask what changed.'];
    expect(R.hasArrayForm(d)).toBe(true);
  });

  /* THE MEASURED EXCLUSION. 335/335 byte-identical either way — there is nothing to decide, so
     spending two render passes to decide it would be pure cost, and joining the array would weld
     a list that prints as rows today. */
  test('an array on faded_example.prompt does NOT put the document in scope', () => {
    const d = clone(CLEAN);
    fadedBlock(d).prompt = ['Read the clue aloud.', 'Write your two guesses.'];
    expect(R.hasArrayForm(d)).toBe(false);
  });

  test('faded_example.prompt does not mask a real array elsewhere in the same document', () => {
    const d = clone(CLEAN);
    fadedBlock(d).prompt = ['Read the clue aloud.', 'Write your two guesses.'];
    askBlock(d).question = ['Which shop is cheaper?', 'How do you know?'];
    expect(R.hasArrayForm(d)).toBe(true);
  });
});

describe('joinArrayForm — the "as-is" form, rebuilt from the array the author wrote', () => {
  test('a gated array becomes the one string the dense block prints', () => {
    const d = clone(CLEAN);
    askBlock(d).question = ['Which shop is cheaper?', 'How do you know?'];
    expect(askBlock(R.joinArrayForm(d)).question).toBe('Which shop is cheaper? How do you know?');
  });

  test('every gated slot is joined, not just the first one found', () => {
    const d = clone(CLEAN);
    askBlock(d).question = ['A one.', 'B two.'];
    d.objectives.outcome = ['C three.', 'D four.'];
    d.page2.differentiation.stuck = ['E five.', 'F six.'];
    d.page2.differentiation.early = ['G seven.', 'H eight.'];
    d.page2.coaching_reflection = ['I nine.', 'J ten.'];
    const j = R.joinArrayForm(d);
    expect(askBlock(j).question).toBe('A one. B two.');
    expect(j.objectives.outcome).toBe('C three. D four.');
    expect(j.page2.differentiation.stuck).toBe('E five. F six.');
    expect(j.page2.differentiation.early).toBe('G seven. H eight.');
    expect(j.page2.coaching_reflection).toBe('I nine. J ten.');
  });

  test('exit_ticket.q and both worked_example slots are joined too', () => {
    const d = clone(CLEAN);
    for (const sec of d.sections) {
      for (const x of sec.exit_ticket || []) x.q = ['K one.', 'L two.'];
      for (const b of sec.blocks) if (b.type === 'worked_example') { b.prompt = ['M one.', 'N two.']; b.cfu = ['O one.', 'P two.']; }
    }
    const j = R.joinArrayForm(d);
    const et = j.sections.flatMap((s2) => s2.exit_ticket || []);
    const we = j.sections.flatMap((s2) => s2.blocks || []).filter((b) => b.type === 'worked_example');
    expect(et.map((x) => x.q)).toEqual(['K one. L two.']);
    expect(we.map((b) => b.prompt)).toEqual(['M one. N two.']);
    expect(we.map((b) => b.cfu)).toEqual(['O one. P two.']);
  });

  /* The separator is a SPACE, not an empty string: welding "A one." to "B two." would invent a
     word the author never wrote. */
  test('the join puts a space between rows', () => {
    const d = clone(CLEAN);
    askBlock(d).question = ['A one.', 'B two.'];
    expect(askBlock(R.joinArrayForm(d)).question).not.toBe('A one.B two.');
  });

  /* The field the gate does not own, it does not touch. Welding this one would REMOVE rows the
     string form already prints. */
  test('faded_example.prompt survives the join untouched, still an array', () => {
    const d = clone(CLEAN);
    fadedBlock(d).prompt = ['Read the clue aloud.', 'Write your two guesses.'];
    askBlock(d).question = ['A one.', 'B two.'];
    expect(fadedBlock(R.joinArrayForm(d)).prompt).toEqual(['Read the clue aloud.', 'Write your two guesses.']);
  });

  test('a string slot is left exactly as it was', () => {
    const d = clone(CLEAN);
    const before = d.objectives.outcome;
    expect(R.joinArrayForm(d).objectives.outcome).toBe(before);
  });

  test('the caller\'s document is never mutated — the join returns a copy', () => {
    const d = clone(CLEAN);
    askBlock(d).question = ['A one.', 'B two.'];
    R.joinArrayForm(d);
    expect(askBlock(d).question).toEqual(['A one.', 'B two.']);
  });
});

describe('measurePartCounts — no browser, no measurement', () => {
  /* The CLI fallback has no probe at all, so there is nothing to compare. Returning null (rather
     than guessing) feeds `keepArrayForm(null, null) === false`, and the lesson keeps the dense
     block — "nothing gets longer" is honoured WITHOUT a measurement anyone could point at. */
  test('a null browser measures nothing and says so', async () => {
    await expect(R.measurePartCounts(null, CLEAN, {})).resolves.toBeNull();
  });
});

describe('keepArrayForm — "nothing gets longer", read part by part', () => {
  test('same page count in every part: the lesson had spare room, keep the readable form', () => {
    expect(R.keepArrayForm({ teach: 6, support: 1 }, { teach: 6, support: 1 })).toBe(true);
  });

  test('one more teach page: the lesson was full, keep the dense block', () => {
    expect(R.keepArrayForm({ teach: 6, support: 1 }, { teach: 7, support: 1 })).toBe(false);
  });

  test('one more SUPPORT page is also a loss — the cap is per part, not a total', () => {
    expect(R.keepArrayForm({ teach: 6, support: 1 }, { teach: 6, support: 2 })).toBe(false);
  });

  /* A part may not grow even when another part shrinks by the same amount: the two caps are
     separate numbers and a total would let a teach page hide behind a support page. */
  test('a teach page bought with a support page is still a loss', () => {
    expect(R.keepArrayForm({ teach: 6, support: 2 }, { teach: 7, support: 1 })).toBe(false);
  });

  /* Measured: g4_ch9/Urdu_seg1 goes 7 -> 6 pages under the array form. The operator said
     "nothing gets longer", not "nothing changes", so a free page is taken, not thrown away. */
  test('FEWER pages is a win, not a violation — the array form is kept', () => {
    expect(R.keepArrayForm({ teach: 7, support: 1 }, { teach: 6, support: 1 })).toBe(true);
  });

  test('a part that only the candidate has counts as growth from zero', () => {
    expect(R.keepArrayForm({ teach: 6 }, { teach: 6, support: 1 })).toBe(false);
  });

  test('a part that only the baseline has is a saving, not growth', () => {
    expect(R.keepArrayForm({ teach: 6, support: 1 }, { teach: 6 })).toBe(true);
  });

  test('a missing measurement is never read as permission', () => {
    expect(R.keepArrayForm(null, { teach: 6 })).toBe(false);
    expect(R.keepArrayForm({ teach: 6 }, null)).toBe(false);
  });
});
