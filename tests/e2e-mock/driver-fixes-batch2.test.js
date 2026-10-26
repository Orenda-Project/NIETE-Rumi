/**
 * Mock-lane driver and lane gaps behind 12 of the 27 failures of run 20261026-2335-par (bd-1r3k2h).
 *
 * T36 / T41  training.cjs lpState seeded the lesson-plan quiz with `--lessons-from auto`, which borrows
 *            meta.lessons from a REAL sent lp_v8 quiz. The local seed has none (lessonsBorrowed: 0), so the
 *            row had no lesson refs and the Flow offered no "Make it again". `--lesson-id` borrows from the
 *            lesson's own asset source, which the seed does carry (grade_3_math_ch1_seg1).
 * COA39–55   every ask was skipped `offered_today`: lp-coaching-ask offeredToday() finds a quiz with
 * + COA45    meta.offered_at today — the transcript-quiz offers the pipeline runs on the same shard left
 *            behind. The driver purges its own run quizzes before the cluster and before every ask.
 * COA09      the second recording went in 45 s after the first step; with cassette replay the pipeline is
 *            complete by then, so the "deferral" was a fresh session. Lane-tunable E2E_COACHING_DEFER_AFTER_MS,
 *            0 on the mock lane, and never after step 5 (nothing left to defer against → BLOCKED, not FAIL).
 * COA25      Step 1/5 is replaced by the reaction on the recording (coaching-orchestrator step1Announced,
 *            NC1): the Urdu run has four counters, not five, by design. The check wants steps 2–5 in Urdu.
 * T74        the report promise rides in the PDF caption since the Meta bill cut (bd-w2daa.7); the order
 *            check still wanted a PROMISE row after FORWARD. The spec's own line: the forward message is last.
 * T42        the question card rides the picker as an interactive HEADER image (CARD_RIDES_THE_PICKER); the
 *            mock only refused example.invalid on a top-level media link, so the "unsendable" card was sent.
 * COA29/30   lp_absent on every fidelity run: niete_lp_fidelity_moves was not a seed table (0 rows locally).
 *
 * Red-first: every assertion fails on the branch before the fix.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

describe('T36/T41 — the lesson-plan quiz seed borrows lessons from a catalog lesson the seed carries', () => {
  const src = read('.claude/qa/shared/features/training.cjs');
  const block = src.slice(src.indexOf('const lpState = async'), src.indexOf('const lpState = async') + 1200);
  test('lpState seeds with --lesson-id, never --lessons-from auto', () => {
    expect(block).toMatch(/'--lesson-id'/);
    expect(block).not.toMatch(/'--lessons-from', 'auto'/);
  });
});

describe('COA39–55 — the driver purges its run quizzes so offeredToday() cannot skip the ask', () => {
  const src = read('.claude/qa/shared/coaching-ext.cjs');
  test('askOnScreen purges run quizzes before seeding the nudge', () => {
    const line = src.split('\n').find((l) => l.includes('const askOnScreen = async'));
    expect(line).toMatch(/purgeRunQuizzes\(\)/);
    expect(line.indexOf('purgeRunQuizzes()')).toBeLessThan(line.indexOf('seedAsk()'));
    const helper = src.split('\n').find((l) => l.includes('const purgeRunQuizzes = '));
    expect(helper).toMatch(/api\.db\('purge-run-quizzes', \['--since'/);
  });
  test('the cluster guard purges once before the bot restart too', () => {
    const i = src.indexOf("await guard(['COA39', 'COA44']");
    expect(src.slice(i, i + 400)).toMatch(/purgeRunQuizzes\(\)/);
  });
});

describe('COA09 — the second recording goes in while the analysis is still in flight', () => {
  const src = read('.claude/qa/shared/features/coaching.cjs');
  test('the trigger is lane-tunable and never fires after step 5', () => {
    expect(src).toMatch(/E2E_COACHING_DEFER_AFTER_MS/);
    const i = src.indexOf('// COA09 — a SECOND recording');
    expect(src.slice(i, i + 400)).toMatch(/!obs\.steps\.includes\('5'\)/);
    expect(src).not.toMatch(/Date\.now\(\) - t0 > 45000/);
  });
  test('run-suite sets 0 on the mock lane', () => {
    expect(read('.claude/qa/shared/run-suite.sh')).toMatch(/E2E_COACHING_DEFER_AFTER_MS="\$\{E2E_COACHING_DEFER_AFTER_MS:-0\}"/);
  });
});

describe('COA25 — Step 1/5 replaced by the reaction is not a missing step', () => {
  const src = read('.claude/qa/shared/coaching-ext.cjs');
  test('the check wants steps 2–5 in Urdu, not five counter rows', () => {
    const i = src.indexOf("set('COA25'");
    const block = src.slice(i - 900, i + 600);
    expect(block).not.toMatch(/stepRows\.length >= 5/);
    expect(block).toMatch(/step1ReplacedByReaction/);
  });
});

describe('T74 — the promise rides in the PDF caption and the forward message is last', () => {
  const src = read('.claude/qa/shared/training-quiz-gen.cjs');
  test('the order check is "FORWARD is last", not "PROMISE after FORWARD"', () => {
    expect(src).toMatch(/forwardLast/);
    expect(src).not.toMatch(/promiseFollowsForward/);
  });
});

describe('COA29/30 — the fidelity move lists are seeded', () => {
  test('niete_lp_fidelity_moves is a seed table', () => {
    const tables = read('supabase/baseline/seed-tables.txt').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(tables).toContain('niete_lp_fidelity_moves');
  });
});
