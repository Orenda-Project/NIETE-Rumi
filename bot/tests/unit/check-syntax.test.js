'use strict';
/**
 * bd-wpx18 — the guard is itself guarded.
 *
 * A checker that silently stops catching things is worse than no checker: it
 * reads as cover and delivers none. These tests prove it FAILS on a malformed
 * file (including the exact shape that took staging down) and that it does so
 * without EXECUTING the file it inspects.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseFile, ENTRY_POINTS, main } = require('../../scripts/check-syntax');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-syntax-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = (name, src) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, src);
  return p;
};

describe('parseFile', () => {
  it('passes a well-formed CommonJS file', () => {
    const p = write('good.js', 'module.exports = function (a) { return a + 1; };\n');
    expect(parseFile(p)).toBeNull();
  });

  it('FAILS on a malformed file and reports the line', () => {
    const p = write('bad.js', [
      'function a() {',
      '  return 1;',
      '}',
      '}',                     // stray closing brace — line 4
      'module.exports = a;',   // ...but the error is reported HERE, line 5
    ].join('\n'));

    const bad = parseFile(p);
    expect(bad).not.toBeNull();
    expect(bad.message).toMatch(/Unexpected|Missing catch/i);
    // A stray brace is not reported where it sits — it closes the enclosing
    // block successfully, and the parser only objects at the NEXT token. That is
    // exactly why the real defect (a stray `}` on line 887 of whatsapp-bot.js)
    // was reported at line 938: the first stray brace was absorbed silently and
    // re-parented 50 lines of handlers, and only the second one raised. Read a
    // reported line number as "at or ABOVE here", never as the culprit itself.
    expect(bad.line).toBe(5);
  });

  it('FAILS on the exact defect that took staging down: a stray brace after an\n'
     + '     else-if branch, inside a try, reported as "Missing catch or finally"', () => {
    // This is bot/whatsapp-bot.js:938 (de980467 / PR #1008) reduced to its shape.
    const p = write('regression-de980467.js', [
      'async function webhook() {',
      '  try {',
      '    if (id.startsWith("a_")) {',
      '      await doA();',
      '    }',
      '    else if (id.startsWith("photo_done_")) {',
      '      await advance();',
      '    }',
      '    }',                 // <-- the stray brace
      '    else if (id.startsWith("photo_more_")) {',
      '      await more();',
      '    }',
      '  } catch (e) {',
      '    log(e);',
      '  }',
      '}',
    ].join('\n'));

    const bad = parseFile(p);
    expect(bad).not.toBeNull();
    expect(bad.message).toMatch(/Missing catch or finally after try/);
  });

  it('parses without EXECUTING the file (no side effects, no imports resolved)', () => {
    const marker = path.join(dir, 'MUST_NOT_EXIST');
    const p = write('sideeffect.js', [
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`,
      "require('a-module-that-does-not-exist');",
      'throw new Error("top-level throw");',
    ].join('\n'));

    expect(parseFile(p)).toBeNull();          // valid syntax
    expect(fs.existsSync(marker)).toBe(false); // but never ran
  });

  it('tolerates a shebang and a BOM while keeping line numbers honest', () => {
    const p = write('shebang.js', ['#!/usr/bin/env node', 'const a = 1;', 'a ===;'].join('\n'));
    const bad = parseFile(p);
    expect(bad).not.toBeNull();
    expect(bad.line).toBe(3);

    const ok = write('bom.js', '﻿' + 'module.exports = 1;\n');
    expect(parseFile(ok)).toBeNull();
  });
});

describe('main()', () => {
  it('exits non-zero on a malformed file passed via --files', () => {
    const bad = write('bad2.js', 'function x() { \n');
    expect(main(['--files', bad])).toBe(1);
  });

  it('exits zero on a well-formed file passed via --files', () => {
    const good = write('good2.js', 'module.exports = 1;\n');
    expect(main(['--files', good])).toBe(0);
  });
});

describe('entry points', () => {
  it('always covers the three files a Railway service executes', () => {
    // Dropping one of these from the list is how a --changed run would stop
    // protecting the file whose parse failure costs a deployment.
    expect(ENTRY_POINTS).toEqual(expect.arrayContaining([
      'bot/whatsapp-bot.js',
      'bot/workers/sqs-worker.js',
      'bot/workers/stale-session.worker.js',
    ]));
  });

  it('the real entry points parse (this is the staging-outage guard)', () => {
    const root = path.resolve(__dirname, '../../..');
    for (const rel of ENTRY_POINTS) {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) continue;
      expect(parseFile(abs)).toBeNull();
    }
  });
});
