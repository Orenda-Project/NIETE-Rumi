/**
 * scripts/tk-of.js — the teacher's keyed reference (tk) for a users.id, so someone reading the logs can find a
 * teacher's lines without the raw id ever being logged. It prints the value and nothing else, never the key.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'tk-of.js');
const KEY = 'unit-kid-key-not-a-secret-0123456789';
const ID = 'a0000000-0000-4000-8000-000000000001';

function run(args, env) {
  const base = { ...process.env };
  delete base.WEB_QUIZ_KID_KEY;
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...base, ...env }, timeout: 30000 });
}

describe('scripts/tk-of.js', () => {
  test('prints the same tk the logs carry, and only that', () => {
    process.env.WEB_QUIZ_KID_KEY = KEY;
    const { tk } = require('../../bot/shared/services/quiz/web-quiz-kid');
    const want = tk(ID);
    delete process.env.WEB_QUIZ_KID_KEY;

    const r = run([ID], { WEB_QUIZ_KID_KEY: KEY });
    expect(r.status).toBe(0);
    expect(want).toMatch(/^[0-9a-f]{16}$/);
    expect(r.stdout).toBe(`${want}\n`);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  test('no key (or a short one): nothing on stdout, exit 2', () => {
    for (const env of [{}, { WEB_QUIZ_KID_KEY: 'short' }]) {
      const r = run([ID], env);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/WEB_QUIZ_KID_KEY/);
    }
  });

  test('no id: the usage line, exit 1', () => {
    const r = run([], { WEB_QUIZ_KID_KEY: KEY });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/usage/i);
  });
});
