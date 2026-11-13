'use strict';
/**
 * bd-33wxxi.4 — whom a PRINCIPAL on the principal app may observe (#55 P3).
 *
 * The /observe roster (patch-resolver.service.js listPatchViaSupabase, read by LeaderSource for the portal and the
 * WhatsApp visit flow) is a leader's leader_schools holdings: 42 of 499 principals on prod have any. A principal on the
 * principal app (app_settings.portal_principal_app names her, or is true) observes HER OWN school instead: the
 * teachers whose users.school_id is hers — never herself, never another principal. Everyone else, every principal the
 * switch does not name included, reads exactly what they read today.
 */
const { createFakePostgrest } = require('../portal/helpers/fake-postgrest');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const ph = (n) => '92' + '000' + String(n).padStart(7, '0');
let tables;
function baseTables() {
  return {
    app_settings: [],
    schools: [{ id: 's-1', name: 'Own School', emis: '1126' }, { id: 's-2', name: 'Held School', emis: '2002' }],
    leader_schools: [
      // the principal also holds another school (a coach-style holding): the principal app reads her own school only
      { leader_user_id: 'p-1', school_id: 's-2', school_ext_id: 'niete:2002' },
      { leader_user_id: 'c-1', school_id: 's-1', school_ext_id: 'niete:1126' },
    ],
    users: [
      { id: 'p-1', phone_number: ph(1), name: 'Principal One', role: 'principal', school_id: 's-1', teacher_level: null },
      { id: 'p-2', phone_number: ph(2), name: 'Principal Two', role: 'principal', school_id: 's-1', teacher_level: null },
      { id: 't-1', phone_number: ph(3), name: 'Ayesha Sample', role: 'teacher', school_id: 's-1', teacher_level: ['PRIMARY'] },
      { id: 't-2', phone_number: ph(4), name: 'Bina Sample', role: 'teacher', school_id: 's-1', teacher_level: null },
      { id: 't-3', phone_number: ph(5), name: 'Held Teacher', role: 'teacher', school_id: 's-2', teacher_level: null },
      { id: 'c-1', phone_number: ph(6), name: 'Coach One', role: 'coach', school_id: null, teacher_level: null },
    ],
  };
}

let supabase;
let Patch;
beforeEach(() => {
  jest.resetModules();
  tables = baseTables();
  supabase = createFakePostgrest({ tables });
  jest.doMock('../../bot/shared/config/supabase', () => supabase);
  Patch = require('../../bot/shared/services/observe/patch-resolver.service');
});

const names = (rows) => rows.map((r) => r.name).sort();
const on = (value) => { supabase = createFakePostgrest({ tables: { ...tables, app_settings: [{ key: 'portal_principal_app', value }] } }); };

describe('listPatchViaSupabase — a principal on the principal app', () => {
  test('switch absent: a principal reads her holdings, as today', async () => {
    expect(names(await Patch.listPatchViaSupabase(supabase, 'p-1'))).toEqual(['Held Teacher']);
  });

  test('switch names her: her OWN school\'s teachers — not herself, not the other principal, not her holdings', async () => {
    on(['p-1']);
    const rows = await Patch.listPatchViaSupabase(supabase, 'p-1');
    expect(names(rows)).toEqual(['Ayesha Sample', 'Bina Sample']);
    expect(rows.every((r) => r.emis === '1126')).toBe(true);
  });

  test('true (every principal) reads the same way; a school filter does not empty it', async () => {
    on(true);
    expect(names(await Patch.listPatchViaSupabase(supabase, 'p-1', 'niete:9999'))).toEqual(['Ayesha Sample', 'Bina Sample']);
  });

  test('a principal the switch does not name, and a coach it names, are unchanged', async () => {
    on(['p-2', 'c-1']);
    expect(names(await Patch.listPatchViaSupabase(supabase, 'p-1'))).toEqual(['Held Teacher']);
    const coach = await Patch.listPatchViaSupabase(supabase, 'c-1');
    expect(names(coach)).toEqual(['Ayesha Sample', 'Bina Sample', 'Principal One', 'Principal Two']);
  });

  test('her row naming no school: today\'s holdings (nothing invented)', async () => {
    tables.users.find((u) => u.id === 'p-1').school_id = null;
    on(['p-1']);
    expect(names(await Patch.listPatchViaSupabase(supabase, 'p-1'))).toEqual(['Held Teacher']);
  });
});

describe('LeaderSource.resolveTeacher — the bind step for a principal on the principal app', () => {
  test('a teacher of her school binds; herself, another principal and a teacher elsewhere do not', async () => {
    on(['p-1']);
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => supabase);
    const LeaderSource = require('../../bot/shared/services/observe/assignment/leader-source');
    expect(await LeaderSource.resolveTeacher('p-1', ph(3))).toMatchObject({ teacher_name: 'Ayesha Sample', user_id: 't-1' });
    expect(await LeaderSource.resolveTeacher('p-1', ph(1))).toBeNull();
    expect(await LeaderSource.resolveTeacher('p-1', ph(2))).toBeNull();
    expect(await LeaderSource.resolveTeacher('p-1', ph(5))).toBeNull();
  });
});
