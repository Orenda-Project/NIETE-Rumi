/**
 * fde_production → NIETE schools/principals migration transforms (bd-2533/bd-2534).
 *
 * Every expectation below encodes a number or row measured live on 2026-08-10
 * against the two real databases, so the test fails if the migration's
 * judgement drifts from the evidence that justified it.
 */

const {
  canonicalizeSchoolName,
  normalizePhonePk,
  transformSchool,
  schoolUpsertKey,
  planPrincipal,
  pickPrimarySchool,
  resolveBackfillRole,
} = require('../../bot/shared/services/schools/school-migration.transform');

describe('canonicalizeSchoolName — the 522-vs-465 drift', () => {
  it('collapses punctuation/spacing variants of the same school', () => {
    // Measured drift: target 'IMSG(VI-X) G7/2' vs source 'IMSG (VI-X) G-7/2'.
    expect(canonicalizeSchoolName('IMSG(VI-X) G7/2')).toBe(canonicalizeSchoolName('IMSG (VI-X) G-7/2'));
    expect(canonicalizeSchoolName('IMS, G-6/1-2')).toBe(canonicalizeSchoolName('IMS(I-V) G-6/1-2'.replace('(I-V)', '')));
  });

  it('does NOT fabricate a match across Roman-numeral drift (that is EMIS work)', () => {
    // '1' vs 'I' is a real character difference; guessing here would merge schools.
    expect(canonicalizeSchoolName('IMS(1-V)F-7/2')).not.toBe(canonicalizeSchoolName('IMS(I-V) F-7/2'));
  });

  it('returns null for empty/blank input rather than an empty string key', () => {
    expect(canonicalizeSchoolName('')).toBeNull();
    expect(canonicalizeSchoolName('   ')).toBeNull();
    expect(canonicalizeSchoolName(null)).toBeNull();
  });
});

describe('normalizePhonePk — must match migrate-users.py exactly', () => {
  it.each([
    ['03215682285', '923215682285'],
    ['3215682285', '923215682285'],
    ['923215682285', '923215682285'],
    ['+92 321 5682285', '923215682285'],
    ['92321568228512345', '923215682285'], // truncates to 12
  ])('normalizes %s → %s', (raw, expected) => {
    expect(normalizePhonePk(raw)).toBe(expected);
  });

  it('rejects what cannot be a PK mobile (68 of 680 source principals)', () => {
    expect(normalizePhonePk('')).toBeNull();
    expect(normalizePhonePk(null)).toBeNull();
    expect(normalizePhonePk('12345')).toBeNull();
    expect(normalizePhonePk('not-a-phone')).toBeNull();
  });
});

describe('transformSchool', () => {
  it('maps a real ICT school with its joined region', () => {
    const out = transformSchool({
      id: 214, name: 'IMSG (VI-X) G-7/2', emis: 214, region_name: 'Urban-I', is_active: true, deleted_at: null,
    });
    expect(out).toMatchObject({
      emis: '214', name: 'IMSG (VI-X) G-7/2', region: 'Urban-I',
      source_school_id: 214, source_system: 'fde_production',
      is_active: true, is_probable_test: false,
    });
  });

  it('flags the 19 junk schools instead of dropping them — they hold 239 teachers + 21 principals', () => {
    // 'Taleemabad' emis=1 alone has 79 teachers attached; deleting orphans them.
    for (const name of ['Taleemabad', 'LUMS', 'Testing School', 'dummy', 'NIETE Test School 4',
      'Tabadlab testing school', 'School for report card testing.', 'FDE', 'Muhammad_school']) {
      expect(transformSchool({ id: 1, name, emis: 1, region_name: null }).is_probable_test).toBe(true);
    }
  });

  it('does not flag real schools as test', () => {
    for (const name of ['IMCG (I-XII) Tarnaul', 'IMSB(I-V)PINDMISTRIAN', 'IMS (I-V) I-10/2',
      'Ghazali Public High School', 'IMSG (I-X) Dhoke Gangal']) {
      expect(transformSchool({ id: 2, name, emis: 5, region_name: 'B.K' }).is_probable_test).toBe(false);
    }
  });

  it('treats a soft-deleted source row as inactive (3 rows, one with 11 teachers)', () => {
    const out = transformSchool({
      id: 483, name: 'IMSB(I-V) JHANG SYDEN', emis: 773, region_name: 'B.K',
      is_active: false, deleted_at: '2024-08-19T08:10:48Z',
    });
    expect(out.is_active).toBe(false);
  });

  it('normalizes a missing EMIS to null rather than the string "null"', () => {
    expect(transformSchool({ id: 4, name: 'NIETE1, H-9', emis: null, region_name: null }).emis).toBeNull();
  });

  it('drops a nameless row instead of writing a blank display name', () => {
    expect(transformSchool({ id: 9, name: '   ', emis: 7 })).toBeNull();
  });
});

describe('schoolUpsertKey — EMIS is identity, name is display', () => {
  it('keys on EMIS for the 460 schools that have one', () => {
    const key = schoolUpsertKey(transformSchool({ id: 214, name: 'IMSG (VI-X) G-7/2', emis: 214, region_name: 'Urban-I' }));
    expect(key).toEqual({ by: 'emis', emis: '214' });
  });

  it('falls back to (canonical name, region) for the 5 EMIS-less schools', () => {
    const key = schoolUpsertKey(transformSchool({ id: 4, name: 'NIETE1, H-9', emis: null, region_name: null }));
    expect(key.by).toBe('name_region');
    expect(key.name_canonical).toBe('NIETE1H9');
    expect(key.region).toBeNull();
  });
});

describe('planPrincipal — old DB wins, update-in-place not insert', () => {
  it('UPDATES the 440 principals who already exist as users (437 role=NULL, 3 teacher)', () => {
    const plan = planPrincipal({ phone: '03215682285', school_emis: '214' }, { id: 'u-1', role: null });
    expect(plan).toMatchObject({ action: 'update', user_id: 'u-1', role: 'principal', phone: '923215682285' });
  });

  it('promotes an existing role=teacher row rather than inserting a duplicate person', () => {
    expect(planPrincipal({ phone: '923215682285' }, { id: 'u-2', role: 'teacher' }).action).toBe('update');
  });

  it('INSERTS only when the phone is genuinely absent from users', () => {
    expect(planPrincipal({ phone: '923000000001', school_emis: '99' }, null))
      .toMatchObject({ action: 'insert', role: 'principal' });
  });

  it('never demotes a coach (79 coaches, 58 of them wired into leader_schools)', () => {
    const plan = planPrincipal({ phone: '923215682285' }, { id: 'u-3', role: 'coach' });
    expect(plan.action).toBe('skip');
    expect(plan.reason).toBe('existing_coach');
  });

  it('skips the 68 principals whose phone cannot be normalized', () => {
    expect(planPrincipal({ phone: 'n/a' }, null)).toMatchObject({ action: 'skip', reason: 'unnormalizable_phone' });
  });
});

describe('pickPrimarySchool — 1,158 source phones have more than one school', () => {
  // Real profile rows for one principal (923348538620), read from the legacy DB.
  const MULTI_SCHOOL_PRINCIPAL = [
    { school_emis: '222', is_probable_test: false, is_active: true, created: '2024-03-25T08:23:42Z' },
    { school_emis: '222', is_probable_test: false, is_active: true, created: '2024-03-25T08:28:56Z' },
    { school_emis: '100000', is_probable_test: true, is_active: true, created: '2024-10-25T06:45:38Z' }, // 'FDE'
    { school_emis: '220', is_probable_test: false, is_active: true, created: '2026-07-13T10:15:45Z' },
  ];

  it('never picks the stale FDE/test school over a real one', () => {
    expect(pickPrimarySchool(MULTI_SCHOOL_PRINCIPAL).school_emis).not.toBe('100000');
  });

  it('picks the NEWEST real school (emis 220, the 2026-07-13 profile)', () => {
    // Matches the free text already on the target row ('IMS G-7/3-3'), i.e. where she is now.
    expect(pickPrimarySchool(MULTI_SCHOOL_PRINCIPAL).school_emis).toBe('220');
  });

  it('picks the real school for 923339293281, not the internal-fixture row', () => {
    expect(pickPrimarySchool([
      { school_emis: '231', is_probable_test: false, is_active: true, created: '2024-03-25T08:23:45Z' },
      { school_emis: '100000', is_probable_test: true, is_active: true, created: '2024-10-25T06:45:38Z' },
    ]).school_emis).toBe('231');
  });

  it('prefers an active school over a soft-deleted one', () => {
    expect(pickPrimarySchool([
      { school_emis: '773', is_probable_test: false, is_active: false, created: '2026-01-01T00:00:00Z' },
      { school_emis: '212', is_probable_test: false, is_active: true, created: '2024-01-01T00:00:00Z' },
    ]).school_emis).toBe('212');
  });

  it('falls back to a test school when that is the ONLY option (239 teachers live there)', () => {
    expect(pickPrimarySchool([
      { school_emis: '1', is_probable_test: true, is_active: true, created: '2024-01-01T00:00:00Z' },
    ]).school_emis).toBe('1');
  });

  it('returns null for no candidates', () => {
    expect(pickPrimarySchool([])).toBeNull();
    expect(pickPrimarySchool(null)).toBeNull();
  });

  it('a real school in ANY profile beats a junk one in another (the cross-table case)', () => {
    // 923055549561 etc.: real school on the PRINCIPAL profile, only 'FDE' as a
    // teacher. The teacher pass runs last and must not win.
    expect(pickPrimarySchool([
      { school_emis: '271', is_probable_test: false, is_active: true, created: '2024-03-25T00:00:00Z' },
      { school_emis: '100000', is_probable_test: true, is_active: true, created: '2024-10-25T00:00:00Z' },
    ]).school_emis).toBe('271');
  });
});

describe('resolveBackfillRole — Option B, not a blanket teacher default', () => {
  it('labels an unregistered contact "unregistered", NOT "teacher"', () => {
    // 9,081 of 9,281 rows are role=NULL and ALL are registration_state='unregistered'.
    // Blanket-teacher would take the teacher count 114 → ~9,195 and corrupt every metric.
    expect(resolveBackfillRole({
      role: null, registration_completed: false, teacher_uuid: null, levels: null,
    })).toBe('unregistered');
  });

  it.each([
    ['registration_completed', { registration_completed: true }],
    ['teacher_uuid present', { teacher_uuid: 'abc-123' }],
    ['levels present', { levels: ['Grade Five'] }],
    ['training progress', { has_training_progress: true }],
  ])('labels "teacher" on positive evidence: %s', (_label, evidence) => {
    expect(resolveBackfillRole({ role: null, ...evidence })).toBe('teacher');
  });

  it('never overwrites an existing role', () => {
    expect(resolveBackfillRole({ role: 'coach', registration_completed: true })).toBe('coach');
    expect(resolveBackfillRole({ role: 'principal' })).toBe('principal');
    expect(resolveBackfillRole({ role: 'teacher' })).toBe('teacher');
  });

  it('treats an empty levels array as no evidence', () => {
    expect(resolveBackfillRole({ role: null, levels: [] })).toBe('unregistered');
  });
});
