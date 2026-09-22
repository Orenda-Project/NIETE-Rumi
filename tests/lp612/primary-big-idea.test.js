/**
 * bd-z4xkl -- THE BIG IDEA GETS ITS OWN SURFACE, OPENING EXPLANATION ON PAGE 2.
 *
 * OPERATOR, choosing between three costed options for kie.ai's `bigIdea`:
 * *"give it its own surface on page 2 under EXPLANATION"*.
 *
 * WHY IT IS NEW RATHER THAN FOLDED IN. kie.ai gives `bigIdea` (role
 * 'pedagogical-heart') ~22% of its page 1; the HTML profile had no equivalent at all.
 * Key fact carried ONE LINE of it and Watch for this slip carried the misconception,
 * so two thirds of it existed scattered and the distinction -- the thing the textbook
 * does not make explicit -- existed nowhere. That distinction is the whole answer to
 * the primary field complaint recorded in spec/07-lp-production.md section 6:
 * *"there used to be an explanation script of exactly what to say and what to explain."*
 *
 * THREE PARAGRAPHS, FIXED ROLES, NOT A LIST. The shape is load-bearing:
 *   1. the distinction the textbook does not make explicit,
 *   2. the misconception pupils arrive with and why,
 *   3. one sentence of demo move -- what the teacher DOES today.
 * A free `items` array would let an author write three restatements of the outcome,
 * which is the defect this surface exists to remove. Named fields make the omission
 * visible instead.
 *
 * WHAT THIS SUITE DEFENDS:
 *
 *   1. IT OPENS EXPLANATION. First atom of `development`, ahead of I Do -- a teacher
 *      cannot model a distinction she has not been told. Placement is the point; a
 *      Big Idea printed after the worked example is a footnote.
 *   2. ALL THREE PARAGRAPHS PRINT, each under its own label, labels from LABELS
 *      (en + ur) and never hardcoded in the renderer.
 *   3. AN AUTHOR'S OMISSION STAYS VISIBLE. The renderer never invents a proxy, and never
 *      silently drops an empty paragraph -- it prints its label, so the gap is seen.
 *      SUPERSEDED IN PART, bd-7l7ne. This clause used to read "whatever string d0 puts in
 *      a paragraph is printed verbatim -- including 'design pending'", and on grades 6-12
 *      it still does, which `primary-pending.test.js` section 1 holds byte for byte. For
 *      grades 1-5 the operator ruled otherwise on the first plan rendered end to end from
 *      its live ICT traces: *"what is pending is not relevant for Primary."* A primary
 *      sentinel is dropped before paint and the drop is reported as a build warning. Only
 *      the sentinel: an empty string is an author's omission, not a pending surface.
 *   4. IT IS ONE ATOM. Three short paragraphs are one movement; splitting the
 *      misconception onto the next page is the defect, not the saving.
 *   5. IT OBEYS THE SURFACE LADDER: a ROLE, not a bespoke colour. `teach` (blue) --
 *      it is teacher-facing explanation. No hex inside any border declaration, radius
 *      from the three tokens only.
 *   6. G6-12 IS UNTOUCHED BY CONSTRUCTION -- no enrichment record outside primary
 *      carries a `big_idea` block, so the grade 9 fixture is the control.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const T = require(path.join(VENDOR, 'lib', 'template'));
const { buildHtml, setPageFormat } = T;
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const BI = {
  type: 'big_idea',
  id: 'big-idea',
  distinction: 'A describing word tells you HOW, not WHO -- the pair is the word and the thing it changes.',
  misconception: 'Pupils mark the noun because it is the word they recognise, not the one doing the work.',
  demo: 'Circle the noun in one colour and the describing word in another, then swap them and read it aloud.',
};

/** Primary is grade 1-5 read off provenance -- the one thing isPrimary looks at. */
function doc(bi = BI) {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  const dev = d.sections.find((s) => s.id === 'development');
  dev.blocks = [bi, ...dev.blocks];
  return d;
}

const built = (d, opts = {}) =>
  buildHtml(d, { docDir: path.dirname(FIXTURE), lang: 'en', ...opts });
const build = (d, opts = {}) => built(d, opts).html;
const sheet = (html) => html.split('<style>')[1].split('</style>')[0]
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\(data:[^)]*\)/g, 'url()');
const body = (html) => html.split('</style>').pop();
/** `decorate` appends the rhythm class to the atom root, so match the NAME, not the attribute. */
const hasClass = (h, c) => new RegExp(`class="(?:[^"]*\\s)?${c}(?:\\s[^"]*)?"`).test(h);

afterEach(() => setPageFormat('phone'));

/* ------------------------------------------------------------------ 1. the G6-12 control */

describe('a G6-12 plan is untouched', () => {
  test('carries no big idea surface at all', () => {
    expect(hasClass(body(build(baseDoc())), 'bigidea')).toBe(false);
  });

  test('renders byte-identically to the document it was before', () => {
    const before = build(baseDoc());
    const after = build(baseDoc());
    expect(after).toBe(before);
  });
});

/* ------------------------------------------------------------------ 2. the surface prints */

describe('the Big Idea prints as three named paragraphs', () => {
  const h = () => body(build(doc()));

  test('the surface is there', () => {
    expect(hasClass(h(), 'bigidea')).toBe(true);
  });

  test('every one of the three paragraphs prints, whole', () => {
    for (const k of ['distinction', 'misconception', 'demo']) {
      expect(h()).toContain(BI[k]);
    }
  });

  test('each paragraph carries its own label, and the labels come from LABELS', () => {
    const L = LABELS.en;
    for (const k of ['biDistinction', 'biMisconception', 'biDemo']) {
      expect(typeof L[k]).toBe('string');
      expect(L[k].length).toBeGreaterThan(0);
      expect(h()).toContain(L[k]);
    }
    expect(h()).toContain(L.bigIdea);
  });

  test('Urdu prints Urdu labels, not English ones', () => {
    const d = doc();
    d.provenance = { ...d.provenance, medium: 'ur' };
    const h2 = body(build(d, { lang: 'ur' }));
    expect(h2).toContain(LABELS.ur.bigIdea);
    expect(h2).not.toContain(LABELS.en.bigIdea);
  });
});

/* ------------------------------------------------------------------ 3. placement */

describe('it opens EXPLANATION', () => {
  /* `atoms` reports placement metadata only (sec/first/glue/soft) and carries no markup, so
     every claim here is made against the PRINTED page -- which is the only place page order
     is a fact. Source order is not page order. */
  const h = () => body(build(doc()));
  const at = (html, needle) => html.indexOf(needle);

  test('it stands ahead of everything else in the development section', () => {
    const html = h();
    const bi = at(html, 'bigidea');
    expect(bi).toBeGreaterThan(-1);
    // The three things EXPLANATION otherwise opens with, in the base fixture.
    for (const later of ['Yes &mdash; one table', LABELS.en.keyPoints, 'exq']) {
      const j = at(html, later);
      if (j > -1) expect(bi).toBeLessThan(j);
    }
  });

  test('it is printed exactly once -- never also folded into Key fact', () => {
    expect((h().match(/class="[^"]*bigidea/g) || [])).toHaveLength(1);
  });

  test('it is ONE atom -- the three paragraphs cannot be split across a page', () => {
    const html = h();
    const from = html.indexOf('<div data-atom class="blk bigidea');
    expect(from).toBeGreaterThan(-1);
    const next = html.indexOf('<div data-atom', from + 10);
    const mine = html.slice(from, next === -1 ? undefined : next);
    for (const k of ['distinction', 'misconception', 'demo']) {
      expect(mine).toContain(BI[k]);
    }
  });
});

/* ------------------------------------------------- 4. an author's omission stays visible */

describe('the renderer never invents a proxy', () => {
  // bd-7l7ne. This asserted the opposite until the operator ruled on the first G1-5 plan
  // rendered end to end: *"what is pending is not relevant for Primary."* This fixture is
  // grade 4, so the primary rule applies -- the sentinel goes, the two authored paragraphs
  // stay, and the drop is reported. The grade 6-12 half of the old law is unchanged and is
  // held by `primary-pending.test.js` section 1, byte-identical control included.
  test('a design-pending paragraph is dropped on a primary plan, and said so', () => {
    const pending = 'design pending — not carried by primary Stage-C enrichment';
    const out = built(doc({ ...BI, demo: pending }));
    const h = body(out.html);
    expect(h).not.toContain(pending);
    expect(h).not.toContain(LABELS.en.biDemo);
    expect(h).toContain(BI.distinction);
    expect(h).toContain(BI.misconception);
    expect(out.warnings.filter((w) => /pending/i.test(w) && /demo/.test(w))).toHaveLength(1);
  });

  test('an empty paragraph still prints its label rather than vanishing', () => {
    const h = body(build(doc({ ...BI, misconception: '' })));
    expect(h).toContain(LABELS.en.biMisconception);
  });
});

/* ------------------------------------------------------------------ 5. the surface ladder */

describe('it obeys the surface ladder', () => {
  const css = () => sheet(build(doc()));
  const rules = (c) => c.split('}').filter((r) => r.includes('bigidea'));

  test('no hex colour inside a border declaration', () => {
    for (const r of rules(css())) {
      const borders = r.match(/border[a-z-]*\s*:[^;]*/g) || [];
      for (const b of borders) expect(b).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  test('every radius comes from the three tokens', () => {
    for (const r of rules(css())) {
      const radii = r.match(/border-radius\s*:\s*([^;]+)/g) || [];
      for (const d of radii) {
        const v = d.split(':')[1].trim();
        expect(
          /^(?:var\(--r-(?:1|2|pill)\)|0)(?:\s+(?:var\(--r-(?:1|2|pill)\)|0)){0,3}$/.test(v)
            || v === '50%',
        ).toBe(true);
      }
    }
  });
});

/* --------------------------------------------- 6. kie.ai's pedagogical-heart treatment */

/* bd-c74u3. Operator, on seeing the first G1-5 render beside a kie.ai plan: *"the pedagogical
   heart was rendered differently in kie.ai, can we take that formatting?"* -- "pedagogical
   heart" is kie.ai's own word for this block (`role: 'pedagogical-heart'`, its prompt builder
   at `kieai-prompt-builder.service.js:103`). Four things differ there. Two are taken here and
   two are NOT, and the split is the whole point of this section:

     TAKEN   a mark on the heading (kie.ai: a lightbulb) -- our surfaces are otherwise
             distinguished by colour alone, and this one is asking to be found on the page.
     TAKEN   the three paragraphs read as PROSE, not as three headed sub-sections. kie.ai
             prints them unlabelled; we keep the label but run it INLINE as a lead-in, which
             is the same page economy without losing the signpost. On an 80-word block three
             `display:block` labels were three of its ~7 lines: furniture outweighing content,
             on the page the operator had already called "too much text dump".
     NOT     kie.ai's subject colour (Maths #059669, English/Urdu #7c3aed). bd-z4xkl put this
             surface on the TEACH rung of the ladder deliberately, and clause 5 above holds it
             there. A per-subject hue is a decision about the whole ladder, not about one block.
     NOT     its ~22% fixed share of page 1. Our page is flow-laid, and a height floor on one
             block is how the other blocks get squeezed.

   PRIMARY ONLY. G6-12 keeps the headed sub-sections: there the block sits on a denser page
   whose reader is scanning for the sub-heading, and `primary-pending.test.js` still holds the
   labelled-blank law that those labels exist to make visible. */

describe("it takes kie.ai's pedagogical-heart treatment, on primary only", () => {
  const css = () => sheet(build(doc()));
  /* The declarations that actually reach `.bigidea .bil`, in source order -- the last one wins,
     so a primary override has to come AFTER the base rule, and reading them in order is the
     only way to assert that rather than assume it. */
  const bilRules = (c) =>
    c.split('}').map((r) => r.trim()).filter((r) => /\.bigidea\b[^{]*\.bil\b/.test(r));
  const displayOf = (rule) => (rule.match(/display\s*:\s*([a-z-]+)/) || [])[1];

  test('the paragraph label runs INLINE with its sentence on a primary plan', () => {
    const applying = bilRules(css()).filter((r) => !/\.pri\b/.test(r) || true);
    const primaryLast = applying.filter((r) => displayOf(r));
    expect(primaryLast.length).toBeGreaterThan(0);
    // The winning declaration for a `.pri` page must not put the label on its own line.
    const last = primaryLast[primaryLast.length - 1];
    expect(last).toMatch(/\.pri\b/);
    expect(['inline', 'inline-block']).toContain(displayOf(last));
  });

  test('G6-12 keeps its label on its own line -- the base rule is untouched', () => {
    const base = bilRules(css()).filter((r) => !/\.pri\b/.test(r) && displayOf(r));
    expect(base).toHaveLength(1);
    expect(displayOf(base[0])).toBe('block');
  });

  test('the heading carries a drawn mark, not a font character', () => {
    const html = body(build(doc()));
    const from = html.indexOf('<div data-atom class="blk bigidea');
    const head = html.slice(from, html.indexOf('</div>', from));
    expect(head).toMatch(/<svg[^>]*class="[^"]*bimark/);
    // The page ships its own font subset (see the .mi checkbox comment) -- a glyph would be a
    // font dependency, and 💡 is exactly the kind that renders as tofu on a teacher's phone.
    expect(head).not.toMatch(/[\u{1F000}-\u{1FAFF}☀-➿]/u);
  });

  test('the mark is absent from a G6-12 plan', () => {
    const d = baseDoc();
    d.provenance = { ...d.provenance, grade: 9 };
    const dev = d.sections.find((s) => s.id === 'development');
    dev.blocks = [BI, ...dev.blocks];
    expect(body(build(d))).not.toMatch(/class="[^"]*bimark/);
  });

  test('taking the treatment did not take the subject colour with it', () => {
    // Guards the half we deliberately left behind: kie.ai's SUBJECT_COLOR values, anywhere.
    const c = css();
    for (const hex of ['#059669', '#7c3aed', '#dc2626', '#ea580c', '#0891b2']) {
      expect(c.toLowerCase()).not.toContain(hex);
    }
  });
});
