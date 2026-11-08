'use strict';
/**
 * WhatsApp says a teacher changed her number: her account moves to the new number, so her history follows her.
 *
 * Meta posts a `system` message (`user_changed_number`; older `customer_changed_number`) when she uses WhatsApp's
 * "Change number": the sender is her OLD number, `system.wa_id` the new one. identity-events.recordSystem logs it;
 * number-change.applyNumberChange runs after it and moves her, through the coach phone edit's own steps, only when
 * the switch is on (meta_number_change_enabled, off by default), Meta's signature on the request verified, and the
 * notice carries the new number. free moves her; shell folds the empty account there into hers and moves her; taken
 * moves nothing and raises the coach edit's escalation row. It is idempotent (Meta can resend), never throws, sends
 * nothing, and logs identity.number_change_applied { tk, verdict, action } with no phone number, name or raw id.
 *
 * Only the network edge is doubled: the database (an in-memory client that records every write in order), the file
 * logger and the WhatsApp sender (to prove nothing is sent). The structured event logger is the real module, spied.
 */
const { recordingDb } = require('./helpers/recording-db');

// The teacher's keyed reference (tk) needs the HMAC key; a fixed test key makes it deterministic here.
process.env.WEB_QUIZ_KID_KEY = 'number-change-test-key-0123456789abcdef';

// Synthetic numbers in the 920000… range (never a real mobile), built from parts.
const fx = (n) => '92' + '000' + String(n).padStart(7, '0');
const OLD = fx(101);
const NEW = fx(202);
const VIA = 'meta_number_change';
const CHANGED_AT = Date.parse('2026-11-08T09:00:00.000Z');
const NOW = Date.parse('2026-11-08T09:01:00.000Z');

// users.created_at is `timestamp` (no zone) holding UTC: these are written the way PostgREST returns them.
const HER = {
  id: 'a0000000-0000-4000-8000-000000000101', phone_number: OLD, name: 'Ayesha Testwala',
  created_at: '2025-01-10T08:00:00', registration_completed: true,
};
// The empty account her new phone made, after the change.
const SHELL = { id: 'a0000000-0000-4000-8000-000000000202', phone_number: NEW, name: 'Shell Account', created_at: '2026-11-08T09:00:30' };
// A real teacher's record on the new number.
const OTHER = { id: 'a0000000-0000-4000-8000-000000000303', phone_number: NEW, name: 'Someone Else', created_at: '2024-02-02T10:00:00' };
// The account getOrCreateUser makes for her OLD number once she has left it (a resend, or a number the bot never knew).
const STUB = { id: 'a0000000-0000-4000-8000-000000000404', phone_number: OLD, name: null, created_at: '2026-11-08T09:00:59', registration_completed: false };
const COACH = 'a0000000-0000-4000-8000-000000000909';

const notice = (system = {}) => ({
  from: OLD,
  id: 'wamid.number-change-1',
  timestamp: String(CHANGED_AT / 1000),
  type: 'system',
  system: { body: 'User A changed their number', wa_id: NEW, type: 'user_changed_number', ...system },
});

let db;
let sent;
let events;
let NC;
let tk;
let fileLog;

function load() {
  const StructuredLogger = require('../../bot/shared/utils/structured-logger');
  events = jest.spyOn(StructuredLogger, 'logEvent').mockImplementation(() => {});
  fileLog = require('../../bot/shared/utils/logger').logToFile;
  NC = require('../../bot/shared/services/identity/number-change');
  ({ tk } = require('../../bot/shared/services/quiz/web-quiz-kid'));
}

beforeEach(() => {
  jest.resetModules();
  db = recordingDb({
    app_settings: [{ key: 'meta_number_change_enabled', value: true }],
    users: [{ ...HER }],
    training_certificates: [],
    training_assessment_attempts: [],
    teacher_training_progress: [],
    coaching_sessions: [],
    observation_schedules: [{ id: 'v1', teacher_ext_id: OLD, status: 'upcoming' }],
    leader_roster_audit: [],
  });
  sent = jest.fn(async () => true);
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => db.client);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: sent, sendInteractiveButtons: sent, sendInteractiveMessage: sent, sendTemplate: sent,
    sendFlow: sent, sendReaction: sent, sendDocument: sent, sendImage: sent, sendCtaUrl: sent,
  }));
  load();
});
afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

const apply = (args) => NC.applyNumberChange({ message: notice(), user: { ...HER }, signatureOk: true, ...args });
const applied = () => events.mock.calls.filter(([name]) => name === 'identity.number_change_applied').map(([, data]) => data);
const row = (id) => db.tables.users.find((u) => u.id === id);
const audits = () => db.writes.filter((w) => w.table === 'leader_roster_audit').map((w) => w.rows[0]);

/** The coach edit's audit row, written as her own change: she is the actor, no coach's roster is affected. */
const metaAudit = (action, detail, who = HER) => ({
  action,
  actor_user_id: who.id,
  affected_leader_user_id: null,
  teacher_ext_id: who.id,
  teacher_phone_e164: who.phone_number,
  teacher_name: who.name,
  detail: { via: VIA, ...detail },
});
const W = {
  phone: (id = HER.id) => ({ table: 'users', op: 'update', patch: { phone_number: NEW }, where: [['eq', 'id', id]] }),
  visits: { table: 'observation_schedules', op: 'update', patch: { teacher_ext_id: NEW }, where: [['eq', 'teacher_ext_id', OLD]] },
  retire: (id) => ({
    table: 'users',
    op: 'update',
    patch: { deleted_at: new Date(NOW).toISOString(), deleted_reason: 'phone_change_merge', deleted_by: VIA, phone_number: `merged:${id}` },
    where: [['eq', 'id', id]],
  }),
  audit: (r) => ({ table: 'leader_roster_audit', op: 'insert', rows: [r] }),
};

describe('the three gates: the switch, the signature, the new number', () => {
  test('the switch absent (the default): nothing is read past it, nothing written, skipped_flag_off', async () => {
    db.tables.app_settings = [];
    await expect(apply()).resolves.toBeUndefined();
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: null, action: 'skipped_flag_off', reason: 'flag_off' }]);
    expect(db.writes).toEqual([]);
    expect(row(HER.id).phone_number).toBe(OLD);
  });

  test.each([['false', false], ['"false"', 'false'], ['junk', 'yes']])('the switch set to %s: skipped_flag_off', async (_l, value) => {
    db.tables.app_settings = [{ key: 'meta_number_change_enabled', value }];
    await apply();
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: null, action: 'skipped_flag_off', reason: 'flag_off' }]);
    expect(db.writes).toEqual([]);
  });

  test.each([['false', false], ['absent', undefined], ['the string "true"', 'true'], ['1', 1]])(
    'the signature verdict %s: skipped_unverified, nothing written', async (_l, signatureOk) => {
      await apply({ signatureOk });
      expect(applied()).toEqual([{ tk: tk(HER.id), verdict: null, action: 'skipped_unverified', reason: 'signature_not_verified' }]);
      expect(db.writes).toEqual([]);
    },
  );

  test('no new number in the notice: skipped_no_number, nothing written', async () => {
    await apply({ message: notice({ wa_id: undefined }) });
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: null, action: 'skipped_no_number', reason: 'no_new_number' }]);
    expect(db.writes).toEqual([]);
  });

  test('the database unreachable: the switch cannot be read, so nothing moves (fail closed), and it is not logged as off', async () => {
    db.down = true;
    await expect(apply()).resolves.toBeUndefined();
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: null, action: 'skipped_flag_unreadable', reason: 'flag_unreadable' }]);
  });

  test('not a number change (a user-id change, another system type, odd input): no event, no write, nothing thrown', async () => {
    await NC.applyNumberChange({ message: notice({ type: 'user_changed_user_id', wa_id: undefined }), user: HER, signatureOk: true });
    await NC.applyNumberChange({ message: notice({ type: 'customer_identity_changed' }), user: HER, signatureOk: true });
    await NC.applyNumberChange({ message: { type: 'system' }, user: HER, signatureOk: true });
    await NC.applyNumberChange({ message: null, user: null });
    await expect(NC.applyNumberChange()).resolves.toBeUndefined();
    expect(applied()).toEqual([]);
    expect(db.writes).toEqual([]);
  });
});

describe('the coach edit verdict for the new number decides', () => {
  test('free: her number moves, her visits follow, the move is on the audit as hers', async () => {
    await apply();
    expect(db.writes).toEqual([
      W.phone(),
      W.visits,
      W.audit(metaAudit('edit_phone', { from_phone: OLD, to_phone: NEW, case: 'free', retired_user_id: null })),
    ]);
    expect(row(HER.id).phone_number).toBe(NEW);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: 'free', action: 'moved', reason: null }]);
  });

  test('the older type name with new_wa_id moves her too', async () => {
    await apply({ message: notice({ type: 'customer_changed_number', wa_id: undefined, new_wa_id: NEW }) });
    expect(row(HER.id).phone_number).toBe(NEW);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: 'free', action: 'moved', reason: null }]);
  });

  test("shell: the empty account her new phone made is retired (merged:<id>), its rows follow her, she takes the number", async () => {
    db.tables.users.push({ ...SHELL });
    db.tables.niete_lp_opens = [{ id: 'o1', user_id: SHELL.id }];
    await apply();
    expect(db.writes.slice(0, 3)).toEqual([W.retire(SHELL.id), W.phone(), W.visits]);
    expect(row(SHELL.id)).toEqual(expect.objectContaining({ phone_number: `merged:${SHELL.id}`, deleted_by: VIA, deleted_reason: 'phone_change_merge' }));
    expect(row(HER.id).phone_number).toBe(NEW);
    expect(db.tables.niete_lp_opens[0].user_id).toBe(HER.id);
    expect(audits()).toEqual([metaAudit('edit_phone', {
      from_phone: OLD,
      to_phone: NEW,
      case: 'shell',
      retired_user_id: SHELL.id,
      reparented: expect.objectContaining({ niete_lp_opens: 1 }),
    })]);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: 'shell', action: 'folded', reason: null }]);
  });

  test("taken: nothing moves; the coach edit's escalation row is raised for a person", async () => {
    db.tables.users.push({ ...OTHER });
    db.tables.training_certificates.push({ id: 'cert-1', user_id: OTHER.id });
    await apply();
    expect(db.writes).toEqual([
      W.audit(metaAudit('edit_phone_escalated', { to_phone: NEW, reason: 'destination_has_history' })),
    ]);
    expect(row(HER.id).phone_number).toBe(OLD);
    expect(row(OTHER.id).phone_number).toBe(NEW);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: 'taken', action: 'escalated', reason: 'destination_has_history' }]);
  });

  test('a history that could not be read is taken (fail closed): escalated, nothing moves', async () => {
    db.tables.users.push({ ...SHELL });
    db.refuseRead = (table) => table === 'coaching_sessions';
    await apply();
    expect(row(SHELL.id).phone_number).toBe(NEW);
    expect(row(HER.id).phone_number).toBe(OLD);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: 'taken', action: 'escalated', reason: 'destination_has_history' }]);
  });

  test('a "shell" made before the change is not her new phone\'s: escalated, never folded (no person in the loop)', async () => {
    db.tables.users.push({ ...OTHER }); // nothing irreplaceable, so the classifier says shell, but it predates the change
    await apply();
    expect(db.writes).toEqual([
      W.audit(metaAudit('edit_phone_escalated', { to_phone: NEW, reason: 'destination_predates_change' })),
    ]);
    expect(row(OTHER.id).phone_number).toBe(NEW);
    expect(row(OTHER.id).deleted_at).toBeUndefined();
    expect(row(HER.id).phone_number).toBe(OLD);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: 'shell', action: 'escalated', reason: 'destination_predates_change' }]);
  });

  test('every write runs as her (the history ledger names her, not the connection)', async () => {
    const { currentActor } = require('../../bot/shared/utils/actor-context');
    const actors = [];
    db.refuse = () => { actors.push(currentActor()); return false; };
    db.tables.users.push({ ...SHELL });
    await apply();
    expect(actors.length).toBeGreaterThan(3);
    expect(new Set(actors)).toEqual(new Set([HER.id]));
  });
});

describe('idempotent: Meta can resend', () => {
  test('she is already on the new number: already_done, nothing written', async () => {
    db.tables.users[0].phone_number = NEW;
    await apply({ user: { ...HER, phone_number: NEW } });
    expect(db.writes).toEqual([]);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: null, action: 'already_done', reason: 'already_on_number' }]);
  });

  test('a resend after the move comes from the old number, where a new empty account was made: nothing more is written', async () => {
    await apply();
    const after = db.writes.length;
    db.tables.users.push({ ...STUB });
    await apply({ user: { ...STUB } });
    expect(db.writes.length).toBe(after);
    expect(row(HER.id).phone_number).toBe(NEW);
    expect(row(HER.id).deleted_at).toBeUndefined();
    expect(applied().map((e) => e.action)).toEqual(['moved', 'already_done']);
    expect(applied()[1]).toEqual({ tk: tk(STUB.id), verdict: 'shell', action: 'already_done', reason: 'move_on_record' });
  });

  test('a coach already moved her, and an account appeared on her old number before the change: already_done, she is never folded into it', async () => {
    db.tables.users[0].phone_number = NEW; // the coach moved her
    const early = { ...STUB, created_at: '2026-11-05T10:00:00' }; // made by a message from the old number, before the change
    db.tables.users.push(early);
    db.tables.leader_roster_audit.push({
      action: 'edit_phone', actor_user_id: COACH, affected_leader_user_id: COACH, teacher_ext_id: HER.id,
      teacher_phone_e164: OLD, teacher_name: HER.name, created_at: '2026-11-01T10:00:00+00:00',
      detail: { via: 'portal_coach_v2', from_phone: OLD, to_phone: NEW, case: 'free', retired_user_id: null },
    });
    await apply({ user: { ...early } });
    expect(db.writes).toEqual([]);
    expect(row(HER.id)).toEqual(expect.objectContaining({ phone_number: NEW }));
    expect(row(HER.id).deleted_at).toBeUndefined();
    expect(applied()).toEqual([{ tk: tk(early.id), verdict: 'shell', action: 'already_done', reason: 'move_on_record' }]);
  });

  test('the same, with no record of how she got there: her account on the new number predates the change, so it is escalated, never folded', async () => {
    db.tables.users[0].phone_number = NEW;
    const early = { ...STUB, created_at: '2026-11-05T10:00:00' };
    db.tables.users.push(early);
    await apply({ user: { ...early } });
    expect(row(HER.id)).toEqual(expect.objectContaining({ phone_number: NEW }));
    expect(row(HER.id).deleted_at).toBeUndefined();
    expect(db.writes.map((w) => [w.table, w.op])).toEqual([['leader_roster_audit', 'insert']]);
    expect(applied()).toEqual([{ tk: tk(early.id), verdict: 'shell', action: 'escalated', reason: 'destination_predates_change' }]);
  });

  test('the account on her old number was made by the notice itself and nothing is on record: escalated (sender_account_new), her account on the new number kept', async () => {
    db.tables.users = [{ ...SHELL, name: 'Ayesha On Her New Phone', registration_completed: true, created_at: '2026-10-01T08:00:00' }, { ...STUB }];
    await apply({ user: { ...STUB } });
    expect(db.writes).toEqual([
      W.audit(metaAudit('edit_phone_escalated', { to_phone: NEW, reason: 'sender_account_new' }, STUB)),
    ]);
    expect(row(SHELL.id).phone_number).toBe(NEW);
    expect(applied()).toEqual([{ tk: tk(STUB.id), verdict: 'shell', action: 'escalated', reason: 'sender_account_new' }]);
  });

  test("a minute's grace for the two clocks: made 30 s before the change counts as made by it; 2 min before does not", async () => {
    await apply({ user: { ...HER, created_at: '2026-11-08T08:59:30' } });
    expect(applied().pop()).toEqual(expect.objectContaining({ action: 'escalated', reason: 'sender_account_new' }));
    db.tables.leader_roster_audit = []; // a separate case: no escalation on record from the first
    await apply({ user: { ...HER, created_at: '2026-11-08T08:58:00' } });
    expect(applied().pop()).toEqual(expect.objectContaining({ action: 'moved' }));
  });

  test('the same taken notice twice: one escalation row; the second is already_done', async () => {
    db.tables.users.push({ ...OTHER });
    db.tables.coaching_sessions.push({ id: 'cs-1', user_id: OTHER.id });
    await apply();
    await apply();
    expect(audits().map((r) => r.action)).toEqual(['edit_phone_escalated']);
    expect(applied()).toEqual([
      { tk: tk(HER.id), verdict: 'taken', action: 'escalated', reason: 'destination_has_history' },
      { tk: tk(HER.id), verdict: 'taken', action: 'already_done', reason: 'escalation_on_record' },
    ]);
  });

  test('an escalation older than a day (past the webhook\'s own 24 h window) does not hold back a new one', async () => {
    db.tables.users.push({ ...OTHER });
    db.tables.coaching_sessions.push({ id: 'cs-1', user_id: OTHER.id });
    db.tables.leader_roster_audit.push({
      ...metaAudit('edit_phone_escalated', { to_phone: NEW, reason: 'destination_has_history' }),
      created_at: '2026-11-06T09:00:00+00:00',
    });
    await apply();
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: 'taken', action: 'escalated', reason: 'destination_has_history' }]);
  });
});

describe('failures: never thrown, never half-claimed', () => {
  test('her number write refused: failed, no audit row', async () => {
    db.refuse = (table, op, patch) => table === 'users' && patch.phone_number === NEW;
    await expect(apply()).resolves.toBeUndefined();
    expect(db.writes).toEqual([W.phone()]);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: 'free', action: 'failed', reason: 'phone_refused' }]);
  });

  test('the shell retirement refused: failed, she stays where she was', async () => {
    db.tables.users.push({ ...SHELL });
    db.refuse = (table, op, patch) => table === 'users' && String(patch.phone_number).startsWith('merged:');
    await apply();
    expect(row(HER.id).phone_number).toBe(OLD);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: 'shell', action: 'failed', reason: 'retire_refused' }]);
  });

  test('the audit record unreadable: failed before any write (it cannot tell a stale notice or a resend)', async () => {
    db.refuseRead = (table) => table === 'leader_roster_audit';
    await apply();
    expect(db.writes).toEqual([]);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: null, action: 'failed', reason: 'audit_unreadable' }]);
  });

  test('the account lookup throws: failed, verdict unknown', async () => {
    db.throwOn = (table) => table === 'users';
    await expect(apply()).resolves.toBeUndefined();
    expect(db.writes).toEqual([]);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: 'unknown', action: 'failed', reason: 'lookup_failed' }]);
  });

  test('no account for the sender (the lookup upstream failed): failed, with no reference', async () => {
    await apply({ user: null });
    expect(db.writes).toEqual([]);
    expect(applied()).toEqual([{ tk: null, verdict: null, action: 'failed', reason: 'no_account' }]);
  });

  test('the audit row refused: the move stands, the outcome says it went unrecorded, and the rejection is logged with her tk, never her raw id', async () => {
    db.refuse = (table) => table === 'leader_roster_audit';
    await apply();
    expect(row(HER.id).phone_number).toBe(NEW);
    expect(applied()).toEqual([{ tk: tk(HER.id), verdict: 'free', action: 'moved', reason: 'audit_unrecorded' }]);
    const rejected = fileLog.mock.calls.filter(([msg]) => /roster audit row REJECTED/.test(msg));
    expect(rejected).toHaveLength(1);
    expect(rejected[0][1]).toEqual(expect.objectContaining({ tk: tk(HER.id), action: 'edit_phone', why: 'insert_rejected' }));
    expect(JSON.stringify(rejected)).not.toContain(HER.id);
  });

  test('the event logger itself failing is swallowed', async () => {
    events.mockImplementation(() => { throw new Error('logger down'); });
    await expect(apply()).resolves.toBeUndefined();
    expect(row(HER.id).phone_number).toBe(NEW);
  });
});

describe('what the event carries, and what it never does', () => {
  test('the actions are a closed list', () => {
    expect(NC.ACTIONS).toEqual([
      'moved', 'folded', 'escalated', 'skipped_flag_off', 'skipped_flag_unreadable', 'skipped_unverified', 'skipped_no_number',
      'skipped_stale', 'already_done', 'failed',
    ]);
  });

  test('exactly tk, verdict, action and reason; never a phone number, a name or a raw id; nothing sent to anyone', async () => {
    await apply(); // moved
    db.tables.users = [{ ...HER }, { ...SHELL }];
    db.tables.leader_roster_audit = []; // separate cases: no earlier move on record
    await apply(); // folded
    db.tables.users = [{ ...HER }, { ...OTHER }];
    db.tables.leader_roster_audit = [];
    db.tables.coaching_sessions.push({ id: 'cs-1', user_id: OTHER.id });
    await apply(); // escalated
    expect(applied().map((e) => e.action)).toEqual(['moved', 'folded', 'escalated']);
    for (const e of applied()) expect(Object.keys(e).sort()).toEqual(['action', 'reason', 'tk', 'verdict']);
    const text = JSON.stringify(applied());
    for (const secret of [OLD, NEW, HER.name, SHELL.name, OTHER.name, HER.id, SHELL.id, OTHER.id]) expect(text).not.toContain(secret);
    expect(sent).not.toHaveBeenCalled();
  });

  test('no key on the service: still recorded, the reference is null', async () => {
    const saved = process.env.WEB_QUIZ_KID_KEY;
    delete process.env.WEB_QUIZ_KID_KEY;
    try { await apply(); } finally { process.env.WEB_QUIZ_KID_KEY = saved; }
    expect(applied()).toEqual([{ tk: null, verdict: 'free', action: 'moved', reason: null }]);
  });
});
