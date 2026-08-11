/**
 * bd-2531 — SOURCE GUARD: /remark is actually reachable.
 *
 * Every other piece of this feature can be perfect and the feature still do
 * NOTHING if the handler is never called. That was true for several commits:
 * gate, rubric, S_pct, capability, narrative and delivery all existed and
 * shipped zero user-visible behaviour because text-message.handler.js had no
 * branch for /remark.
 *
 * This is the "defined ≠ wired" check (CLAUDE.md Rule 16) as a test, so the
 * wiring cannot be silently removed by a later refactor.
 */
const fs = require('fs');
const path = require('path');

const HANDLER = path.join(__dirname, '../../shared/handlers/text-message.handler.js');
const src = fs.readFileSync(HANDLER, 'utf8');

describe('bd-2531 — the /remark branch exists in the text handler', () => {
  test('text-message.handler.js tests for /remark', () => {
    expect(src).toMatch(/\/\^\\\/remark\\b\/i|\/remark\\b/);
  });

  test('it requires and calls the remark command handler', () => {
    expect(src).toContain("require('./remark-command.handler')");
    expect(src).toMatch(/handleRemarkCommand\s*\(/);
  });

  test('it RETURNS when handled — no double-processing into normal chat', () => {
    const branch = src.slice(src.indexOf('handleRemarkCommand'));
    expect(branch.slice(0, 300)).toMatch(/if\s*\(\s*remarkHandled\s*\)\s*return/);
  });

  test('the referenced handler module actually exists and exports the function', () => {
    // A branch requiring a file that does not exist throws at runtime for a
    // real principal — and the source-scan above would still pass.
    const mod = require('../../shared/handlers/remark-command.handler');
    expect(typeof mod.handleRemarkCommand).toBe('function');
  });

  test('the trigger regex in the handler matches the branch condition', () => {
    // If the branch says /remark but the gate matches something else, the
    // handler returns false and the message falls through to chat forever.
    const { REMARK_TRIGGER_RX } = require('../../shared/services/remark/remark-gate');
    expect(REMARK_TRIGGER_RX.test('/remark')).toBe(true);
    expect(REMARK_TRIGGER_RX.test('/remarks')).toBe(false);
  });
});

describe('bd-2531 — the remark modules wire to each other', () => {
  test('every remark service loads without env vars (lazy supabase)', () => {
    // config/supabase calls process.exit(78) when unconfigured. Any module that
    // requires it at load time kills the test runner AND any tooling that
    // imports it — this trap bit three times while building this feature.
    for (const m of ['remark-gate', 'remark-rubric', 'remark-narrative.service',
                     'remark-delivery.service', 'remark-cycle.repository']) {
      expect(() => require(`../../shared/services/remark/${m}`)).not.toThrow();
    }
  });

  test('the handler resolves its default dependencies', () => {
    // The handler defaults deps to real modules. If a path is wrong, the
    // failure only shows for a live principal — assert the modules resolve.
    expect(() => require('../../shared/services/remark/remark-cycle.repository')).not.toThrow();
    expect(() => require('../../shared/services/authz/capability')).not.toThrow();
  });
});
