/**
 * scripts/ci/require-resolution.js — every local require/import in the deployed code (bot/, dashboard/)
 * resolves to a file COMMITTED on the branch being checked. `--ref <branch>` checks a branch without
 * checking it out, so staging and main can be checked from any clone.
 *
 * Why: a cherry-pick that carried a caller without its dependency left
 * `require('../coaching/ack-reaction')` on staging and main and `require('../../observe/transcript-quality')`
 * on main. The reachability guard (tests/setup/unresolved-requires.test.js) was already red in the
 * baseline snapshot, so a new miss did not fail CI.
 *
 * Each test builds a throwaway git repo, so the suite needs no bot/ deps.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'require-resolution.js');
const ALLOWLIST = 'tests/setup/unresolved-requires.allowlist.json';
// Fixture source is built with req(): tests/setup/unresolved-requires reads this file with a regex and would
// otherwise take the fixtures' requires for this file's own.
const req = (spec) => `${'require'}('${spec}')`;

const made = [];
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A git repo whose first commit holds `files` ({ path: content }). */
function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'require-resolution-'));
  made.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'test');
  commit(dir, files, 'first');
  return dir;
}

function commit(dir, files, msg) {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    if (body === null) { git(dir, 'rm', '-q', rel); continue; }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
    git(dir, 'add', rel);
  }
  git(dir, 'commit', '-q', '-m', msg);
}

function run(dir, ...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', timeout: 60000 });
}

describe('scripts/ci/require-resolution.js', () => {
  test('passes when every local require resolves: file, .js, .json, dir/index.js, dir/package.json main', () => {
    const dir = repo({
      'bot/a.js': [
        `const b = ${req('./b')};`,
        `const data = ${req('./data.json')};`,
        `const lib = ${req('./lib')};`,
        `const pkg = ${req('./pkg')};`,
        `const fs = ${req('fs')};`,
        `const express = ${req('express')};`,
      ].join('\n'),
      'bot/b.js': 'module.exports = 1;',
      'bot/data.json': '{}',
      'bot/lib/index.js': 'module.exports = 2;',
      'bot/pkg/package.json': '{"main":"main.js"}',
      'bot/pkg/main.js': 'module.exports = 3;',
    });
    const r = run(dir);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('0 unresolved');
    expect(r.status).toBe(0);
  });

  test('fails on a require whose file is missing, naming the file, the line and the request', () => {
    const dir = repo({
      'bot/a.js': `const x = 1;\nconst ack = () => ${req('../coaching/ack-reaction')};\n`,
      'dashboard/routes/r.js': `${req('./present')};\n`,
      'dashboard/routes/present.js': '',
    });
    const r = run(dir);
    expect(r.stdout).toContain(`bot/a.js:2 ${req('../coaching/ack-reaction')}`);
    expect(r.stdout).toContain('1 unresolved');
    expect(r.status).toBe(1);
  });

  test('a file on disk that is not committed does not count: it is not in the deploy', () => {
    const dir = repo({ 'bot/a.js': `${req('./later')};\n` });
    fs.writeFileSync(path.join(dir, 'bot/later.js'), 'module.exports = 1;');
    const r = run(dir);
    expect(r.stdout).toContain(`bot/a.js:1 ${req('./later')}`);
    expect(r.status).toBe(1);
  });

  test('--ref checks a committed branch, not the working tree', () => {
    const dir = repo({ 'bot/a.js': `${req('./b')};\n`, 'bot/b.js': '' });
    git(dir, 'branch', 'good');
    commit(dir, { 'bot/b.js': null }, 'drop b');
    expect(run(dir, '--ref', 'good').status).toBe(0);
    const bad = run(dir, '--ref', 'HEAD');
    expect(bad.stdout).toContain(`bot/a.js:1 ${req('./b')}`);
    expect(bad.status).toBe(1);
  });

  test('requires inside comments and strings are not requires; a glob string does not hide a real one', () => {
    const dir = repo({
      'bot/a.js': [
        `// ${req('./gone-line')}`,
        `/* ${req('./gone-block')} */`,
        "const s = \"require('./gone-string')\";",
        "const glob = 'src/**/*.js';",
        "const re = /['\"]/g;",
        "const url = 'http://example.invalid/x';",
        `${req('./really-missing')};`,
      ].join('\n'),
    });
    const r = run(dir);
    expect(r.stdout).not.toContain('gone-');
    expect(r.stdout).toContain(`bot/a.js:7 ${req('./really-missing')}`);
    expect(r.stdout).toContain('1 unresolved');
    expect(r.status).toBe(1);
  });

  test('import, export-from, dynamic import() and require.resolve are checked; an interpolated path is not', () => {
    const dir = repo({
      'bot/a.mjs': [
        "import x from './m1';",
        "export { y } from './m2';",
        "const z = await import('./m3');",
        "const p = require.resolve('./m4');",
        "const t = require(`./m5`);",
        // eslint-disable-next-line no-template-curly-in-string
        'const d = require(`./handlers/${name}`);',
      ].join('\n'),
    });
    const r = run(dir);
    for (const m of ['m1', 'm2', 'm3', 'm4', 'm5']) expect(r.stdout).toContain(`./${m}`);
    expect(r.stdout).not.toContain('./handlers/');
    expect(r.stdout).toContain('5 unresolved');
  });

  test('only the deployed code is scanned: tests/, scripts/, node_modules/ and test files under bot/ are not', () => {
    const dir = repo({
      'tests/a.test.js': `${req('./nope')};\n`,
      'scripts/x.js': `${req('./nope')};\n`,
      'bot/node_modules/pkg/index.js': `${req('./nope')};\n`,
      'bot/tests/quiz/x.test.js': `${req('./nope')};\n`,
      'bot/__tests__/y.js': `${req('./nope')};\n`,
      'dashboard/services/z.spec.js': `${req('./nope')};\n`,
      'dashboard/tests/helper.js': `${req('./nope')};\n`,
      'bot/ok.js': '',
    });
    const r = run(dir);
    expect(r.stdout).toContain('0 unresolved');
    expect(r.status).toBe(0);
  });

  test('an allowlisted optional require is reported as optional and does not fail; the branch\'s own list is read', () => {
    const entry = [{ from: 'bot/a.js', spec: './optional', reason: 'guarded by try/catch; falls back to text' }];
    const dir = repo({ 'bot/a.js': `try { ${req('./optional')}; } catch (e) {}\n`, [ALLOWLIST]: '[]' });
    git(dir, 'branch', 'without-entry');
    commit(dir, { [ALLOWLIST]: JSON.stringify(entry) }, 'allow it');
    const ok = run(dir, '--ref', 'HEAD');
    expect(ok.stdout).toContain('optional (allowlisted): bot/a.js:1');
    expect(ok.stdout).toContain('0 unresolved');
    expect(ok.status).toBe(0);
    expect(run(dir, '--ref', 'without-entry').status).toBe(1);
  });

  test('a relative path into node_modules is an installed package, not a committed file', () => {
    const dir = repo({ 'dashboard/a.js': `const { JSDOM } = ${req('../portal/node_modules/jsdom')};\n` });
    const r = run(dir);
    expect(r.stdout).toContain('0 unresolved');
    expect(r.status).toBe(0);
  });

  test('a require marked `// optional-require: <why>` on its own line is optional on every branch; an unmarked one is not', () => {
    const dir = repo({
      'bot/a.js': [
        `const _deps = { loadAck: () => ${req('./ack')} }; // optional-require: the caller catches MODULE_NOT_FOUND and sends a text`,
        `const b = ${req('./b')}; // a plain comment is not a marker`,
      ].join('\n'),
    });
    const r = run(dir);
    expect(r.stdout).toContain(`optional (marked): bot/a.js:1 ${req('./ack')} — the caller catches MODULE_NOT_FOUND and sends a text`);
    expect(r.stdout).toContain(`✗ bot/a.js:2 ${req('./b')}`);
    expect(r.stdout).toContain('1 unresolved, 1 optional');
    expect(r.status).toBe(1);
  });

  test('--json prints the findings as data', () => {
    const dir = repo({ 'bot/a.js': `\n${req('./missing')};\n` });
    const r = run(dir, '--json');
    const out = JSON.parse(r.stdout);
    expect(out.unresolved).toEqual([{ from: 'bot/a.js', line: 2, spec: './missing' }]);
    expect(out.optional).toEqual([]);
    expect(r.status).toBe(1);
  });
});
