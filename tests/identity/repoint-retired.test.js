'use strict';
/**
 * When a teacher's number moves, the accounts retired into hers must follow it.
 *
 * The governed analytics (ict_account_merges) credit a retired account's activity to whoever is live on its LATEST
 * edit_phone row's to_phone: they follow the number. A coach edit, WhatsApp's number change or an "Is this you?" claim
 * that moves her to a new number used to leave her retired accounts pointing at the old one, credited to nobody (or to
 * whoever takes the old number next). After each of those moves, repointRetired writes, through the caller's own audit
 * writer (so the row reads as that flow's own), a newer edit_phone row for each retired account whose latest row names
 * her, on her new number. planRepoints is the decision; repointRetired reads, decides and calls the writer; it is
 * behind repoint_retired_on_number_move_enabled (off by default) and never throws: the move has already happened.
 *
 * Faked: the Supabase client (in memory; reads are not recorded, writes are) and the logger.
 */
const { recordingDb } = require('./helpers/recording-db');

// Synthetic numbers in the 920000… range (never a real mobile), built from parts.
const fx = (n) => '92' + '000' + String(n).padStart(7, '0');
const OLD = fx(101);
const NEW = fx(202);
const ELSEWHERE = fx(303);
const HER = 'a0000000-0000-4000-8000-000000000101';
const R1 = 'a0000000-0000-4000-8000-000000000501';
const R2 = 'a0000000-0000-4000-8000-000000000502';
const SOMEONE = 'a0000000-0000-4000-8000-000000000909';
const FLAG = 'repoint_retired_on_number_move_enabled';
const MOD = '../../bot/shared/services/identity/repoint-retired';

/** An edit_phone row as the table holds it: the retired account, the survivor it names, its to_phone, when. */
const row = (id, retired, survivor, toPhone, createdAt) => ({
  id, action: 'edit_phone', teacher_ext_id: survivor, created_at: createdAt,
  detail: { via: 'rm_duplicate_review', retired_user_id: retired, ...(toPhone === undefined ? {} : { to_phone: toPhone }) },
});
const T1 = '2026-11-01T08:00:00.000Z';
const T2 = '2026-11-05T08:00:00.000Z';
const repoint = (retired, fromPhone, supersedes) => ({
  case: 'repoint', retired_user_id: retired, from_phone: fromPhone, to_phone: NEW, supersedes,
});

afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

describe('planRepoints: which retired accounts follow her', () => {
  const plan = (rows, deleted) => require(MOD).planRepoints({ userId: HER, toPhone: NEW, rows, deleted });

  test('a retired account whose latest row names her and points at her old number follows her to the new one', () => {
    expect(plan([row('a1', R1, HER, OLD, T1)], { [R1]: true })).toEqual([repoint(R1, OLD, 'a1')]);
  });

  test('one already on her new number (in any format) is left: the shell this very move retired', () => {
    expect(plan([row('a1', R1, HER, '+' + NEW, T1)], { [R1]: true })).toEqual([]);
  });

  test("one whose latest row names another account is left: its history is someone else's now", () => {
    expect(plan([row('a1', R1, HER, OLD, T1), row('a2', R1, SOMEONE, ELSEWHERE, T2)], { [R1]: true })).toEqual([]);
  });

  test('the latest row decides, whatever order the rows come in', () => {
    expect(plan([row('a2', R1, HER, OLD, T2), row('a1', R1, SOMEONE, ELSEWHERE, T1)], { [R1]: true }))
      .toEqual([repoint(R1, OLD, 'a2')]);
  });

  test('a live account is never re-pointed, nor one that is no account', () => {
    expect(plan([row('a1', R1, HER, OLD, T1), row('a2', R2, HER, OLD, T1)], { [R1]: false })).toEqual([]);
  });

  test('a latest row with no number is re-pointed (it maps to nobody now)', () => {
    expect(plan([row('a1', R1, HER, undefined, T1)], { [R1]: true })).toEqual([repoint(R1, null, 'a1')]);
  });

  test('several follow her, in id order', () => {
    expect(plan([row('a2', R2, HER, OLD, T1), row('a1', R1, HER, ELSEWHERE, T1)], { [R1]: true, [R2]: true }))
      .toEqual([repoint(R1, ELSEWHERE, 'a1'), repoint(R2, OLD, 'a2')]);
  });

  test('an account retired into one of her retired accounts follows her too (the chain is followed by id)', () => {
    // R2 was folded into R1 (a shell), and R1 later into her: both are hers now.
    expect(plan([row('a1', R1, HER, OLD, T1), row('a0', R2, R1, OLD, T1)], { [R1]: true, [R2]: true }))
      .toEqual([repoint(R1, OLD, 'a1'), repoint(R2, OLD, 'a0')]);
  });

  test('a chain that reaches a live account ends there: not hers', () => {
    expect(plan([row('a0', R2, R1, OLD, T1)], { [R1]: false, [R2]: true })).toEqual([]);
  });

  test('two rows at the same instant: the smaller id is the latest, as the merge tool orders them', () => {
    expect(plan([row('b', R1, SOMEONE, ELSEWHERE, T1), row('a', R1, HER, OLD, T1)], { [R1]: true }))
      .toEqual([repoint(R1, OLD, 'a')]);
  });
});

describe('repointRetired: read, decide, write through the caller', () => {
  let db;
  let written;
  beforeEach(() => {
    jest.resetModules();
    db = recordingDb({
      app_settings: [{ key: FLAG, value: true }],
      users: [{ id: HER, phone_number: NEW }, { id: R1, phone_number: `merged:${R1}`, deleted_at: T1 }],
      leader_roster_audit: [row('a1', R1, HER, OLD, T1)],
    });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => db.client);
    written = [];
  });
  const run = (write = async (d) => { written.push(d); return true; }) =>
    require(MOD).repointRetired({ userId: HER, toPhone: NEW }, write);

  test("switch on: one row through the caller's own writer; the helper itself writes nothing", async () => {
    await expect(run()).resolves.toEqual({ planned: 1, repointed: 1 });
    expect(written).toEqual([repoint(R1, OLD, 'a1')]);
    expect(db.writes).toEqual([]);
  });

  test('the switch absent (the default): the audit table is never read, nothing written', async () => {
    db.tables.app_settings = [];
    db.throwOn = (t) => t === 'leader_roster_audit';
    await expect(run()).resolves.toEqual({ planned: 0, repointed: 0, skipped: 'flag_off' });
    expect(written).toEqual([]);
  });

  test('a chain: the account retired into her retired account is found and re-pointed too', async () => {
    db.tables.users.push({ id: R2, phone_number: `merged:${R2}`, deleted_at: T1 });
    db.tables.leader_roster_audit.push(row('a0', R2, R1, OLD, T1));
    await expect(run()).resolves.toEqual({ planned: 2, repointed: 2 });
    expect(written).toEqual([repoint(R1, OLD, 'a1'), repoint(R2, OLD, 'a0')]);
  });

  test('no retired account names her: nothing written', async () => {
    db.tables.leader_roster_audit = [];
    await expect(run()).resolves.toEqual({ planned: 0, repointed: 0 });
    expect(written).toEqual([]);
  });

  test.each([['the audit table', 'leader_roster_audit'], ['the users table', 'users']])(
    '%s unreadable: nothing written, never thrown', async (_l, table) => {
      db.refuseRead = (t) => t === table;
      await expect(run()).resolves.toEqual({ planned: 0, repointed: 0, failed: true });
      expect(written).toEqual([]);
    },
  );

  test('the database unreachable: the switch reads as off, never thrown', async () => {
    db.down = true;
    await expect(run()).resolves.toEqual({ planned: 0, repointed: 0, skipped: 'flag_off' });
  });

  test('a writer that refuses is not counted; one that throws is caught', async () => {
    await expect(run(async () => false)).resolves.toEqual({ planned: 1, repointed: 0 });
    await expect(run(async () => { throw new Error('insert failed'); })).resolves.toEqual({ planned: 1, repointed: 0, failed: true });
  });

  test('more rows than the read bound: nothing written (fail closed)', async () => {
    const R = require(MOD);
    db.tables.leader_roster_audit = Array.from({ length: R.READ_LIMIT }, (_, i) => row(`x${i}`, R1, HER, OLD, T1));
    await expect(run()).resolves.toEqual({ planned: 0, repointed: 0, failed: true });
    expect(written).toEqual([]);
  });
});
