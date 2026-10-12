/**
 * The coach app's school and teacher admin, portal side. Like Edit teacher
 * (coach-teacher-admin.service), the writes are the bot's WhatsApp /observe
 * writers, asked over the internal API. This module is the portal's half of
 * the guard: a school must be one of HER schools (by the EMIS in the URL, looked
 * up in her own records), and only what her records say about that school and
 * its people is sent — never a school key or a user id from the request.
 *
 * The database is faked at the query boundary and the bot at the client
 * boundary; the coach-v2 read side and this service run for real.
 */

const Admin = require('../../dashboard/services/coach-school-admin.service');
const { SQL } = require('../../dashboard/services/coach-v2.service');
const { PATCH_TEACHERS_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'coach-me';
const SCHOOLS = [
  { school_ext_id: 'niete:110', school_name: 'IMSG I-10/1', emis: '110' },
  { school_ext_id: 'niete:620', school_name: 'IMSG G-6/2', emis: '620' },
];
const patchRow = (ext, name, school, rumi) => ({
  teacher_ext_id: ext, name, phone: ext, school_ext_id: school, role: 'teacher', rumi_user_id: rumi,
  coaching_sessions: 0, observations: 0, training_modules: 0, last_analysis_data: null,
  school_name: SCHOOLS.find((s) => s.school_ext_id === school).school_name,
});
const PATCH = [
  patchRow('923001110001', 'Ayesha Bibi', 'niete:110', 'u-ayesha'),
  patchRow('923001110002', 'Bilal Khan', 'niete:110', 'u-bilal'),
  patchRow('923001110004', 'Not On Rumi', 'niete:110', null),
  patchRow('923001110009', 'Zara Elsewhere', 'niete:620', 'u-zara'),
];

const query = async (sql) => {
  if (sql === SQL.LEADER_SCHOOLS) return { rows: SCHOOLS };
  if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
  return { rows: [] };
};

const ok = (data = {}) => ({ status: 200, data: { success: true, ...data } });
function fakeClient(answers = {}) {
  const fn = (name) => jest.fn().mockResolvedValue(answers[name] || ok());
  return {
    searchSchools: fn('searchSchools'),
    addSchool: fn('addSchool'),
    removeSchool: fn('removeSchool'),
    checkTeacher: fn('checkTeacher'),
    addTeacher: fn('addTeacher'),
    removeTeachers: fn('removeTeachers'),
  };
}

describe('searchSchools', () => {
  const universe = [
    { schoolExtId: 'niete:9110', name: 'IMCB G-9/1', emis: '9110', alreadyMine: false },
    { schoolExtId: 'niete:110', name: 'IMSG I-10/1', emis: '110', alreadyMine: true },
    { schoolExtId: 'niete:1100', name: 'Bright Future 110', emis: '1100', alreadyMine: false },
    { schoolExtId: 'niete:620', name: 'IMSG G-6/2', emis: '620', alreadyMine: false },
  ];

  test('under two characters: no search, nothing asked', async () => {
    const client = fakeClient();
    const out = await Admin.searchSchools(client, ME, ' i ');
    expect(out).toEqual(ok({ schools: [] }));
    expect(client.searchSchools).not.toHaveBeenCalled();
  });

  test('an exact EMIS first, then names that start with the term, then the rest, by name', async () => {
    const client = fakeClient({ searchSchools: ok({ schools: universe }) });
    const out = await Admin.searchSchools(client, ME, '110');
    expect(client.searchSchools).toHaveBeenCalledWith({ leaderUserId: ME, term: '110' });
    expect(out.data.schools.map((s) => s.schoolExtId)).toEqual(['niete:110', 'niete:1100', 'niete:9110', 'niete:620']);
    expect(out.data.schools[0]).toEqual({ schoolExtId: 'niete:110', name: 'IMSG I-10/1', emis: '110', alreadyMine: true });

    const byName = await Admin.searchSchools(client, ME, 'imsg');
    expect(byName.data.schools.map((s) => s.name)).toEqual(['IMSG G-6/2', 'IMSG I-10/1', 'Bright Future 110', 'IMCB G-9/1']);
  });

  test('at most 20 come back', async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ schoolExtId: `niete:${i}`, name: `School ${i}`, emis: String(i), alreadyMine: false }));
    const out = await Admin.searchSchools(fakeClient({ searchSchools: ok({ schools: many }) }), ME, 'school');
    expect(out.data.schools).toHaveLength(20);
  });

  test('the bot\'s own failure comes back as it is', async () => {
    const down = { status: 502, data: { success: false, reason: 'bot_unreachable' } };
    expect(await Admin.searchSchools(fakeClient({ searchSchools: down }), ME, 'imsg')).toEqual(down);
  });
});

describe('addSchool', () => {
  test('a school key: the bot adds it for HER', async () => {
    const client = fakeClient({ addSchool: ok({ schoolName: 'IMSG G-6/2', emis: '620' }) });
    const out = await Admin.addSchool(client, ME, 'niete:620');
    expect(client.addSchool).toHaveBeenCalledWith({ leaderUserId: ME, schoolExtId: 'niete:620' });
    expect(out.status).toBe(200);
  });

  test('anything that is not a school key: 400, nothing asked', async () => {
    const client = fakeClient();
    for (const bad of ['', '620', 'niete:', 'niete:62 0', "niete:1' OR 1=1"]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await Admin.addSchool(client, ME, bad)).status).toBe(400);
    }
    expect(client.addSchool).not.toHaveBeenCalled();
  });
});

describe('removeSchool', () => {
  test('one of her schools: the bot removes HER link, keyed by her own record', async () => {
    const client = fakeClient({ removeSchool: ok({ schoolName: 'IMSG I-10/1' }) });
    const out = await Admin.removeSchool(query, client, ME, '110');
    expect(client.removeSchool).toHaveBeenCalledWith({ leaderUserId: ME, schoolExtId: 'niete:110' });
    expect(out).toEqual(ok({ schoolName: 'IMSG I-10/1' }));
  });

  test('not one of hers: 404, the bot is never asked', async () => {
    const client = fakeClient();
    expect((await Admin.removeSchool(query, client, ME, '999')).status).toBe(404);
    expect(client.removeSchool).not.toHaveBeenCalled();
  });
});

describe('checkTeacher / addTeacher', () => {
  test('a number checked at one of her schools: the bot plans it for that school', async () => {
    const client = fakeClient({ checkTeacher: ok({ outcome: 'new', phone: '923001110555' }) });
    const out = await Admin.checkTeacher(query, client, ME, '110', ' 0300 1110555 ');
    expect(client.checkTeacher).toHaveBeenCalledWith({ leaderUserId: ME, schoolExtId: 'niete:110', phone: '0300 1110555' });
    expect(out.data.outcome).toBe('new');
  });

  test('add: the number and the trimmed name go to the bot for HER school', async () => {
    const client = fakeClient({ addTeacher: ok({ outcome: 'new', name: 'Nadia Akbar' }) });
    await Admin.addTeacher(query, client, ME, '620', { phone: '03001110555', name: '  Nadia Akbar ' });
    expect(client.addTeacher).toHaveBeenCalledWith({ leaderUserId: ME, schoolExtId: 'niete:620', phone: '03001110555', name: 'Nadia Akbar' });
  });

  test('no number: 400; a school not hers: 404; the bot is never asked', async () => {
    const client = fakeClient();
    expect((await Admin.checkTeacher(query, client, ME, '110', '  ')).status).toBe(400);
    expect((await Admin.checkTeacher(query, client, ME, '999', '03001110555')).status).toBe(404);
    expect((await Admin.addTeacher(query, client, ME, '999', { phone: '03001110555', name: 'X' })).status).toBe(404);
    expect(client.checkTeacher).not.toHaveBeenCalled();
    expect(client.addTeacher).not.toHaveBeenCalled();
  });
});

describe('removeTeachers', () => {
  test('ticked teachers AT that school go to the bot as their accounts; the reason rides along', async () => {
    const client = fakeClient({ removeTeachers: ok({ removed: [{ name: 'Ayesha Bibi' }, { name: 'Bilal Khan' }] }) });
    const out = await Admin.removeTeachers(query, client, ME, '110', ['923001110001', '923001110002'], ' Transferred ');
    expect(client.removeTeachers).toHaveBeenCalledWith({
      leaderUserId: ME, schoolExtId: 'niete:110', userIds: ['u-ayesha', 'u-bilal'], reason: 'Transferred',
    });
    expect(out.status).toBe(200);
  });

  test('a teacher at another school, or with no account, is never sent', async () => {
    const client = fakeClient();
    await Admin.removeTeachers(query, client, ME, '110', ['923001110001', '923001110009', '923001110004', '923000000000'], '');
    expect(client.removeTeachers).toHaveBeenCalledWith({
      leaderUserId: ME, schoolExtId: 'niete:110', userIds: ['u-ayesha'], reason: null,
    });
  });

  test('nobody that can be removed: 404; none ticked or more than 30: 400; never asked', async () => {
    const client = fakeClient();
    expect((await Admin.removeTeachers(query, client, ME, '110', ['923001110009'], '')).status).toBe(404);
    expect((await Admin.removeTeachers(query, client, ME, '110', [], '')).status).toBe(400);
    expect((await Admin.removeTeachers(query, client, ME, '110', 'nope', '')).status).toBe(400);
    const tooMany = Array.from({ length: 31 }, (_, i) => `92300111${String(i).padStart(4, '0')}`);
    expect((await Admin.removeTeachers(query, client, ME, '110', tooMany, '')).status).toBe(400);
    expect((await Admin.removeTeachers(query, client, ME, '999', ['923001110001'], '')).status).toBe(404);
    expect(client.removeTeachers).not.toHaveBeenCalled();
  });
});
