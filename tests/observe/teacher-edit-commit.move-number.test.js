'use strict';
/**
 * The coach edit's number move, as one routine another caller can use: moveNumber in teacher-edit-commit.service.
 *
 * commitPhone (the coach screen) and WhatsApp's own number-change notice (identity/number-change.js) both move a
 * teacher's account to a new number through it. It decides from the destination's classification (the caller reads
 * loadTargetWithHistory just before, as the coach commit always has): taken writes nothing; a shell is retired first
 * (merged:<id>, soft, deleted_by = the actor), then she takes the number, then the shell's rows follow her; free just
 * moves. Booked visits follow her number. It writes no audit row; each caller records the move in its own words, and
 * moveDetail is the detail both use. The coach's own writes through it are pinned in
 * teacher-edit-commit.phone-pin.test.js; this suite drives it with an actor that is not a coach.
 *
 * Faked: the Supabase client (in memory, every write recorded) and the logger. The clock is fixed.
 */
const { recordingDb } = require('../identity/helpers/recording-db');

// Synthetic numbers in the 920000… range (never a real mobile), built from parts.
const fx = (n) => '92' + '000' + String(n).padStart(7, '0');
const OLD = fx(101);
const NEW = fx(202);
const HER = 'a0000000-0000-4000-8000-000000000101';
const SHELL = 'a0000000-0000-4000-8000-000000000202';
const ACTOR = 'meta_number_change';
const NOW = Date.parse('2026-11-08T09:00:00.000Z');

let db;
beforeEach(() => {
  jest.resetModules();
  db = recordingDb({
    users: [{ id: HER, phone_number: OLD, name: 'Ayesha Testwala' }],
    training_certificates: [],
    training_assessment_attempts: [],
    teacher_training_progress: [],
    coaching_sessions: [],
    observation_schedules: [{ id: 'v1', teacher_ext_id: OLD }],
    leader_roster_audit: [],
  });
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => db.client);
});
afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

const svc = () => require('../../bot/shared/services/observe/teacher-edit-commit.service');
const user = (id) => db.tables.users.find((u) => u.id === id);
async function move(extra = {}) {
  const C = svc();
  const target = await C.loadTargetWithHistory(NEW);
  return C.moveNumber({ userId: HER, fromPhone: OLD, toPhone: NEW, target, actor: ACTOR, ...extra });
}
const W = {
  phone: { table: 'users', op: 'update', patch: { phone_number: NEW }, where: [['eq', 'id', HER]] },
  visits: { table: 'observation_schedules', op: 'update', patch: { teacher_ext_id: NEW }, where: [['eq', 'teacher_ext_id', OLD]] },
  retire: {
    table: 'users',
    op: 'update',
    patch: { deleted_at: '2026-11-08T09:00:00.000Z', deleted_reason: 'phone_change_merge', deleted_by: ACTOR, phone_number: `merged:${SHELL}` },
    where: [['eq', 'id', SHELL]],
  },
};

describe('moveNumber, called with an actor that is not a coach', () => {
  test('a free number: she takes it and her booked visits follow; no audit row (the caller writes its own)', async () => {
    const out = await move();
    expect(out).toEqual({ ok: true, verdict: 'free', retiredId: null, moved: null });
    expect(db.writes).toEqual([W.phone, W.visits]);
    expect(user(HER).phone_number).toBe(NEW);
    expect(db.tables.observation_schedules[0].teacher_ext_id).toBe(NEW);
  });

  test('a shell: retired first (merged:<id>, deleted_by the actor), then she takes the number, then its rows follow', async () => {
    db.tables.users.push({ id: SHELL, phone_number: NEW, name: 'Shell Account' });
    db.tables.niete_lp_opens = [{ id: 'o1', user_id: SHELL }];
    const out = await move();
    expect(out).toEqual(expect.objectContaining({ ok: true, verdict: 'shell', retiredId: SHELL }));
    expect(out.moved.reparented).toEqual(expect.objectContaining({ niete_lp_opens: 1 }));
    expect(db.writes.slice(0, 3)).toEqual([W.retire, W.phone, W.visits]);
    expect(user(SHELL)).toEqual(expect.objectContaining({ phone_number: `merged:${SHELL}`, deleted_by: ACTOR }));
    expect(user(HER).phone_number).toBe(NEW);
    expect(db.tables.niete_lp_opens[0].user_id).toBe(HER);
    expect(db.writes.some((w) => w.table === 'leader_roster_audit')).toBe(false);
  });

  test('a taken number: nothing is written, and the verdict says why', async () => {
    db.tables.users.push({ id: SHELL, phone_number: NEW, name: 'Real Teacher' });
    db.tables.training_certificates.push({ id: 'c1', user_id: SHELL });
    expect(await move()).toEqual({ ok: false, reason: 'taken', verdict: 'taken' });
    expect(db.writes).toEqual([]);
  });

  test('a history that could not be read is taken (fail closed): nothing is written', async () => {
    db.tables.users.push({ id: SHELL, phone_number: NEW, name: 'Unread' });
    db.refuseRead = (table) => table === 'coaching_sessions';
    expect(await move()).toEqual({ ok: false, reason: 'taken', verdict: 'taken' });
    expect(db.writes).toEqual([]);
  });

  test('the shell retirement refused: failed, nothing after it is attempted', async () => {
    db.tables.users.push({ id: SHELL, phone_number: NEW, name: 'Shell Account' });
    db.refuse = (table, op, patch) => table === 'users' && String(patch.phone_number).startsWith('merged:');
    expect(await move()).toEqual({ ok: false, reason: 'failed', verdict: 'shell' });
    expect(db.writes).toEqual([W.retire]);
    expect(user(HER).phone_number).toBe(OLD);
  });

  test('her number write refused: failed, her visits stay where they were', async () => {
    db.refuse = (table, op, patch) => table === 'users' && patch.phone_number === NEW;
    expect(await move()).toEqual({ ok: false, reason: 'failed', verdict: 'free' });
    expect(db.writes).toEqual([W.phone]);
    expect(db.tables.observation_schedules[0].teacher_ext_id).toBe(OLD);
  });
});

describe('moveDetail: the edit_phone audit detail both callers write', () => {
  test('a free move: from, to, the case, nothing retired', () => {
    expect(svc().moveDetail(OLD, NEW, { ok: true, verdict: 'free', retiredId: null, moved: null }))
      .toEqual({ from_phone: OLD, to_phone: NEW, case: 'free', retired_user_id: null });
  });

  test('a fold: what moved; what stayed and what failed only when there is any', () => {
    const moved = { reparented: { niete_lp_opens: 2 }, skipped: {}, failed: [] };
    expect(svc().moveDetail(OLD, NEW, { ok: true, verdict: 'shell', retiredId: SHELL, moved }))
      .toEqual({ from_phone: OLD, to_phone: NEW, case: 'shell', retired_user_id: SHELL, reparented: { niete_lp_opens: 2 } });
    const partial = { reparented: { student_lists: 1 }, skipped: { student_lists: 1 }, failed: ['class_teachers'] };
    expect(svc().moveDetail(OLD, NEW, { ok: true, verdict: 'shell', retiredId: SHELL, moved: partial })).toEqual({
      from_phone: OLD,
      to_phone: NEW,
      case: 'shell',
      retired_user_id: SHELL,
      reparented: { student_lists: 1 },
      reparent_skipped: { student_lists: 1 },
      reparent_failed: ['class_teachers'],
    });
  });
});
