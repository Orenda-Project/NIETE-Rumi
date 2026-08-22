/**
 * Attendance does not make classes any more. It points at /class.
 *
 * Operator decision 2026-08-14. `attendance-setup` existed only because attendance
 * needed a roster and there was no class flow; now there is one, and having two
 * writers of class membership is what produced the divergence between
 * students.list_id and class_enrollments.
 *
 * So a teacher with no class is handed to the class manager instead of being given
 * a second, parallel way to create one.
 *
 * The school guard is not optional. `classes.school_id` is NOT NULL and roughly one
 * in eight teachers has no school on file, so /class itself checks first and answers
 * in chat rather than opening a Flow that cannot succeed — its own comment calls
 * this "the dead-end pattern that has already cost this deployment once". Attendance
 * must make the same check, or it reintroduces the dead end from a different door.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const router = require('../../bot/shared/services/attendance-router.service');

function db({ user = {}, classes = [] } = {}) {
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: user, error: null }) }) }) };
    }
    if (table === 'student_lists') {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: classes, error: null }) }) }),
        }),
      };
    }
    return {};
  });
}

beforeEach(() => jest.clearAllMocks());

describe('a teacher with no class', () => {
  it('is sent to the class manager, not an attendance-owned setup flow', async () => {
    db({ user: { id: 't1', role: 'teacher', school_id: 'sch1' }, classes: [] });

    const r = await router.route('t1');

    expect(r.action).toBe('SEND_CLASS_MANAGER');
    expect(r.action).not.toBe('SEND_SETUP');
  });

  it('with no school on file is answered in chat, not handed a Flow that cannot succeed', async () => {
    db({ user: { id: 't2', role: 'teacher', school_id: null }, classes: [] });

    const r = await router.route('t2');

    expect(r.action).not.toBe('SEND_CLASS_MANAGER');
    expect(r.message).toBeTruthy();
  });
});

describe('a principal is never routed at their classes from /attendance', () => {
  // The "My students" branch is gone (bd-43520): a principal's /attendance is staff
  // attendance, and their own class is marked from /class. So there is no path from
  // here to the class manager for them — and, more to the point, no path to a class
  // picker either.
  it('gets the tap-or-voice question, whether or not they have a class', async () => {
    db({ user: { id: 'p1', role: 'principal', school_id: 'sch1' }, classes: [] });
    expect((await router.route('p1')).action).toBe('ASK_METHOD');

    db({
      user: { id: 'p1', role: 'principal', school_id: 'sch1' },
      classes: [{ id: 'c1', class_name: 'Grade 5' }],
    });
    expect((await router.route('p1')).action).toBe('ASK_METHOD');
  });
});

describe('the setup flow is no longer reachable from attendance', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '../..');

  it('the router no longer emits SEND_SETUP', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bot/shared/services/attendance-router.service.js'), 'utf8');
    expect(src).not.toContain("action: 'SEND_SETUP'");
  });

  it('neither consumer sends ATTENDANCE_SETUP_FLOW_ID any more', () => {
    ['bot/whatsapp-bot.js', 'bot/shared/handlers/text-message.handler.js'].forEach((rel) => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      // The constant may still be imported; what must be gone is sending it.
      const sends = [...src.matchAll(/flowId:\s*(?:constants\.)?ATTENDANCE_SETUP_FLOW_ID/g)];
      expect(sends.map(() => rel)).toEqual([]);
    });
  });
});
