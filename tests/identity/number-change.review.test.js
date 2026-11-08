'use strict';
/**
 * The number-change move, against the timelines a review found it got wrong (S1 to S6), and the outcomes it must
 * report honestly.
 *
 *   Fold only what the change made. A "shell" (nothing irreplaceable) on the new number is folded into her only when it
 *   was created at or after the change (the account her new phone made) and never finished sign-up. Anything else that
 *   classifies as a shell is escalated with its reason: destination_predates_change, destination_registered.
 *   S1: an old empty stub on her old number must not absorb her real account on the new one.
 *   S2: a stranger's older account on a recycled number must not be folded into hers.
 *   S3: a resend after a move whose audit row was lost, with the bot's clock behind Meta's, must not fold her.
 *
 *   Stale and out-of-order notices. A notice older than her latest edit_phone row is ignored (skipped_stale). An
 *   account on the old number that the notice itself made, with no record of the move, is escalated
 *   (sender_account_new); a true resend (the move is on record) stays already_done.
 *   S4: B->C delivered before A->B.  S6: A->B replayed after she changed back.
 *
 *   A half-finished move is recorded. S5: the shell was retired, then her number write was refused: an
 *   edit_phone_escalated row names the retired account and the step that failed, and a log line says so.
 *
 *   Every outcome is honest: a refused escalation row is failed, an unreadable switch is not "off", and every outcome
 *   that is not a clean move carries a machine reason.
 *
 * Only the network edge is doubled: the database (an in-memory client recording every write in order) and the file
 * logger. The event logger is the real module, spied.
 */
const { recordingDb } = require('./helpers/recording-db');

process.env.WEB_QUIZ_KID_KEY = 'number-change-test-key-0123456789abcdef';

// Synthetic numbers in the 920000… range (never a real mobile), built from parts.
const fx = (n) => '92' + '000' + String(n).padStart(7, '0');
const A = fx(101);
const B = fx(202);
const C = fx(303);
const VIA = 'meta_number_change';
const CHANGED_AT = Date.parse('2026-11-08T09:00:00.000Z');
const NOW = Date.parse('2026-11-08T09:01:00.000Z');
const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let db;
let events;
let fileLog;
let NC;

function setup(users, extra = {}) {
  jest.resetModules();
  db = recordingDb({
    app_settings: [{ key: 'meta_number_change_enabled', value: true }],
    users,
    training_certificates: [], training_assessment_attempts: [], teacher_training_progress: [], coaching_sessions: [],
    observation_schedules: [], leader_roster_audit: [], student_lists: [], niete_lp_opens: [],
    ...extra,
  });
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => db.client);
  const SL = require('../../bot/shared/utils/structured-logger');
  events = jest.spyOn(SL, 'logEvent').mockImplementation(() => {});
  fileLog = require('../../bot/shared/utils/logger').logToFile;
  NC = require('../../bot/shared/services/identity/number-change');
}
afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

const notice = (from, to, ts = CHANGED_AT) => ({
  from, id: `wamid.${from}.${to}.${ts}`, timestamp: String(ts / 1000), type: 'system',
  system: { body: 'User A changed their number', wa_id: to, type: 'user_changed_number' },
});
const outcomes = () => events.mock.calls.filter(([n]) => n === 'identity.number_change_applied').map(([, d]) => d);
const said = () => outcomes().map((d) => `${d.verdict}/${d.action}/${d.reason}`);
const row = (uid) => db.tables.users.find((u) => u.id === uid);
const escalations = () => db.writes.filter((w) => w.table === 'leader_roster_audit' && w.rows[0].action === 'edit_phone_escalated')
  .map((w) => w.rows[0]);
// What getOrCreateUser hands the webhook: the row on `from`, or a fresh row made now by the bot's clock.
function senderOn(phone, botClockMs = NOW) {
  let u = db.tables.users.find((x) => x.phone_number === phone);
  if (!u) {
    u = { id: id(900 + db.tables.users.length), phone_number: phone, registration_completed: false,
      created_at: new Date(botClockMs).toISOString().replace('Z', '') };
    db.tables.users.push(u);
  }
  return { ...u };
}
const apply = (message, user) => NC.applyNumberChange({ message, user, signatureOk: true });

describe('fold only the account the change made (S1, S2, S3)', () => {
  test('S1: an old empty stub on the old number does not absorb her real, registered account on the new one', async () => {
    const STUB = { id: id(1), phone_number: A, name: null, registration_completed: false, created_at: '2024-03-01T10:00:00' };
    const HER = { id: id(2), phone_number: B, name: 'Real Teacher', registration_completed: true, created_at: '2025-05-01T10:00:00' };
    setup([STUB, HER], { student_lists: [{ id: 'sl1', user_id: HER.id, class_name: 'Grade 3-A', academic_year: '2026-27', is_active: true }] });
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['shell/escalated/destination_predates_change']);
    expect(row(HER.id).phone_number).toBe(B);
    expect(row(HER.id).deleted_at).toBeUndefined();
    expect(row(STUB.id).phone_number).toBe(A);
    expect(db.tables.student_lists[0].user_id).toBe(HER.id);
    expect(escalations()).toEqual([expect.objectContaining({
      actor_user_id: STUB.id, detail: { via: VIA, to_phone: B, reason: 'destination_predates_change' },
    })]);
  });

  test('S2: a recycled number holding a stranger\'s older account is escalated, and the stranger keeps her classes', async () => {
    const HER = { id: id(3), phone_number: A, name: 'Her', registration_completed: true, created_at: '2025-01-10T08:00:00' };
    const STRANGER = { id: id(4), phone_number: B, name: 'Stranger', registration_completed: true, created_at: '2025-06-01T08:00:00' };
    setup([HER, STRANGER], { student_lists: [{ id: 'sl-x', user_id: STRANGER.id, class_name: 'Grade 5-B', academic_year: '2026-27', is_active: true }] });
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['shell/escalated/destination_predates_change']);
    expect(db.tables.student_lists[0].user_id).toBe(STRANGER.id);
    expect(row(STRANGER.id).phone_number).toBe(B);
    expect(row(HER.id).phone_number).toBe(A);
  });

  test('an account made after the change but already registered is escalated, never folded', async () => {
    const HER = { id: id(5), phone_number: A, name: 'Her', registration_completed: true, created_at: '2025-01-10T08:00:00' };
    const NEWREG = { id: id(6), phone_number: B, name: 'Signed Up Again', registration_completed: true, created_at: '2026-11-08T09:00:20' };
    setup([HER, NEWREG]);
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['shell/escalated/destination_registered']);
    expect(row(NEWREG.id).phone_number).toBe(B);
    expect(row(HER.id).phone_number).toBe(A);
  });

  test('the account her new phone made after the change, unregistered, is still folded', async () => {
    const HER = { id: id(7), phone_number: A, name: 'Her', registration_completed: true, created_at: '2025-01-10T08:00:00' };
    const MADE = { id: id(8), phone_number: B, name: null, registration_completed: false, created_at: '2026-11-08T09:00:20' };
    setup([HER, MADE]);
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['shell/folded/null']);
    expect(row(MADE.id).phone_number).toBe(`merged:${MADE.id}`);
    expect(row(HER.id).phone_number).toBe(B);
  });

  test('S3: a resend after a move whose audit row was lost, with the bot clock 5 min behind Meta, does not fold her', async () => {
    const HER = { id: id(9), phone_number: A, name: 'Her', registration_completed: true, created_at: '2025-01-10T08:00:00' };
    setup([HER]);
    db.refuse = (table) => table === 'leader_roster_audit';
    await apply(notice(A, B), senderOn(A));
    db.refuse = () => false;
    await apply(notice(A, B), senderOn(A, CHANGED_AT - 5 * 60 * 1000));
    expect(said()).toEqual(['free/moved/audit_unrecorded', 'shell/escalated/destination_predates_change']);
    expect(row(HER.id).phone_number).toBe(B);
    expect(row(HER.id).deleted_at).toBeUndefined();
  });
});

describe('stale and out-of-order notices (S4, S6)', () => {
  test('S4: B->C before A->B: the first is escalated (sender_account_new), not dropped as done; A->B then folds', async () => {
    const HER = { id: id(10), phone_number: A, name: 'Her', registration_completed: true, created_at: '2025-01-10T08:00:00' };
    setup([HER]);
    await apply(notice(B, C, CHANGED_AT + 30 * 1000), senderOn(B));
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['free/escalated/sender_account_new', 'shell/folded/null']);
    expect(row(HER.id).phone_number).toBe(B);
    expect(escalations()).toEqual([expect.objectContaining({
      teacher_phone_e164: B, detail: { via: VIA, to_phone: C, reason: 'sender_account_new' },
    })]);
  });

  test('S6: A->B, then B->A, then A->B replayed: the replay is older than her last move and is skipped', async () => {
    const HER = { id: id(11), phone_number: A, name: 'Her', registration_completed: true, created_at: '2025-01-10T08:00:00' };
    setup([HER]);
    await apply(notice(A, B), senderOn(A));
    await apply(notice(B, A, CHANGED_AT + 60 * 1000), senderOn(B));
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['free/moved/null', 'free/moved/null', 'null/skipped_stale/notice_older_than_last_move']);
    expect(row(HER.id).phone_number).toBe(A);
  });

  test('a true resend (the move is on record) stays already_done', async () => {
    const HER = { id: id(12), phone_number: A, name: 'Her', registration_completed: true, created_at: '2025-01-10T08:00:00' };
    setup([HER]);
    await apply(notice(A, B), senderOn(A));
    const after = db.writes.length;
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['free/moved/null', 'shell/already_done/move_on_record']);
    expect(db.writes.length).toBe(after);
  });

  test('the old number\'s account was made by the notice and nothing is on record: escalated, not already_done', async () => {
    const MINE = { id: id(13), phone_number: B, name: 'Her On Her New Phone', registration_completed: true, created_at: '2026-10-01T08:00:00' };
    setup([MINE]);
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['shell/escalated/sender_account_new']);
    expect(row(MINE.id).phone_number).toBe(B);
  });
});

describe('a half-finished move is recorded (S5)', () => {
  const HER = { id: id(14), phone_number: A, name: 'Her', registration_completed: true, created_at: '2025-01-10T08:00:00' };
  const SHELL = { id: id(15), phone_number: B, name: null, registration_completed: false, created_at: '2026-11-08T09:00:30' };

  test('S5: the shell retired, then her number write refused: escalated, naming the retired account and the failed step', async () => {
    setup([{ ...HER }, { ...SHELL }], { niete_lp_opens: [{ id: 'o1', user_id: SHELL.id }] });
    db.refuse = (table, op, patch) => table === 'users' && patch.phone_number === B;
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['shell/escalated/move_incomplete']);
    expect(row(SHELL.id).phone_number).toBe(`merged:${SHELL.id}`);
    expect(row(HER.id).phone_number).toBe(A);
    expect(escalations()).toEqual([expect.objectContaining({
      actor_user_id: HER.id,
      detail: { via: VIA, to_phone: B, reason: 'move_incomplete', retired_user_id: SHELL.id, failed_step: 'phone' },
    })]);
    const line = fileLog.mock.calls.find(([msg]) => /half-finished/.test(msg));
    expect(line && line[1]).toEqual(expect.objectContaining({ failedStep: 'phone', recorded: true }));
    expect(JSON.stringify(line)).not.toContain(SHELL.id);
  });

  test('the connection drops on her number write after the shell was retired: recorded the same way', async () => {
    setup([{ ...HER }, { ...SHELL }]);
    db.throwWrite = (table, op, patch) => table === 'users' && patch.phone_number === B;
    await expect(apply(notice(A, B), senderOn(A))).resolves.toBeUndefined();
    expect(said()).toEqual(['shell/escalated/move_incomplete']);
    expect(escalations()[0].detail).toEqual(expect.objectContaining({ retired_user_id: SHELL.id, failed_step: 'phone' }));
  });

  test('the first write itself refused (nothing changed): failed with its reason, no escalation', async () => {
    setup([{ ...HER }, { ...SHELL }]);
    db.refuse = (table, op, patch) => table === 'users' && String(patch.phone_number).startsWith('merged:');
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['shell/failed/retire_refused']);
    expect(escalations()).toEqual([]);
  });

  test('her booked visits refused after the move: moved, the audit says so, and a person is asked to finish it', async () => {
    setup([{ ...HER }], { observation_schedules: [{ id: 'v1', teacher_ext_id: A }] });
    db.refuse = (table) => table === 'observation_schedules';
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['free/moved/move_incomplete']);
    expect(row(HER.id).phone_number).toBe(B);
    const move = db.writes.find((w) => w.table === 'leader_roster_audit' && w.rows[0].action === 'edit_phone').rows[0];
    expect(move.detail).toEqual(expect.objectContaining({ visits_failed: true }));
    expect(escalations()).toEqual([expect.objectContaining({
      detail: { via: VIA, to_phone: B, reason: 'move_incomplete', retired_user_id: null, failed_step: 'visits' },
    })]);
  });

  test('a shell table refused while folding: folded, and the escalation names the table', async () => {
    setup([{ ...HER }, { ...SHELL }], {
      student_lists: [{ id: 'sl-1', user_id: SHELL.id, class_name: 'Grade 3-A', academic_year: '2026-27', is_active: true }],
    });
    db.refuse = (table, op) => table === 'student_lists' && op === 'update';
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['shell/folded/move_incomplete']);
    expect(escalations()).toEqual([expect.objectContaining({
      detail: {
        via: VIA, to_phone: B, reason: 'move_incomplete', retired_user_id: SHELL.id, failed_step: 'reparent', reparent_failed: ['student_lists'],
      },
    })]);
  });
});

describe('honest outcomes', () => {
  const HER = { id: id(16), phone_number: A, name: 'Her', registration_completed: true, created_at: '2025-01-10T08:00:00' };
  const REAL = { id: id(17), phone_number: B, name: 'Real', registration_completed: true, created_at: '2024-01-01T08:00:00' };

  test('a refused escalation row is failed with its reason, not escalated', async () => {
    setup([{ ...HER }, { ...REAL }], { training_certificates: [{ id: 'c1', user_id: REAL.id }] });
    db.refuse = (table) => table === 'leader_roster_audit';
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['taken/failed/escalation_unrecorded']);
    const rejected = fileLog.mock.calls.find(([msg]) => /roster audit row REJECTED/.test(msg));
    expect(rejected[1]).toEqual(expect.objectContaining({ reason: 'destination_has_history' }));
  });

  test('a switch that cannot be read is skipped_flag_unreadable, never logged as off, and nothing moves', async () => {
    setup([{ ...HER }]);
    db.refuseRead = (table) => table === 'app_settings';
    await apply(notice(A, B), senderOn(A));
    expect(said()).toEqual(['null/skipped_flag_unreadable/flag_unreadable']);
    expect(db.writes).toEqual([]);
  });

  test('every outcome that is not a clean move carries a machine reason', async () => {
    setup([{ ...HER }, { ...REAL }], { training_certificates: [{ id: 'c1', user_id: REAL.id }] });
    await apply(notice(A, B), senderOn(A)); // taken
    await NC.applyNumberChange({ message: notice(A, B), user: senderOn(A), signatureOk: false });
    db.tables.app_settings = [];
    await apply(notice(A, B), senderOn(A));
    for (const o of outcomes()) {
      expect(Object.keys(o).sort()).toEqual(['action', 'reason', 'tk', 'verdict']);
      expect(typeof o.reason).toBe('string');
    }
    expect(outcomes().map((o) => o.action)).toEqual(['escalated', 'skipped_unverified', 'skipped_flag_off']);
  });
});
