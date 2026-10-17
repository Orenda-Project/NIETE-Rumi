/**
 * `node tests/run.js <args>` hands every argument to jest exactly as it was given: a path with a space stays one
 * argument, a quoted test name stays one argument, and nothing is read by a shell (a `|` in a pattern is not a pipe).
 * Once the runner joined its arguments into one shell string, so `--outputFile=<a path with a space>` split in two,
 * jest wrote its report to the first half of the path and read the rest as a test pattern.
 *
 * The runner is copied into a temp folder next to a stand-in jest (node_modules/.bin/jest) that records the
 * arguments and environment it was given; no real jest runs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER = path.resolve(__dirname, '..', 'run.js');

const FAKE_JEST = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith('--outputFile='));
if (out) fs.writeFileSync(out.slice('--outputFile='.length), JSON.stringify({ args, nodeOptions: process.env.NODE_OPTIONS || '' }));
process.exit(Number(process.env.FAKE_JEST_EXIT || 0));
`;

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-js-args-'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.copyFileSync(RUNNER, path.join(dir, 'tests', 'run.js'));
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  const jest = path.join(dir, 'node_modules', '.bin', 'jest');
  fs.writeFileSync(jest, FAKE_JEST);
  fs.chmodSync(jest, 0o755);
  fs.mkdirSync(path.join(dir, 'with space'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = (args, env = {}) => spawnSync(process.execPath, [path.join(dir, 'tests', 'run.js'), ...args], {
  cwd: dir, encoding: 'utf8', env: { ...process.env, ...env },
});

describe('tests/run.js passes its arguments through unchanged', () => {
  test('a path with a space stays one arg: the report lands at that exact path, nothing at the split', () => {
    const out = path.join(dir, 'with space', 'report.json');
    const r = run(['--json', `--outputFile=${out}`]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'with'))).toBe(false);
    const { args } = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(args).toEqual(['--config', 'tests/jest.config.js', '--json', `--outputFile=${out}`]);
  });

  test('a quoted test name stays one arg, and a | in a pattern is not a shell pipe', () => {
    const out = path.join(dir, 'with space', 'r.json');
    const r = run(['--testPathPattern=a|b', '-t', 'vendored-skill exemption', `--outputFile=${out}`]);
    expect(r.status).toBe(0);
    const { args } = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(args.slice(2)).toEqual(['--testPathPattern=a|b', '-t', 'vendored-skill exemption', `--outputFile=${out}`]);
  });

  test('jest\'s exit code is the runner\'s exit code', () => {
    expect(run(['--outputFile=' + path.join(dir, 'x.json')], { FAKE_JEST_EXIT: '3' }).status).toBe(3);
  });

  test('the Node flag jest needs is still added to NODE_OPTIONS, after any the caller set', () => {
    const out = path.join(dir, 'n.json');
    run([`--outputFile=${out}`], { NODE_OPTIONS: '--max-old-space-size=2048' });
    const { nodeOptions } = JSON.parse(fs.readFileSync(out, 'utf8'));
    const major = parseInt(process.versions.node.split('.')[0], 10);
    const flag = major >= 25 ? '--no-experimental-webstorage' : major >= 22 ? '--localstorage-file=/tmp/jest-ls' : '';
    expect(nodeOptions).toBe(['--max-old-space-size=2048', flag].filter(Boolean).join(' '));
  });
});
