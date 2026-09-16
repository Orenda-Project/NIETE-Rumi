/**
 * bd-2507 — /menu goes straight to the interactive list.
 *
 * The chain was: /menu → MenuService.sendMenu → sendFeatureMenuCarousel, which
 * tried the Meta TEMPLATE `feature_menu_carousel_v3` first and only fell back
 * to the interactive list when that failed. The template is APPROVED, so the
 * template was the normal path.
 *
 * That meant bd-2504 — Training first, Reading Assessment and AI Video
 * Generation removed — edited the FALLBACK and was invisible on the happy path.
 * The carousel still showed Lesson Plans / Create Video / Coaching / Reading
 * Test: no Training, and both removed options still on offer.
 *
 * Two other things the template costs us, which the list does not:
 *   - it is categorised MARKETING, so it is subject to delivery limits and is
 *     suppressed entirely for teachers opted out of marketing;
 *   - changing it is a Meta review round-trip, so the menu cannot be iterated
 *     at the speed a menu needs to be iterated.
 *
 * Operator decision 2026-08-02: skip the template, send the list. The template
 * is left registered and untouched — deleting it is a separate call, and an
 * unused approved template costs nothing.
 */
const fs = require('fs');
const path = require('path');

const WA = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/whatsapp.service.js'), 'utf8');

/**
 * The body of sendFeatureMenuCarousel, which is what MenuService calls.
 *
 * Matched on the NAME, not on a full signature literal: row 122 added a `user`
 * parameter so the rows can be chosen by role, and an exact-signature anchor
 * turned this whole suite red for a reason that has nothing to do with what it
 * guards.
 */
function fnBody(name) {
  const start = WA.search(new RegExp(`static async ${name}\\s*\\(`));
  expect(start).toBeGreaterThan(-1);
  return WA.slice(start, WA.indexOf('\n  static ', start + 10));
}

const carouselFn = () => fnBody('sendFeatureMenuCarousel');

describe('bd-2507 — the menu entry point sends the list, not the template', () => {
  it('does not build the template payload before sending', () => {
    // buildFeatureMenuCarouselPayload is what produced the template message.
    expect(carouselFn()).not.toMatch(/buildFeatureMenuCarouselPayload/);
  });

  it('sends the interactive list', () => {
    expect(carouselFn()).toMatch(/sendFeatureMenuList|interactive/);
  });

  it('the two features that must never get a row still do not have one', () => {
    // Row 122: the rows are now built per role by config/role-features rather
    // than sitting as a literal here, so ask the builder. The bd-2504
    // guarantee is asserted for EVERY role, which is stronger than the single
    // hardcoded list this used to read.
    const { featureMenuRows } = require('../../bot/shared/config/role-features');
    for (const role of ['teacher', 'principal', 'coach', null]) {
      const ids = featureMenuRows(role && { id: 'u', role }, {
        observeEnabled: true, trainingEnabled: true, lessonPlanEnabled: true,
        rosterEnabled: true, classesEnabled: true, quizEnabled: true,
        assessmentEnabled: true, videosEnabled: true,
      }).map((r) => r.id);
      // Reading assessment cannot run here; the AI video GENERATOR stays
      // command-only. `menu_videos` — the pre-made library — is a different id
      // with its own door, and it does get a row.
      expect(ids).not.toContain('menu_reading');
      expect(ids).not.toContain('menu_video');
      expect(ids).toContain('menu_training');
    }
  });

  it('still returns a boolean so MenuService can tell success from failure', () => {
    // MenuService branches on the return value to set conversation state; a
    // silent undefined would make a failed send look like a delivered menu.
    //
    // The booleans now live in the list function, and the entry point returns
    // its value — so assert the contract, not where the literals sit.
    expect(carouselFn()).toMatch(/return\s+await\s+this\.sendFeatureMenuListFallback\(to\b/);

    const listFn = fnBody('sendFeatureMenuListFallback');
    expect(listFn).toMatch(/return\s+true/);
    expect(listFn).toMatch(/return\s+false/);
  });
});
