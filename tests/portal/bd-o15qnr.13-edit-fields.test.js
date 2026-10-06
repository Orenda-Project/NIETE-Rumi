/**
 * bd-o15qnr.13 — the portal half of Edit teacher's name / level / role / phone.
 * The portal re-checks the teacher is in this coach's patch, then asks the bot
 * to run main's /observe edit path (teacher-edit-commit.service). Her account
 * and school come from the patch, never from the request.
 */

const Admin = require('../../dashboard/services/coach-teacher-admin.service');
const CoachV2 = require('../../dashboard/services/coach-v2.service');
const { PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'coach-me';
const PATCH = [
  {
    teacher_ext_id: '923001110001', name: 'Ayesha Bibi', phone: '923001110001', school_ext_id: 'niete:110',
    role: 'teacher', rumi_user_id: 'u-ayesha', coaching_sessions: 7, observations: 3, training_modules: 4,
    last_analysis_data: null, school_name: 'IMSG I-10/1',
  },
];

const query = async (sql, params) => {
  if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
  const S = CoachV2.SQL;
  if (sql === S.TEACHER_FACTS || sql === S.TEACHER_TRAINING || sql === S.TEACHER_HISTORY || sql === S.MY_SCHEDULES) return { rows: [] };
  if (sql === S.LEADER_SCHOOLS) return { rows: [] };
  if (sql === S.TEACHER_LEVELS) return { rows: params[0] === 'u-ayesha' ? [{ training_bands: ['MIDDLE', 'EARLY_YEARS', 'primary'] }] : [] };
  throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
};

const client = () => ({ editTeacher: jest.fn().mockResolvedValue({ status: 200, data: { success: true, outcome: 'saved' } }) });

describe('editTeacher — name, level, role, phone', () => {
  test('a teacher in her patch: the bot is asked to edit HER account at HER school', async () => {
    const c = client();
    const out = await Admin.editTeacher(query, c, ME, '923001110001', 'name', 'Ayesha Khan');
    expect(c.editTeacher).toHaveBeenCalledWith({ leaderUserId: ME, schoolExtId: 'niete:110', userId: 'u-ayesha', edit: 'name', value: 'Ayesha Khan' });
    expect(out.status).toBe(200);
  });

  test('every field goes the same way: level (bands), role, phone check, phone', async () => {
    const c = client();
    await Admin.editTeacher(query, c, ME, '923001110001', 'level', ['PRIMARY', 'HIGH']);
    await Admin.editTeacher(query, c, ME, '923001110001', 'role', 'principal');
    await Admin.editTeacher(query, c, ME, '923001110001', 'phone_check', '03004445556');
    await Admin.editTeacher(query, c, ME, '923001110001', 'phone', '923004445556');
    expect(c.editTeacher.mock.calls.map(([a]) => [a.edit, a.value])).toEqual([
      ['level', ['PRIMARY', 'HIGH']], ['role', 'principal'], ['phone_check', '03004445556'], ['phone', '923004445556'],
    ]);
  });

  test('outside her patch: 404, the bot is never asked', async () => {
    const c = client();
    expect((await Admin.editTeacher(query, c, ME, '923000000000', 'name', 'X')).status).toBe(404);
    expect(c.editTeacher).not.toHaveBeenCalled();
  });

  test('anything that is not one of the four fields: 400, the bot is never asked', async () => {
    const c = client();
    expect((await Admin.editTeacher(query, c, ME, '923001110001', 'school', 'niete:620')).status).toBe(400);
    expect(c.editTeacher).not.toHaveBeenCalled();
  });

  test("the bot's refusal comes back as it is (a taken number: 409 with main's message)", async () => {
    const c = { editTeacher: jest.fn().mockResolvedValue({ status: 409, data: { success: false, reason: 'taken', heading: 'Please wait while we fix your data' } }) };
    const out = await Admin.editTeacher(query, c, ME, '923001110001', 'phone_check', '923003330003');
    expect(out).toEqual({ status: 409, data: { success: false, reason: 'taken', heading: 'Please wait while we fix your data' } });
  });
});

describe('getCoachTeacher — her current teaching levels, for the multi-select', () => {
  test('canonical Primary / Middle / High only; early years is not a level', async () => {
    const out = await CoachV2.getCoachTeacher(query, ME, '923001110001', { today: '2026-10-06' });
    expect(out.teacher.levels).toEqual(['PRIMARY', 'MIDDLE']);
  });
});
