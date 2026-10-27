/**
 * The driver sleeps the dashboard still showed after the 27 were fixed (bd-1r3k2h, run 20261027-1022-par:
 * driver.sleep 509 s, bot.timeout 60 s across eleven children — traces read, not guessed).
 *
 * coaching    185 s of 2.5 s sleeps + a 60 s timeout, all in COA04: (a) the walker waits up to 180 s for the
 *             report's voice note (COA57) and keeps waiting after the bot has SAID "Voice summary could not be
 *             generated" (the debrief answer is a per-run cassette miss on the sealed lane); (b) the photo
 *             prompt's "Yes" gets no new message back (a reaction since the bill cut), so tapAndWait ran its
 *             full 60 s before the photo upload.
 * training#3  257 s: T77 proves "exactly one report for two asks" by waiting 90 s for a second PDF that must
 *             not come, and T78 proves a suppressed scheduled run by waiting 60 s for a report that must not
 *             come. Under cassette replay a report renders in seconds; the absence windows are lane-tunable.
 * dashboard   coaching shards 2 and 3 showed nothing at all: coaching-ext records its verdicts with no window
 *             (ms 0, recorded at the end), so profile_run attributed no time. The guard now times its block
 *             and the runner's rec() carries the window's end through to the scenario span.
 *
 * Red-first: every assertion fails on the branch.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

describe('coaching walker — the voice-note wait and the photo Yes tap', () => {
  const src = read('.claude/qa/shared/features/coaching.cjs');
  test('the voice-note wait stops on the bot\'s "could not be generated" note and is lane-tunable', () => {
    const i = src.indexOf('COA57 needs the report\'s own voice note');
    const block = src.slice(i, i + 1400);
    expect(block).toMatch(/Voice summary could not be generated/);
    expect(block).toMatch(/E2E_COACHING_VOICE_NOTE_MS/);
    expect(block).not.toMatch(/Date\.now\(\) \+ 180000/);
  });
  test('the photo prompt\'s Yes is tapped with a short wait, not 60 s', () => {
    const i = src.indexOf('COA08 — the classroom-photo prompt, ACCEPT branch');
    const block = src.slice(i, i + 700);
    expect(block).not.toMatch(/tapAndWait\(yes, 60000\)/);
    expect(block).toMatch(/tapAndWait\(yes, \d{4}\)/);
  });
  test('the extension\'s verdicts reach rec() with their window', () => {
    expect(src).toMatch(/rec\(id, name, DEEP \? \(r \? r\[0\] : 'BLOCKED'\) : 'SKIP',[\s\S]{0,400}r\[2\]/);
  });
});

describe('coaching-ext — the photo prompt taps wait seconds, not the 60 s default (run 20261027-1040-par coaching#2: 8 × 60 s)', () => {
  const src = read('.claude/qa/shared/coaching-ext.cjs');
  test('Yes and Add another carry a short wait', () => {
    const i = src.indexOf("o.photo === 'yes' || o.photo === 'screenshot'");
    const block = src.slice(i, i + 900);
    expect(block).toMatch(/tapRow\(r, RX\.yes, \d{4}\)/);
    expect(block).toMatch(/tapRow\(p1, RX\.addAnother, \d{4}\)/);
    expect(block).not.toMatch(/tapRow\(r, RX\.yes\);/);
  });
});

describe('coaching-ext — every guarded block is timed so the dashboard can attribute the shards', () => {
  const src = read('.claude/qa/shared/coaching-ext.cjs');
  test('set() stores the window and guard() opens it', () => {
    expect(src).toMatch(/const set = \(id, verdict, ev\) => out\.set\(id, \[verdict, ev, \{/);
    expect(src).toMatch(/blockStart = t\(\)/);
  });
});

describe('feature-runner — rec() passes an explicit window end to the scenario span', () => {
  test('tracer.scenario receives t1 when the driver gives one', () => {
    const src = read('.claude/qa/shared/feature-runner.cjs');
    expect(src).toMatch(/const rec = \(id, name, verdict, evidence, ms, win\)/);
    expect(src).toMatch(/tracer\.scenario\(id, \{ verdict, ms, title: name, t1: win && win\.t1 \}\)/);
  });
});

describe('training-quiz-gen — the "a report must NOT arrive" windows are lane-tunable', () => {
  const src = read('.claude/qa/shared/training-quiz-gen.cjs');
  test('T77 and T78 read E2E_REPORT_ABSENCE_MS', () => {
    expect(src).toMatch(/E2E_REPORT_ABSENCE_MS/);
    const t77 = src.slice(src.indexOf('// T77 — asked twice'), src.indexOf("done('T77'"));
    expect(t77).not.toMatch(/> 90000/);
    expect(t77).toMatch(/ABSENCE_MS/);
    const t78 = src.slice(src.indexOf('// T78 — a scheduled run'), src.indexOf("done('T78'"));
    expect(t78).not.toMatch(/\(x\.doc \|\| x\.pdf\), 60000\)/);
    expect(t78).toMatch(/ABSENCE_MS/);
  });
  test('run-suite sets the lane values', () => {
    const rs = read('.claude/qa/shared/run-suite.sh');
    expect(rs).toMatch(/E2E_REPORT_ABSENCE_MS="\$\{E2E_REPORT_ABSENCE_MS:-12000\}"/);
    expect(rs).toMatch(/E2E_COACHING_VOICE_NOTE_MS="\$\{E2E_COACHING_VOICE_NOTE_MS:-60000\}"/);
  });
});
