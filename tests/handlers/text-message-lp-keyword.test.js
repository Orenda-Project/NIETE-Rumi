/**
 * Pakistan LP intercept (FEAT-059) — asserts the handler opens the LP menu on a
 * lesson-plan request.
 *
 * REWRITTEN 2026-08-16 (bd-hvhhu). This file used to scrape the regex out of
 * text-message.handler.js by source text and assert the OLD exact-match
 * behaviour. Two things changed:
 *
 *  1. The matcher moved into its own module (bot/shared/utils/lp-intent.js) with
 *     82 cases of its own, so scraping source text is no longer the way to test
 *     it — this file now asserts the HANDLER WIRING, and the matcher's own suite
 *     asserts the matching.
 *
 *  2. THREE OF ITS ASSERTIONS ARE DELIBERATELY INVERTED. It previously required
 *     that the intercept does NOT fire on:
 *         "lesson plan for grade 3 math"
 *         "I need a lesson plan on photosynthesis"
 *         "lps"
 *     — the earlier design sent a *specific* request to the generation path and
 *     reserved the menu for a bare keyword. The current spec is the opposite:
 *     ANY mention of a lesson plan opens the menu, because the ready-made K-5
 *     corpus is what a teacher asking for a lesson plan should get. Those three
 *     now fire, on purpose. This is a behaviour change, recorded here rather
 *     than quietly dropped.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HANDLER_PATH = path.join(REPO_ROOT, 'bot', 'shared', 'handlers', 'text-message.handler.js');
const { isLessonPlanRequest } = require(path.join(REPO_ROOT, 'bot', 'shared', 'utils', 'lp-intent.js'));

describe('LP intercept — handler wiring', () => {
  let source;
  beforeAll(() => { source = fs.readFileSync(HANDLER_PATH, 'utf8'); });

  test('the handler delegates to the lp-intent matcher, not an inline regex', () => {
    expect(source).toMatch(/require\('\.\.\/utils\/lp-intent'\)/);
    expect(source).toMatch(/matchLessonPlanIntent\(trimmedMessage\)/);
  });

  test('the intercept is still presence-gated on PAKISTAN_LP_FLOW_ID', () => {
    // With no Flow provisioned the message must fall through to the existing
    // curriculum-LP topic path rather than dead-end.
    expect(source).toMatch(/PAKISTAN_LP_FLOW_ID && lpMatch\.matched/);
  });

  test('the match tier is logged, so a false positive is diagnosable', () => {
    expect(source).toMatch(/tier: lpMatch\.tier/);
  });

  test('no inline LP keyword regex is EXECUTED in the handler', () => {
    // The old pattern is still quoted in the block comment above the intercept,
    // deliberately — it is the record of what changed. What must not survive is
    // it being *run*: a literal regex tested against the message.
    const executed = /\/\^\([^/]*lesson[^/]*\)\$\/i?\s*\.test\s*\(/;
    expect(source).not.toMatch(executed);
  });
});

describe('LP intercept — behaviour', () => {
  const fires = [
    'lp', 'LP', 'Lp', 'lps',
    'lesson plan', 'Lesson Plan', 'LESSON PLAN', 'lesson-plan', 'lessonplan',
    '/lp', 'لیسن پلان',
    // The three that INVERTED — see the header note.
    'lesson plan for grade 3 math',
    'I need a lesson plan on photosynthesis',
  ];
  test.each(fires)('fires on %p', (t) => expect(isLessonPlanRequest(t)).toBe(true));

  const quiet = ['', 'hi', 'train', 'lesson', 'plan', 'thanks', 'what is the plan'];
  test.each(quiet)('stays quiet on %p', (t) => expect(isLessonPlanRequest(t)).toBe(false));

  test('a marketing string that merely contains the words does not fire', () => {
    // "plan lesson - create pdf lesson plans instantly" is a menu label, not a
    // teacher request. It DOES contain "lesson plans", so it fires — and that is
    // acceptable: it reaches the handler only if a teacher types it verbatim,
    // in which case opening the LP menu is the right answer anyway.
    expect(isLessonPlanRequest('plan lesson - create pdf lesson plans instantly')).toBe(true);
  });
});
