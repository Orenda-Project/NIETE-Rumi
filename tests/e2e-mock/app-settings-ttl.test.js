/**
 * One lane-tunable TTL for every app_settings switch cache the mock-lane drivers flip (bd-0vaqcg).
 *
 * The harness sleeps 31 s after every setAppSetting/restoreAppSettings because the bot caches the switches
 * for 30 s — 18 times in run 20261026-1616-par, 558 s, the largest harness wait left. Only
 * app-redirect.service.js read APP_SETTINGS_FLAG_TTL_MS; the six quiz modules that cache the two switches
 * training flips (web_quiz_hub, web_quiz_child_quiz_home) kept their own `30 * 1000`, which is why a
 * 1.5 s settle broke T695 once. They all read the one value now; production default unchanged.
 *
 * Red-first: fails on the branch — the helper does not exist and the six modules hard-code 30 s.
 */
const { describeWithEngine, testWithEngine, HAVE_ENGINE } = require('./engine');   // the shared engine, borrowed (bd-9157r.1)
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const MODULES = [
  'bot/shared/services/app-redirect.service.js',
  'bot/shared/services/quiz/story-teacher.service.js',
  'bot/shared/services/quiz/web-quiz-hub-flags.js',
  'bot/shared/services/quiz/web-quiz-book.js',
  'bot/shared/services/quiz/web-quiz-card.js',
  'bot/shared/services/quiz/web-quiz-class-round-flags.js',
  'bot/shared/services/quiz/web-quiz-hub-play.js',
];

describe('bot/shared/config/app-settings-ttl.js', () => {
  const fresh = (env) => { jest.resetModules(); delete process.env.APP_SETTINGS_FLAG_TTL_MS; Object.assign(process.env, env); return require('../../bot/shared/config/app-settings-ttl'); };
  test('unset → 30 s', () => { expect(fresh({}).APP_SETTINGS_FLAG_TTL_MS).toBe(30000); });
  test('a whole number of ms up to an hour is honoured (1000 on the lane)', () => { expect(fresh({ APP_SETTINGS_FLAG_TTL_MS: '1000' }).APP_SETTINGS_FLAG_TTL_MS).toBe(1000); });
  test('anything else keeps 30 s', () => {
    for (const v of ['soon', '0', '-5', '3600001', '1.5']) expect(fresh({ APP_SETTINGS_FLAG_TTL_MS: v }).APP_SETTINGS_FLAG_TTL_MS).toBe(30000);
  });
});

describe('every switch cache the drivers flip reads it', () => {
  for (const m of MODULES) {
    test(`${path.basename(m)} requires the helper and keeps no 30 s TTL of its own`, () => {
      const src = fs.readFileSync(path.join(REPO, m), 'utf8');
      expect(src).toMatch(/require\('(\.\.\/)+config\/app-settings-ttl'\)/);
      expect(src).not.toMatch(/^const (FLAG_)?TTL_MS = 30 \* 1000;/m);
    });
  }
});

describe('the lane uses it', () => {
  test('local-stack composes APP_SETTINGS_FLAG_TTL_MS=1000', () => {
    expect(fs.readFileSync(path.join(REPO, 'bot/scripts/e2e/local-stack.sh'), 'utf8')).toMatch(/echo "APP_SETTINGS_FLAG_TTL_MS=\$\{E2E_APP_SETTINGS_FLAG_TTL_MS:-1000\}"/);
  });
  testWithEngine('run-suite settles 1.5 s after a flip on the mock lane', () => {
    expect(fs.readFileSync(path.join(REPO, '.claude/qa/engine/bin/run-suite.sh'), 'utf8')).toMatch(/E2E_APP_SETTING_SETTLE_MS="\$\{E2E_APP_SETTING_SETTLE_MS:-1500\}"/);
  });
});
