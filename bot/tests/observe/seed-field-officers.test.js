/**
 * FEAT-053 bd-11 + bd-13 — field-officer seed: CSV parsing, validation,
 * explicit 5/5 A/B assignment, upsert planning (never duplicate a phone).
 *
 * The CSV itself lives OUTSIDE the repo (contains personal phone numbers);
 * the script takes --csv <path>. These tests exercise the pure functions.
 */

const { parseSeedCsv, buildUpsertPlan } = require('../../scripts/seed-field-officers');

const CSV = `rank,name,school_allocated,phone_e164,alt_phone_e164,organization,onboarding_arm
1,Elisha Mushi,Usagara Primary School,255785150099,,Silverleaf Academy,why_coaching
2,Lusungu Mgowe,Kindi Juu Primary School,255624781057,,Silverleaf Academy,functional
3,Lina Fokas,Kidachini Primary School,255621069876,,Silverleaf Academy,why_coaching
4,Gudila Mosha,Sambarai Primary School,255654010229,,Silverleaf Academy,functional
5,Mercylidya Nashon,Kirima Juu Primary School,255623025828,,Silverleaf Academy,why_coaching
6,Dafrosa Kway,Masoka Primary School,255627518822,,Silverleaf Academy,functional
7,Anna Minja,Kindi Kati Primary School,255749598711,,Silverleaf Academy,why_coaching
8,Fadhila Sambekwa,Merry Bennett Primary School,255629099536,,Silverleaf Academy,functional
9,Kelvin Frank,Singabora Primary School,255616520615,255757460615,Silverleaf Academy,why_coaching
10,Fidelis Mponda,Msasani Primary School,255716122544,,Silverleaf Academy,functional
`;

describe('parseSeedCsv', () => {
  test('parses 10 valid rows with exactly 5/5 arms', () => {
    const rows = parseSeedCsv(CSV);
    expect(rows).toHaveLength(10);
    const why = rows.filter(r => r.onboarding_arm === 'why_coaching');
    expect(why).toHaveLength(5);
    expect(rows.filter(r => r.onboarding_arm === 'functional')).toHaveLength(5);
    expect(rows[8]).toMatchObject({
      name: 'Kelvin Frank',
      phone_e164: '255616520615',
      alt_phone_e164: '255757460615',
    });
  });

  test('rejects malformed phone (not 255+9 digits)', () => {
    const bad = CSV.replace('255785150099', '0785150099');
    expect(() => parseSeedCsv(bad)).toThrow(/phone/i);
  });

  test('rejects blank phone', () => {
    const bad = CSV.replace('255785150099', '');
    expect(() => parseSeedCsv(bad)).toThrow(/phone/i);
  });

  test('rejects unknown arm value', () => {
    const bad = CSV.replace('why_coaching', 'mystery_arm');
    expect(() => parseSeedCsv(bad)).toThrow(/arm/i);
  });

  test('rejects unbalanced arms (4/6)', () => {
    const bad = CSV.replace(
      '9,Kelvin Frank,Singabora Primary School,255616520615,255757460615,Silverleaf Academy,why_coaching',
      '9,Kelvin Frank,Singabora Primary School,255616520615,255757460615,Silverleaf Academy,functional'
    );
    expect(() => parseSeedCsv(bad)).toThrow(/5\/5|balance/i);
  });
});

describe('buildUpsertPlan', () => {
  const rows = () => parseSeedCsv(CSV);

  test('new phone → insert with role, org, country, arm, registered', () => {
    const plan = buildUpsertPlan(rows(), {});
    expect(plan).toHaveLength(10);
    const ins = plan.find(p => p.phone === '255785150099');
    expect(ins.op).toBe('insert');
    expect(ins.fields).toMatchObject({
      phone_number: '255785150099',
      role: 'school_leader',
      country: 'TZ',
      organization: 'Silverleaf Academy',
      school_name: 'Usagara Primary School',
      preferred_language: 'sw',
      registration_completed: true,
    });
    expect(ins.fields.preferences).toMatchObject({ observe_onboarding_arm: 'why_coaching' });
  });

  test('existing phone (Silverleaf teacher row) → update role-flip, preserves existing name, merges preferences', () => {
    const existing = {
      '255624781057': {
        id: 'uuid-existing', phone_number: '255624781057',
        first_name: 'Lusungu', name: 'Lusungu M.',
        preferences: { some_flag: true },
      },
    };
    const plan = buildUpsertPlan(rows(), existing);
    const upd = plan.find(p => p.phone === '255624781057');
    expect(upd.op).toBe('update');
    expect(upd.userId).toBe('uuid-existing');
    expect(upd.fields.role).toBe('school_leader');
    // must NOT clobber an existing name
    expect(upd.fields.first_name).toBeUndefined();
    expect(upd.fields.name).toBeUndefined();
    // preferences merged, not replaced
    expect(upd.fields.preferences).toMatchObject({ some_flag: true, observe_onboarding_arm: 'functional' });
  });

  test('alt phone recorded in preferences (Kelvin Frank)', () => {
    const plan = buildUpsertPlan(rows(), {});
    const kelvin = plan.find(p => p.phone === '255616520615');
    expect(kelvin.fields.preferences).toMatchObject({ alt_phone: '255757460615' });
  });
});
