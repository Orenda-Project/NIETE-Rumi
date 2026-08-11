/**
 * bd-2529 — STEPS "S" Supervisor Remark: the /remark trigger gate.
 *
 * Mirrors the observe-gate shape (FEAT-053 bd-12): a pure, side-effect-free
 * decision helper so routing is unit-testable without the handler harness.
 *
 * Design decisions (operator, 2026-08-10):
 *  - /remark is PRINCIPAL-only. The observe LEADER_ROLES family is deliberately
 *    NOT reused: a coach/AEO evaluating a teacher for their ACR is a different
 *    authority than a coach running an observation. Only `principal` may remark.
 *  - The cycle is NEVER asked for. It is resolved server-side as "the cycle
 *    whose [starts_at, ends_at) contains now". No active cycle === no permission.
 *  - Hard stop at cycle close, mid-rubric included. Partial work stays in the
 *    table unsubmitted; it does NOT get a grace period.
 */
const {
  REMARK_TRIGGER_RX,
  REMARK_ROLES,
  isPrincipal,
  evaluateRemarkTrigger,
} = require('../../shared/services/remark/remark-gate');

const CYCLE = { id: 'c-1', name: 'Second Quarter 2026' };
const PRINCIPAL_USER = { id: 'u-p', role: 'principal' };

describe('bd-2529 — /remark trigger matching', () => {
  test('matches /remark as a command', () => {
    for (const m of ['/remark', '/Remark', '  /remark  ', '/remark ali']) {
      expect(REMARK_TRIGGER_RX.test(m.trim())).toBe(true);
    }
  });

  test('does NOT match a prefix collision or a bare mention', () => {
    for (const m of ['/remarks', '/remarked', 'remark', 'please /remark']) {
      expect(REMARK_TRIGGER_RX.test(m.trim())).toBe(false);
    }
  });

  test('a non-trigger message falls through untouched', () => {
    expect(evaluateRemarkTrigger({
      messageBody: 'hello', user: { role: 'principal' }, activeCycle: CYCLE,
    })).toEqual({ match: false });
  });
});

describe('bd-2529 — REMARK_ROLES is principal-only', () => {
  test('the family is exactly [principal]', () => {
    expect([...REMARK_ROLES]).toEqual(['principal']);
  });

  test('isPrincipal accepts principal and nothing else', () => {
    expect(isPrincipal({ role: 'principal' })).toBe(true);
    // The observe leader family must NOT leak in — a coach is not an evaluator.
    for (const r of ['coach', 'aeo', 'school_leader', 'supervisor',
                     'teacher', '', null, undefined]) {
      expect(isPrincipal({ role: r })).toBe(false);
    }
    expect(isPrincipal(null)).toBe(false);
  });
});

describe('bd-2531 — the gate defers to the CAPABILITY layer, not its own list', () => {
  const { evaluateRemarkTriggerAsync } = require('../../shared/services/remark/remark-gate');
  const { CAPABILITIES } = require('../../shared/services/authz/capability');

  test('it asks for remark.author, not for a role', async () => {
    const asked = [];
    const has = async (user, cap) => { asked.push(cap); return true; };
    await evaluateRemarkTriggerAsync(
      { messageBody: '/remark', user: PRINCIPAL_USER, activeCycle: CYCLE }, { hasCapability: has });
    expect(asked).toEqual([CAPABILITIES.REMARK_AUTHOR]);
  });

  test('capability granted + open cycle → proceed', async () => {
    const has = async () => true;
    await expect(evaluateRemarkTriggerAsync(
      { messageBody: '/remark', user: PRINCIPAL_USER, activeCycle: CYCLE }, { hasCapability: has }))
      .resolves.toEqual({ match: true, action: 'proceed', cycle: CYCLE });
  });

  test('capability denied → deny_role, even for role=principal', async () => {
    // The matrix is authoritative. If the grant row is pulled, a principal is
    // denied — that is the point of moving permission into data.
    const has = async () => false;
    await expect(evaluateRemarkTriggerAsync(
      { messageBody: '/remark', user: PRINCIPAL_USER, activeCycle: CYCLE }, { hasCapability: has }))
      .resolves.toEqual({ match: true, action: 'deny_role' });
  });

  test('a NON-principal granted the capability is allowed — no hardcoded role wins', async () => {
    // Grant remark.author to 'aeo' in the matrix and it works, with NO code
    // change. This is the test that proves the list is not load-bearing.
    const has = async () => true;
    await expect(evaluateRemarkTriggerAsync(
      { messageBody: '/remark', user: { id: 'u-a', role: 'aeo' }, activeCycle: CYCLE },
      { hasCapability: has }))
      .resolves.toEqual({ match: true, action: 'proceed', cycle: CYCLE });
  });

  test('capability is checked BEFORE the cycle — no window leak to the unauthorised', async () => {
    const has = async () => false;
    await expect(evaluateRemarkTriggerAsync(
      { messageBody: '/remark', user: { id: 'u-t', role: 'teacher' }, activeCycle: null },
      { hasCapability: has }))
      .resolves.toEqual({ match: true, action: 'deny_role' });
  });

  test('no user → deny_no_user without consulting the matrix', async () => {
    const asked = [];
    const has = async (u, c) => { asked.push(c); return true; };
    await expect(evaluateRemarkTriggerAsync(
      { messageBody: '/remark', user: null, activeCycle: CYCLE }, { hasCapability: has }))
      .resolves.toEqual({ match: true, action: 'deny_no_user' });
    expect(asked).toHaveLength(0);
  });

  test('a non-trigger message never consults the matrix', async () => {
    const asked = [];
    const has = async (u, c) => { asked.push(c); return true; };
    await expect(evaluateRemarkTriggerAsync(
      { messageBody: 'hello', user: PRINCIPAL_USER, activeCycle: CYCLE }, { hasCapability: has }))
      .resolves.toEqual({ match: false });
    expect(asked).toHaveLength(0);
  });
});

describe('bd-2529 — the two gates: role AND active cycle', () => {
  test('unknown sender is denied', () => {
    expect(evaluateRemarkTrigger({
      messageBody: '/remark', user: null, activeCycle: CYCLE,
    })).toEqual({ match: true, action: 'deny_no_user' });
  });

  test('a non-principal is denied on role', () => {
    expect(evaluateRemarkTrigger({
      messageBody: '/remark', user: { role: 'teacher' }, activeCycle: CYCLE,
    })).toEqual({ match: true, action: 'deny_role' });
  });

  test('role is checked BEFORE the cycle — a teacher never learns the window state', () => {
    expect(evaluateRemarkTrigger({
      messageBody: '/remark', user: { role: 'teacher' }, activeCycle: null,
    })).toEqual({ match: true, action: 'deny_role' });
  });

  test('a principal with NO active cycle is denied on the window', () => {
    expect(evaluateRemarkTrigger({
      messageBody: '/remark', user: { role: 'principal' }, activeCycle: null,
    })).toEqual({ match: true, action: 'deny_no_cycle' });
  });

  test('a principal inside an open cycle proceeds, carrying the resolved cycle', () => {
    expect(evaluateRemarkTrigger({
      messageBody: '/remark', user: { role: 'principal' }, activeCycle: CYCLE,
    })).toEqual({ match: true, action: 'proceed', cycle: CYCLE });
  });
});

describe('bd-2529 — resolveActiveCycle is half-open [starts_at, ends_at)', () => {
  const { resolveActiveCycle } = require('../../shared/services/remark/remark-gate');
  const cycles = [
    { id: 'q2', name: 'Second Quarter 2026',
      starts_at: '2026-04-01T00:00:00Z', ends_at: '2026-07-01T00:00:00Z' },
    { id: 'q3', name: 'Third Quarter 2026',
      starts_at: '2026-07-01T00:00:00Z', ends_at: '2026-10-01T00:00:00Z' },
  ];

  test('start is INCLUSIVE', () => {
    expect(resolveActiveCycle(cycles, new Date('2026-04-01T00:00:00Z')).id).toBe('q2');
  });

  test('end is EXCLUSIVE — so back-to-back cycles never both match', () => {
    // The instant q2 ends, q3 owns it. Exactly one cycle, no ambiguity.
    expect(resolveActiveCycle(cycles, new Date('2026-07-01T00:00:00Z')).id).toBe('q3');
  });

  test('before any cycle / after every cycle → null', () => {
    expect(resolveActiveCycle(cycles, new Date('2026-01-01T00:00:00Z'))).toBeNull();
    expect(resolveActiveCycle(cycles, new Date('2027-01-01T00:00:00Z'))).toBeNull();
  });

  test('an empty roster → null (no cycle configured is not an error)', () => {
    expect(resolveActiveCycle([], new Date('2026-05-01T00:00:00Z'))).toBeNull();
  });
});
