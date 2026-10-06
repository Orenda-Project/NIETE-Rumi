/**
 * bd-o15qnr.11 — the portal side of Edit teacher. The portal cannot load bot
 * modules (bd-60085), so it asks the bot over the internal API to run the
 * /observe teacher admin. Before it asks, it re-checks that the teacher is in
 * THIS coach's patch, and it sends only what the patch says about her — never
 * a phone or user id from the request.
 */

const Admin = require('../../dashboard/services/coach-teacher-admin.service');
const { PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'coach-me';
const PATCH = [
  {
    teacher_ext_id: '923001110001', name: 'Ayesha Bibi', phone: '923001110001', school_ext_id: 'niete:110',
    role: 'teacher', rumi_user_id: 'u-ayesha', coaching_sessions: 7, observations: 3, training_modules: 4,
    last_analysis_data: null, school_name: 'IMSG I-10/1',
  },
  {
    teacher_ext_id: '923001110004', name: 'Not On Rumi', phone: '923001110004', school_ext_id: 'niete:620',
    role: 'teacher', rumi_user_id: null, coaching_sessions: 0, observations: 0, training_modules: 0,
    last_analysis_data: null, school_name: 'IMSG G-6/2',
  },
];

const query = async (sql) => {
  if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
  throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
};

function fakeClient(answer = { status: 200, data: { success: true, outcome: 'move' } }) {
  return {
    moveTeacher: jest.fn().mockResolvedValue(answer),
    removeTeacher: jest.fn().mockResolvedValue({ status: 200, data: { success: true } }),
  };
}

describe('moveTeacher', () => {
  test('a teacher in her patch: the bot is asked to move HER number, by the patch, to the chosen school', async () => {
    const client = fakeClient();
    const out = await Admin.moveTeacher(query, client, ME, '923001110001', 'niete:620');
    expect(client.moveTeacher).toHaveBeenCalledWith({ leaderUserId: ME, teacherPhone: '923001110001', schoolExtId: 'niete:620' });
    expect(out).toEqual({ status: 200, data: { success: true, outcome: 'move' } });
  });

  test('a teacher outside her patch: 404, and the bot is never asked', async () => {
    const client = fakeClient();
    const out = await Admin.moveTeacher(query, client, ME, '923000000000', 'niete:620');
    expect(out.status).toBe(404);
    expect(client.moveTeacher).not.toHaveBeenCalled();
  });

  test('a school she does not hold: the bot\'s own refusal (403 not_my_school) comes back as it is', async () => {
    const client = fakeClient({ status: 403, data: { success: false, reason: 'not_my_school' } });
    const out = await Admin.moveTeacher(query, client, ME, '923001110001', 'niete:999');
    expect(out).toEqual({ status: 403, data: { success: false, reason: 'not_my_school' } });
  });

  test('no school picked: 400 before anything is asked', async () => {
    const client = fakeClient();
    const out = await Admin.moveTeacher(query, client, ME, '923001110001', '');
    expect(out.status).toBe(400);
    expect(client.moveTeacher).not.toHaveBeenCalled();
  });
});

describe('removeTeacher', () => {
  test('a teacher in her patch: the bot removes HER user id from HER current school', async () => {
    const client = fakeClient();
    const out = await Admin.removeTeacher(query, client, ME, '923001110001');
    expect(client.removeTeacher).toHaveBeenCalledWith({ leaderUserId: ME, userId: 'u-ayesha', schoolExtId: 'niete:110' });
    expect(out.status).toBe(200);
  });

  test('outside her patch, or not on Rumi (no account to take off): 404, the bot is never asked', async () => {
    const client = fakeClient();
    expect((await Admin.removeTeacher(query, client, ME, '923000000000')).status).toBe(404);
    expect((await Admin.removeTeacher(query, client, ME, '923001110004')).status).toBe(404);
    expect(client.removeTeacher).not.toHaveBeenCalled();
  });
});
