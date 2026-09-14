/**
 * WHAT AN URDU LESSON STILL SAYS IN ENGLISH — bd-x3dn6 and bd-8g1u7.
 *
 * The Urdu toggle replaces instruction strings through `ur_overlay`, a map of JSON pointer ->
 * Urdu string. Which pointers that map is ALLOWED to carry is decided in one place —
 * `overlayTargets()` in `lint_lp.js` — and two decisions there left English on an otherwise
 * Urdu page, on the first Urdu lessons ever delivered (d04/d05/d06, 2026-09-05):
 *
 *   bd-x3dn6 — `/provenance` sat in `OVERLAY_SKIP_ROOTS` wholesale. That is right for the
 *     citation metadata in the block (a publisher's name, a curriculum's name, an edition) and
 *     wrong for `topic`, which is the lesson's TITLE: the largest type on page 1, repeated in the
 *     running header of every continued page, in the page-2 head, and in the PDF's own title.
 *     «Rational and Irrational Numbers» headed a page that was otherwise 74% Urdu.
 *
 *   bd-8g1u7 — diagram labels never became targets at all. Not because a rule excluded them, but
 *     because `isInstructionProse` wants >= 8 characters AND two runs of two-or-more Latin
 *     letters, and a label is a short single word by nature: `Nucleus` fails on length,
 *     `p_photon` fails on word count, `p_e-` fails on both. So an Urdu physics lesson kept its
 *     English figure labels — arguable for a symbol like `p_e-`, not for a bio schematic or a
 *     flow chart.
 *
 * `subject` is deliberately NOT overlaid by the model. `SUBJECT_NAMES_UR` / `subjectNameFor()` in
 * `bot/shared/config/lp612-subject-order.js` already produce the Urdu subject name the WhatsApp
 * caption prints (bd-63dea); a model translating it here would drift from that caption.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));
const { applyOverlay } = require(path.join(V, 'lib', 'overlay.js'));
const { buildHtml } = require(path.join(V, 'lib', 'template.js'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const load = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const targets = (d) => overlayDefects.targets(d);

// ── bd-x3dn6 · the lesson's own title ───────────────────────────────────────

describe('provenance is gated per field, not skipped whole', () => {
  test('the lesson TITLE and its chapter are overlayable', () => {
    const t = targets(load());
    expect(t).toContain('/provenance/topic');
    expect(t).toContain('/provenance/chapter');
    expect(t).toContain('/provenance/chapter_title');
  });

  test('citation metadata is not — a translated publisher is a wrong citation', () => {
    const d = load();
    d.provenance.publisher = 'Punjab Curriculum and Textbook Board';
    d.provenance.curriculum = 'National Curriculum of Pakistan 2006';
    d.provenance.edition = 'Second Edition, reprinted';
    d.provenance.source_quality_flags = ['figure on page 24 is printed upside down'];

    const t = targets(d);
    for (const ptr of ['/provenance/publisher', '/provenance/curriculum', '/provenance/edition',
      '/provenance/source_quality_flags/0', '/provenance/book_stem', '/provenance/medium',
      '/provenance/printed_pages', '/provenance/pdf_pages', '/provenance/version']) {
      expect(t).not.toContain(ptr);
    }
  });

  test('subject stays out — the Urdu subject name is a deterministic map, not a translation', () => {
    // bd-63dea: `subjectNameFor()` drives the WhatsApp caption. Two sources for one string is
    // how the caption and the PDF header end up disagreeing about what the subject is called.
    expect(targets(load())).not.toContain('/provenance/subject');
  });

  test('the Urdu render paints the Urdu title at every site that draws it', () => {
    const d = load();
    const UR_TOPIC = 'دو ۲×۲ میٹرکسوں کا ضرب';
    d.ur_overlay = { '/provenance/topic': UR_TOPIC };

    const { doc, errors } = applyOverlay(d, 'ur');
    expect(errors).toEqual([]);

    const { html } = buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'ur' });
    const en = load().provenance.topic;

    // `template.js` draws `provenance.topic` at four sites — the document <title> (:2474), the
    // hero (:1589), the page-2 head (:2184), and the running header of a CONTINUED teach page
    // (:1512). This fixture is two pages with no continuation, so three of the four are emitted;
    // all four read the same pointer.
    //
    // Asserting the sites rather than the whole document is deliberate: the English string ALSO
    // appears at `/sequence/this` ("Multiplying two 2×2 matrices (p.24-25)"), which is its own
    // overlay pointer and is not what this test drives.
    const sites = [
      html.match(/<title>[\s\S]*?<\/title>/)?.[0],
      html.match(/<div class="h-title">[\s\S]*?<\/div>/)?.[0],
      html.match(/<div class="t">\s*دو[\s\S]*?<\/div>/)?.[0],   // the page-2 head
    ];
    for (const site of sites) {
      expect(site).toBeTruthy();
      expect(site).toContain(UR_TOPIC);
      expect(site).not.toContain(en);
    }

    // And the English title survives at exactly one place — `/sequence/this`, its own pointer.
    expect(html.split(en).length - 1).toBe(1);
  });
});

// ── bd-8g1u7 · figure labels ────────────────────────────────────────────────

describe('diagram labels are overlayable when they are words, not symbols', () => {
  const withSpec = (spec) => {
    const d = load();
    d.sections[1].blocks.push({ type: 'diagram', spec });
    return d;
  };

  test('a word label on a schematic is a target even though it is one short word', () => {
    const t = targets(withSpec({
      type: 'bio_schematic',
      title: 'Parts of an atom',
      parts: [{ label: 'Nucleus' }, { label: 'Electron shell' }],
      labels: ['Proton'],
      caption: 'Label each part',
    }));
    expect(t.some((p) => p.endsWith('/label') && /parts\/0/.test(p))).toBe(true);
    expect(t.some((p) => p.endsWith('/parts/1/label'))).toBe(true);
    expect(t.some((p) => p.endsWith('/labels/0'))).toBe(true);
    expect(t.some((p) => p.endsWith('/title'))).toBe(true);
    expect(t.some((p) => p.endsWith('/caption'))).toBe(true);
  });

  test('a physics symbol is left alone — it is notation, not a word', () => {
    const t = targets(withSpec({
      type: 'atom',
      labels: ['p_e-', 'p_photon', 'e⁻'],
      parts: [{ label: 'p_e-' }],
    }));
    for (const p of t) expect(p).not.toMatch(/\/labels\/[012]$|\/parts\/0\/label$/);
  });

  test('the machine fields of a spec stay frozen', () => {
    const t = targets(withSpec({
      type: 'chem_equation',
      formula: 'C + O2 -> CO2',
      tex: '\\ce{C + O2 -> CO2}',
      smiles: 'O=C=O',
      label: 'Complete combustion',
    }));
    for (const p of t) expect(p).not.toMatch(/\/(formula|tex|smiles)$/);
    expect(t.some((p) => p.endsWith('/label'))).toBe(true);
  });

  test('a diagram label outside a spec subtree is unaffected by the new rule', () => {
    // The loosening is scoped to `spec`. A bare short word anywhere else is still not prose.
    const d = load();
    const at = d.sections[1].blocks.length;
    d.sections[1].blocks.push({ type: 'callout', label: 'Nucleus' });
    expect(targets(d)).not.toContain(`/sections/1/blocks/${at}/label`);
  });
});
