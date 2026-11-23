'use strict';
/**
 * bd-sf8ioj (queue #199) — WhatsApp scheduling never books a visit with the person booking.
 *
 * The /observe visit Flow's teacher lists (school step, search, cross-school pick) all read
 * leader-source.listTeachers, which has dropped the leader since 15 Sep (bd-o8nt4). Its one writer,
 * observe-schedule.service.saveSchedule, took whatever teacher_ext_id the Flow posted — a Flow screen
 * opened before 15 Sep, or a hand-built payload, could still book the leader herself. Now the writer
 * refuses it as well. A failed read of her own number never blocks a booking: the lists already leave
 * her out, and the scheduling is the product.
 */

let table;
let users;
let usersFail;
let notice;
let calendar;
let Store;

function fakeSupabase() {
  return {
    from(name) {
      const filters = [];
      let op = 'select';
      let payload = null;
      const rows = () => (name === 'users' ? users : table)
        .filter((r) => filters.every(([k, v]) => String(r[k]) === String(v)));
      const api = {
        select() { return api; },
        eq(k, v) { filters.push([k, v]); return api; },
        insert(p) { op = 'insert'; payload = p; return api; },
        update(p) { op = 'update'; payload = p; return api; },
        single() { return api.then((x) => x); },
        maybeSingle() {
          if (name === 'users' && usersFail) return Promise.resolve({ data: null, error: { message: 'boom' } });
          return Promise.resolve({ data: rows()[0] || null, error: null });
        },
        then(ok, bad) {
          let out;
          if (op === 'insert') {
            const row = { id: `sch-${table.length + 1}`, ...payload };
            table.push(row);
            out = { data: row, error: null };
          } else if (op === 'update') {
            rows().forEach((r) => Object.assign(r, payload));
            out = { data: null, error: null };
          } else {
            out = { data: rows(), error: null };
          }
          return Promise.resolve(out).then(ok, bad);
        },
      };
      return api;
    },
  };
}

const LEADER = 'u-principal';
const OWN_PHONE = '923150000009';
const BOOK = (teacherExtId) => ({
  school_ext_id: 'niete:285', teacher_ext_id: teacherExtId, teacher_name: 'Someone',
  school_name: 'IMS (I-V) AIOU Colony', date: '2026-11-21', slot: '09:00',
});

beforeEach(() => {
  jest.resetModules();
  table = [];
  users = [{ id: LEADER, phone_number: OWN_PHONE }];
  usersFail = false;
  notice = jest.fn().mockResolvedValue(true);
  calendar = { onScheduled: jest.fn(), onRescheduled: jest.fn(), onCancelled: jest.fn() };
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => fakeSupabase());
  jest.doMock('../../bot/shared/services/observe/observe-calendar.service', () => calendar);
  jest.doMock('../../bot/shared/services/observe/observe-teacher-notice.service', () => ({ notifyTeacher: notice }));
  Store = require('../../bot/shared/services/observe/observe-schedule.service');
});

afterEach(() => jest.resetModules());

test('RED: her own number is refused — nothing written, no invite, no notice', async () => {
  await expect(Store.saveSchedule(LEADER, BOOK(OWN_PHONE))).rejects.toThrow(/cannot book a visit with yourself/);
  expect(table).toEqual([]);
  expect(calendar.onScheduled).not.toHaveBeenCalled();
  expect(notice).not.toHaveBeenCalled();
});

test('another teacher books as before', async () => {
  const row = await Store.saveSchedule(LEADER, BOOK('923000000001'));
  expect(row).toMatchObject({ leader_user_id: LEADER, teacher_ext_id: '923000000001', status: 'upcoming' });
  expect(table).toHaveLength(1);
  expect(notice).toHaveBeenCalledTimes(1);
});

test('a failed read of her own number never blocks a booking', async () => {
  usersFail = true;
  const row = await Store.saveSchedule(LEADER, BOOK('923000000001'));
  expect(row).toMatchObject({ teacher_ext_id: '923000000001' });
  expect(table).toHaveLength(1);
});
