/**
 * Logger-level consistency ratchet.
 *
 * Every `logToFile('❌ …', data, ?level)` callsite is a claim that the
 * condition is dashboard-worthy — an on-caller would want to see it. That only
 * holds if the call opts into `level: 'error'` (the 3rd positional arg), so the
 * underlying `console.error` fires and Axiom aggregates it under `level=error`.
 *
 * A `logToFile('❌ …')` without an explicit 'error' or 'warn' defaults to
 * `console.log` (level=info in Axiom). Two failure modes follow:
 *
 *   1. Genuine bugs get buried in info-level noise — the dashboard filter
 *      `level == 'error'` finds nothing when the caller intended an alert.
 *   2. Recoverable degradations (missing optional asset, cache miss) that were
 *      only *decorated* with ❌ become alert-worthy in aggregate — the opposite
 *      mistake.
 *
 * The rule this pins: **if the message starts with ❌, the call must pass
 * level='error' OR level='warn' as the third argument.** Existing violators are
 * grandfathered in `logger-level-consistency.allowlist.json`; anything NEW must
 * be fixed at author-time (add the level, or drop the ❌ sentinel).
 *
 * Re-baseline / inspect the allowlist with the committed generator:
 *   node tests/setup/gen-logger-allowlist.js           # show drift
 *   node tests/setup/gen-logger-allowlist.js --write   # re-baseline
 *
 * Scanning and key derivation live in `logger-level-lib.js`, shared with that
 * generator and covered by `logger-level-lib.test.js`. Entries are keyed on
 * file + snippet + occurrence, never on line number. The reason, in short: the
 * old `file:line` key made every unrelated line shift look like a brand-new
 * violation, so this gate sat permanently red and stopped meaning anything.
 * See that file's header for the full rationale.
 */

const path = require('path');

const ALLOWLIST = require('./logger-level-consistency.allowlist.json');
const { scanViolations, diffAgainstAllowlist, findSeverityInData } = require('./logger-level-lib');

const REPO_ROOT = path.resolve(__dirname, '../..');

describe('Logger level consistency (❌ messages must pass level=error|warn)', () => {
  const live = scanViolations(path.join(REPO_ROOT, 'bot'), { relativeTo: REPO_ROOT });
  const { newOnes, stale } = diffAgainstAllowlist(live, ALLOWLIST);

  it('no NEW callsite prints ❌ without opting into error/warn level', () => {
    // Formatted as strings so a failure names the file:line to go fix.
    expect(newOnes.map((v) => `${v.file}:${v.line}  ${v.snippet}`)).toEqual([]);
  });

  it('every allowlist entry still exists (else clean it up)', () => {
    expect(stale.map((a) => `${a.file}:${a.line ?? '?'}  ${a.snippet}`)).toEqual([]);
  });

  it('no call passes severity as a `level` key in its data object', () => {
    // `logToFile(msg, { level: 'error' })` does NOT set severity — the level is
    // the THIRD positional argument. Worse, `level` is a reserved pino/base
    // field, so the emitted line carries two "level" keys and which one a
    // consumer honours is parser-dependent (JSON.parse keeps the last, a
    // first-wins parser keeps pino's `info`). The log is therefore neither
    // reliably `error` nor cleanly `info`.
    //
    // No allowlist here, deliberately: the author typed a severity, so the
    // intent is unambiguous and the placement is simply wrong. Contrast the
    // assertions above, where "is this failure terminal?" is a judgement call
    // worth grandfathering.
    //
    // Note this catches cases the ❌ ratchet above cannot see at all — most of
    // these messages open with ⚠️ or 🈯, not ❌.
    const misplaced = findSeverityInData(path.join(REPO_ROOT, 'bot'), { relativeTo: REPO_ROOT });
    expect(misplaced.map((v) => `${v.file}:${v.line}  level: '${v.severity}'  ${v.snippet}`)).toEqual([]);
  });

  it('the grandfathered backlog never grows', () => {
    // Belt-and-braces on top of the two assertions above: even if a future edit
    // swaps one violation for another, the total cannot creep upward.
    expect(live.length).toBeLessThanOrEqual(ALLOWLIST.length);
  });
});
