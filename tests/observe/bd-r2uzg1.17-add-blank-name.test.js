/**
 * Adding a teacher whose number already has an account WITH NO NAME (red-first).
 *
 * Coach /observe -> Manage teachers -> Add, with a number that is already on
 * record. The name screen used to appear only for an UNKNOWN number, so a found
 * account went straight to the confirm screen: "Name: " printed blank, nothing
 * asked for one, and commitAdd's move path wrote only the school. The teacher
 * landed in the coach's school nameless. Production, 1 Oct-12 Nov: 32 of 287
 * 'move' rows carried no name; 29 live teachers with a school have none.
 *
 * The fix, as approved:
 *   · a found account whose name is blank gets the name screen BEFORE confirm;
 *   · the move writes that name, ONLY when the record is still blank (the guard
 *     is in the write, so a name that arrived since the plan is never
 *     overwritten), with an `edit_name` audit row beside the `move` row;
 *   · a named account is untouched and still skips the name screen.
 *
 * Mocked at the network boundary only: Supabase is the in-memory table double,
 * so the handler -> planAdd -> commitAdd -> port chain runs for real. The
 * school list and the schedule reads are stubbed because this suite is about
 * the add steps, not those screens.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_SCHEDULING_UI = 'true';

const { tableDouble } = require('../../bot/tests/helpers/table-double');
const flow = require('../../docs/flows/observe-visit-v2.json');

const COACH = 'c0000000-0000-4000-8000-000000000001';
const T_ID = 'a0000000-0000-4000-8000-000000000002';
const PHONE = '923001234567';
const TO = { ext: 'niete:916', id: 's916', name: 'IMCG, G-10/2', emis: '916' };
const FROM = { id: 's273', name: 'IMS(I-V) No.2 G-10/2', emis: '273' };

let db;
let handler;
let T;

function seed(teacher = {}) {
  db = tableDouble({
    leader_schools: [{ leader_user_id: COACH, school_ext_id: TO.ext }],
    schools: [
      { id: TO.id, name: TO.name, emis: TO.emis, region: null, is_probable_test: false },
      { id: FROM.id, name: FROM.name, emis: FROM.emis, region: null, is_probable_test: false },
    ],
    users: [{
      id: T_ID, phone_number: PHONE, role: 'teacher', school_id: FROM.id, name: null,
      organization: null, is_test_user: false, deleted_at: null, ...teacher,
    }],
    leader_roster_audit: [],
  });
  jest.resetModules();
  jest.doMock('../../bot/shared/config/supabase', () => db);
  jest.doMock('../../bot/shared/services/observe/observe-schedule.service', () => ({
    listUpcoming: jest.fn(async () => []),
    listPendingDebriefs: jest.fn(async () => []),
  }));
  jest.doMock('../../bot/shared/services/observe/observe-school-admin.service', () => ({
    ...jest.requireActual('../../bot/shared/services/observe/observe-school-admin.service'),
    listMySchools: jest.fn(async () => ([{ school_ext_id: TO.ext, school_name: TO.name, emis: TO.emis }])),
  }));
  handler = require('../../bot/shared/handlers/observe-visit-flow.handler');
  T = require('../../bot/shared/services/observe/observe-teacher-admin.service');
}

const coach = (lang = 'en') => ({ id: COACH, preferred_language: lang });
const step = (s, data = {}, lang = 'en') =>
  handler.handle(COACH, 'data_exchange', '', { step: s, ...data }, COACH, coach(lang));
const teacherRow = () => db.tables.users.find((u) => u.id === T_ID);
const audit = (action) => db.tables.leader_roster_audit.filter((r) => r.action === action);
const declared = (sid) => Object.keys(((flow.screens.find((x) => x.id === sid) || {}).data) || {});

// ── the screens ────────────────────────────────────────────────────────

describe('a found account with NO name asks for one before the confirm', () => {
  it.each([[null], [''], ['   ']])('name %p -> the name screen, nothing written', async (blank) => {
    seed({ name: blank });
    const res = await step('teacher_add_lookup', { school_ext_id: TO.ext, phone: '0300 1234567' });
    expect(res.screen).toBe('TEACHER_NAME');
    expect(res.data).toMatchObject({ school_ext_id: TO.ext, phone: PHONE });
    expect(res.data.intro).toContain(PHONE);
    expect(res.data.intro).toMatch(/no name/i);
    expect(res.data.intro).toMatch(/full name/i);
    expect(res.data.intro).not.toContain('${');
    // Every key the published screen declares, or WhatsApp fails it silently.
    expect(declared('TEACHER_NAME').filter((k) => !(k in res.data))).toEqual([]);
    expect(db.writes).toHaveLength(0);
  });

  it('speaks Urdu to an Urdu coach, and never says "app"', async () => {
    seed({ name: null });
    const res = await step('teacher_add_lookup', { school_ext_id: TO.ext, phone: PHONE }, 'ur');
    expect(res.screen).toBe('TEACHER_NAME');
    expect(res.data.intro).toMatch(/[؀-ۿ]/);
    expect(res.data.intro).toContain(PHONE);
    expect(res.data.intro).not.toMatch(/\bapp\b|ایپ/i);
  });

  it('a NAMED account still goes straight to the confirm, no name asked', async () => {
    seed({ name: 'Tahira Manzoor' });
    const res = await step('teacher_add_lookup', { school_ext_id: TO.ext, phone: PHONE });
    expect(res.screen).toBe('TEACHER_CONFIRM');
    expect(res.data.found_details).toContain('Tahira Manzoor');
  });

  it('the name screen hands the typed name to the confirm, still writing nothing', async () => {
    seed({ name: null });
    const res = await step('teacher_add_named', { school_ext_id: TO.ext, phone: PHONE, name: '  Ayesha Bibi ' });
    expect(res.screen).toBe('TEACHER_CONFIRM');
    expect(res.data.found_details).toContain('Ayesha Bibi');
    expect(res.data.found_details).toContain(FROM.name);
    // The confirm's commit payload carries ${data.name}: it must be the typed one.
    expect(res.data.name).toBe('Ayesha Bibi');
    expect(declared('TEACHER_CONFIRM').filter((k) => !(k in res.data))).toEqual([]);
    expect(db.writes).toHaveLength(0);
  });

  it('if the account was named between the two taps, the record\'s name wins', async () => {
    seed({ name: 'Tahira Manzoor' });
    const res = await step('teacher_add_named', { school_ext_id: TO.ext, phone: PHONE, name: 'Someone Else' });
    expect(res.screen).toBe('TEACHER_CONFIRM');
    expect(res.data.found_details).toContain('Tahira Manzoor');
    expect(res.data.found_details).not.toContain('Someone Else');
    expect(res.data.name).toBe('Tahira Manzoor');
  });
});

// ── the write ──────────────────────────────────────────────────────────

describe('the move writes the name, only onto a blank record, with an edit_name row', () => {
  it('nameless account: school AND name written; move + edit_name audited', async () => {
    seed({ name: null });
    const res = await step('teacher_add_commit', { school_ext_id: TO.ext, phone: PHONE, name: 'Ayesha Bibi' });
    expect(res.screen).toBe('TEACHER_DONE');
    expect(res.data.body).toContain('Ayesha Bibi');
    expect(teacherRow()).toMatchObject({ school_id: TO.id, name: 'Ayesha Bibi' });

    expect(audit('move')).toHaveLength(1);
    expect(audit('move')[0]).toMatchObject({ teacher_name: 'Ayesha Bibi', to_school_ext_id: TO.ext });
    expect(audit('edit_name')).toHaveLength(1);
    // Same shape as the Edit -> Name path's rows: the account id, the phone, detail.to.
    expect(audit('edit_name')[0]).toMatchObject({
      actor_user_id: COACH, affected_leader_user_id: COACH,
      teacher_ext_id: T_ID, teacher_phone_e164: PHONE,
      detail: { via: 'observe_flow', to: 'Ayesha Bibi', on: 'add' },
    });
  });

  it('an empty-string name is blank too, and is filled', async () => {
    seed({ name: '' });
    await step('teacher_add_commit', { school_ext_id: TO.ext, phone: PHONE, name: 'Ayesha Bibi' });
    expect(teacherRow().name).toBe('Ayesha Bibi');
    expect(audit('edit_name')).toHaveLength(1);
  });

  it('a NAMED account keeps its name whatever the payload says; no edit_name row', async () => {
    seed({ name: 'Tahira Manzoor' });
    await step('teacher_add_commit', { school_ext_id: TO.ext, phone: PHONE, name: 'Someone Else' });
    expect(teacherRow()).toMatchObject({ school_id: TO.id, name: 'Tahira Manzoor' });
    expect(audit('move')).toHaveLength(1);
    expect(audit('edit_name')).toHaveLength(0);
  });

  it('no name supplied (the portal\'s move) still moves, and invents nothing', async () => {
    seed({ name: null });
    const res = await T.commitAdd({ actorLeaderUserId: COACH, schoolExtId: TO.ext, rawPhone: PHONE });
    expect(res.wrote).toBe(true);
    expect(teacherRow()).toMatchObject({ school_id: TO.id, name: null });
    expect(audit('edit_name')).toHaveLength(0);
  });

  it('the blank guard is in the write: a name that arrives mid-commit is never overwritten', async () => {
    seed({ name: null });
    // Someone names her between the plan's read and the name write: the moment
    // the school update lands, the row gains a name.
    const realFrom = db.from;
    db.from = (table) => {
      const q = realFrom(table);
      if (table !== 'users') return q;
      const realUpdate = q.update.bind(q);
      q.update = (patch, ...rest) => {
        if (patch && 'school_id' in patch) teacherRow().name = 'Named Meanwhile';
        return realUpdate(patch, ...rest);
      };
      return q;
    };
    await T.commitAdd({ actorLeaderUserId: COACH, schoolExtId: TO.ext, rawPhone: PHONE, name: 'Ayesha Bibi' });
    expect(teacherRow()).toMatchObject({ school_id: TO.id, name: 'Named Meanwhile' });
    expect(audit('edit_name')).toHaveLength(0);
  });

  it('a name write that fails leaves the move standing and claims no edit', async () => {
    seed({ name: null });
    const realFrom = db.from;
    db.from = (table) => {
      const q = realFrom(table);
      if (table !== 'users') return q;
      const realUpdate = q.update.bind(q);
      q.update = (patch, ...rest) => {
        if (patch && 'name' in patch) throw new Error('boom');
        return realUpdate(patch, ...rest);
      };
      return q;
    };
    const res = await T.commitAdd({ actorLeaderUserId: COACH, schoolExtId: TO.ext, rawPhone: PHONE, name: 'Ayesha Bibi' });
    expect(res.wrote).toBe(true);
    expect(teacherRow()).toMatchObject({ school_id: TO.id, name: null });
    expect(audit('move')).toHaveLength(1);
    expect(audit('edit_name')).toHaveLength(0);
  });
});
