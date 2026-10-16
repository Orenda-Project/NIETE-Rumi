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
 * per DIRECTORY (so the list names no test file); it only shrinks: a new directory or a higher count fails, and a
 * lower count fails until the entry is lowered (or removed at 0).
 */
const fs = require('fs');
const path = require('path');
const ALLOW = require('./virtual-mock-of-existing-module.allowlist.json');

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

function problems(hits, allow) {
  const out = [];
  for (const dir of [...new Set([...Object.keys(hits), ...Object.keys(allow)])].sort()) {
    const now = hits[dir] || 0;
    const ok = Object.prototype.hasOwnProperty.call(allow, dir) ? allow[dir] : null;
    if (ok === null) out.push(`NEW: ${dir} has ${now} virtual mock(s) of a module that exists. Drop { virtual: true }.`);
    else if (now > ok) out.push(`UP: ${dir} has ${now}, the allowlist allows ${ok}. Drop { virtual: true } on the new one.`);
    else if (now < ok) out.push(now === 0 ? `CLEAN: ${dir} has none now. Remove its entry from the allowlist.` : `DOWN: ${dir} has ${now}, the allowlist says ${ok}. Lower it to ${now}.`);
  }
  return out;
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

  test('the shrink-only check: new, up, down and clean all fail; equal passes', () => {
    expect(problems({ a: 1 }, { a: 1 })).toEqual([]);
    expect(problems({ b: 1 }, {})[0]).toMatch(/^NEW: b/);
    expect(problems({ a: 2 }, { a: 1 })[0]).toMatch(/^UP: a/);
    expect(problems({ a: 1 }, { a: 2 })[0]).toMatch(/^DOWN: a .* Lower it to 1/);
    expect(problems({}, { a: 2 })[0]).toMatch(/^CLEAN: a/);
  });
});

describe('the tree', () => {
  test('no new virtual mock of a module that exists; the allowlist matches today exactly', () => {
    expect(problems(scan(), ALLOW)).toEqual([]);
  });
});
