/**
 * No `{ virtual: true }` mock of a module that exists in the tree.
 *
 * A virtual mock registers under the path as written (no extension), while a real file resolves to `<path>.js`.
 * Jest's resolver caches module ids per worker across test files, so when another file in the same worker loaded the
 * real module first, the "mocked" suite gets the real one: red or green by file order, invisible when run alone, and
 * blamed on whichever PR happens to change the order. A virtual mock is only for a module the repo does not have.
 *
 * Scans every `jest.mock(<relative path>, …, { virtual: true })` under bot/tests, dashboard/tests and tests, resolves
 * the path against the test file, and fails when `<path>`, `<path>.js`, `<path>.json` or `<path>/index.js` exists.
 * The suites that held such mocks before this gate are in virtual-mock-of-existing-module.allowlist.json as hit counts
 * per DIRECTORY (so the list names no test file); it only shrinks: a new directory or a higher count fails; a lower
 * count, or a listed directory not in the tree, prints a DOWN:/CLEAN:/GONE: warning and passes (the entry is lowered
 * on the branch that owns the list).
 *
 * `jest.doMock(<relative path>, …, { virtual: true })` is the same hazard inside a test body, so it is scanned too
 * (the spec a literal, or a const string the file binds, e.g. `jest.doMock(ID_FLAGS, …)`), with one exception:
 * `sharp`, the optional native package a suite may fake whether or not it is installed. The doMock hits are counted
 * apart, in the allowlist's `doMock` section (same per-directory, shrink-only rule), so the jest.mock counts above
 * did not move when the scan grew.
 */
const fs = require('fs');
const path = require('path');
const { doMock: ALLOW_DO_MOCK = {}, ...ALLOW } = require('./virtual-mock-of-existing-module.allowlist.json');
const { virtualDoMocksOfExisting, testFiles, byDir } = require('./test-seam-gates-lib');
const { countVerdict, report } = require('./ratchet-verdict-lib');

const REPO = path.resolve(__dirname, '../..');
const ROOTS = ['bot/tests', 'dashboard/tests', 'tests'];

/** Each `jest.mock('<spec>', …)` call in a source text: { spec, call } (the call's full text, parentheses balanced). */
function mockCalls(text) {
  const out = [];
  const rx = /jest\.mock\(\s*(['"])([^'"]+)\1/g;
  for (let m = rx.exec(text); m; m = rx.exec(text)) {
    let depth = 0;
    let i = m.index + 'jest.mock'.length;
    for (; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    out.push({ spec: m[2], call: text.slice(m.index, i + 1) });
  }
  return out;
}

const isVirtual = (call) => /\{\s*virtual\s*:\s*true\s*\}\s*\)$/.test(call);
const exists = (p) => ['', '.js', '.json', `${path.sep}index.js`].some((ext) => fs.existsSync(p + ext));

/** The virtual mocks in one test file whose relative target exists: [spec]. */
function virtualOfExisting(file, text, existsFn = exists) {
  return mockCalls(text)
    .filter((c) => c.spec.startsWith('.') && isVirtual(c.call))
    .filter((c) => existsFn(path.resolve(path.dirname(file), c.spec)))
    .map((c) => c.spec);
}

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(test|spec)\.js$/.test(e.name) || (e.name.endsWith('.js') && full.includes(`${path.sep}__tests__${path.sep}`))) out.push(full);
  }
  return out;
}

/** { 'repo/relative/dir': hits } over the roots. */
function scan() {
  const byDir = {};
  for (const root of ROOTS) {
    for (const file of walk(path.join(REPO, root))) {
      const n = virtualOfExisting(file, fs.readFileSync(file, 'utf8')).length;
      if (!n) continue;
      const dir = path.relative(REPO, path.dirname(file)).split(path.sep).join('/');
      byDir[dir] = (byDir[dir] || 0) + n;
    }
  }
  return byDir;
}

const dirExists = (dir) => fs.existsSync(path.join(REPO, dir));

/** The shrink-only verdict: { failures (new, up), warnings (down, clean, gone) }. */
function problems(hits, allow, exists = dirExists, what = 'virtual mock(s) of a module that exists. Drop { virtual: true }') {
  return countVerdict(hits, allow, { what, list: 'virtual-mock-of-existing-module.allowlist.json', exists });
}

describe('the rule, on in-memory sources', () => {
  const FILE = path.join(REPO, 'bot/tests/quiz/x.test.js');
  const here = (set) => (p) => set.has(path.relative(REPO, p).split(path.sep).join('/'));

  test('a virtual mock of an existing relative module is a hit; of a missing one, or of a package, is not', () => {
    const src = [
      "jest.mock('../../shared/a', () => ({ f: jest.fn() }), { virtual: true });",
      "jest.mock('../../shared/gone', () => ({}), { virtual: true });",
      "jest.mock('some-package', () => ({}), { virtual: true });",
    ].join('\n');
    expect(virtualOfExisting(FILE, src, here(new Set(['bot/shared/a'])))).toEqual(['../../shared/a']);
  });

  test('a plain mock is never a hit; a factory with parentheses and nested objects is read whole', () => {
    const src = [
      "jest.mock('../../shared/a', () => ({ f: jest.fn(() => ({ g: (1) })) }));",
      "jest.mock('../../shared/b', () => {\n  if (global.x) throw new Error('x (y)');\n  return { h: () => ({}) };\n}, { virtual: true });",
    ].join('\n');
    expect(virtualOfExisting(FILE, src, here(new Set(['bot/shared/a', 'bot/shared/b'])))).toEqual(['../../shared/b']);
  });

  test('the shrink-only check: new and up fail; equal passes', () => {
    expect(problems({ a: 1 }, { a: 1 })).toEqual({ failures: [], warnings: [] });
    expect(problems({ b: 1 }, {}).failures[0]).toMatch(/^NEW: b/);
    expect(problems({ a: 2 }, { a: 1 }).failures[0]).toMatch(/^UP: a/);
  });

  test('below the list, at 0, or absent from the tree: a warning, and the gate passes', () => {
    expect(problems({ a: 1 }, { a: 2 }, () => true)).toEqual({ failures: [], warnings: [expect.stringMatching(/^DOWN: a .* Lower it to 1/)] });
    expect(problems({}, { a: 2 }, () => true)).toEqual({ failures: [], warnings: [expect.stringMatching(/^CLEAN: a/)] });
    expect(problems({}, { gone: 2 }, () => false)).toEqual({ failures: [], warnings: [expect.stringMatching(/^GONE: gone is not in this tree/)] });
  });

  test('a seeded tree: below and absent pass, above and new fail', () => {
    const v = problems({ below: 1, above: 3, fresh: 2 }, { below: 2, above: 1, absent: 4 }, (d) => d !== 'absent');
    expect(v.failures.map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['UP: above', 'NEW: fresh']);
    expect(v.warnings.map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['GONE: absent', 'DOWN: below']);
  });
});

describe('jest.doMock, on in-memory sources', () => {
  const FILE = path.join(REPO, 'bot/tests/quiz/x.test.js');
  const here = (set) => (p) => set.has(path.relative(REPO, p).split(path.sep).join('/'));

  test('a virtual doMock of an existing relative module is a hit, by literal or by a const spec', () => {
    const src = [
      "const FLAGS = '../../shared/flags';",
      "jest.doMock('../../shared/a', () => ({}), { virtual: true });",
      "test('x', () => { jest.doMock(FLAGS, () => { throw new Error('gone (x)'); }, { virtual: true }); });",
      "jest.doMock('../../shared/gone', () => ({}), { virtual: true });",
      "jest.doMock('../../shared/a', () => ({}));",
      "jest.doMock('../../shared/a', () => ({}), { virtual: false });",
    ].join('\n');
    expect(virtualDoMocksOfExisting(FILE, src, here(new Set(['bot/shared/a', 'bot/shared/flags'])))).toEqual(['../../shared/a', '../../shared/flags']);
  });

  test('sharp is the one allowed virtual doMock; a package or a commented-out call is never a hit', () => {
    const src = [
      "jest.doMock('sharp', () => { throw new Error('x'); }, installed ? undefined : { virtual: true });",
      "jest.doMock('bcryptjs', () => ({}), { virtual: true });",
      "// jest.doMock('../../shared/a', () => ({}), { virtual: true });",
    ].join('\n');
    expect(virtualDoMocksOfExisting(FILE, src, () => true)).toEqual([]);
  });
});

const scanDoMock = () => byDir(testFiles(ROOTS).map((file) => ({ file, n: virtualDoMocksOfExisting(file, fs.readFileSync(file, 'utf8')).length })));

describe('the tree', () => {
  test('no new virtual mock of a module that exists; no directory above its entry (below or gone: a warning)', () => {
    expect(report(problems(scan(), ALLOW))).toEqual([]);
  });

  test('no new virtual doMock of a module that exists; no directory above its doMock entry', () => {
    expect(report(problems(scanDoMock(), ALLOW_DO_MOCK, dirExists, 'virtual jest.doMock(s) of a module that exists. Drop { virtual: true }'))).toEqual([]);
  });
});
