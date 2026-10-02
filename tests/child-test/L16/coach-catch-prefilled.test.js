/**
 * bd-s1oo0.21 (L16) — the simulated coach rubber-stamps.
 *
 * L14's coach corrected 90% of every disagreement it saw (--coach-catch). A coach who mostly confirms
 * misses more of the wrong marks that arrive filled, and misses fewer when the field says "unsure,
 * please check". --coach-catch-prefilled <marked>,<unmarked> sets the two rates (default 0.8 and 0.4);
 * each unsure-marked field also costs a look (check_unsure); --coach-blind-accuracy sets how often a coach
 * filling an EMPTY field gets it right (default 1, L14's assumption).
 *
 * Real: L6's renderer (the screen the coach sees), check-play's coach model. rng is pinned.
 */

const P = require('../../../bot/shared/services/child-test/check-flow/prefill');
const CheckFlow = require('../../../bot/shared/services/child-test/check-flow');
const CP = require('../../../bot/scripts/e2e/child-test-sim/check-play');
const F = require('../L6/fixtures/ai-marks');

const items = CheckFlow.formItems('3', 'A');
const costs = CP.loadActionCosts();

function screenData(block, ai, mode, lang = 'ur') {
  const before = process.env.CHILD_TEST_PREFILL_MODE;
  process.env.CHILD_TEST_PREFILL_MODE = mode;
  try { return P.renderScreen(block, { aiMarks: ai, items, lang, child: { label: 'roll 14' }, aiStatus: 'scored' }).data; } finally {
    if (before === undefined) delete process.env.CHILD_TEST_PREFILL_MODE; else process.env.CHILD_TEST_PREFILL_MODE = before;
  }
}

// The key disagrees with Rumi on: the story count (41 vs 30, unsure in assist), Q1 (sure, unmarked: AI correct,
// key wrong), Q3 (unsure in assist: AI none, key correct).
function keyFor(ai) {
  const k = JSON.parse(JSON.stringify(ai));
  k.story.words_correct = 30; k.story.words_attempted = 45; k.story.flagged = [];
  k.questions[0].verdict = 'wrong';
  k.questions[2].verdict = 'correct';
  return { blocks: { urdu: k } };
}

const reasonFor = (actions, field) => (actions.find((a) => a.field === field && a.action !== 'check_unsure') || {}).reason;

test('assist: an unsure-marked wrong field is caught at the marked rate, an unmarked one at the unmarked rate', () => {
  const ai = F.urduConfident();
  const data = screenData('urdu', ai, 'assist');
  const { actions, posted } = CP.coachFill({ screen: 'URDU', data, key: keyFor(ai), items, rng: () => 0.5, costs, catchPrefilled: { unsure: 0.8, unmarked: 0.4 } });
  expect(reasonFor(actions, 'u_wc')).toBe('correct');         // unsure (Urdu story: NEVER bar) → caught at 0.8
  expect(posted.u_wc).toBe('30');
  expect(reasonFor(actions, 'u_q3')).toBe('correct');         // unsure → caught
  expect(reasonFor(actions, 'u_q1')).toBe('missed');          // sure, unmarked → rubber-stamped at 0.4
  expect(posted.u_q1).toBe('correct');
});

test('each unsure-marked field costs a look, whether or not it was right', () => {
  const ai = F.urduConfident();
  const data = screenData('urdu', ai, 'assist');
  const { actions } = CP.coachFill({ screen: 'URDU', data, key: { blocks: { urdu: ai } }, items, rng: () => 0.5, costs, catchPrefilled: { unsure: 0.8, unmarked: 0.4 } });
  const looks = actions.filter((a) => a.action === 'check_unsure');
  expect(looks.length).toBeGreaterThanOrEqual(5);              // count + attempted, flagged words, Q3, 4 first sounds, a made-up word
  expect(looks.every((a) => a.cost_s === costs.check_unsure)).toBe(true);
  expect(costs.check_unsure).toBeGreaterThan(0);
});

test('strict: nothing is unsure-marked, so a pre-filled wrong field is caught at the unmarked rate', () => {
  const ai = F.englishConfident();
  const key = JSON.parse(JSON.stringify(ai));
  key.questions[0].verdict = 'wrong';                           // AI correct at 0.95, pre-filled in strict
  const data = screenData('english', ai, 'strict', 'en');
  const { actions } = CP.coachFill({ screen: 'ENGLISH', data, key: { blocks: { english: key } }, items, rng: () => 0.5, costs, catchPrefilled: { unsure: 0.8, unmarked: 0.4 } });
  expect(reasonFor(actions, 'e_q1')).toBe('missed');
  expect(actions.some((a) => a.action === 'check_unsure')).toBe(false);
});

test('without --coach-catch-prefilled the coach is L14\'s (one catch rate, no check_unsure)', () => {
  const ai = F.urduConfident();
  const data = screenData('urdu', ai, 'assist');
  const { actions } = CP.coachFill({ screen: 'URDU', data, key: keyFor(ai), items, rng: () => 0.5, costs, catchP: 0.9 });
  expect(reasonFor(actions, 'u_q1')).toBe('correct');
  expect(actions.some((a) => a.action === 'check_unsure')).toBe(false);
});

test('--coach-blind-accuracy: a coach filling an empty field blind can get it wrong', () => {
  const ai = F.urduConfident();
  const data = screenData('urdu', ai, 'strict');                // the Urdu story count arrives empty
  const key = keyFor(ai);
  const right = CP.coachFill({ screen: 'URDU', data, key, items, rng: () => 0.5, costs, catchPrefilled: { unsure: 0.8, unmarked: 0.4 }, blindAccuracy: 1 });
  expect(right.posted.u_wc).toBe('30');
  const wrong = CP.coachFill({ screen: 'URDU', data, key, items, rng: () => 0.5, costs, catchPrefilled: { unsure: 0.8, unmarked: 0.4 }, blindAccuracy: 0.3 });
  expect(wrong.posted.u_wc).not.toBe('30');
  expect(reasonFor(wrong.actions, 'u_wc')).toBe('fill_empty');
});

test('parseCatchPrefilled reads "0.8,0.4" and rejects nonsense', () => {
  expect(CP.parseCatchPrefilled('0.8,0.4')).toEqual({ unsure: 0.8, unmarked: 0.4 });
  expect(CP.parseCatchPrefilled(undefined)).toBeNull();
  expect(() => CP.parseCatchPrefilled('1.2,0.4')).toThrow();
  expect(() => CP.parseCatchPrefilled('0.8')).toThrow();
});

describe('the mock stack carries the mode to its bot', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const SCRIPT = path.resolve(__dirname, '../../../bot/scripts/e2e/child-test-sim/sim-stack.sh');
  test('CHILD_TEST_PREFILL_MODE set in the shell reaches the bot env (names only printed)', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'l16-stack-'));
    const f = path.join(d, 'sandbox.env');
    fs.writeFileSync(f, 'SUPABASE_URL=https://olvritwoqujtjvwfulbh.supabase.co\n', { mode: 0o600 });
    const r = spawnSync('bash', [SCRIPT, 'env-names'], { env: { PATH: process.env.PATH, HOME: os.tmpdir(), SIM_SANDBOX_ENV: f, CHILD_TEST_PREFILL_MODE: 'assist' }, encoding: 'utf8', timeout: 20000 });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toContain('CHILD_TEST_PREFILL_MODE');
  });
});
