/**
 * bd-s1oo0.21 (L16) — replay-check: one run's AI marks, checked offline in strict and in assist.
 * Real: L6's renderer and read-back, check-play's coach, score-run-compare. The run dir is a tmp copy
 * of what driver.js + score_run.py leave (run.json, summary.json, db_rows.json); the "child" is a
 * fixture id with an exact key. No network, no DB.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { replay } = require('../../../bot/scripts/e2e/child-test-sim/replay-check');
const F = require('../L6/fixtures/ai-marks');

function runDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'l16-replay-'));
  const fx = path.join(d, 'fixtures'); fs.mkdirSync(path.join(fx, 's-test'), { recursive: true });
  const ai = { urdu: F.urduConfident(), english: F.englishConfident(), maths: F.mathsConfident() };
  // the key: Rumi right everywhere except the Urdu story count (41 → 30) and Q1 (correct → wrong)
  const key = { fixture_id: 's-test', kind: 'synthetic', grade: 3, form: 'A', blocks: JSON.parse(JSON.stringify(ai)) };
  key.blocks.urdu.story.words_correct = 30;
  key.blocks.urdu.questions[0].verdict = 'wrong';
  key.blocks.maths = { maths: key.blocks.maths.maths };
  fs.writeFileSync(path.join(fx, 's-test', 'key.json'), JSON.stringify(key));
  const run = path.join(d, 'run'); fs.mkdirSync(run);
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ fixtures: [{ id: 's-test' }] }));
  fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify({ result: { children: [{ roll: 14, fixture: 's-test' }] } }));
  const blocks = Object.fromEntries(Object.entries(ai).map(([b, m]) => [b, { ai_marks: m, ai_status: 'scored' }]));
  fs.writeFileSync(path.join(run, 'db_rows.json'), JSON.stringify([{ session: { id: 'sess-1', roll: 14, grade: 3, form: 'A' }, blocks }]));
  return { run, fx, strips: path.join(d, 'strips') };
}

const coach = (unsure, unmarked) => ({ catchP: 0.9, catchPrefilled: { unsure, unmarked }, blindAccuracy: 1 });

test('assist pre-fills more fields than strict on the same marks, and the check is shorter', () => {
  const d = runDir();
  const strict = replay({ runDir: d.run, fixturesDir: d.fx, stripsDir: d.strips, mode: 'strict', coach: coach(0.8, 0.4), seeds: [1], rttS: 0.8 });
  const assist = replay({ runDir: d.run, fixturesDir: d.fx, stripsDir: d.strips, mode: 'assist', coach: coach(0.8, 0.4), seeds: [1], rttS: 0.8 });
  const s = strict.per_seed[0]; const a = assist.per_seed[0];
  expect(a.summary.prefill.rate).toBeGreaterThan(s.summary.prefill.rate);
  expect(a.children[0].check_s).toBeLessThan(s.children[0].check_s);
  expect(a.children[0].looks).toBeGreaterThan(0);
  expect(s.children[0].looks).toBe(0);
});

test('a coach who catches everything ends at the key in both modes; one who catches nothing keeps Rumi\'s errors in assist', () => {
  const d = runDir();
  for (const mode of ['strict', 'assist']) {
    const all = replay({ runDir: d.run, fixturesDir: d.fx, stripsDir: d.strips, mode, coach: coach(1, 1), seeds: [1], rttS: 0.8 }).per_seed[0].summary;
    expect(all.story.urdu.coach.mae).toBe(0);
    expect(all.items.questions.coach.agree).toBe(100);
  }
  const none = replay({ runDir: d.run, fixturesDir: d.fx, stripsDir: d.strips, mode: 'assist', coach: coach(0, 0), seeds: [1], rttS: 0.8 }).per_seed[0].summary;
  expect(none.story.urdu.coach.mae).toBe(11);           // the AI's 41 against the key's 30, rubber-stamped
  const strictNone = replay({ runDir: d.run, fixturesDir: d.fx, stripsDir: d.strips, mode: 'strict', coach: coach(0, 0), seeds: [1], rttS: 0.8 }).per_seed[0].summary;
  expect(strictNone.story.urdu.coach.mae).toBe(0);      // strict: the Urdu count arrived empty, the coach typed the key
});

test('--look-s prices a look at an unsure field (sensitivity)', () => {
  const d = runDir();
  const cheap = replay({ runDir: d.run, fixturesDir: d.fx, stripsDir: d.strips, mode: 'assist', coach: coach(0.8, 0.4), seeds: [1], rttS: 0.8, lookS: 1 });
  const dear = replay({ runDir: d.run, fixturesDir: d.fx, stripsDir: d.strips, mode: 'assist', coach: coach(0.8, 0.4), seeds: [1], rttS: 0.8, lookS: 4 });
  const looks = cheap.per_seed[0].children[0].looks;
  expect(dear.per_seed[0].children[0].check_s - cheap.per_seed[0].children[0].check_s).toBeCloseTo(3 * looks, 5);
  expect(dear.look_s).toBe(4);
});
