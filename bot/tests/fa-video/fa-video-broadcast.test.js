'use strict';
/**
 * bd-pw1ccr.8.4 — the one-off FA video broadcast: switch, audience, dry run, send.
 * bd-pw1ccr.12 — to every teacher in the test schools, both arms; the dry run prints the arm split and the cost.
 */
const { fakeDb } = require('./fake-db');
const {
  FLAG_KEY, parseArgs, switchOn, audience, run, testNumbersFrom,
} = require('../../shared/services/fa-video/broadcast');

const T = (id, school, extra = {}) => ({
  id, school_id: school, role: 'teacher', phone_number: `92300000${id}`, deleted_at: null, is_test_user: null, ...extra,
});

const OPERATOR = '15550000001'; // not a real number: the repo is public

function tables(flag = false) {
  return {
    app_settings: [{ key: FLAG_KEY, value: flag }],
    niete_topic_nudge_ab_assignment: [{ school_id: 's1', ab_group: 'B' }, { school_id: 's2', ab_group: 'A' }, { school_id: 's3', ab_group: 'B' }],
    users: [
      T('01', 's1'), T('02', 's1'), T('03', 's2'), T('04', 's3'),
      T('05', 's1', { role: 'principal' }), T('06', 's1', { deleted_at: '2026-10-01' }),
      T('07', 's1', { is_test_user: true }), T('08', 's3', { phone_number: 'merged:abc' }),
      T('09', 's3', { phone_number: '9230000001' }), // same phone as 01 → once
      T('10', null),
    ],
    broadcast_logs: [],
    broadcast_messages: [],
  };
}

function deps(db, over = {}) {
  const out = [];
  return {
    db,
    out,
    print: (l) => out.push(l),
    upload: jest.fn().mockResolvedValue('MEDIA_1'),
    send: jest.fn().mockResolvedValue({ ok: true, id: 'wamid.X' }),
    sleep: () => Promise.resolve(),
    ...over,
  };
}

test('parseArgs: dry run by default; --live, --to list, --video path', () => {
  expect(parseArgs([])).toEqual({ live: false, to: [], video: null });
  expect(parseArgs(['--live', '--video', 'v.mp4', '--to', '15550000001,15550000003'])).toEqual({
    live: true, video: 'v.mp4', to: ['15550000001', '15550000003'],
  });
});

test('the switch fails closed: missing row, non-true value, read error', async () => {
  expect(await switchOn(fakeDb({ app_settings: [] }))).toBe(false);
  expect(await switchOn(fakeDb({ app_settings: [{ key: FLAG_KEY, value: 'false' }] }))).toBe(false);
  expect(await switchOn(fakeDb({ app_settings: [{ key: FLAG_KEY, value: 'true' }] }))).toBe(true);
  expect(await switchOn(fakeDb(tables(true), { failOn: 'app_settings' }))).toBe(false);
});

test('audience: every school in the test, both arms; live teachers only, real phones, one per phone', async () => {
  const a = await audience(fakeDb(tables()));
  expect(a.map((u) => u.id).sort()).toEqual(['01', '02', '03', '04']);
  expect(a.find((u) => u.id === '03').group).toBe('A');
  expect(a.find((u) => u.id === '04').group).toBe('B');
});

test('a school outside the test hears nothing', async () => {
  const t = tables();
  t.users.push(T('11', 's9'));
  expect((await audience(fakeDb(t))).map((u) => u.id)).not.toContain('11');
});

test('dry run prints the split control (A+C) / treatment (B+D) and the cost at the Pakistan marketing rate', async () => {
  const d = deps(fakeDb(tables()), { templateStatus: jest.fn().mockResolvedValue({ status: 'APPROVED', category: 'MARKETING' }) });
  const r = await run([], d);
  expect(r).toMatchObject({ control: 1, treatment: 3, category: 'MARKETING', templateStatus: 'APPROVED', costUsd: 0.19 });
  const out = d.out.join('\n');
  expect(out).toMatch(/control \(A\+C\) 1/);
  expect(out).toMatch(/treatment \(B\+D\) 3/);
  expect(out).toMatch(/\$0\.0473/);
  expect(out).toMatch(/\$0\.19/);
});

test('any other category, or a status that cannot be read: rate unknown, never a guessed rate', async () => {
  for (const ts of [jest.fn().mockResolvedValue({ status: 'APPROVED', category: 'UTILITY' }), jest.fn().mockRejectedValue(new Error('x')), undefined]) {
    const d = deps(fakeDb(tables()), { templateStatus: ts });
    const r = await run([], d);
    expect(r.costUsd).toBeNull();
    expect(d.out.join('\n')).toMatch(/rate unknown/);
  }
});

test('dry run (default) prints the count and sends or writes nothing, switch on or off', async () => {
  for (const flag of [false, true]) {
    const db = fakeDb(tables(flag));
    const d = deps(db);
    const r = await run([], d);
    expect(r).toMatchObject({ mode: 'dry-run', audience: 4, switchOn: flag });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.upload).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    expect(d.out.join('\n')).toMatch(/4/);
  }
});

test('--live refuses while the switch is off', async () => {
  const db = fakeDb(tables(false));
  const d = deps(db);
  await expect(run(['--live', '--video', 'v.mp4'], d)).rejects.toThrow(/fa_video_broadcast_enabled/);
  expect(d.send).not.toHaveBeenCalled();
  expect(db.writes).toEqual([]);
});

test('--live needs --video', async () => {
  await expect(run(['--live'], deps(fakeDb(tables(true))))).rejects.toThrow(/--video/);
});

test('--live with the switch on: one upload, one send per teacher, logged', async () => {
  const t = tables(true);
  const db = fakeDb(t);
  const d = deps(db, { send: jest.fn().mockResolvedValueOnce({ ok: false, error: 'x' }).mockResolvedValue({ ok: true, id: 'wamid.X' }) });
  const r = await run(['--live', '--video', 'v.mp4'], d);
  expect(d.upload).toHaveBeenCalledTimes(1);
  expect(d.send).toHaveBeenCalledTimes(4);
  expect(d.send.mock.calls[0][1]).toEqual([{ type: 'header', parameters: [{ type: 'video', video: { id: 'MEDIA_1' } }] }]);
  expect(r).toMatchObject({ mode: 'live', sent: 3, failed: 1 });
  expect(t.broadcast_logs).toHaveLength(1);
  expect(t.broadcast_logs[0]).toMatchObject({
    template_name: 'niete_fa_video_ab_v1', total_recipients: 4, sent_count: 3, failed_count: 1, status: 'completed',
  });
  expect(t.broadcast_logs[0].filters).toMatchObject({ ab_groups: ['A', 'B'] });
  expect(t.broadcast_messages.map((m) => m.status).sort()).toEqual(['failed', 'sent', 'sent', 'sent']);
  expect(t.broadcast_messages.find((m) => m.status === 'sent').message_id).toBe('wamid.X');
});

test('a re-run skips teachers already sent this template', async () => {
  const t = tables(true);
  const d1 = deps(fakeDb(t));
  await run(['--live', '--video', 'v.mp4'], d1);
  const d2 = deps(fakeDb(t));
  const r = await run([], d2);
  expect(r).toMatchObject({ audience: 4, alreadySent: 4, toSend: 0 });
});

test('--to sends only to operator/test numbers, needs no switch, writes no log rows', async () => {
  const db = fakeDb(tables(false));
  const d = deps(db);
  d.testNumbers = [OPERATOR];
  const r = await run(['--to', OPERATOR, '--video', 'v.mp4'], d);
  expect(r).toMatchObject({ mode: 'test', sent: 1 });
  expect(d.send).toHaveBeenCalledWith(OPERATOR, expect.any(Array));
  expect(db.writes).toEqual([]);
});

test('--to refuses any number that is not an operator/test number', async () => {
  const d = deps(fakeDb(tables(true)));
  d.testNumbers = [OPERATOR];
  await expect(run(['--to', '15550000002', '--video', 'v.mp4'], d)).rejects.toThrow(/test number/);
  expect(d.send).not.toHaveBeenCalled();
});

test('--to refuses every number when no operator numbers are configured', async () => {
  const d = deps(fakeDb(tables(true)));
  await expect(run(['--to', OPERATOR, '--video', 'v.mp4'], d)).rejects.toThrow(/FA_VIDEO_TEST_NUMBERS/);
  expect(d.send).not.toHaveBeenCalled();
});

test('operator numbers come from FA_VIDEO_TEST_NUMBERS, never from source', () => {
  expect(testNumbersFrom({ FA_VIDEO_TEST_NUMBERS: ' 15550000001, 15550000003 ,' })).toEqual(['15550000001', '15550000003']);
  expect(testNumbersFrom({})).toEqual([]);
});
