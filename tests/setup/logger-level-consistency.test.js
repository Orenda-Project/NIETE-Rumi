/**
 * Logger-level consistency audit.
 *
 * Every `logToFile('❌ …', data, ?level)` callsite is a claim that the
 * condition is dashboard-worthy — an on-caller would want to see it. That
 * only holds if the call opts into `level: 'error'` (the 3rd positional
 * arg), so that the underlying `console.error` fires and Axiom aggregates
 * it under `level=error`.
 *
 * A `logToFile('❌ …')` without an explicit 'error' or 'warn' level defaults
 * to `console.log` (level=info in Axiom). Two failure modes follow:
 *
 *   1. Genuine bugs get buried in info-level noise — the dashboard filter
 *      `level == 'error'` finds nothing when the caller intended an alert.
 *   2. Recoverable degradations (missing optional asset, cache miss) that
 *      were only *decorated* with ❌ become alert-worthy in aggregate — the
 *      opposite mistake.
 *
 * The rule this test pins: **if the message starts with ❌, the call must
 * pass level='error' OR level='warn' as the third arg.** Existing violators
 * are snapshotted in `logger-level-consistency.allowlist.json`; anything
 * NEW must be fixed at author-time (either add the level or change the
 * emoji sentinel).
 *
 * Regenerate the allowlist with:
 *   node /tmp/gen-allowlist.js   (see git blame of this file for the script)
 * ...or delete an entry from the allowlist by fixing the callsite.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../bot');
const ALLOWLIST = require('./logger-level-consistency.allowlist.json');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      e.name === 'node_modules' ||
      e.name === '__mocks__' ||
      e.name === '__tests__' ||
      e.name === 'test' ||
      e.name === 'tests'
    ) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}

// Returns all logToFile('❌ …') callsites in the bot/ tree that do NOT pass
// a 'error' or 'warn' level as the third positional argument. Uses a
// bracket-depth parser so multi-line calls with nested object literals are
// handled correctly.
function scanViolations() {
  const violations = [];
  for (const f of walk(ROOT)) {
    const src = fs.readFileSync(f, 'utf8');
    const lines = src.split(/\r?\n/);
    const re = /logToFile\s*\(\s*(['"`])❌/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const startParen = src.indexOf('(', m.index);
      let depth = 0;
      let i = startParen;
      for (; i < src.length; i++) {
        const c = src[i];
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) break; }
      }
      if (depth !== 0) continue;
      const callSrc = src.slice(m.index, i + 1);

      let commas = 0;
      let d = 0;
      let thirdArgOk = false;
      for (let j = 0; j < callSrc.length; j++) {
        const c = callSrc[j];
        if (c === '(') d++;
        else if (c === ')') d--;
        else if (c === '{' || c === '[') d++;
        else if (c === '}' || c === ']') d--;
        else if (c === ',' && d === 1) {
          commas++;
          if (commas === 2) {
            const rest = callSrc.slice(j + 1).trim();
            if (/^['"`](error|warn)['"`]/.test(rest)) thirdArgOk = true;
            break;
          }
        }
      }
      if (thirdArgOk) continue;

      const lineNo = src.slice(0, m.index).split('\n').length;
      violations.push({
        file: path.relative(path.resolve(__dirname, '../..'), f),
        line: lineNo,
        snippet: (lines[lineNo - 1] || '').trim().slice(0, 100),
      });
    }
  }
  violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
  );
  return violations;
}

function key(v) { return `${v.file}:${v.line}`; }

describe('Logger level consistency (❌ messages must pass level=error|warn)', () => {
  const actual = scanViolations();
  const allowedSet = new Set(ALLOWLIST.map(key));

  it('no NEW callsite prints ❌ without opting into error/warn level', () => {
    const newOnes = actual
      .filter((v) => !allowedSet.has(key(v)))
      .map((v) => `${v.file}:${v.line}  ${v.snippet}`);
    expect(newOnes).toEqual([]);
  });

  it('every allowlist entry still exists (else clean it up)', () => {
    const actualSet = new Set(actual.map(key));
    const stale = ALLOWLIST
      .filter((a) => !actualSet.has(key(a)))
      .map((a) => `${a.file}:${a.line}`);
    expect(stale).toEqual([]);
  });
});
