/**
 * bd-jr91a — SUPERSEDED ON 2026-09-24 BY bd-blxml. This file is what is LEFT of it.
 *
 * bd-jr91a raised the primary teach cap to 16 EN / 24 UR to honour the operator's *"dont cut
 * anything, increase the page cap for those 14"* (2026-09-23). The next day she was given three
 * ways to reconcile that sentence with her other standing rule — *"I want lower, we cant go
 * beyond 8, its too much to read and remember!"* and *"22-24 pages no teacher will read ...
 * ever"* — and chose **(a): raise the cap for those 40 only**. A global cap of 24 is the literal
 * opposite of the second sentence, so the global cap came down to 8 and the long lessons keep
 * their pages through a NAMED, HEIGHT-BOUND exemption list instead.
 *
 * The 8 and the exemption mechanism are covered by primary-page-cap-8.test.js and
 * primary-page-cap-exemptions.test.js. Everything in this file that asserted 16 / 24, or warn
 * 4 / 5, was deleted rather than edited: it described a ruling that no longer exists, and a test
 * kept alive by loosening it is worse than no test.
 *
 * WHAT IS KEPT is the half of bd-jr91a that ruling (a) did not overturn — its MEASUREMENTS, and
 * the promise they were taken to secure. Nothing authored may be cut, so every lesson bd-jr91a
 * measured over the cap must STILL render. It now renders under a per-lesson licence rather than
 * a blanket one, and that is exactly what these tests check: the same lessons, by name, at
 * heights at least as tall as the day they were measured.
 *
 * bd-jr91a's measured ceilings, at the default (phone) format, quoted from its own failure text:
 *
 *     teach needs 15 pages; the cap is 9     g3_ch8_Maths_seg2      <- non-Urdu maximum
 *     teach needs 16 pages; the cap is 12    g1_ch8_Urdu_seg6
 *     teach needs 18 pages; the cap is 12    (Urdu)
 *     teach needs 22 pages; the cap is 12    g5_ch8_Urdu_seg9       <- Urdu maximum
 *
 * Those four lessons are all in today's list, and two of them are now SHORTER than bd-jr91a
 * measured them — seg9 at 21, not 22; g1_ch8_Urdu_seg6 at 15, not 16. That is worker B's packer
 * fix (767 -> 757 pages across 112 lessons) showing up in the corpus, and it is why the list is
 * regenerated from a measured render and marked provisional rather than typed once.
 */

const R = require('../../bot/vendor/lp-v9/render_lp.js');
const EX = require('../../bot/vendor/lp-v9/lib/page_cap_exemptions.js');

const primary = { provenance: { grade: 4 } };

// The lessons bd-jr91a measured over its cap, with the height it measured, and the height the
// current corpus measures. Both are recorded: the promise is about the LESSON, and the second
// column is what actually has to be licensed today.
const JR91A = [
  ['g3_ch8_Maths_seg2', 15, 15],
  ['g1_ch8_Urdu_seg6', 16, 15],
  ['g5_ch9_Urdu_seg11', 18, 18],
  ['g5_ch8_Urdu_seg9', 22, 21],
];

describe('bd-jr91a is superseded: the global raise is gone', () => {
  test('the primary teach cap is no longer 16 / 24 in either language', () => {
    expect(R.MAX_PAGES_PRIMARY.teach).not.toBe(16);
    expect(R.MAX_PAGES_PRIMARY_UR.teach).not.toBe(24);
    expect(R.pageCapsFor('en', primary).max.teach).toBe(8);
    expect(R.pageCapsFor('ur', primary).max.teach).toBe(8);
  });

  test('the 1.5x Urdu premium bd-jr91a derived is gone with it — one cap, both languages', () => {
    // It was round(EN x 1.5) = 24. Ruling (a) was not language-qualified, and the Nastaliq
    // premium is now absorbed lesson by named lesson: 23 of the 40 entries are Urdu.
    expect(R.MAX_PAGES_PRIMARY_UR.teach).toBe(R.MAX_PAGES_PRIMARY.teach);
    const urdu = Object.keys(EX.loadExemptions().entries).filter((s) => s.includes('_Urdu_'));
    expect(urdu).toHaveLength(23);
  });
});

describe('but the promise bd-jr91a secured still holds: nothing it measured got cut', () => {
  test.each(JR91A)('%s still renders — it is licensed by name', (stem) => {
    expect(EX.exemptionFor(stem)).not.toBeNull();
  });

  test.each(JR91A)('%s is licensed to at least its current measured height (%i -> %i)',
    (stem, _then, now) => {
      expect(R.pageCapsFor('ur', primary, 'phone', stem).max.teach).toBeGreaterThanOrEqual(now);
      expect(R.pageCapsFor('en', primary, 'phone', stem).max.teach).toBeGreaterThanOrEqual(now);
    });

  test('the licence is per lesson, not a blanket restoration of the old cap', () => {
    // The falsifiable difference between ruling (a) and bd-jr91a: an UNLISTED lesson at 21
    // pages was legal under the old Urdu cap of 24 and is a defect now, while the one lesson
    // that was MEASURED at 21 is not.
    expect(21 > R.pageCapsFor('ur', primary, 'phone', 'g2_ch8_Urdu_seg1').max.teach).toBe(true);
    expect(21 > R.pageCapsFor('ur', primary, 'phone', 'g5_ch8_Urdu_seg9').max.teach).toBe(false);
    // And seg9 at bd-jr91a's OWN measurement of 22 is a defect too -- the licence tracks the
    // corpus as it is now, not the corpus as it was when the lesson was first found too long.
    expect(22 > R.pageCapsFor('ur', primary, 'phone', 'g5_ch8_Urdu_seg9').max.teach).toBe(true);
  });

  test('and no elision path was added by either ruling — over cap still FAILS', () => {
    const msg = R.overCapProblem('teach', 9, 8, null, { stem: 'g2_ch8_Urdu_seg1' });
    expect(msg).toMatch(/^PAGE COUNT: g2_ch8_Urdu_seg1: teach needs 9 pages; the cap is 8\./);
    expect(msg).not.toMatch(/truncat|elid|shorten automatically/i);
  });
});
