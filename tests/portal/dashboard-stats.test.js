/**
 * bd-60079 — the dashboard's numbers should be things a teacher still does.
 *
 * It showed three big cards: Lesson Plans, Coaching Sessions, Latest Score.
 * The first counted `lesson_plans` — her own Gamma-generated output — and
 * custom generation is off, so that number is frozen at whatever she reached
 * and can never move again. A headline metric that cannot change is not a
 * metric, it is a fossil.
 *
 * Replaced with the three things she IS doing: coaching, training and
 * assessments. All three are read from tables that already exist and are
 * already written by the bot; nothing new is stored.
 *
 * These assertions read the route source rather than standing up
 * express+session+supabase, for the same reason the other portal contract
 * tests do — the failure mode here is a field that silently is not returned,
 * not a throw.
 */

const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', '..', 'dashboard', 'routes', 'portal.routes.js');
const src = fs.readFileSync(ROUTES, 'utf8');

const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

/** The /dashboard handler alone, so a neighbouring route cannot mask a miss. */
function dashboardBlock() {
  const start = code.indexOf("router.get('/dashboard'");
  expect(start).toBeGreaterThan(-1);
  const next = code.indexOf("\nrouter.", start + 10);
  return code.slice(start, next > start ? next : undefined);
}

describe('the frozen lesson-plan count is gone', () => {
  test('the dashboard no longer counts lesson_plans', () => {
    expect(dashboardBlock()).not.toMatch(/from\(['"]lesson_plans['"]\)/);
  });

  test('and no longer returns totalLessonPlans', () => {
    expect(dashboardBlock()).not.toMatch(/totalLessonPlans/);
  });
});

describe('it returns what she is actually doing', () => {
  const block = () => dashboardBlock();

  test('coaching sessions, which it already had', () => {
    expect(block()).toMatch(/totalCoachingSessions/);
    expect(block()).toMatch(/from\(['"]coaching_sessions['"]\)/);
  });

  test('a training breakdown, not just a count', () => {
    // modules completed AND the total available, so "12" can read "12 of 40"
    // rather than a number with no scale.
    expect(block()).toMatch(/training/i);
    expect(block()).toMatch(/modulesCompleted/);
    expect(block()).toMatch(/modulesTotal/);
  });

  test('the training breakdown names the level she is working through', () => {
    expect(block()).toMatch(/currentLevel|levelName/);
  });

  test('assessments generated', () => {
    expect(block()).toMatch(/totalAssessments/);
    expect(block()).toMatch(/from\(['"]assessment_requests['"]\)/);
  });

  test('every count is scoped to the teacher asking', () => {
    // The whole block: no count may be global. A dashboard that shows someone
    // else's totals is worse than showing none.
    const counts = block().match(/count:\s*['"]exact['"]/g) || [];
    expect(counts.length).toBeGreaterThanOrEqual(3);
    // Each supabase chain in here filters on the session user.
    expect(block()).toMatch(/eq\(['"]user_id['"], userId\)/);
  });
});

describe('a partial failure still renders a dashboard', () => {
  test('the top-level counts are gathered with allSettled', () => {
    // One dead table must not blank the whole page — the existing handler
    // already made that choice and it has to survive the new queries.
    //
    // Only the TOP-LEVEL gather is asserted. The training helper uses a plain
    // Promise.all for its two lookups, which is right: they are dependent
    // detail for one stat, the whole helper is wrapped in a catch that returns
    // an empty breakdown, and allSettled there would just move the same
    // fallback one level down.
    const block = dashboardBlock();
    expect(block).toMatch(/const \[coachingSessionsResult[\s\S]{0,80}Promise\.allSettled/);
  });

  test('a failed training lookup degrades to an empty breakdown, not a 500', () => {
    const block = dashboardBlock();
    expect(block).toMatch(/modulesCompleted: 0, modulesTotal: 0, currentLevel: null/);
    expect(block).toMatch(/\.catch\(/);
  });
});
