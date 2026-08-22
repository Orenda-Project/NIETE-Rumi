/**
 * No-undefined-FlowResponseHandler-methods conformance. (bd-2714)
 *
 * Sibling of no-undefined-whatsapp-methods.test.js, for the same bug class one
 * module over. A call to `FlowResponseHandler.<x>(...)` where `<x>` is not
 * exported throws `TypeError: FlowResponseHandler.<x> is not a function` the
 * first time that branch runs.
 *
 * Observed on NIETE staging 2026-08-14 08:01:40Z: a principal submitted a
 * teacher register, the write succeeded ("Teacher attendance saved", 3 present),
 * and then the Flow-completion webhook hit
 *
 *   FlowResponseHandler.handleAttendanceMarkingFlow is not a function
 *     at bot/whatsapp-bot.js:1337
 *
 * The 2026-08-10 attendance teardown (696fbd9) removed
 * handleAttendanceSetupFlow and handleAttendanceMarkingFlow but left both call
 * sites behind. The throw is swallowed by a catch whose user-visible error was
 * suppressed on 2026-07-13, so the teacher got NO confirmation at all while the
 * data saved silently. Live on main as well as develop.
 *
 * The completion branch is also the seam every future Flow hand-off travels
 * through (register -> "a teacher has left" -> /staff), so a dead call here
 * quietly disables more than it appears to.
 *
 * Scope is SOURCE only, matching the WhatsAppService guard: tests, __tests__,
 * __mocks__ legitimately reference stubs. Allowlist is empty by design — a real
 * undefined call is a bug to fix, not to record.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HANDLER = path.join(ROOT, 'bot/shared/handlers/flow-response.handler.js');
const SCAN_ROOT = path.join(ROOT, 'bot');

const SKIP_DIRS = new Set(['node_modules', '__tests__', '__mocks__', 'tests', 'coverage', '.git']);

// Empty by design.
const ALLOWLIST = new Set([]);

/** Names on `module.exports = { ... }` of the handler. */
function parseExports(src) {
  const block = src.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error('flow-response.handler.js: could not locate module.exports block');
  return new Set(
    block[1]
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .map((l) => l.replace(/,$/, ''))
      .map((l) => (l.includes(':') ? l.split(':')[0].trim() : l))
      .filter((l) => /^[A-Za-z_$][\w$]*$/.test(l)),
  );
}

function findSourceJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...findSourceJsFiles(path.join(dir, e.name)));
    } else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

describe('No undefined FlowResponseHandler methods', () => {
  const exported = parseExports(fs.readFileSync(HANDLER, 'utf8'));

  it('parses a plausible export set', () => {
    expect(exported.size).toBeGreaterThan(0);
    expect(exported.has('handleFlowResponse')).toBe(true);
  });

  it('every FlowResponseHandler.<method>( call site names a real export', () => {
    const offenders = [];

    findSourceJsFiles(SCAN_ROOT).forEach((file) => {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file);
      const lines = src.split('\n');

      lines.forEach((line, i) => {
        const re = /FlowResponseHandler\.(\w+)\s*\(/g;
        let m;
        while ((m = re.exec(line))) {
          const method = m[1];
          if (exported.has(method) || ALLOWLIST.has(method)) continue;
          offenders.push(`${rel}:${i + 1} -> FlowResponseHandler.${method}()`);
        }
      });
    });

    expect(offenders).toEqual([]);
  });
});
