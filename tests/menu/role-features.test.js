'use strict';
/**
 * Row 122 (DC review sheet, Saaim, 14 Sep 2026) — the main menu offered every
 * user the same rows, so a `role='principal'` teacher tapped "Classroom
 * Coaching", was told to send her recording, and got the HITL binding list
 * ("Whose observation is this?") because observe-audio-router intercepts a
 * leader's audio on role alone. 544 live users (459 principal + 85 coach).
 *
 * The contract locked here — DC is "coach ME", HITL is "I observed SOMEONE":
 *
 *   teacher                          DC only
 *   principal                        both      (in ICT a principal also teaches)
 *   coach                            HITL only
 *   school_leader/supervisor/aeo     HITL only (LEADER_ROLES, 0 live on NIETE)
 *   unknown / null                   DC only   (never grant HITL by accident,
 *                                               never strip DC from ~14.4k teachers)
 *
 * PURE and SYNCHRONOUS on purpose. authz/capability.js is the repo's usual
 * gate, but it is DB-backed and fail-closed: a lookup blip would take DC away
 * from every teacher, and on the audio hot path a denial means the recording
 * parks. Policy this hot cannot have a failure mode.
 */

const {
  canSelfCoach, canObserve, featureMenuRows,
} = require('../../bot/shared/config/role-features');

const u = (role) => (role === undefined ? {} : { id: 'u-1', role });

describe('role-features — the capability table', () => {
  test.each([
    ['teacher', true, false],
    ['principal', true, true],
    ['coach', false, true],
    ['school_leader', false, true],
    ['supervisor', false, true],
    ['aeo', false, true],
  ])('%s → DC %s, HITL %s', (role, dc, hitl) => {
    expect(canSelfCoach(u(role))).toBe(dc);
    expect(canObserve(u(role))).toBe(hitl);
  });

  test('an unknown role keeps DC and is never granted HITL', () => {
    for (const bad of ['headmaster', 'UNREGISTERED', '', null, undefined]) {
      expect(canSelfCoach({ id: 'u', role: bad })).toBe(true);
      expect(canObserve({ id: 'u', role: bad })).toBe(false);
    }
  });

  test('no user at all → DC, never HITL (menu must still render)', () => {
    expect(canSelfCoach(null)).toBe(true);
    expect(canObserve(null)).toBe(false);
  });

  test('role matching is case- and whitespace-insensitive', () => {
    expect(canObserve({ role: '  Principal ' })).toBe(true);
    expect(canSelfCoach({ role: 'COACH' })).toBe(false);
  });
});

describe('featureMenuRows — what each role is offered', () => {
  const ids = (user, opts) => featureMenuRows(user, opts).map((r) => r.id);
  // Every row is presence-gated now, not just the observe one: a row appears
  // only when the feature behind it can actually start. ON is "this deployment
  // has everything published", which is what production runs.
  const ON = {
    observeEnabled: true,
    trainingEnabled: true,
    lessonPlanEnabled: true,
    rosterEnabled: true,
    classesEnabled: true,
    quizEnabled: true,
    assessmentEnabled: true,
    videosEnabled: true,
  };

  test('teacher: DC, no HITL', () => {
    expect(ids(u('teacher'), ON)).toContain('menu_coaching');
    expect(ids(u('teacher'), ON)).not.toContain('menu_observe');
  });

  test('coach: HITL, no DC', () => {
    expect(ids(u('coach'), ON)).toContain('menu_observe');
    expect(ids(u('coach'), ON)).not.toContain('menu_coaching');
  });

  test('principal: BOTH — the row-122 fix', () => {
    expect(ids(u('principal'), ON)).toEqual(
      expect.arrayContaining(['menu_coaching', 'menu_observe']));
  });

  test('the shared rows are untouched for every role', () => {
    for (const role of ['teacher', 'principal', 'coach', null]) {
      expect(ids(u(role), ON)).toEqual(
        expect.arrayContaining(['menu_training', 'menu_lesson_plan', 'menu_other']));
    }
  });

  test('a row whose feature cannot start here is not offered to anyone', () => {
    // The reading-assessment lesson, generalised: it stayed on the menu for
    // twenty days after it stopped being able to run — 57 attempts, 57
    // failures. Nothing is offered that cannot start.
    for (const role of ['teacher', 'principal', 'coach', null]) {
      const shut = ids(u(role), {});
      for (const gated of ['menu_observe', 'menu_roster', 'menu_classes',
        'menu_quiz', 'menu_assessment', 'menu_videos', 'menu_training',
        'menu_lesson_plan']) {
        expect(shut).not.toContain(gated);
      }
      // And she is still left with a usable menu.
      expect(shut).toContain('menu_other');
    }
  });

  test('HITL row is absent when the market has no observe Flow (presence-based gating)', () => {
    expect(ids(u('principal'), { observeEnabled: false })).not.toContain('menu_observe');
    expect(ids(u('coach'), { observeEnabled: false })).not.toContain('menu_observe');
  });

  test('a coach with observe off still never gets the DC row', () => {
    expect(ids(u('coach'), { observeEnabled: false })).not.toContain('menu_coaching');
  });

  test('every row carries catalog keys whose copy fits the list caps, in EVERY offered language', () => {
    // The rows carry KEYS now, not copy: a per-language map in this config
    // module would sit outside the catalog, where neither resolveUx nor the
    // field-cap check can see it. So resolve each key and measure the result —
    // which also makes the cap check cover Urdu rather than English alone.
    const { resolveUx } = require('../../bot/shared/config/ux-strings');
    const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');
    expect(LANGUAGE_OFFER.length).toBeGreaterThan(1);

    for (const r of featureMenuRows(u('principal'), ON)) {
      for (const language of LANGUAGE_OFFER) {
        const title = resolveUx(r.titleKey, { language });
        const description = resolveUx(r.descriptionKey, { language });
        // Class I: CODE POINTS, not UTF-16 units — they diverge on non-Latin
        // scripts and emoji, which is how a string passes locally and is rejected
        // at the API boundary (#131009), killing the WHOLE message.
        expect([...title].length).toBeGreaterThan(0);
        expect([...title].length).toBeLessThanOrEqual(24);
        expect([...description].length).toBeLessThanOrEqual(72);
      }
    }
  });

  test('a WhatsApp list section holds 10 rows — we stay inside it', () => {
    expect(featureMenuRows(u('principal'), ON).length).toBeLessThanOrEqual(10);
  });
});
