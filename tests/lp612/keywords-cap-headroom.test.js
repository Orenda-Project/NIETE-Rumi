/**
 * bd-c091j — `keywords.items.maxItems` HAD ZERO HEADROOM.
 *
 * `schema_caps.py --build` (10_Grades 1-5 LP Rebuild/ch9-10-build, 2026-09-24) over the
 * 335-lesson ch9-10 corpus, freshly built by the CURRENT document layer:
 *
 *   1.00 maxItems  8   8  335  #/definitions/block/oneOf/4/properties/items  g1_ch8/English_seg5.lp.json  <== within 20%
 *
 * `util == 1.00` is not "close to the cap" — the observed maximum IS the cap. One more
 * keyword anywhere in the corpus stops all 335 lessons validating (`SCHEMA INVALID —
 * refusing to render`, the same failure class `key_points.items` hit at bd-bdctp).
 *
 * The fix mirrors the `key_points` precedent exactly (schema/lp_doc.schema.json, the
 * `key_points.items` description): observed max * 1.55 headroom, rounded up. 8 * 1.55 = 12.4
 * -> 13. The renderer already carries any length with no slice: `R.keywords`
 * (lib/template.js:2229-2232) and `kwTable` (lib/template.js:2940-2941) both `.map()` every
 * item with no truncation, so the cap is only a guard against a runaway list, exactly as
 * `key_points.items`'s cap is.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { validateDoc } = require(path.join(VENDOR, 'lib', 'validate'));
const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const kwItems = (n) =>
  Array.from({ length: n }, (_, i) => ({ word: `word${i}`, meaning: `meaning ${i}` }));

function withKeywords(n) {
  const d = baseDoc();
  d.sections
    .find((s) => s.id === 'development')
    .blocks.push({ type: 'keywords', id: 'kw-cap-test', page: '12', items: kwItems(n) });
  return d;
}
const ok = (doc) => validateDoc(doc);

describe('bd-c091j — keywords.items carries the same measured headroom as key_points', () => {
  test('8 items (todays observed max) still validates', () => {
    expect(ok(withKeywords(8)).errors).toEqual([]);
  });

  test('9 items validates — the first list the OLD cap would have refused', () => {
    // NOT a live incident: nothing in the corpus ever exceeded 8. The observed max IS 8 and
    // the old cap WAS 8, which is the defect (util 1.00, zero headroom) — the next keyword
    // anyone adds is the one that breaks it. 9 is that next keyword. New cap: ceil(8 * 1.55) = 13.
    expect(ok(withKeywords(9)).errors).toEqual([]);
  });

  test('13 items (the new cap) validates', () => {
    expect(ok(withKeywords(13)).errors).toEqual([]);
  });

  test('14 items — one past the new cap — is still refused, it is a guard not a removal', () => {
    expect(ok(withKeywords(14)).ok).toBe(false);
  });
});
