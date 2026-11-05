/**
 * An audit row that the DATABASE rejects must not disappear in silence.
 *
 * THE BUG THIS ENCODES
 * The coach Edit flow shipped four new audit actions — edit_name, edit_level,
 * edit_phone and edit_phone_escalated — into a table whose CHECK constraint only
 * ever admitted 'add', 'remove' and 'move':
 *
 *   CHECK (action = ANY (ARRAY['add','remove','move']))
 *
 * So every single coach edit raised 23514 and wrote nothing. Nobody noticed,
 * because `_editAudit` wrapped the insert in `catch (_) {}` with the entirely
 * correct intent that a failed audit must never fail the coach's edit — and the
 * entirely wrong consequence that a failed audit says nothing at all.
 *
 * It surfaced the only way it could: a coach hit the Case-3 refusal screen on
 * production, and the escalation queue we built to catch exactly that case was
 * empty when we went looking for him. That queue is the whole mechanism by
 * which a human picks the case up afterwards. Without the row, nobody would
 * have.
 *
 * TWO THINGS ARE UNDER TEST, because the bug needed both to hide:
 *   1. writeRosterAudit REPORTS a rejected write (returns false + logs) instead
 *      of swallowing it — while still never throwing at its caller.
 *   2. ROSTER_AUDIT_ACTIONS and the migration's CHECK list agree, so the code
 *      can never again emit an action the table refuses.
 *
 * The supabase client RESOLVES with `{ error }` rather than throwing, which is
 * why try/catch never even ran. The first test below is the one that failed
 * against the shipped code.
 */

const fs = require('fs');
const path = require('path');

const {
  writeRosterAudit,
  ROSTER_AUDIT_ACTIONS,
} = require('../../bot/shared/handlers/observe-visit-flow.handler');

// A supabase double whose insert resolves the way PostgREST really does.
const clientThat = (result) => ({
  from: () => ({ insert: () => Promise.resolve(result) }),
});

const ROW = { action: 'edit_phone_escalated', actor_user_id: 'coach-1' };

describe('writeRosterAudit — a refused audit row is reported, never swallowed', () => {
  let logged;
  const log = (msg, data) => logged.push({ msg, data });
  beforeEach(() => { logged = []; });

  it('reports a constraint rejection instead of returning quietly', async () => {
    // THE regression. `catch (_) {}` returned undefined here and logged
    // nothing, so a table that refused every edit_* row looked identical to a
    // table that accepted them.
    const err = { code: '23514', message: 'violates check constraint' };
    const ok = await writeRosterAudit(clientThat({ error: err }), ROW, log);

    expect(ok).toBe(false);
    expect(logged).toHaveLength(1);
    expect(logged[0].data).toMatchObject({ code: '23514', action: 'edit_phone_escalated' });
  });

  it('still refuses to throw — the coach edit must survive a broken audit', async () => {
    // The original intent, kept. Reporting is the fix; propagating is not.
    await expect(
      writeRosterAudit(clientThat({ error: { code: '23514' } }), ROW, log),
    ).resolves.toBe(false);

    const thrower = { from: () => ({ insert: () => Promise.reject(new Error('socket hang up')) }) };
    await expect(writeRosterAudit(thrower, ROW, log)).resolves.toBe(false);
    expect(logged).toHaveLength(2);
  });

  it('is quiet and true on the happy path', async () => {
    const ok = await writeRosterAudit(clientThat({ error: null }), ROW, log);
    expect(ok).toBe(true);
    expect(logged).toEqual([]);
  });
});

describe('the code and the constraint agree on what an action is', () => {
  const MIGRATION = path.join(
    __dirname, '../../infrastructure/supabase/migrations',
    'V1.4.7__roster_audit_edit_actions.sql');

  it('every action the handler emits is one the table admits', () => {
    // Read the CHECK list straight out of the migration rather than restating
    // it — a copy here would drift exactly the way the original did.
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    const body = sql.slice(sql.indexOf('ADD CONSTRAINT leader_roster_audit_action_check'));
    const admitted = [...body.slice(0, body.indexOf(']')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

    expect(admitted).toEqual(expect.arrayContaining([...ROSTER_AUDIT_ACTIONS]));
  });

  it('names the four edit actions the Manage-teachers flow writes', () => {
    expect([...ROSTER_AUDIT_ACTIONS].sort()).toEqual(
      ['edit_level', 'edit_name', 'edit_phone', 'edit_phone_escalated']);
  });
});
