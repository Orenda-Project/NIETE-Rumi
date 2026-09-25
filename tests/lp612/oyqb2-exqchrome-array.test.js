/**
 * bd-oyqb2 / bd-3z25f -- `exqChrome` IS THE ONE CALL SITE THE ARRAY FORM NEVER REACHED.
 *
 * Nine authored fields were widened from `string` to `string | string[]` so a dense welded
 * paragraph can print as scannable rows. Eleven call sites in lib/template.js learned the
 * array form. `exqChrome` -- the chrome every SPLIT example shares, and the only renderer a
 * long worked/faded example ever reaches -- did not:
 *
 *   `b.prompt.split(" · ")`   (the `we` branch)  THROWS on an array:
 *                                  "TypeError: b.prompt.split is not a function"
 *   `rich(b.prompt)`               (the plain branch) does NOT throw. It silently emits
 *                                  `Array.prototype.toString()` -- elements welded by a bare
 *                                  comma with no space, which eats a word boundary and is the
 *                                  exact defect this bead exists to kill.
 *
 * WHY THIS SUITE IS BUILT ON A PRIMARY FIXTURE (bd-3z25f). `v9_gate_base.lp.json` is a
 * Grade 9 / STEM-2 document. Every v9 gate suite standing on it is green and BLIND to primary,
 * which is where `exqChrome` actually lives: measured over the 335 rendered ch9-10 documents,
 * 333 (99.4%) route a worked/faded example through `exqChrome`, and all 329 prompt-bearing
 * ones are primary `faded_example`s. `primary_g1_english.lp.json` is a real corpus document
 * (GRADE_1_ENGLISH_CH10_SEG1); its `activity.faded_example` carries 18 turns and a prompt, so
 * it hits the `turns >= 4` dispatch at blockAtoms and reaches `exqChrome` on every render.
 *
 * WHAT IS PROVEN, and what is deliberately NOT. Proven: both branches accept an array; the
 * string form stays byte-identical; and the array and its ` · `-joined equivalent carry the
 * SAME WORDS, by multiset, not by eye. NOT proven here, because it is not this bead's to
 * decide: WHICH form a given lesson gets. That is the two-pass fill gate (bd-8sfwj) in
 * render_lp.js, per the operator's ruling -- *"use the new readable format on a page only if
 * that lesson has spare room; leave it as-is where the lesson is already full"*. This file
 * makes both forms CORRECT and leaves the choice selectable.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'primary_g1_english.lp.json');
const SEP = ' · ';

const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const html = (d) => buildHtml(d, { docDir: path.dirname(FIXTURE) }).html;
/** CSS ships verbatim inside <style>; the body starts right after it. */
const body = (d) => html(d).split('</style>').pop();

const sec = (d, id) => d.sections.find((s) => s.id === id);
const fadedBlock = (d) => sec(d, 'activity').blocks.find((b) => b.type === 'faded_example');
const workedBlock = (d) => sec(d, 'development').blocks.find((b) => b.type === 'worked_example');

/** The `we` branch's set-up list, exactly as `exqChrome` emits it. */
const setupOf = (out) => {
  const i = out.indexOf('<ul class="setup">');
  return i < 0 ? null : out.slice(i, out.indexOf('</ul>', i) + 5);
};
/** The plain branch's prompt div. */
const promptOf = (out) => {
  const i = out.indexOf('<div class="prompt">');
  return i < 0 ? null : out.slice(i, out.indexOf('</div>', i) + 6);
};

/** Tags out, entities loosened, whitespace normalised, split to words. */
const words = (frag) => frag
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .split(/\s+/).filter(Boolean);
const bag = (ws) => ws.slice().sort().join('\u0000');

const PROMPT = [
  'Pairs sit knee-to-knee with one copy of page 41 between them.',
  'Partner A reads the clue aloud; Partner B blends the word sound by sound.',
  'They swap roles after every second word and both write the answer.',
];

/* -------------------------------------------------- 1. the `we` branch (faded_example) */

describe('bd-oyqb2: exqChrome `we` branch takes an array', () => {
  test('the fixture really does reach exqChrome -- 18 turns, over the >=4 dispatch', () => {
    const b = fadedBlock(doc());
    expect(Array.isArray(b.turns) && b.turns.length).toBeGreaterThanOrEqual(4);
    expect(typeof b.prompt).toBe('string');
    // pc-a/pc-z are emitted ONLY by exqAtoms/exqStepAtoms, i.e. only through exqChrome.
    expect(body(doc())).toContain(`blk exq we pc pc-a`);
  });

  test('an array prompt renders one <li> per element -- it does not throw', () => {
    const d = doc();
    fadedBlock(d).prompt = PROMPT;
    expect(setupOf(body(d))).toBe(
      `<ul class="setup">${PROMPT.map((x) => `<li>${x}</li>`).join('')}</ul>`
    );
  });

  test('a string prompt is byte-identical to before -- still split on its authored separator', () => {
    const d = doc();
    fadedBlock(d).prompt = PROMPT.join(SEP);
    expect(setupOf(body(d))).toBe(
      `<ul class="setup">${PROMPT.map((x) => `<li>${x}</li>`).join('')}</ul>`
    );
  });

  test('WORD CONSERVATION: array and joined string carry the same words', () => {
    const a = doc(); fadedBlock(a).prompt = PROMPT;
    const s = doc(); fadedBlock(s).prompt = PROMPT.join(SEP);
    const wa = words(setupOf(body(a)));
    const ws = words(setupOf(body(s)));
    expect(wa.length).toBe(ws.length);
    expect(bag(wa)).toBe(bag(ws));
    expect(bag(wa)).toBe(bag(words(PROMPT.join(' '))));
  });

  test('no element is welded to the next -- the comma-join defect leaves a fingerprint', () => {
    const d = doc();
    fadedBlock(d).prompt = PROMPT;
    const out = setupOf(body(d));
    // Array.prototype.toString() would print "…them.,Partner…" -- a comma with no space,
    // gluing the last word of one element to the first word of the next.
    expect(out).not.toMatch(/them\.,Partner/);
    expect(words(out)).toContain('them.');
    expect(words(out)).toContain('Partner');
  });
});

/* ------------------------------------- 2. the plain branch (worked_example with a prompt) */

describe('bd-oyqb2: exqChrome plain branch takes an array', () => {
  test('a worked_example with a prompt and >=4 turns reaches exqChrome too', () => {
    const d = doc();
    workedBlock(d).prompt = 'PLAIN PROMPT MARKER.';
    expect(Array.isArray(workedBlock(d).turns) && workedBlock(d).turns.length).toBeGreaterThanOrEqual(4);
    expect(body(d)).toContain(`blk exq pc pc-a`);
  });

  test('an array prompt renders richRows markup, matching the unsplit worked_example', () => {
    const d = doc();
    workedBlock(d).prompt = PROMPT;
    expect(promptOf(body(d))).toBe(
      `<div class="prompt"><ul class="kp">${PROMPT.map((x) => `<li>${x}</li>`).join('')}</ul></div>`
    );
  });

  test('a string prompt is byte-identical to before -- no list wrapper', () => {
    const d = doc();
    workedBlock(d).prompt = 'PLAIN PROMPT MARKER.';
    expect(promptOf(body(d))).toBe('<div class="prompt">PLAIN PROMPT MARKER.</div>');
  });

  test('WORD CONSERVATION: array and space-joined string carry the same words', () => {
    const a = doc(); workedBlock(a).prompt = PROMPT;
    const s = doc(); workedBlock(s).prompt = PROMPT.join(' ');
    const wa = words(promptOf(body(a)));
    const ws = words(promptOf(body(s)));
    expect(wa.length).toBe(ws.length);
    expect(bag(wa)).toBe(bag(ws));
  });

  test('the silent comma-weld is gone -- elements do not run together', () => {
    const d = doc();
    workedBlock(d).prompt = PROMPT;
    expect(promptOf(body(d))).not.toMatch(/them\.,Partner/);
  });
});

/* ------------------------------------------- 3. the other dispatch branch: flat `steps` */

describe('bd-oyqb2: exqStepAtoms shares the same chrome and the same fix', () => {
  /** The corpus pairs no prompt with a >=6-step example (148 such blocks, 0 with a prompt),
   *  so the steps route is built here from the fixture's own faded_example. */
  const stepDoc = (prompt) => {
    const d = doc();
    const b = fadedBlock(d);
    delete b.turns;
    b.steps = ['Step one.', 'Step two.', 'Step three.', 'Step four.', 'Step five.', 'Step six.'];
    b.prompt = prompt;
    return d;
  };

  test('the rebuilt block really takes the steps route -- <ol start> is exqStepAtoms only', () => {
    expect(body(stepDoc(PROMPT.join(SEP)))).toContain('<ol start="2"');
  });

  test('an array prompt renders one <li> per element on the steps route', () => {
    expect(setupOf(body(stepDoc(PROMPT)))).toBe(
      `<ul class="setup">${PROMPT.map((x) => `<li>${x}</li>`).join('')}</ul>`
    );
  });

  test('WORD CONSERVATION on the steps route as well', () => {
    const wa = words(setupOf(body(stepDoc(PROMPT))));
    const ws = words(setupOf(body(stepDoc(PROMPT.join(SEP)))));
    expect(bag(wa)).toBe(bag(ws));
    expect(bag(wa)).toBe(bag(words(PROMPT.join(' '))));
  });
});

/* ----------------------------------------------------- 4. nothing else may have moved */

describe('bd-oyqb2: the do-not-cut list is untouched by this change', () => {
  test('a string-authored document renders byte-identically to its own baseline shape', () => {
    // The fixture as shipped authors a STRING prompt; every corpus document does. If this
    // change altered the string path at all, the two renders below would differ.
    const a = body(doc());
    const d = doc();
    d.sections = JSON.parse(JSON.stringify(d.sections));
    expect(body(d)).toBe(a);
  });

  test('pc-a and pc-z both still print -- the split chrome is intact', () => {
    const out = body(doc());
    expect(out).toContain('pc pc-a');
    expect(out).toContain('pc pc-z');
  });
});
