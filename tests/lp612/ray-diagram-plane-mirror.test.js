/**
 * A PLANE MIRROR IS NOT A CURVED ONE — the manifest, not the renderer, was the defect.
 *
 * Observed on the annotated review of `B_proposed_phone.pdf` (Grade 10 Physics, Ch. 14 Optics,
 * "Reflection of Light: Laws and Mirror Image Formation", pp. 121-125). BOTH ray diagrams in a
 * lesson about PLANE mirrors were drawn as CURVED mirrors carrying a printed focal length --
 * `f = 30 cm` on the development page, `f = 25 cm` on reference A. A plane mirror has no focal
 * length. The picture contradicted the lesson it illustrated, on every copy that shipped.
 *
 * `ray_diagram.js` is NOT at fault. It has supported `plane_mirror` since it was written:
 * the element is in `ELEMENTS`, `solve()` returns `{v:-u, m:1, real:false}` for it, and the
 * `f = …` dimension line is explicitly suppressed by `if (!isPlane)`. Handed the right spec it
 * draws the right picture.
 *
 * The author was never able to ask for it. `types_manifest.json` is the only machine-readable
 * contract the author has for a diagram type, and for `ray_diagram` it said:
 *
 *     "required": ["element", "f", "u", "hObject"]
 *     "limits":   ["element is convex_lens | concave_lens | concave_mirror | convex_mirror.", …]
 *
 * `plane_mirror` is absent from the documented element list, and `f` -- a quantity a plane
 * mirror does not have -- is mandatory. For a plane-mirror lesson the contract admits no valid
 * spec. The author did the only thing left open to it: picked a curved mirror and invented a
 * focal length. SPEC_CONTRACT then passed the result, because every required field was present.
 *
 * This is the silent-fallback class the SPEC_CONTRACT block already names (atom -> hydrogen,
 * cell -> plant cell, grid -> empty), with one extra turn of the screw: here the contract did
 * not merely permit the wrong picture, it REQUIRED one.
 *
 * Four rules, red-first on this branch's base:
 *   1. a correct plane-mirror spec must LINT CLEAN            (today: SPEC_CONTRACT, missing `f`)
 *   2. a plane mirror carrying `f` must FAIL                  (today: silent, `f` is ignored)
 *   3. an element the engine cannot draw must FAIL            (today: silent fallback to a LENS)
 *   4. a curved element in a plane-mirror lesson must FAIL    (today: nothing — the shipped bug)
 * plus a drift guard that keeps the manifest and `ELEMENTS` in step.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));
const MANIFEST = require(path.join(V, 'diagrams', 'types_manifest.json'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

/** The five elements `ray_diagram.js` actually draws, read from the engine itself. */
const ENGINE_ELEMENTS = ['convex_lens', 'concave_lens', 'concave_mirror', 'convex_mirror', 'plane_mirror'];

/**
 * Put `spec` on reference A of the base fixture, and optionally retitle the lesson so the
 * diagram has a subject to agree or disagree with.
 */
function docWith(spec, lessonText) {
  const d = JSON.parse(raw);
  for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
  d.page2.board_final.diagram = spec;
  if (lessonText) {
    d.slo.text_verbatim = lessonText;
    d.sequence.this = lessonText;
    d.objectives.outcome = lessonText;
  }
  return d;
}

const fails = (doc) => (lint(doc).fails || []).map(String);
const codes = (doc) => fails(doc).map((e) => e.split(/[\s:]/)[0]);

const PLANE_LESSON = 'Draw the image of a point object in a plane mirror and state that image distance equals object distance.';
const CURVED_LESSON = 'Find the image formed by a concave mirror using the mirror formula.';

/** The lesson as it should have been authored: a plane mirror, no focal length. */
const PLANE_OK = {
  type: 'ray_diagram',
  element: 'plane_mirror',
  u: 30,
  hObject: 12,
  title: 'IMAGE IN A PLANE MIRROR',
  caption: 'The image is virtual, erect, the same size, and as far behind the mirror as the object is in front.',
};

/** The spec that shipped: a curved mirror with an invented focal length, in a plane-mirror lesson. */
const SHIPPED = {
  type: 'ray_diagram',
  element: 'concave_mirror',
  f: 30,
  u: 45,
  hObject: 12,
  title: 'REFLECTION FROM A MIRROR',
  caption: 'The reflected ray leaves at the same angle as the incident ray.',
};

describe('ray_diagram — a plane mirror is askable, and a curved one is not silently substituted', () => {
  it('1. a correct plane-mirror spec lints clean — `f` is not required for it', () => {
    const c = codes(docWith(PLANE_OK, PLANE_LESSON));
    expect(c).not.toContain('SPEC_CONTRACT');
    expect(c).not.toContain('RAY_ELEMENT_UNKNOWN');
    expect(c).not.toContain('RAY_ELEMENT_MISMATCH');
    expect(c).not.toContain('RAY_PLANE_FOCAL');
  });

  it('2. a plane mirror carrying a focal length fails — it does not have one', () => {
    const doc = docWith({ ...PLANE_OK, f: 25 }, PLANE_LESSON);
    expect(codes(doc)).toContain('RAY_PLANE_FOCAL');
    expect(fails(doc).find((m) => m.includes('RAY_PLANE_FOCAL'))).toMatch(/focal length/i);
  });

  it('3. an element the engine cannot draw fails instead of falling back to a lens', () => {
    // `ELEMENTS.has("plane mirror")` is false -> render() substitutes "convex_lens" and,
    // with `f` defaulting to 20, prints a confident `f = 20 cm` under a plane-mirror caption.
    const doc = docWith({ ...PLANE_OK, element: 'plane mirror' }, PLANE_LESSON);
    expect(codes(doc)).toContain('RAY_ELEMENT_UNKNOWN');
    expect(fails(doc).find((m) => m.includes('RAY_ELEMENT_UNKNOWN'))).toMatch(/convex_lens/);
  });

  it('4. the spec that shipped fails — a curved mirror in a plane-mirror lesson', () => {
    const doc = docWith(SHIPPED, PLANE_LESSON);
    expect(codes(doc)).toContain('RAY_ELEMENT_MISMATCH');
    const msg = fails(doc).find((m) => m.includes('RAY_ELEMENT_MISMATCH'));
    expect(msg).toMatch(/plane mirror/i);
    expect(msg).toMatch(/concave_mirror/);
  });

  it('4b. and the mismatch runs the other way — a plane mirror in a curved-mirror lesson', () => {
    expect(codes(docWith(PLANE_OK, CURVED_LESSON))).toContain('RAY_ELEMENT_MISMATCH');
  });

  it('4c. a curved mirror in a curved-mirror lesson is left alone', () => {
    expect(codes(docWith(SHIPPED, CURVED_LESSON))).not.toContain('RAY_ELEMENT_MISMATCH');
  });

  it('does not fire on a lens lesson that never mentions a mirror', () => {
    const lens = { type: 'ray_diagram', element: 'convex_lens', f: 20, u: 60, hObject: 14 };
    const c = codes(docWith(lens, 'Locate the image formed by a convex lens for an object beyond 2F.'));
    expect(c).not.toContain('RAY_ELEMENT_MISMATCH');
    expect(c).not.toContain('RAY_ELEMENT_UNKNOWN');
    expect(c).not.toContain('RAY_PLANE_FOCAL');
  });
});

describe('types_manifest.json — the contract the author reads must match the engine', () => {
  const entry = (MANIFEST.types || []).find((t) => t.type === 'ray_diagram');

  it('has a ray_diagram entry', () => {
    expect(entry).toBeTruthy();
  });

  it('documents every element the engine draws, and no others', () => {
    const line = (entry.limits || []).find((l) => /^element is/.test(l));
    expect(line).toBeTruthy();
    for (const el of ENGINE_ELEMENTS) expect(line).toContain(el);
  });

  it('does not make `f` unconditionally required — a plane mirror has none', () => {
    expect(entry.required || []).not.toContain('f');
  });

  it('still names `f` as expected for the curved elements', () => {
    const text = JSON.stringify(entry);
    expect(text).toMatch(/\bf\b/);
  });
});
