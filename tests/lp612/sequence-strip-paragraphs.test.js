/**
 * bd-a8veu.15 — THE SEQUENCE STRIP IS FOUR STATEMENTS, SO IT IS FOUR LINES.
 *
 * OPERATOR, 2026-09-12: *"The Next LPs is perfect, the current and next and checkpoint statements
 * should be on new lines, like a new paragraph."*
 *
 * The CONTENT is signed off — this is a layout instruction and nothing else. Today the four legs
 * (last / current / next / checkpoint) run together as one paragraph of continuous text, so a
 * teacher scanning for "what am I teaching today" has to read a sentence to find it. Four facts
 * that are read independently get four lines.
 *
 * TWO EARLIER CONSTRAINTS ON THIS STRIP STILL BIND, and this suite re-asserts both so the layout
 * change cannot quietly undo them:
 *
 *   bd-a8veu.2 — the strip must not be a FLEX row, and no arrow may be a DIRECT child of it. A
 *   direct child is an atomic box: a phrase too long for the line jumps whole and leaves the rest
 *   of that line blank, and an arrow that is a box of its own gets stranded alone. Each arrow
 *   therefore lives INSIDE the phrase it leads away from, glued to its last word. Stacking the
 *   legs does not change that — a leg is still ordinary text that wraps word by word within its
 *   own line.
 *
 *   bd-a8veu.19 — the `.seq` box itself must survive. An unclosed CSS comment above it ate the
 *   whole rule for the life of v9.3, which is why the strip has been rendering unboxed.
 *
 * WHAT CHANGES: each leg becomes a block, with a paragraph's worth of air between legs, and the
 * `·` that separated checkpoint from next in the running text goes — a separator between two
 * things that are no longer on the same line is just a stray dot.
 *
 * WHY THIS IS A RENDERER FIX AND NOT A BRIEF: see the docblock of
 * `tests/lp612/outcome-one-voice-render.test.js`. A defect you can see on the page lands on the
 * ~4,700 stored lessons only if the RENDERER is what changed.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const buildFrom = (d, lang = 'en') => buildHtml(d, { lang, docDir: path.dirname(FIXTURE) }).html;
const built = (lang = 'en') => buildFrom(doc(), lang);

/** the one rule the emitted sheet declares for `sel`, as it was written */
function rule(html, sel) {
  const m = html.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}`));
  if (!m) throw new Error(`the emitted stylesheet has no rule for \`${sel}\``);
  return m[0];
}

/** everything after the stylesheet — CSS comments ship verbatim, so the body starts at `</style>` */
const body = (html) => html.slice(html.indexOf('</style>'));

/** the strip as emitted, `<div class="seq …">` through its closing tag */
function strip(html) {
  const b = body(html);
  const i = b.indexOf('class="seq');
  if (i < 0) throw new Error('the emitted document has no sequence strip');
  const open = b.lastIndexOf('<div', i);
  return b.slice(open, b.indexOf('</div>', i) + 6);
}

/** the attributes of the strip's DIRECT child spans, in paint order */
function directChildren(s) {
  const inner = s.slice(s.indexOf('>') + 1, s.lastIndexOf('</div>'));
  const out = [];
  let depth = 0;
  for (const m of inner.matchAll(/<(\/?)span\b([^>]*)>/g)) {
    if (m[1]) depth--;
    else out.push(depth++ === 0 ? m[2] : null);
  }
  return out.filter((a) => a !== null);
}

describe('bd-a8veu.15 — each leg of the sequence strip is its own paragraph', () => {
  test('the legs are blocks, not a run of inline phrases', () => {
    // The direct-child combinator is deliberate: it must not catch `.arrow`, which is nested
    // inside a leg and has to stay inline or it becomes a box of its own again (bd-a8veu.2).
    expect(rule(built(), '.seq > span')).toMatch(/display:\s*block/);
  });

  test('there is air between the legs — a new line is not yet a new paragraph', () => {
    const r = rule(built(), '.seq > span + span');
    expect(r).toMatch(/margin-top:\s*\d/);
  });

  test('the checkpoint no longer carries the running-text separator', () => {
    // `· Checkpoint:` made sense when next and checkpoint shared a line. On a line of its own a
    // leading middot is a stray mark.
    const s = strip(built());
    const i = s.indexOf('Checkpoint:');
    expect(i).toBeGreaterThan(-1);
    // nothing between the opening of the checkpoint leg and its label but the `<b>`
    expect(s.slice(s.lastIndexOf('<span', i), i)).not.toContain('&middot;');
  });

  test('all four legs are still there, in order, each a direct child', () => {
    const s = strip(built());
    const d = doc();
    expect(directChildren(s)).toHaveLength(4);
    let cursor = -1;
    for (const phrase of [d.sequence.previous, d.sequence.this, d.sequence.next, d.sequence.checkpoint]) {
      const i = s.indexOf(phrase.replace(/&/g, '&amp;'));
      expect(i).toBeGreaterThan(cursor);
      cursor = i;
    }
  });

  test('bd-a8veu.2 still holds — not a flex row, and no arrow is a direct child', () => {
    const s = strip(built());
    expect(rule(built(), '.seq')).not.toMatch(/display:\s*flex/);
    expect(directChildren(s).some((a) => /class="arrow"/.test(a))).toBe(false);
    expect(s).toContain('class="arrow"');
  });

  test('bd-a8veu.19 still holds — the strip is still a box', () => {
    const r = rule(built(), '.seq');
    expect(r).toMatch(/background:/);
    expect(r).toMatch(/border:/);
    expect(r).toMatch(/padding:/);
  });

  test('the Urdu strip stacks the same way', () => {
    expect(rule(built('ur'), '.seq > span')).toMatch(/display:\s*block/);
    expect(directChildren(strip(built('ur')))).toHaveLength(4);
  });
});
