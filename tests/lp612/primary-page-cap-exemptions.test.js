/**
 * bd-blxml — A NAMED, HEIGHT-BOUND EXEMPTION IS THE ONLY WAY PAST 8 PAGES.
 *
 * Operator, 2026-09-24, choosing between raising the cap for the 40 over-8 lessons only /
 * re-segmenting them / holding 8 as a target: **"a"**. Consistent with 2026-09-23: *"dont cut
 * anything, increase the page cap for those 14"*. So: the cap is 8 (primary-page-cap-8.test.js),
 * and named lessons carry their own allowed height.
 *
 * AN EXEMPTION RECORDS A HEIGHT, NOT JUST A NAME. A list of bare names is a blanket amnesty: the
 * lesson that was 9 pages the day it was listed renders at 14 six weeks later and nothing says
 * so. Each entry therefore carries the teach height that was MEASURED for that lesson, and the
 * gate is `n > thatHeight`, not `n > 8 unless listed`.
 *
 * THE LIST IS DATA, NOT A LITERAL IN THE RENDERER, and today's 40 are seeded as PROVISIONAL.
 * Three landed/landing changes move page counts under it — sentence-splitting (~+0.25 pages per
 * lesson), the packer fix (767 -> 757 pages across 112 lessons) and the duplicate board figure
 * (~61 pages). Freezing today's 40 into code would exempt the wrong lessons and let a regressed
 * one through. The file is regenerated from a measured render; see
 * `10_Grades 1-5 LP Rebuild/ch9-10-build/regen_cap_exemptions.py`.
 *
 * THE KEY IS THE RENDER STEM, NOT `lesson_id`. Measured over the 335 built renders: `lesson_id`
 * is not unique — `g5_ch9_Science_seg1` and `g5_ch9_Science_seg10` both carry
 * `GRADE_5_GENERAL_SCIENCE_CH9_SEG1`, and 107 of 335 stems do not map to their id by any rule
 * (`Maths` -> `MATH`, `Science` -> `GENERAL_SCIENCE`, `seg9` -> `SEG990`). One id-keyed entry
 * would have exempted two different lessons.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const R = require('../../bot/vendor/lp-v9/render_lp.js');
const EX = require('../../bot/vendor/lp-v9/lib/page_cap_exemptions.js');

const primary = { provenance: { grade: 4 } };
const secondary = { provenance: { grade: 9 } };

const tmpFile = (obj) => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lpcap-')), 'ex.json');
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
};
const wellFormed = (entries) => ({
  provisional: true,
  measured: { source: 'test', at: '2026-09-24', corpus_size: 1, format: 'phone' },
  base_cap: { teach: 8 },
  entries,
});

describe('the shipped list is a data file, seeded provisionally from the measured corpus', () => {
  const list = EX.loadExemptions();

  test('it lives beside the renderer as JSON, not inside it', () => {
    expect(EX.EXEMPTIONS_PATH).toMatch(/page_cap_exemptions\.json$/);
    expect(fs.existsSync(EX.EXEMPTIONS_PATH)).toBe(true);
    const src = fs.readFileSync(path.join(__dirname, '../../bot/vendor/lp-v9/render_lp.js'), 'utf8');
    expect(src).not.toMatch(/g5_ch8_Urdu_seg9/);
  });

  test('it is marked PROVISIONAL — today\'s 40 are not tomorrow\'s 40', () => {
    expect(list.provisional).toBe(true);
  });

  test('it states the render it was measured from, so it can be re-measured', () => {
    expect(list.measured.source).toContain('render.json');
    expect(list.measured.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(list.measured.format).toBe('phone');
    expect(list.measured.corpus_size).toBe(335);
  });

  test('its base cap is the renderer\'s primary cap, so the two cannot drift', () => {
    expect(list.baseCap.teach).toBe(R.MAX_PAGES_PRIMARY.teach);
  });

  test('it holds exactly the 40 lessons measured over 8 pages', () => {
    expect(Object.keys(list.entries)).toHaveLength(40);
  });

  test('every recorded height is above the cap — a listed lesson that fits needs no licence', () => {
    for (const [stem, e] of Object.entries(list.entries)) {
      expect(Number.isInteger(e.teach)).toBe(true);
      expect(e.teach).toBeGreaterThan(list.baseCap.teach);
      expect(stem).toMatch(/^g[1-5]_ch\d+_[A-Za-z]+_seg\d+$/);
    }
  });

  test('the four tallest are the ones the census named, at the heights it measured', () => {
    expect(list.entries.g5_ch8_Urdu_seg9.teach).toBe(21);
    expect(list.entries.g5_ch9_Urdu_seg11.teach).toBe(18);
    expect(list.entries.g3_ch8_Maths_seg2.teach).toBe(15);
    expect(list.entries.g1_ch8_Urdu_seg6.teach).toBe(15);
  });

  test('Urdu is 23 of the 40 — the premium is absorbed here, not by a higher Urdu cap', () => {
    const urdu = Object.keys(list.entries).filter((s) => s.includes('_Urdu_'));
    expect(urdu).toHaveLength(23);
    expect(R.pageCapsFor('ur', primary).max.teach).toBe(R.pageCapsFor('en', primary).max.teach);
  });
});

describe('pageCapsFor raises the cap for a named lesson, to that lesson\'s own height', () => {
  test('an unnamed stem gets the bare cap of 8', () => {
    expect(R.pageCapsFor('en', primary, 'phone', 'g1_ch9_English_seg1').max.teach).toBe(8);
    expect(R.pageCapsFor('ur', primary, 'phone', 'g2_ch8_Urdu_seg1').max.teach).toBe(8);
  });

  test('no stem at all gets the bare cap of 8', () => {
    expect(R.pageCapsFor('en', primary, 'phone').max.teach).toBe(8);
    expect(R.pageCapsFor('en', primary, 'phone', undefined).max.teach).toBe(8);
  });

  test('a named stem gets its OWN recorded height, not a blanket raise', () => {
    expect(R.pageCapsFor('ur', primary, 'phone', 'g5_ch8_Urdu_seg9').max.teach).toBe(21);
    expect(R.pageCapsFor('en', primary, 'phone', 'g3_ch8_Maths_seg2').max.teach).toBe(15);
    expect(R.pageCapsFor('ur', primary, 'phone', 'g4_ch10_Urdu_seg3').max.teach).toBe(11);
  });

  test('the exemption moves teach ONLY — support keeps the unexempted cap', () => {
    expect(R.pageCapsFor('ur', primary, 'phone', 'g5_ch8_Urdu_seg9').max.support).toBe(4);
    expect(R.pageCapsFor('en', primary, 'phone', 'g3_ch8_Maths_seg2').max.support).toBe(3);
  });

  test('an exempt lesson at its recorded height PASSES, one page taller FAILS', () => {
    const cap = R.pageCapsFor('ur', primary, 'phone', 'g5_ch8_Urdu_seg9').max.teach;
    expect(21 > cap).toBe(false);
    expect(22 > cap).toBe(true);
  });

  test('a non-exempt lesson at the same height FAILS', () => {
    // The whole point: 21 pages is licensed for ONE named lesson, not for 21 pages.
    expect(21 > R.pageCapsFor('ur', primary, 'phone', 'g2_ch8_Urdu_seg1').max.teach).toBe(true);
  });

  test('the exemption converts to A4 on the same geometry every other cap does', () => {
    const { PAGE_FORMATS } = require('../../bot/vendor/lp-v9/lib/template.js');
    const box = (f) => PAGE_FORMATS[f].h - PAGE_FORMATS[f].padT - PAGE_FORMATS[f].padB;
    const ratio = box('phone') / box('a4');
    expect(R.pageCapsFor('ur', primary, 'a4', 'g5_ch8_Urdu_seg9').max.teach)
      .toBe(Math.round(21 * ratio));
  });

  test('a G6-12 doc is not exempted even if a stem collides with the list', () => {
    expect(R.pageCapsFor('ur', secondary, 'phone', 'g5_ch8_Urdu_seg9').max).toEqual({ teach: 5, support: 4 });
  });
});

describe('the over-cap message names the lesson, and says when an exemption was outgrown', () => {
  test('a non-exempt lesson is named with its page count', () => {
    expect(R.overCapProblem('teach', 11, 8, null, { stem: 'g1_ch9_Urdu_seg3' })).toBe(
      'PAGE COUNT: g1_ch9_Urdu_seg3: teach needs 11 pages; the cap is 8. '
      + 'Cut it, or move content to the other part.',
    );
  });

  test('an exempt lesson that grew past its height says so, in those words', () => {
    const msg = R.overCapProblem('teach', 22, 21, null, { stem: 'g5_ch8_Urdu_seg9', exempt: 21 });
    expect(msg).toContain('g5_ch8_Urdu_seg9: teach needs 22 pages; the cap is 21.');
    expect(msg).toContain('page_cap_exemptions.json');
    expect(msg).toContain('licences a KNOWN height, not any height');
  });

  test('with no stem the message is byte-identical to the one G6-12 has always had', () => {
    expect(R.overCapProblem('teach', 5, 4, null)).toBe(
      'PAGE COUNT: teach needs 5 pages; the cap is 4. Cut it, or move content to the other part.',
    );
  });
});

describe('a malformed list FAILS LOUDLY — it is never silently treated as empty', () => {
  const load = (obj) => () => EX.loadExemptions(tmpFile(obj));

  test('an entry at or below the base cap is refused as dead weight', () => {
    expect(load(wellFormed({ g1_ch9_Urdu_seg3: { teach: 8 } }))).toThrow(/above the base cap/);
  });

  test('a non-integer height is refused', () => {
    expect(load(wellFormed({ g1_ch9_Urdu_seg3: { teach: 9.5 } }))).toThrow(/integer/);
  });

  test('a bare name with no height is refused — that is the amnesty this design forbids', () => {
    expect(load(wellFormed({ g1_ch9_Urdu_seg3: true }))).toThrow(/teach/);
  });

  test('a missing base_cap is refused', () => {
    expect(load({ provisional: true, entries: {} })).toThrow(/base_cap/);
  });

  test('a missing file is refused rather than defaulting to "nothing is exempt"', () => {
    expect(() => EX.loadExemptions('/nonexistent/page_cap_exemptions.json')).toThrow(/ENOENT|not found/);
  });

  test('an empty entry set is legal — it means the corpus is fully compliant', () => {
    expect(EX.loadExemptions(tmpFile(wellFormed({}))).entries).toEqual({});
  });
});
