'use strict';
/**
 * The type-floor auditor for NIETE's teacher-facing rendered artefacts.
 *
 * PLAN_R5 D6 / operator item 11: "The pre-send teacher PDF and the completion
 * report both must be at an appropriate enough size that the teacher can read
 * them easily… this is a rule for all teacher facing artefacts in this build."
 * The floor is the one the 6-12 lesson plans already carry — body 18px at an
 * A4 794px page width, small type 14px, nothing at all under 13.5px
 * (`.claude/skills/curriculum-baked-lesson-plans/scripts/lp_html/lint_lp.js`).
 *
 * WHY A CSS PARSE AND NOT A PIXEL MEASUREMENT. A computed font-size is exact
 * where a pixel measurement of a rasterised page is an estimate, and the LP
 * gate says so itself: the image check exists to catch type baked into a
 * FIGURE, which CSS cannot see. So this is the fast, exact, in-suite gate on
 * the CSS, and `scripts/phone_gate_pdf.py` is the slow visual gate on the
 * rendered page. Neither replaces the other.
 *
 * This reads the REAL rendered document — the template function's own output,
 * with every ternary and interpolation already resolved — so it fails on the
 * branch that ships, not on a source file's text.
 */

/** Every `font-size: Npx` declaration in the document, with the selector it belongs to. */
function fontSizes(html) {
  const out = [];
  const styles = String(html || '').match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  styles.forEach((block) => {
    // Comments first: a /* … */ between two rules is otherwise swallowed into
    // the next rule's selector text and the selector stops matching by name.
    const css = block.replace(/<\/?style[^>]*>/gi, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // Rule bodies only — @font-face/@page carry no readable type, and an
    // at-rule's own prelude is not a selector.
    const ruleRe = /([^{}@][^{}]*)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(css)) !== null) {
      const selector = m[1].replace(/\s+/g, ' ').trim();
      const body = m[2];
      const fs = /font-size\s*:\s*([\d.]+)px/g;
      let f;
      while ((f = fs.exec(body)) !== null) {
        out.push({ selector, px: parseFloat(f[1]), where: 'css' });
      }
    }
  });
  // Inline styles are CSS too, and a template that sets one has escaped the
  // stylesheet the gate reads.
  const inline = /style="([^"]*)"/g;
  let i;
  while ((i = inline.exec(String(html || ''))) !== null) {
    const f = /font-size\s*:\s*([\d.]+)px/.exec(i[1]);
    if (f) out.push({ selector: '[inline style]', px: parseFloat(f[1]), where: 'inline' });
  }
  return out;
}

/** The font-size a selector declares, or null when it declares none. */
function sizeOf(html, selector) {
  const hit = fontSizes(html).filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector));
  return hit.length ? Math.min(...hit.map((r) => r.px)) : null;
}

/** Everything under `floor`, as `selector@px` strings — the failure message writes itself. */
function under(html, floor) {
  return fontSizes(html).filter((r) => r.px < floor)
    .map((r) => `${r.selector}@${r.px}px`);
}

module.exports = { fontSizes, sizeOf, under };
