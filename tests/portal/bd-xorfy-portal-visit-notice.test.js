/**
 * bd-xorfy — a visit booked or cancelled on the portal reaches the teacher's
 * WhatsApp, exactly as one booked in the bot does.
 *
 * The portal cannot send WhatsApp itself (bd-60085: it cannot require bot
 * modules), so it asks the bot over the internal API. Three things are pinned:
 *
 *   1. the CLIENT posts only ids + kind (the bot re-reads the row) and never
 *      throws — a notice is a courtesy, the booking is the product;
 *   2. createSchedule reports whether a re-booking actually CHANGED the date or
 *      slot, so a no-op re-save does not message the teacher again;
 *   3. the ROUTES call the client after a successful write, from the session's
 *      leader id, without awaiting it on the response path.
 */

const fs = require('fs');
const path = require('path');

jest.mock('axios', () => ({ post: jest.fn() }));
const axios = require('axios');

const Client = require('../../dashboard/services/observe-notice.service');
const { createSchedule } = require('../../dashboard/services/leader-schedule-write.service');
const { editSchedule } = require('../../dashboard/services/leader-assignment.service');

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MAIN_BOT_URL = 'http://bot.internal/';
  process.env.INTERNAL_API_KEY = 'k';
});

describe('bd-xorfy — portal notice client', () => {
  it('posts ids + kind to the bot\'s internal route with the shared key', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { success: true, sent: true } });
    const sent = await Client.notifyTeacher({ scheduleId: 'sch-1', leaderUserId: 'coach-1', kind: 'scheduled' });
    expect(sent).toBe(true);
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe('http://bot.internal/api/internal/observe/notify-teacher');
    expect(body).toEqual({ scheduleId: 'sch-1', leaderUserId: 'coach-1', kind: 'scheduled' });
    expect(opts.headers['x-api-key']).toBe('k');
  });

  it('never throws — a bot outage leaves the booking alone', async () => {
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(Client.notifyTeacher({ scheduleId: 'sch-1', leaderUserId: 'coach-1', kind: 'cancelled' }))
      .resolves.toBe(false);
  });

  it('unconfigured transport sends nothing and does not throw', async () => {
    delete process.env.MAIN_BOT_URL;
    await expect(Client.notifyTeacher({ scheduleId: 'sch-1', leaderUserId: 'coach-1', kind: 'scheduled' }))
      .resolves.toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('bd-xorfy — createSchedule says whether the visit actually moved', () => {
  const PATCH = { teacher_ext_id: 'p1', teacher_name: 'T', school_ext_id: 'niete:1', school_name: 'S' };
  const q = (existing) => jest.fn(async (sql) => {
    if (/leader_schools/i.test(sql)) return { rows: [PATCH] };
    if (/select/i.test(sql) && /observation_schedules/i.test(sql)) return { rows: existing };
    return { rows: [{ id: 'sch-1' }] };
  });
  const input = { teacherExtId: 'p1', date: '2026-10-08', slot: '09:00' };
  const opts = { today: '2026-10-01' };

  it('a new booking is not an update', async () => {
    const r = await createSchedule(q([]), 'coach-1', input, opts);
    expect(r).toMatchObject({ updated: false, changed: true });
  });

  it('re-booking onto a different date is a change', async () => {
    const r = await createSchedule(q([{ id: 'sch-1', scheduled_for: '2026-10-05', scheduled_slot: '09:00' }]), 'coach-1', input, opts);
    expect(r).toMatchObject({ updated: true, changed: true });
  });

  it('re-booking the same date and slot is not a change', async () => {
    const r = await createSchedule(q([{ id: 'sch-1', scheduled_for: '2026-10-08', scheduled_slot: '09:00' }]), 'coach-1', input, opts);
    expect(r).toMatchObject({ updated: true, changed: false });
  });
});


describe('bd-xorfy — editSchedule says whether the visit actually moved', () => {
  const q = (owned) => jest.fn(async (sql) => {
    if (/^\s*SELECT/i.test(sql)) return { rows: [owned] };
    return { rows: [{ id: 'sch-1' }] };
  });
  const own = (over = {}) => ({ id: 'sch-1', status: 'upcoming', leader_user_id: 'coach-1', scheduled_for: '2026-10-08', scheduled_slot: '09:00', ...over });
  const opts = { today: '2026-10-01' };

  it('a new date is a change', async () => {
    const r = await editSchedule(q(own()), 'coach-1', 'sch-1', { date: '2026-10-09', slot: '09:00' }, opts);
    expect(r.changed).toBe(true);
  });

  it('the same date and slot is not a change', async () => {
    const r = await editSchedule(q(own()), 'coach-1', 'sch-1', { date: '2026-10-08', slot: '09:00' }, opts);
    expect(r.changed).toBe(false);
  });
});

describe('bd-xorfy — portal routes call the client', () => {
  const SRC = stripComments(fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8'));
  const block = (from, to) => {
    const a = SRC.indexOf(from);
    const b = SRC.indexOf(to, a + 1);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    return SRC.slice(a, b);
  };

  it('requires the notice client, not a bot module', () => {
    expect(SRC).toMatch(/require\('\.\.\/services\/observe-notice\.service'\)/);
    expect(SRC).not.toMatch(/require\('\.\.\/\.\.\/bot\/shared\/services\/observe\/observe-teacher-notice/);
  });

  it('booking notifies scheduled / rescheduled from the session leader', () => {
    const b = block("router.post('/leader/schedules',", "router.post('/leader/schedules/:id/cancel'");
    expect(b).toMatch(/ObserveNotice\.notifyTeacher\(/);
    expect(b).toMatch(/'rescheduled'/);
    expect(b).toMatch(/'scheduled'/);
    expect(b).toMatch(/leaderUserId:\s*req\.session\.portalUserId/);
    expect(b).not.toMatch(/await\s+ObserveNotice/);
  });

  it('cancelling notifies cancelled', () => {
    const b = block("router.post('/leader/schedules/:id/cancel'", 'router.');
    expect(b).toMatch(/ObserveNotice\.notifyTeacher\(/);
    expect(b).toMatch(/'cancelled'/);
    expect(b).not.toMatch(/await\s+ObserveNotice/);
  });

  it('editing a visit to a new time notifies rescheduled', () => {
    const b = block("router.post('/leader/schedules/:id/edit'", 'router.');
    expect(b).toMatch(/ObserveNotice\.notifyTeacher\(/);
    expect(b).toMatch(/'rescheduled'/);
    expect(b).toMatch(/result\.changed/);
    expect(b).not.toMatch(/await\s+ObserveNotice/);
  });
});
