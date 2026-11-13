/**
 * bd-370733 — Send feedback is for teachers and principals too (operator, 12 Nov: "Report an issue on the portal only
 * appearing for Coaches only. Should be for teacher as well."). Every send still lands in coach_feedback, and each row
 * now says WHO sent it: the reporter's role, read by the server from users.role at send time (a tester's role switch
 * rewrites users.role, so a later join could name the wrong one). The app can never claim a role.
 */

const SERVICE = '../../bot/shared/services/feedback/app-feedback.service';

const UID = '11111111-2222-4333-8444-555555555555';

/** A database whose users row has `role`; `failUsers` makes the users read fail. */
function fakeDb({ role, failUsers = false } = {}) {
  const calls = { inserts: [], userReads: 0 };
  const supabase = {
    from(table) {
      const q = { table };
      const chain = {
        select() { return chain; },
        insert(row) { calls.inserts.push({ table, row }); q.insert = row; return chain; },
        update() { return chain; },
        eq() { return chain; },
        gte() { return Promise.resolve({ count: 0, error: null }); },
        single() { return Promise.resolve({ data: { id: 'fb-1' }, error: null }); },
        maybeSingle() {
          if (table !== 'users') return Promise.resolve({ data: null, error: null });
          calls.userReads += 1;
          if (failUsers) return Promise.resolve({ data: null, error: { message: 'boom' } });
          return Promise.resolve({ data: { name: 'Sana Iqbal', role }, error: null });
        },
      };
      return chain;
    },
  };
  return { supabase, calls };
}

function deps(db) {
  return {
    supabase: db.supabase,
    r2: { headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 10 }), getPresignedGetUrl: jest.fn() },
    later: () => {},
    logError: jest.fn(),
    logWarn: jest.fn(),
    now: () => new Date('2026-11-12T10:00:00Z'),
  };
}

describe('Send feedback — the reporter\'s role is kept on the row', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test.each([
    ['teacher', 'teacher'],
    ['principal', 'principal'],
    ['coach', 'coach'],
    ['Principal', 'principal'],
    // The app's rule (useTeacherV2 isTeacherV2For): no role recorded counts as a teacher.
    [null, 'teacher'],
    ['', 'teacher'],
  ])('users.role %p is stored as context.role %p', async (role, stored) => {
    const db = fakeDb({ role });
    const out = await Svc.submitFeedback({ userId: UID, topic: 'broken', text: 'Lesson plans do not open' }, deps(db));
    expect(out).toEqual({ status: 'ok', feedbackId: 'fb-1' });
    expect(db.calls.inserts).toHaveLength(1);
    expect(db.calls.inserts[0].table).toBe('coach_feedback');
    expect(db.calls.inserts[0].row.context.role).toBe(stored);
  });

  test('a role the app sends is ignored: only the server says who she is', async () => {
    const db = fakeDb({ role: 'teacher' });
    await Svc.submitFeedback({
      userId: UID, topic: 'idea', text: 'x', context: { role: 'coach', browser: 'whatsapp-iab' },
    }, deps(db));
    expect(db.calls.inserts[0].row.context).toEqual({ browser: 'whatsapp-iab', role: 'teacher' });
  });

  test('a users read that fails never loses the report: it is kept without a role', async () => {
    const db = fakeDb({ failUsers: true });
    const d = deps(db);
    const out = await Svc.submitFeedback({ userId: UID, topic: 'other', text: 'x' }, d);
    expect(out.status).toBe('ok');
    expect(db.calls.inserts[0].row.context).toEqual({});
    expect(d.logWarn).toHaveBeenCalled();
  });

  test('the team\'s Slack post names the role beside her name', async () => {
    const db = fakeDb({ role: 'teacher' });
    const postToSlack = jest.fn().mockResolvedValue('1.1');
    const d = { ...deps(db), postToSlack, env: { APP_FEEDBACK_SLACK_CHANNEL: 'C1', PROD_DIGEST_SLACK_TOKEN: 'xoxb-t' } };
    await Svc.followUp({
      id: 'fb-1', user_id: UID, kind: 'broken', message: 'x', page: '/portal/teacher/more', audio_key: null, photo_keys: [],
      context: { role: 'teacher' },
    }, d);
    expect(postToSlack.mock.calls[0][0]).toMatch(/from Sana Iqbal \(teacher\)/);
  });
});
