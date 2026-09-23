/**
 * bd-hqfq4 -- THE CONTINUATION BAR NAMES A SECTION THE PAGE DOES NOT CONTAIN.
 *
 * OPERATOR, reading the grade 3 English render: *"In Engliush, it says Homework continued and
 * youve given a coaching corner instead!"* She is exactly right, and this is what page t8 of
 * `renders/g3-ch2-trio/web/English_seg2.html` emits, verbatim:
 *
 *     <div class="contstrip">Reading: Jojo ... <span>... continued</span></div>
 *     <div class="bar s-h cont" data-sec="homework">
 *       <span class="badge">H</span><span class="nm">Homework &middot; continued</span></div>
 *     <div data-atom class="coach sp-4"><div class="lbl">Coaching corner</div>...
 *
 * A teacher turning to that page is told she is still inside Homework and then handed a Coaching
 * Corner. There is no homework on the page at all.
 *
 * THE ROOT CAUSE, TRACED, NOT GUESSED (Rule 12). Three facts compose:
 *
 *   1. `flowHosts()` places the corner in a HOST section so the packer can flow it -- and the
 *      host is `secs[secs.length - 1].id`, which on a plan that ends in homework is "homework".
 *   2. `after(s)` pushes the corner with no `sec` of its own. The comment above it even claims
 *      "It registers no `sec`, so it adds no continuation bar" -- but that is a claim about the
 *      object it pushes, not about the atom that is built from it.
 *   3. `sectionAtoms` tags EVERY atom coming back from `after(s)` with the host's key:
 *      `for (const x of after(s)) out.push(atom(x.html, { sec, ... }))`.
 *
 * So the corner silently inherits `sec:"homework", first:false`, and both the bar painter
 * (`paginate`: `g[0].sec && !g[0].first`) and the packer's own height charge
 * (`render_lp.js`, `contBarSecOf(i) = i > 0 && a.sec && !a.first ? a.sec : null`) read that and
 * conclude the page opens mid-Homework. The comment is not describing the code; the fix is to
 * make it true.
 *
 * WHAT THE BAR IS FOR, which is what fixes it. It is a re-entry label: "the section you were
 * reading continues here". It is only ever honest about the atom that OPENS the page. So the
 * rule asserted below is the general one, checked at every break point, not a patch for the one
 * page the operator happened to photograph:
 *
 *     the bar names the section the page's FIRST atom belongs to,
 *     and no bar is painted when that atom belongs to no section, or opens its own.
 *
 * A corner that belongs to no section therefore gets no bar -- which is also a line of page
 * budget back on every continuation page it starts, the operator's other complaint.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

/** The corner is PRIMARY-only (`isPrimary`: grade 1-5), so the operator's shape is grade 3. */
const primaryDoc = () => {
  const d = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  d.provenance.grade = 3;
  return d;
};

const build = (opts = {}) =>
  buildHtml(primaryDoc(), { docDir: path.dirname(FIXTURE), lang: 'en', ...opts });

/** One page of the teach column, by id. */
const page = (html, id) =>
  html.split(`<div class="page" id="${id}"`)[1].split('<div class="page"')[0];

/** The section a continuation page's bar names, or null when it paints none. */
function barSec(html, id) {
  const m = /<div class="bar[^"]*\bcont\b[^"]*" data-sec="([^"]*)"/.exec(page(html, id));
  return m ? m[1] : null;
}

/** Index of the coaching-corner atom among the teach atoms, read off the emitted roots. */
function coachIndex(html) {
  const roots = [...page(html, 't1').matchAll(/<[a-z]+\b[^>]*data-atom[^>]*>/g)];
  return roots.findIndex((m) => /class="(?:[^"]*\s)?coach(?:\s|")/.test(m[0]));
}

/** Index of the first atom that continues (does not open) the corner's host section. */
const midHomeworkIndex = (atoms) =>
  atoms.findIndex((a) => a.sec === 'homework' && !a.first);

afterEach(() => setPageFormat('phone'));

describe('bd-hqfq4: the continuation bar names the page it is actually on', () => {
  test('the coaching corner belongs to no section -- it closes the lesson, it does not continue one', () => {
    const { html, atoms } = build();
    const i = coachIndex(html);
    expect(i).toBeGreaterThan(-1);
    expect(atoms.teach[i].sec).toBeNull();
  });

  test('a page that OPENS with the corner paints no bar at all', () => {
    const i = coachIndex(build().html);
    const { html } = build({ breaks: { teach: [i], support: [] } });
    expect(barSec(html, 't2')).toBeNull();
    expect(page(html, 't2')).not.toContain('Homework &middot; continued');
    // the strip still runs -- the page is still a continuation of the lesson
    expect(page(html, 't2')).toContain('class="contstrip"');
  });

  test('the corner is still ON that page -- it is the bar that goes, not the card', () => {
    const i = coachIndex(build().html);
    const { html } = build({ breaks: { teach: [i], support: [] } });
    expect(page(html, 't2')).toContain('class="coach sp-4"');
  });

  test('a page that really does open mid-Homework still says so', () => {
    // the fix must not be "paint fewer bars": the re-entry label is load-bearing where it is true
    const { atoms } = build();
    const i = midHomeworkIndex(atoms.teach);
    expect(i).toBeGreaterThan(-1);
    const { html } = build({ breaks: { teach: [i], support: [] } });
    expect(barSec(html, 't2')).toBe('homework');
    expect(page(html, 't2')).toMatch(/<span class="nm">[^<]*&middot; continued<\/span>/);
  });

  test('THE RULE, at every break point: the bar names the first atom\'s own section', () => {
    // `data-sec` carries the PARENT id for a sub-band key (`activity:you` resumes under
    // `activity`, repainting YOU DO's fill and title -- bd-f6opy), so a sub-key matches its
    // parent. What may never happen is a bar on a page whose first atom has no section, or a
    // bar naming a section that atom is not inside.
    const { atoms } = build();
    const wrong = [];
    atoms.teach.forEach((a, i) => {
      if (i === 0) return;
      const { html } = build({ breaks: { teach: [i], support: [] } });
      const expected = a.sec && !a.first ? a.sec.split(':')[0] : null;
      const got = barSec(html, 't2');
      if (got !== expected) wrong.push({ atom: i, sec: a.sec, first: a.first, got, expected });
    });
    expect(wrong).toEqual([]);
  });

  test('a4 behaves the same -- the bar is not a phone-format quirk', () => {
    const i = coachIndex(build({ format: 'a4' }).html);
    const { html } = build({ format: 'a4', breaks: { teach: [i], support: [] } });
    expect(barSec(html, 't2')).toBeNull();
  });
});
