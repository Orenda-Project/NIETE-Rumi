/**
 * bd-ilzfs — A WORKED EXAMPLE MAY BREAK BETWEEN TURNS, AND SAYS SO WHEN IT DOES.
 *
 * OPERATOR: *"the pages should not be more than 4 pages on html pls, possible or not?"*, then
 * *"21 px is non negotiable, what can be fixed in the design?"* — type size is off the table, so
 * the only lever left is the 34% of the rendered page that is furniture and blank.
 *
 * WHERE THE BLANK WAS. Over the 38-lesson G4 Ch9 corpus at 21px a `.blk` is 86% of all content
 * height and tops out at 2,500px against a 1,986px page box: `.exq.we` (WE-DO) is 1,490px median
 * and ALL 30 exceed the 493px a page typically has left at its foot, `.exq` (I-DO) 723px median,
 * 50 of 60 over. As ONE atom such a block demands a page of its own and overflows it, and the bar
 * glued in front cannot join it — `glue`'s stand-alone escape hatch strands the bar on a sheet by
 * itself, so five lessons printed a strip, a bar and a footer over nothing else, 6% full.
 *
 * The packer is not at fault: `packAtoms` is an exact DP and is page-optimal FOR THE ATOMS IT IS
 * GIVEN — it cannot put half a block in a hole because there was no half block. So the fix is atom
 * GRANULARITY, exactly as `practice` (v8.1) and `homework` (bd-x4xxm) already do it. These pin:
 *   * a document with no `turns` is untouched — the fixture is G6-12 and is the control
 *   * a card splits only where a break is pedagogically safe: between TURNS, never between a
 *     prompt and its answer, and never before the closing result
 *   * N pieces PAINT WHAT ONE CARD PAINTED — the seam is the 2px gap `.scr` already draws
 *   * a break landing on a seam dashes that edge in the surface's own ink, so the teacher sees
 *     the card continues overleaf — while a card that genuinely ended still closes solid
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');
const { LABELS } = require('../../bot/vendor/lp-v9/lib/overlay');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const build = (d, opts = {}) =>
  buildHtml(d || doc(), { lang: 'en', docDir: path.dirname(FIXTURE), ...opts });
const body = (d, opts) => build(d, opts).html.split('</style>').pop();

/** The emitted sheet, comments stripped — what a CSS parser sees. */
function sheet(d, lang = 'en') {
  const out = build(d, { lang }).html;
  return out.slice(out.indexOf('<style>') + 7, out.lastIndexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(data:[^)]*\)/g, 'url(data:)');
}

/** Five turns: over the gate of four, and one of them answers. */
const TURNS = [
  { kind: 'do', text: 'Open the page and set out the four labelled boxes.', ref: 'p.180' },
  { kind: 'say', text: 'Let us build the class plan together.' },
  { kind: 'ask', text: 'What is 2023 plus 5?', expect: ['2028'] },
  { kind: 'frame', text: 'It opens in ___.' },
  { kind: 'say', text: 'Write the opening date under the title.' },
];
/** Three turns — under the gate, so the same block stays whole. */
const SHORT = TURNS.slice(0, 3);

const script = (id, turns, d = doc()) => {
  for (const s of d.sections) for (const b of s.blocks) if (b.id === id) b.turns = turns;
  return d;
};

const ATOM = /<[a-z]+ data-atom[^>]*class="([^"]*)"/g;
const atomClasses = (h) => [...h.matchAll(ATOM)].map((m) => m[1]);
const EXQ = /<div data-atom class="(blk exq[^"]*)">/g;
const bare = (cls) => cls.replace(/\s*\bsp-\d\b/, '');

/** The run of atoms ONE example occupies — from its first root to the next atom that is not
 *  part of it. A split card is N sibling atoms, so a card is a RUN, not a single element. */
function run(h, we) {
  const hits = [...h.matchAll(EXQ)].filter((m) => /\bwe\b/.test(m[1]) === we);
  if (!hits.length) return '';
  const last = hits[hits.length - 1];
  const after = h.indexOf('data-atom', last.index + last[0].length);
  return h.slice(hits[0].index, after === -1 ? h.length : h.lastIndexOf('<', after));
}
const IDO = (h) => run(h, false);
const WEDO = (h) => run(h, true);

/** Every `.exq` root in a run, with its own slice of markup. `sp-N` is the packer's. */
function cards(h) {
  const hits = [...h.matchAll(EXQ)];
  const ends = [...h.matchAll(/<[a-z]+ data-atom/g)].map((m) => m.index);
  return hits.map((m) => {
    const next = ends.find((i) => i > m.index);
    return { cls: bare(m[1]), html: h.slice(m.index + m[0].length, next === undefined ? h.length : next) };
  });
}

/** The printed shape of an example, as an ordered token stream. */
function stream(h) {
  const rx = /<div data-atom class="(blk exq[^"]*)">|<span class="tag">|<ul class="setup">|<div class="prompt">|<div class="scr">|<div class="tn ([^"]+)">|<div class="res">/g;
  return [...h.matchAll(rx)].map((m) => {
    if (m[1] !== undefined) return `card:${bare(m[1])}`;
    if (m[2] !== undefined) return `tn:${m[2]}`;
    if (m[0].includes('tag')) return 'tag';
    if (m[0].includes('setup') || m[0].includes('prompt')) return 'setup';
    return m[0].includes('scr') ? 'scr' : 'res';
  });
}

const page = (h, id) => {
  const a = h.indexOf(`id="${id}"`), b = h.indexOf('<div class="page"', a + 1);
  return h.slice(a, b === -1 ? h.length : b);
};

// ── the control ─────────────────────────────────────────────────────────────
describe('a document with no `turns` splits nothing', () => {
  test('the G6-12 fixture prints each example as ONE card, with no seam classes', () => {
    const h = body(doc());
    expect(h).not.toMatch(/class="[^"]*\bpc\b/);
    expect(h).not.toContain('pc-a');
    expect(stream(IDO(h))).toEqual(['card:blk exq', 'tag', 'setup', 'res']);
    expect(IDO(h)).toContain('<ol>');
  });

  test('and it is still ONE atom, so the packer is handed exactly what it was handed before', () => {
    expect(atomClasses(build().html).filter((c) => /\bexq\b/.test(c)))
      .toEqual(['blk exq sp-2', 'blk exq we sp-2']);
  });

  test('three turns is under the gate — a short script is not worth a seam', () => {
    // Three rows or fewer fit the median 347px page tail whole: no page bought, a seam spent.
    const h = body(script('ido', SHORT));
    expect(stream(IDO(h))).toEqual(
      ['card:blk exq', 'tag', 'setup', 'scr', 'tn:hd', 'tn:k-do', 'tn:k-say', 'tn:k-ask', 'res']);
    expect(atomClasses(IDO(h))).toEqual(['blk exq sp-2']);
  });
});

// ── where it may break ──────────────────────────────────────────────────────

describe('a scripted example breaks between turns and nowhere else', () => {
  const h = () => IDO(body(script('ido', TURNS)));

  test('one piece per turn, opened by the tag and closed by the result', () => {
    expect(cards(h()).map((c) => c.cls)).toEqual([
      'blk exq pc pc-a', 'blk exq pc pc-m', 'blk exq pc pc-m', 'blk exq pc pc-m',
      'blk exq pc pc-z']);
  });

  test('the shape is the whole card with ONE `.scr` opened into five', () => {
    expect(stream(h())).toEqual([
      'card:blk exq pc pc-a', 'tag', 'setup', 'scr', 'tn:hd', 'tn:k-do',
      'card:blk exq pc pc-m', 'scr', 'tn:k-say',
      'card:blk exq pc pc-m', 'scr', 'tn:k-ask',
      'card:blk exq pc pc-m', 'scr', 'tn:k-frame',
      'card:blk exq pc pc-z', 'scr', 'tn:k-say', 'res',
    ]);
  });

  test('every turn reaches the page exactly once, in the order it was authored', () => {
    const html = h();
    const at = TURNS.map((t) => {
      expect(html.split(t.text)).toHaveLength(2);      // once, never twice
      return html.indexOf(t.text);
    });
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  test('the tag and the setup ride WITH turn 1, so a page never opens on a bare line of speech', () => {
    const [first] = cards(h());
    expect(first.html).toContain('<span class="tag">');
    expect(first.html).toContain('<div class="prompt">');  // the question it works on
    expect(first.html).toContain(TURNS[0].text);
    expect(first.html).toContain(LABELS.en.classSays);     // the heads open the script
  });

  test('the piece that opens a card is GLUED, so a break may not fall under a bare tag', () => {
    const glue = build(script('ido', TURNS)).atoms.teach
      .map((a, i) => ({ ...a, i }))
      .filter((a) => a.glue)
      .map((a) => a.i);
    const cls = atomClasses(build(script('ido', TURNS)).html);
    expect(glue).toContain(cls.findIndex((c) => c.includes('pc-a')));
    for (const seam of ['pc-m', 'pc-z']) {
      expect(glue).not.toContain(cls.findIndex((c) => c.includes(seam)));
    }
  });

  test('the closing result travels in the LAST turn’s piece, never stranded from the work', () => {
    const cs = cards(h());
    const last = cs[cs.length - 1];
    expect(last.cls).toContain('pc-z');
    expect(last.html).toContain('<div class="res">');
    expect(last.html).toContain(TURNS[4].text);
    for (const c of cs.slice(0, -1)) expect(c.html).not.toContain('<div class="res">');
  });

  test('an ASK is never severed from its response — the pills are inside its own row', () => {
    const asking = cards(h()).find((c) => c.html.includes(TURNS[2].text));
    expect(asking.html).toContain('<span class="pl">2028</span>');
    // and the pills sit inside the `.tn` the question is in, not after it
    expect(asking.html).toMatch(/What is 2023 plus 5\?<\/span><div class="rp">/);
  });

  test('the WE-DO card splits the same way and keeps its own colour on every piece', () => {
    const h2 = WEDO(body(script('wedo', TURNS)));
    expect(cards(h2).map((c) => c.cls)).toEqual([
      'blk exq we pc pc-a', 'blk exq we pc pc-m', 'blk exq we pc pc-m', 'blk exq we pc pc-m',
      'blk exq we pc pc-z']);
    expect(cards(h2).pop().html).toContain(`${LABELS.en.answer}:`);
  });
});

// ── painted as one card ─────────────────────────────────────────────────────

describe('the pieces paint what one card painted', () => {
  test('each piece opens the edge it shares with the next, and zeroes the padding there', () => {
    const css = sheet();
    expect(css).toContain('.exq.pc{ border-radius:0; }');
    expect(css).toMatch(/\.exq\.pc-a\{[^}]*border-bottom:0;[^}]*padding-bottom:0/);
    expect(css).toMatch(/\.exq\.pc-m\{[^}]*border-top:0; border-bottom:0;[^}]*padding-bottom:0/);
    expect(css).toMatch(/\.exq\.pc-z\{[^}]*border-top:0;[^}]*padding-top:2px/);
    // the outer corners survive: the first piece keeps the top radius, the last the bottom
    expect(css).toMatch(/\.exq\.pc-a\{[^}]*border-radius:var\(--r-2\) var\(--r-2\) 0 0/);
    expect(css).toMatch(/\.exq\.pc-z\{[^}]*border-radius:0 0 var\(--r-2\) var\(--r-2\)/);
  });

  test('they butt at sp-0, so the seam is only the 2px gap `.scr` already draws', () => {
    // `.blk` has no margin of its own and the rhythm is margin-top only, so a piece at sp-0
    // sits flush against the one above it — 2px of amber against amber.
    const css = sheet();
    expect(css).toMatch(/\.blk\{[^}]*margin:0/);
    expect(css).toMatch(/\.scr\{[^}]*gap:2px/);
    const cs = atomClasses(IDO(body(script('ido', TURNS))));
    expect(cs.map((c) => /sp-(\d)/.exec(c)[1])).toEqual(['2', '0', '0', '0', '0']);
  });

  test('a piece is a `.blk exq` like any other, so it takes the card’s own fill and border', () => {
    expect(sheet()).toMatch(/\.exq\{[^}]*background:var\(--s-note\)/);
    expect(sheet()).toMatch(/\.exq\.we\{[^}]*background:var\(--s-do\)/);
    for (const c of cards(IDO(body(script('ido', TURNS))))) expect(c.cls).toMatch(/^blk exq\b/);
  });

  test('the tag prints ONCE across the whole card, not once per piece', () => {
    const cs = cards(IDO(body(script('ido', TURNS))));
    expect(cs.filter((c) => c.html.includes('<span class="tag">'))).toHaveLength(1);
  });
});

// ── and says so when a break lands on a seam ────────────────────────────────

describe('a break on a seam is visible', () => {
  /** Force the break the packer would choose: the first seam of the split I-DO. */
  const broken = () => {
    const cls = atomClasses(build(script('ido', TURNS)).html);
    const cut = cls.findIndex((c) => c.includes('pc-m'));
    return build(script('ido', TURNS), { breaks: { teach: [cut] } }).html;
  };

  test('the cut piece is the page’s second-to-last child, which is what the rule selects', () => {
    const p1 = page(broken(), 't1');
    const atoms = atomClasses(p1);
    expect(atoms[atoms.length - 1]).toContain('pc-a');
    expect(p1.indexOf('<div class="foot">')).toBeGreaterThan(p1.lastIndexOf('pc-a'));
    expect(sheet()).toContain('.pad > .exq.pc:not(.pc-z):nth-last-child(2){');
    // THE DASH IS THE SURFACE'S OWN INK. The first cut drew `1px dashed var(--s-note-line)`
    // (#F0DFB4) on `var(--s-note)` (#FFF8E8): the rule fired, these tests passed, and on the
    // page the card just stopped above the footer. A signal that cannot be seen is not one.
    expect(sheet()).toMatch(/nth-last-child\(2\)\{\s*border-bottom:2px dashed var\(--s-note-ink\)/);
  });

  test('the resuming piece follows the continuation strip and the repeated bar', () => {
    const p2 = page(broken(), 't2');
    expect(p2).toContain('class="contstrip"');
    const bar = p2.indexOf('class="bar ');
    const piece = p2.indexOf('class="blk exq pc pc-m');
    expect(p2.indexOf('class="contstrip"')).toBeLessThan(bar);
    expect(bar).toBeLessThan(piece);
    expect(atomClasses(p2)[0]).toContain('pc-m');
    const css = sheet();
    expect(css).toContain('.pad > .contstrip + .exq.pc:not(.pc-a),');
    expect(css).toContain('.pad > .bar + .exq.pc:not(.pc-a){');
    expect(css).toMatch(/\.pad > \.bar \+ \.exq\.pc:not\(\.pc-a\)\{\s*border-top:2px dashed var\(--s-note-ink\)/);
  });

  test('a card that genuinely ENDED still closes solid — `.pc-z` is excluded from both rules', () => {
    const css = sheet();
    for (const m of css.match(/\.pad > [^{]*\.exq[^{]*\{/g)) {
      expect(m).toMatch(/:not\(\.pc-[az]\)/);
    }
    // and the dash never reaches an unsplit card: every rule is gated on `.pc`
    expect(css).not.toMatch(/\.pad > \.exq:not/);
  });

  test('the WE-DO seam dashes in its own green, not the I-DO amber', () => {
    const css = sheet();
    expect(css).toContain('.pad > .exq.we.pc:not(.pc-z):nth-last-child(2){ border-bottom-color:var(--s-do-ink); }');
    expect(css).toMatch(/\.pad > \.bar \+ \.exq\.we\.pc:not\(\.pc-a\)\{ border-top-color:var\(--s-do-ink\)/);
  });

  test('a page break BETWEEN two cards is not a seam and draws nothing', () => {
    // The rule is `.exq.pc` — an unsplit example ending a page keeps its solid box.
    const cls = atomClasses(build().html);
    const cut = cls.findIndex((c) => c.includes('blk exq we'));
    const p1 = page(build(doc(), { breaks: { teach: [cut] } }).html, 't1');
    expect(p1).toContain('class="blk exq sp-2"');
    expect(p1).not.toContain('pc-');
  });
});
