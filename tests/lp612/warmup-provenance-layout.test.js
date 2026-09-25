/**
 * A LONG SPACED-REVIEW LABEL MUST NOT SQUEEZE THE WARM-UP QUESTION — bd-oak77.31.
 *
 * A warm-up row is `n. question → answer` with a provenance label, `.wu .kind`, floated to the
 * row's end corner ("spaced review · p.22, adding matrices"). The float has no width cap, so it
 * is as wide as its text. A long SPACED REVIEW source ("§3.2 Cell structure and function,
 * Grade 6 General Science textbook, p.41") takes most of the 478px row, and the question
 * wraps two or three words a line in the gap beside it.
 *
 * Acceptance: a long label goes on its own line, so the question keeps the full row width. A
 * short label ("prerequisite", "scaffold for today") stays in the corner and renders as before.
 *
 * The root suite has no real browser (playwright-core is mocked), so this test runs buildHtml,
 * reads the emitted stylesheet and markup, and works out which rules apply to each label: a
 * small cascade over the `.wu .kind…` rules that apply to the element's classes.
 *
 * Red-first: on this branch's base the long label is still floated and has no width cap.
 */
const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(V, 'lib', 'template.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const LONG_FROM = '§3.2 Cell structure and function, Grade 6 General Science textbook, p.41';

function build(mutate) {
  const d = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  mutate(d.sections.find((s) => s.id === 'introduction').warmup.items);
  return buildHtml(d, { lang: 'en', docDir: path.dirname(BASE) }).html;
}

/** Every `selector{decls}` rule in the emitted <style>s, in source order. */
function rules(html) {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    for (const sel of m[1].split(',')) out.push({ sel: sel.trim().replace(/\s+/g, ' '), decls });
  }
  return out;
}

/** The warm-up label spans: their class list and their text. */
function labels(html) {
  const wu = html.slice(html.search(/class="blk wu[ "]/));
  return [...wu.matchAll(/<span class="(kind(?: [\w-]+)*)">([\s\S]*?)<\/span><\/div>/g)]
    .slice(0, 3)
    .map((m) => ({ classes: m[1].split(' '), text: m[2].replace(/<[^>]+>/g, '') }));
}

/** The declared value of `prop` on a `.wu .kind` element with these classes. Rules with more
 *  classes win, and among equals the later rule wins. */
function resolve(all, classes, prop) {
  let best = null;
  all.forEach((r, i) => {
    const m = /^\.wu (?:\.it )?\.kind((?:\.[\w-]+)*)$/.exec(r.sel);
    if (!m || !(prop in r.decls)) return;
    const mods = m[1].split('.').filter(Boolean);
    if (!mods.every((c) => classes.includes(c))) return;
    const spec = mods.length;
    if (!best || spec > best.spec || (spec === best.spec && i > best.i)) best = { spec, i, v: r.decls[prop] };
  });
  return best ? best.v : undefined;
}

const takesOwnLine = (all, classes) =>
  resolve(all, classes, 'float') === 'none' && resolve(all, classes, 'display') === 'block';

describe('bd-oak77.31 — a long provenance label does not starve the warm-up question', () => {
  const html = build((items) => { items.find((it) => it.kind === 'spaced').from = LONG_FROM; });
  const all = rules(html);
  const rows = labels(html);
  const long = rows.find((r) => r.text.includes('General Science textbook'));
  const short = rows.filter((r) => r !== long);

  it('renders the whole long label, untruncated', () => {
    expect(long).toBeDefined();
    expect(long.text).toContain('p.41');
  });

  it('puts the long label on its own line, not in the corner beside the question', () => {
    expect(takesOwnLine(all, long.classes)).toBe(true);
  });

  it('caps any label left in the corner so it can never take most of the row', () => {
    const cap = resolve(all, ['kind'], 'max-width');
    expect(cap).toMatch(/^\d+(\.\d+)?%$/);
    expect(parseFloat(cap)).toBeLessThanOrEqual(50);
  });

  it('leaves short labels floated in the corner, exactly as before', () => {
    expect(short).toHaveLength(2);
    for (const r of short) {
      expect(r.classes).toEqual(['kind']);
      expect(resolve(all, r.classes, 'float')).toBe('right');
    }
  });

  it('gives the question no width limit of its own', () => {
    const q = all.filter((r) => /^\.wu (?:\.it )?\.q$/.test(r.sel));
    expect(q.length).toBeGreaterThan(0);
    for (const r of q) {
      expect(r.decls['max-width']).toBeUndefined();
      expect(r.decls.width).toBeUndefined();
    }
  });
});
