'use strict';
/**
 * bd-8kxvg5 — add a tester to NIETE SANDBOX in one command: an ICT teacher (grades 3 and 6-8, the sandbox test
 * school, a Grade 3 and a Grade 6 class) with Make my own on, and (for the shared login) a portal password.
 * It must be impossible to run anywhere but sandbox: env name AND the Supabase project ref are both checked.
 */
const { fakeDb } = require('../fa-video/fake-db');
const {
  SANDBOX_REF, FLAG_KEY, assertSandbox, toStoredPhone, parseArgs, addTester,
} = require('../../shared/services/sandbox-tester');

const SANDBOX_ENV = { RAILWAY_ENVIRONMENT_NAME: 'sandbox', SUPABASE_URL: `https://${SANDBOX_REF}.supabase.co` };
const PHONE = '03000000043'; // not a real teacher: the repo is public

function deps(tables, env = SANDBOX_ENV) {
  const db = fakeDb(tables);
  const calls = { create: [], assign: [] };
  const classes = {
    async createClass(p) { calls.create.push(p); return { class: { id: `class-${p.gradeCode}` }, created: true }; },
    async assignTeacher(p) { calls.assign.push(p); return { ok: true }; },
  };
  const hash = async (pw) => `hashed:${pw}`;
  return { db, classes, hash, env, calls };
}

describe('assertSandbox — refuses every environment but NIETE sandbox', () => {
  test.each([
    ['production', { RAILWAY_ENVIRONMENT_NAME: 'production', SUPABASE_URL: 'https://ihzciabopbttygxxgrkm.supabase.co' }],
    ['staging', { RAILWAY_ENVIRONMENT_NAME: 'staging', SUPABASE_URL: `https://${SANDBOX_REF}.supabase.co` }],
    ['no env name', { SUPABASE_URL: `https://${SANDBOX_REF}.supabase.co` }],
    ['sandbox name, production database', { RAILWAY_ENVIRONMENT_NAME: 'sandbox', SUPABASE_URL: 'https://ihzciabopbttygxxgrkm.supabase.co' }],
    ['sandbox name, no database', { RAILWAY_ENVIRONMENT_NAME: 'sandbox' }],
    ['look-alike host', { RAILWAY_ENVIRONMENT_NAME: 'sandbox', SUPABASE_URL: `https://${SANDBOX_REF}x.supabase.co` }],
  ])('%s → throws', (_, env) => {
    expect(() => assertSandbox(env)).toThrow(/sandbox only/);
  });

  test('sandbox name + sandbox database → passes', () => {
    expect(() => assertSandbox(SANDBOX_ENV)).not.toThrow();
  });
});

describe('toStoredPhone', () => {
  test.each([['03000000043'], ['0300 000 0043'], ['+92 300 0000043'], ['923000000043'], ['3000000043']])('%s → 923000000043', (raw) => {
    expect(toStoredPhone(raw)).toBe('923000000043');
  });
  test.each([['12345'], ['447700900123'], [''], [undefined]])('%s → throws', (raw) => {
    expect(() => toStoredPhone(raw)).toThrow(/Pakistani mobile/);
  });
});

describe('parseArgs', () => {
  test('reads --phone, --name, --password', () => {
    expect(parseArgs(['--phone', PHONE, '--name', 'Test Teacher', '--password', 'Rumi2026test']))
      .toEqual({ phone: PHONE, name: 'Test Teacher', password: 'Rumi2026test' });
  });
  test('--phone is required', () => {
    expect(() => parseArgs(['--name', 'x'])).toThrow(/--phone/);
  });
  test('a password needs 8 characters and a number (the portal rule)', () => {
    expect(() => parseArgs(['--phone', PHONE, '--password', 'short1'])).toThrow(/8 characters/);
    expect(() => parseArgs(['--phone', PHONE, '--password', 'nonumberhere'])).toThrow(/8 characters/);
  });
});

describe('addTester', () => {
  test('off sandbox: throws before any read or write', async () => {
    const d = deps({ users: [], app_settings: [] }, { RAILWAY_ENVIRONMENT_NAME: 'production', SUPABASE_URL: 'https://ihzciabopbttygxxgrkm.supabase.co' });
    await expect(addTester({ phone: PHONE }, d)).rejects.toThrow(/sandbox only/);
    expect(d.db.writes).toEqual([]);
    expect(d.calls.create).toEqual([]);
  });

  test('a new number becomes a registered ICT teacher, G3 + G6-8, test school, flagged test user', async () => {
    const d = deps({ users: [], app_settings: [{ key: FLAG_KEY, value: ['someone-else'] }] });
    const out = await addTester({ phone: PHONE, name: 'Sandbox Tester' }, d);
    const u = d.db.from && (await d.db.from('users').select().eq('phone_number', '923000000043').maybeSingle()).data;
    expect(out).toMatchObject({ userId: u.id, created: true, flag: 'added', password: 'unchanged' });
    expect(u).toMatchObject({
      phone_number: '923000000043', name: 'Sandbox Tester', role: 'teacher', region: 'ict', organization: 'niete',
      country: 'PK', registration_state: 'completed', registration_completed: true, is_test_user: true,
      school_id: '8e35cffb-358d-4fa9-bb36-b5717fb53eb0', teacher_level: ['PRIMARY', 'MIDDLE'],
    });
    expect(JSON.parse(u.grades_taught)).toEqual(['grade_3', 'grade_6', 'grade_7', 'grade_8']);
    expect(u.subjects_taught).toEqual(expect.arrayContaining(['english', 'maths', 'urdu', 'general_science']));
    expect(u.portal_password_hash).toBeUndefined();
  });

  test('Make my own: her id joins the list, once', async () => {
    const d = deps({ users: [], app_settings: [{ key: FLAG_KEY, value: ['someone-else'] }] });
    const { userId } = await addTester({ phone: PHONE }, d);
    await addTester({ phone: PHONE }, d);
    const row = (await d.db.from('app_settings').select().eq('key', FLAG_KEY).maybeSingle()).data;
    expect(row.value).toEqual(['someone-else', userId]);
  });

  test.each([[true], ['teachers']])('flag already on for everyone (%p): left alone', async (value) => {
    const d = deps({ users: [], app_settings: [{ key: FLAG_KEY, value }] });
    const out = await addTester({ phone: PHONE }, d);
    expect(out.flag).toBe('already_on');
    expect(d.db.writes.filter((w) => w.table === 'app_settings')).toEqual([]);
  });

  test('flag absent: written as a list holding her', async () => {
    const d = deps({ users: [], app_settings: [] });
    const { userId } = await addTester({ phone: PHONE }, d);
    const row = (await d.db.from('app_settings').select().eq('key', FLAG_KEY).maybeSingle()).data;
    expect(row.value).toEqual([userId]);
  });

  test('a Grade 3 class (maths, urdu, english) and a Grade 6 class (english, maths, general science)', async () => {
    const d = deps({ users: [], app_settings: [] });
    const { userId } = await addTester({ phone: PHONE }, d);
    expect(d.calls.create.map((c) => [c.gradeCode, c.sessionCode, c.schoolId])).toEqual([
      ['grade_3', '2026-2027', '8e35cffb-358d-4fa9-bb36-b5717fb53eb0'],
      ['grade_6', '2026-2027', '8e35cffb-358d-4fa9-bb36-b5717fb53eb0'],
    ]);
    expect(d.calls.assign).toEqual([
      { classId: 'class-grade_3', teacherUserId: userId, isClassTeacher: false, subjectCodes: ['maths', 'urdu', 'english'] },
      { classId: 'class-grade_6', teacherUserId: userId, isClassTeacher: false, subjectCodes: ['english', 'maths', 'general_science'] },
    ]);
  });

  test('a class that cannot be made stops the run with its reason', async () => {
    const d = deps({ users: [], app_settings: [] });
    d.classes.createClass = async () => ({ error: 'unknown_session' });
    await expect(addTester({ phone: PHONE }, d)).rejects.toThrow(/grade_3.*unknown_session/);
  });

  test('an existing number is updated in place, never duplicated', async () => {
    const d = deps({ users: [{ id: 'u-old', phone_number: '923000000043', name: 'Old', region: 'gilgit-baltistan' }], app_settings: [] });
    const out = await addTester({ phone: PHONE }, d);
    const all = (await d.db.from('users').select().eq('phone_number', '923000000043')).data;
    expect(all).toHaveLength(1);
    expect(out).toMatchObject({ userId: 'u-old', created: false });
    expect(all[0]).toMatchObject({ region: 'ict', name: 'Old' });
  });

  test('--password sets the portal password (hashed) and activates the portal', async () => {
    const d = deps({ users: [], app_settings: [] });
    const out = await addTester({ phone: PHONE, password: 'Rumi2026test' }, d);
    const u = (await d.db.from('users').select().eq('id', out.userId).maybeSingle()).data;
    expect(out.password).toBe('set');
    expect(u).toMatchObject({ portal_password_hash: 'hashed:Rumi2026test', portal_activated: true });
  });
});
