/**
 * bd-oyqb2 — RENDER: the 9 slots print ONE ROW PER ARRAY ELEMENT, exactly like
 * `key_points.items` (`R.key_points`, `.kp` <ul>, one `<li>` per item, lib/template.js:2240-2248).
 * The schema-only proof lives in oyqb2-array-fields-schema.test.js; this suite is the markup
 * proof — the ninth slot in that suite, `slo.text_verbatim`, is excluded here on purpose because
 * outcome-one-voice-render.test.js already proves it is never painted at all.
 *
 * MEASURED TODAY (before this fix): `rich(s)` is `String(s ?? "")` (lib/rich.js:123-124). An
 * array fed into any of these 9 slots therefore renders as `Array.prototype.toString()` —
 * elements joined by a bare comma, no tags, no separator space, no new row. That is the failure
 * this suite's array assertions catch, and it is what the RED in the done-report is.
 *
 * Category A — richRows (`<ul class="kp"><li>…</li></ul>`, byte-for-byte the same markup
 * `R.key_points` already emits): used where the field's existing wrapper is a <div> it owns
 * alone (ask.question's `.q`, worked_example.prompt's `.prompt`, worked_example.cfu's `.cfu`
 * alongside its `.cl` label span — a <ul> sibling after a <span> inside a <div> is valid HTML),
 * or a <p> it owns alone, which is replaced WHOLE (objectives.outcome, differentiation.stuck/
 * .early) because a <p> cannot legally contain a <ul>. faded_example.prompt already has its own
 * array-shaped mechanism (`.setup`, split on " · ") — extending it to accept a real array
 * needs no new helper.
 *
 * Category B — richLines (`<br>`-joined, stays fully inline, no new element): used where the
 * field's wrapper (`<p class="ask">`, a bare `<span>`) also carries OTHER sibling markup (a
 * label span, a nested answer span) that must survive untouched — nesting a <ul> there would
 * invalidly close the wrapper early and reflow the DOM. (page2.coaching_reflection,
 * exit_ticket[].q)
 *
 * Every assertion below matches on one long literal (or a tightly-scoped regex for the one
 * unknown localized label string per site), never on a bounded "first occurrence" region — two
 * of these fields (page2.differentiation, page2.coaching_reflection) have TWO call sites in
 * template.js (an inline one-screen summary and the page2 detail section) that are mutually
 * exclusive per document via `flowHost`/`hosts`, so a fixed match-count or a first-index search
 * would be fragile. The exact adjacent markup is not.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const html = (doc) => buildHtml(doc, { docDir: path.dirname(FIXTURE) }).html;
/** CSS ships verbatim inside <style>; the body starts right after it (same helper as
 * outcome-one-voice-render.test.js, bd-a8veu.14). */
const body = (out) => out.slice(out.lastIndexOf('</style>') + 8);

const sec = (d, id) => d.sections.find((s) => s.id === id);
const blk = (d, id, type) => sec(d, id).blocks.find((b) => b.type === type);

/** The sloBox alone (bd-a8veu.14's own extraction, reused verbatim). */
const outcomeBox = (out) => {
  const i = out.indexOf('class="slo');
  return out.slice(i, out.indexOf('</div>\n<div data-atom', i));
};

describe('bd-oyqb2 — render: array in, one row per element out; string in, byte-identical', () => {
  test('ask.question: array renders one <li> per element inside the existing .q div', () => {
    const d = baseDoc();
    blk(d, 'introduction', 'ask').question = ['First half of the question.', 'Second half of the question.'];
    expect(body(html(d))).toContain(
      '<div class="q"><ul class="kp"><li>First half of the question.</li><li>Second half of the question.</li></ul></div>'
    );
  });
  test('ask.question: string form is unchanged — no list wrapper', () => {
    const d = baseDoc();
    blk(d, 'introduction', 'ask').question = 'PLAIN Q MARKER.';
    expect(body(html(d))).toContain('<div class="q">PLAIN Q MARKER.</div>');
  });

  test('worked_example.prompt: array renders one <li> per element inside the existing .prompt div', () => {
    const d = baseDoc();
    blk(d, 'development', 'worked_example').prompt = ['Multiply A by B.', 'Show every entry of the product.'];
    expect(body(html(d))).toContain(
      '<div class="prompt"><ul class="kp"><li>Multiply A by B.</li><li>Show every entry of the product.</li></ul></div>'
    );
  });
  test('worked_example.prompt: string form is unchanged — no list wrapper', () => {
    const d = baseDoc();
    blk(d, 'development', 'worked_example').prompt = 'PLAIN PROMPT MARKER.';
    expect(body(html(d))).toContain('<div class="prompt">PLAIN PROMPT MARKER.</div>');
  });

  test('worked_example.cfu: array renders one <li> per element, the .cl label span untouched', () => {
    const d = baseDoc();
    blk(d, 'development', 'worked_example').cfu = ['Which entry needs row 2 of A?', 'Which entry needs column 1 of B?'];
    expect(body(html(d))).toMatch(
      /<div class="cfu"><span class="cl">[^<]*<\/span><ul class="kp"><li>Which entry needs row 2 of A\?<\/li><li>Which entry needs column 1 of B\?<\/li><\/ul><\/div>/
    );
  });
  test('worked_example.cfu: string form is unchanged — no list wrapper', () => {
    const d = baseDoc();
    blk(d, 'development', 'worked_example').cfu = 'PLAIN CFU MARKER.';
    expect(body(html(d))).toMatch(/<div class="cfu"><span class="cl">[^<]*<\/span>PLAIN CFU MARKER\.<\/div>/);
  });

  test('faded_example.prompt: array renders one <li> per element in the SAME .setup <ul> the split-string form already uses', () => {
    const d = baseDoc();
    blk(d, 'activity', 'faded_example').prompt = ['Multiply C by D.', 'Fill in the missing entries.'];
    expect(body(html(d))).toContain('<ul class="setup"><li>Multiply C by D.</li><li>Fill in the missing entries.</li></ul>');
  });
  test('faded_example.prompt: string with the middle-dot separator still splits exactly as today', () => {
    const d = baseDoc();
    blk(d, 'activity', 'faded_example').prompt = 'PLAIN A · PLAIN B';
    expect(body(html(d))).toContain('<ul class="setup"><li>PLAIN A</li><li>PLAIN B</li></ul>');
  });

  test('objectives.outcome: array replaces the <p> WHOLE with <ul class="kp">, box stays exactly 2 divs', () => {
    const d = baseDoc();
    d.objectives.outcome = ['You can multiply two 2x2 matrices.', 'You can say when the product is defined.'];
    const box = outcomeBox(body(html(d)));
    expect(box).not.toMatch(/<p>/);
    expect(box).toMatch(
      /<ul class="kp"><li>You can multiply two 2x2 matrices\.<\/li><li>You can say when the product is defined\.<\/li><\/ul>/
    );
    expect(box.match(/<div class="/g)).toHaveLength(2); // .lbl and .bythe only — unchanged from bd-a8veu.14
  });
  test('objectives.outcome: string form is still exactly a <p>, unchanged', () => {
    const d = baseDoc();
    d.objectives.outcome = 'PLAIN OUTCOME MARKER, well past ten characters.';
    const box = outcomeBox(body(html(d)));
    expect(box).toMatch(/<p>PLAIN OUTCOME MARKER, well past ten characters\.<\/p>/);
  });

  test('page2.differentiation.stuck and .early: array renders one <li> per element; .barrier is untouched by this diff (schema keeps it string-only)', () => {
    const d = baseDoc();
    d.page2.differentiation.stuck = ['Give a printed grid.', 'Walk the row-by-column sweep once with them.'];
    d.page2.differentiation.early = ['Ask for A(BC).', 'Ask for (AB)C.', 'Ask what they notice.'];
    const out = body(html(d));
    expect(out).toContain('<ul class="kp"><li>Give a printed grid.</li><li>Walk the row-by-column sweep once with them.</li></ul>');
    expect(out).toContain('<ul class="kp"><li>Ask for A(BC).</li><li>Ask for (AB)C.</li><li>Ask what they notice.</li></ul>');
  });
  test('page2.differentiation.stuck: string form is still exactly a <p>, unchanged', () => {
    const d = baseDoc();
    d.page2.differentiation.stuck = 'PLAIN STUCK MARKER.';
    expect(body(html(d))).toContain('<p>PLAIN STUCK MARKER.</p>');
  });

  test('page2.coaching_reflection: array is <br>-joined, stays inside the existing <p class="ask">', () => {
    const d = baseDoc();
    d.page2.coaching_reflection = ['Which pupils could say the address out loud?', 'Who do I re-teach tomorrow?'];
    expect(body(html(d))).toMatch(
      /<p class="ask"><span class="lbl">[^<]*<\/span>Which pupils could say the address out loud\?<br>Who do I re-teach tomorrow\?<\/p>/
    );
  });
  test('page2.coaching_reflection: string form is unchanged — no <br>', () => {
    const d = baseDoc();
    d.page2.coaching_reflection = 'PLAIN COACH MARKER.';
    expect(body(html(d))).toMatch(/<p class="ask"><span class="lbl">[^<]*<\/span>PLAIN COACH MARKER\.<\/p>/);
  });

  test('exit_ticket[].q: array is <br>-joined, stays inline beside the existing <span class="a">', () => {
    const d = baseDoc();
    sec(d, 'conclusion').exit_ticket[0].q = ['Multiply A and B.', 'State the order of the product.'];
    expect(body(html(d))).toContain('Multiply A and B.<br>State the order of the product. <span class="a">');
  });
  test('exit_ticket[].q: string form is unchanged — no <br>', () => {
    const d = baseDoc();
    sec(d, 'conclusion').exit_ticket[0].q = 'PLAIN TICKET MARKER.';
    expect(body(html(d))).toContain('PLAIN TICKET MARKER. <span class="a">');
  });
});
