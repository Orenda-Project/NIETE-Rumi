/**
 * A suite that replaces net.Socket.prototype.connect must put it back in an afterAll.
 *
 * `net` is a Node core module: Jest gives each test file its own module registry and its own globals, but every file
 * in one worker shares the SAME net.Socket.prototype. A connect guard left in place refuses the sockets of every suite
 * that runs after it in that worker, so a different set of unrelated suites goes red on each CI run, depending only on
 * which files Jest happened to put behind the guard (bd-ke5dtg: seam-goldens broke fx6-round4, fx7, fln-links-routes...).
 * global.fetch is not covered here: it lives on the per-file global, so a leftover fake dies with its file.
 */
const fs = require('fs');
const path = require('path');

const TESTS = path.resolve(__dirname, '..');
const PATCH_RE = /Socket\.prototype\.connect\s*=(?!=)/;
const RESTORE_RE = /afterAll\([\s\S]*?Socket\.prototype\.connect\s*=(?!=)/;

function testFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules') return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return testFiles(p);
    return /\.test\.[jt]s$/.test(e.name) ? [p] : [];
  });
}

/** A source that patches the connect prototype without an afterAll that assigns it again. */
function leaksConnectGuard(src) {
  return PATCH_RE.test(src) && !RESTORE_RE.test(src);
}

describe('a socket connect guard never outlives its suite', () => {
  test('the rule: a patch alone leaks; a patch with an afterAll restore does not; no patch is fine', () => {
    expect(leaksConnectGuard('net.Socket.prototype.connect = function g() {};')).toBe(true);
    expect(leaksConnectGuard('const real = net.Socket.prototype.connect;\nnet.Socket.prototype.connect = function g() {};\n'
      + 'afterAll(() => { net.Socket.prototype.connect = real; });')).toBe(false);
    expect(leaksConnectGuard('expect(net.Socket.prototype.connect === real).toBe(true);')).toBe(false);
  });

  test('no test file under tests/ leaves net.Socket.prototype.connect patched', () => {
    const self = path.resolve(__filename);
    const leaks = testFiles(TESTS)
      .filter((f) => f !== self && leaksConnectGuard(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(TESTS, f));
    expect(leaks).toEqual([]);
  });
});
