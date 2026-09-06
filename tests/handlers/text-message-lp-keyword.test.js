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
    //
    // bd-oak77.4: this pinned the literal source order `PAKISTAN_LP_FLOW_ID && lpMatch.matched`,
    // which bd-hgwfo swapped — so it has been red on `develop` ever since while the gate itself
    // was never broken. A grep for one operand ORDER is not a test of the gate; it is a test of
    // how the line was typed. Assert both operands guard the same branch instead. The EXECUTING
    // proof that the branch behaves lives in tests/lp-v8/bd-hgwfo-gamma-door.test.js
    // ("falls back to the not-in-catalog reply ONLY when no Flow is provisioned").
    const intercept = source.slice(source.indexOf('const lpMatch = matchLessonPlanIntent'));
    const guard = intercept.slice(0, intercept.indexOf('{', intercept.indexOf('if (')));
    expect(guard).toMatch(/lpMatch\.matched/);
    expect(guard).toMatch(/PAKISTAN_LP_FLOW_ID/);
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
    // bd-oak77.4: the broadcast template button's label, matched exactly again after bd-hgwfo's
    // narrowing dropped it (see lp-intent.js BROADCAST_BUTTON_LABELS).
    'Lesson Plans & Assessment',
    // bd-oak77.4: a bare 'lesson' fires, and should. BARE matches `lessons?` — the whole message
    // IS the artefact name, which is the receptionist doctrine, and a teacher who types one word
    // wants the menu. This sat in `quiet` from before bd-hgwfo settled the regex.
    'lesson', 'lessons',
  ];
  test.each(fires)('fires on %p', (t) => expect(isLessonPlanRequest(t)).toBe(true));

  // bd-hgwfo INVERTED these two back again (2026-08-30), and this file's header note is one
  // revision behind — see the amendment at the top. A message that carries CONTENT now goes to
  // the LLM classifier, which knows what was just delivered: a new request still lands on the same
  // Flow via the lesson_plan intent, while "shorten this lp" 30s after a delivery gets the lesson
  // rewritten instead of a picker. 748 intercepts in 14 days, 47% of them unanswerable, is what
  // paid for that. These two are the measurement, kept here so nobody re-widens the matcher by
  // accident.
  const quiet = [
    '', 'hi', 'train', 'plan', 'thanks', 'what is the plan',
    'lesson plan for grade 3 math',
    'I need a lesson plan on photosynthesis',
  ];
  test.each(quiet)('stays quiet on %p', (t) => expect(isLessonPlanRequest(t)).toBe(false));

  test('a marketing string that merely contains the words does NOT fire', () => {
    // The test name and the assertion disagreed: the name says "does not fire", the assertion
    // demanded `true`, and it has been red on `develop` since bd-hgwfo made the matcher
    // whole-message-only. bd-hgwfo is right and the name was right all along — a menu label with
    // eight words around the artefact name is not a bare command. It still reaches the LLM
    // classifier, which will open the same Flow if the teacher genuinely meant it.
    expect(isLessonPlanRequest('plan lesson - create pdf lesson plans instantly')).toBe(false);
  });
});
