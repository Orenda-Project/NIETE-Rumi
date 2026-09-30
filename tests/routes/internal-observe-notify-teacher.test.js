/**
 * bd-xorfy — the portal asks the bot to tell the teacher about her visit.
 *
 * The portal cannot send WhatsApp itself: it cannot require bot modules at all
 * (bd-60085 — bot/shared/config/supabase.js resolves `dotenv` from bot/, which the
 * portal service never installs). So a visit booked, moved or cancelled on the
 * portal is announced by the bot, over the internal API, through the SAME notice
 * service the WhatsApp flow uses.
 *
 * Contract:
 *   1. Shared-key auth like every internal route.
 *   2. The row is re-read by id AND leader — the portal never supplies the
 *      teacher, the phone or the date, so a hand-posted body cannot message
 *      anybody the coach has not actually booked.
 *   3. An unknown kind is a 400; a row that is not hers is a 404.
 */

let router;
let notifyTeacher;
let rows;

function findRoute(r, method, path) {
  for (const layer of r.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map(s => s.handle);
    }
  }
  return null;
}

async function invoke({ headers = {}, body = {} } = {}) {
  const stack = findRoute(router, 'post', '/observe/notify-teacher');
  if (!stack) throw new Error('route POST /observe/notify-teacher not found');
  const req = { headers, body, ip: '127.0.0.1', method: 'POST', path: '/observe/notify-teacher' };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

const KEY = 'shared-secret-key';
const auth = { 'x-api-key': KEY };
const ROW = {
  id: 'sch-1', leader_user_id: 'coach-1', teacher_ext_id: '923001234567',
  teacher_name: 'Ayesha Khan', school_name: 'IMSG I-8/1',
  scheduled_for: '2026-10-08', scheduled_slot: '09:30', status: 'upcoming',
};

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  rows = [ROW];
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  notifyTeacher = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/observe/observe-teacher-notice.service', () => ({ notifyTeacher }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: jest.fn(() => {
      const f = {};
      const chain = {
        select: () => chain,
        eq: (c, v) => { f[c] = v; return chain; },
        maybeSingle: async () => ({
          data: rows.find(r => r.id === f.id && r.leader_user_id === f.leader_user_id) || null,
          error: null,
        }),
      };
      return chain;
    }),
  }));
  router = require('../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('bd-xorfy — POST /api/internal/observe/notify-teacher', () => {
  it('rejects a call without the shared key and tells nobody', async () => {
    const { statusCode } = await invoke({ body: { scheduleId: 'sch-1', leaderUserId: 'coach-1', kind: 'scheduled' } });
    expect(statusCode).toBe(401);
    expect(notifyTeacher).not.toHaveBeenCalled();
  });

  it('re-reads the coach\'s own row and hands it to the shared notice service', async () => {
    const { statusCode, payload } = await invoke({
      headers: auth, body: { scheduleId: 'sch-1', leaderUserId: 'coach-1', kind: 'scheduled' },
    });
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ success: true, sent: true });
    expect(notifyTeacher).toHaveBeenCalledWith('scheduled', expect.objectContaining({
      id: 'sch-1', teacher_ext_id: '923001234567', scheduled_for: '2026-10-08',
    }));
  });

  it('ignores any teacher, phone or date in the body — only the stored row counts', async () => {
    await invoke({
      headers: auth,
      body: { scheduleId: 'sch-1', leaderUserId: 'coach-1', kind: 'rescheduled', teacher_ext_id: '920000000000', scheduled_for: '2030-01-01' },
    });
    const [, row] = notifyTeacher.mock.calls[0];
    expect(row.teacher_ext_id).toBe('923001234567');
    expect(row.scheduled_for).toBe('2026-10-08');
  });

  it('another coach\'s schedule is a 404 and sends nothing', async () => {
    const { statusCode } = await invoke({
      headers: auth, body: { scheduleId: 'sch-1', leaderUserId: 'coach-2', kind: 'scheduled' },
    });
    expect(statusCode).toBe(404);
    expect(notifyTeacher).not.toHaveBeenCalled();
  });

  it('an unknown kind or a missing id is a 400', async () => {
    for (const body of [
      { scheduleId: 'sch-1', leaderUserId: 'coach-1', kind: 'bogus' },
      { leaderUserId: 'coach-1', kind: 'scheduled' },
      { scheduleId: 'sch-1', kind: 'scheduled' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const { statusCode } = await invoke({ headers: auth, body });
      expect(statusCode).toBe(400);
    }
    expect(notifyTeacher).not.toHaveBeenCalled();
  });
});
