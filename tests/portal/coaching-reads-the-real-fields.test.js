/**
 * bd-60077 — the portal's coaching screens read keys its sessions do not have.
 *
 * Three defects, all silent, all measured against production on 9 Sep 2026.
 * None of them throws: every one is a missing key absorbed by `|| 0`, so the
 * page renders confidently and wrongly.
 *
 *   1. SCORES  The route builds six OECD goal bars from
 *              scores.goal1_total…goal5_total. Sampling 30 recent completed
 *              sessions: 30/30 are FICO and NOT ONE contains a goalN key.
 *              The real structure is analysis_data.domains — four FICO
 *              sections whose indicators each carry a score AND a quoted
 *              piece of evidence from her own lesson.
 *
 *   2. PERCENT Four call sites read scores.percentage. Across 500 sampled
 *              sessions that key appears 0 times; scores.overall_percentage
 *              appears 492 times. So every percentage the portal prints —
 *              list, detail header, analytics — is a hardcoded zero.
 *
 *   3. MAXSCORE `|| 118` is a fallback for a number that is never 118 under
 *              FICO, whose max is computed per session from the subject
 *              (42 maths/science, 44 literacy, 38 unknown).
 *
 * These tests read the ROUTE SOURCE rather than standing up express+session+
 * supabase, for the same reason the session-id guard does: the failure is a
 * silent undefined, not a throw, so a request test would need the whole
 * harness to reach the same line and would still only cover the routes
 * someone remembered to exercise. This fails on the SHAPE.
 */

const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', '..', 'dashboard', 'routes', 'portal.routes.js');
const src = fs.readFileSync(ROUTES, 'utf8');

/** Source with comments stripped — assertions are about what the code DOES. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

/** Just the three coaching handlers, so unrelated routes cannot mask a miss. */
function coachingBlock() {
  const start = code.indexOf("router.get('/coaching-sessions'");
  const end = code.indexOf("router.get('/", code.indexOf("router.get('/coaching-analytics'") + 10);
  expect(start).toBeGreaterThan(-1);
  return code.slice(start, end > start ? end : undefined);
}

describe('the scores come from the framework the session was actually scored on', () => {
  test('no OECD goal key is read anywhere in the coaching routes', () => {
    const block = coachingBlock();
    // The exact keys that do not exist in a FICO session.
    expect(block).not.toMatch(/goal[1-6]_total/);
  });

  test('no OECD goal NAME is hardcoded in the coaching routes', () => {
    const block = coachingBlock();
    [
      'Formative Assessment',
      'Student Engagement',
      'Quality Content',
      'Effective Differentiation',
      'Classroom Management',
      'Reflective Debrief',
    ].forEach((name) => {
      expect(block).not.toContain(name);
    });
  });

  test('the breakdown is asked of the bot, not assembled here', () => {
    // buildScoreViewModel already dispatches five frameworks and is what
    // renders her WhatsApp report. The portal must call it, never re-implement
    // it — a sixth framework should not require a portal change.
    expect(code).toMatch(/coaching\/breakdown|CoachingBreakdown|Coaching\.breakdown/);
  });
});

describe('the percentages are the ones that exist', () => {
  test('scores.percentage is never read — it is absent from every session', () => {
    const block = coachingBlock();
    expect(block).not.toMatch(/scores\?\.\s*percentage|scores\.percentage/);
  });

  test('the overall score comes from the framework-agnostic helper', () => {
    // getOverall (dashboard/services/coaching-frameworks.service) already
    // normalises every framework's score shape and reads overall_percentage.
    // It predates this work and the leader dashboard uses it — the coaching
    // routes simply never called it. Asserting the CALL rather than the key
    // is the stronger contract: it also rules out a future inline `?.percentage`
    // creeping back in beside it.
    const block = coachingBlock();
    expect(block).toMatch(/getOverall\(/);
    expect(fs.readFileSync(
      path.join(__dirname, '..', '..', 'dashboard', 'services', 'coaching-frameworks.service.js'),
      'utf8',
    )).toMatch(/overall_percentage/);
  });

  test('no hardcoded 118 max — FICO computes its own denominator per session', () => {
    const block = coachingBlock();
    expect(block).not.toMatch(/\|\|\s*118/);
  });
});

describe('the artifacts are signed, and named for what they are', () => {
  test('coaching artifacts are presigned like every other media URL', () => {
    const block = coachingBlock();
    // The helper already used by the training and video endpoints in this file.
    expect(block).toMatch(/_resolveMediaUrl|generatePresignedUrl/);
  });

  test('her OWN lesson audio is served, not just the coach debrief', () => {
    const block = coachingBlock();
    expect(block).toMatch(/audio_url/);
  });

  test('the coach debrief is returned under a name that says so', () => {
    const block = coachingBlock();
    // `audioUrl: session.voice_debrief_url` is the mislabel: the player titled
    // "Session Recording" was playing the coach talking, not her lesson.
    expect(block).not.toMatch(/audioUrl:\s*session\.voice_debrief_url/);
    expect(block).toMatch(/debriefAudioUrl|voiceDebriefUrl/);
  });
});

describe('what she generated is returned, not merely fetched', () => {
  // The route already runs select('*') — 63 columns — and returns seven.
  test.each([
    ['executive_summary', /executive_summary|executiveSummary/],
    ['lesson-plan fidelity', /lp_fidelity|lpFidelity/],
    ['her classroom photos', /classroom_photos|classroomPhotos/],
    ['whether a lesson plan was attached', /has_lesson_plan|hasLessonPlan/],
    ['her reflective answers', /conversation_state|reflection/],
    ['the action she was given', /prioritized_action|prioritizedAction/],
    // talk_time is deliberately NOT in this list. Measured on 300 recent
    // completed sessions it is a non-empty object on 3% — the plan claimed
    // 56%, which was wrong. Promising a figure that is absent 97% of the time
    // is how the `|| 0` bugs got written in the first place.
  ])('%s reaches the client', (_label, pattern) => {
    expect(coachingBlock()).toMatch(pattern);
  });
});
