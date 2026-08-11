/**
 * School FK read path (bd-2533).
 *
 * After the migration, `schools` is the source of truth (465 rows, EMIS-keyed)
 * and `users.school_id` is populated for 8,797 users. Code should read the
 * school through the FK, falling back to the legacy free-text `users.school_name`
 * only while that column still exists (its removal is bd-2535, deferred because
 * dashboard access-scoping filters on school_name_lower inside mv_* views).
 */

let fromCaptor;

function load({ userRow = null, schoolRow = null, error = null } = {}) {
  jest.resetModules();
  fromCaptor = [];

  const makeChain = (row) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: row, error }),
      single: () => Promise.resolve({ data: row, error }),
    };
    return chain;
  };

  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (table) => {
      fromCaptor.push(table);
      return makeChain(table === 'schools' ? schoolRow : userRow);
    },
  }));

  return require('../../bot/shared/services/schools/school-resolver.service');
}

describe('resolveUserSchool', () => {
  it('returns the FK-joined school when school_id is set', async () => {
    const svc = load({
      userRow: { id: 'u-1', school_id: 's-1', school_name: 'IMSG(VI-X) G7/2' },
      schoolRow: { id: 's-1', name: 'IMSG (VI-X) G-7/2', region: 'Urban-I', emis: '214', is_probable_test: false },
    });
    const out = await svc.resolveUserSchool('u-1');

    // The FK name wins over the drifted free text — that is the whole point.
    expect(out).toMatchObject({ id: 's-1', name: 'IMSG (VI-X) G-7/2', emis: '214', source: 'fk' });
    expect(fromCaptor).toContain('schools');
  });

  it('falls back to the legacy free-text name when school_id is NULL', async () => {
    const svc = load({ userRow: { id: 'u-2', school_id: null, school_name: 'ICB' } });
    const out = await svc.resolveUserSchool('u-2');

    expect(out).toMatchObject({ id: null, name: 'ICB', source: 'legacy_text' });
  });

  it('returns null when the user has neither a FK nor free text', async () => {
    const svc = load({ userRow: { id: 'u-3', school_id: null, school_name: null } });
    expect(await svc.resolveUserSchool('u-3')).toBeNull();
  });

  it('returns null for an unknown user without throwing', async () => {
    const svc = load({ userRow: null });
    expect(await svc.resolveUserSchool('nope')).toBeNull();
  });

  it('surfaces is_probable_test so callers can exclude the 19 junk schools', async () => {
    const svc = load({
      userRow: { id: 'u-4', school_id: 's-9', school_name: null },
      schoolRow: { id: 's-9', name: 'Taleemabad', region: null, emis: '1', is_probable_test: true },
    });
    expect((await svc.resolveUserSchool('u-4')).is_probable_test).toBe(true);
  });

  it('does not throw when the user lookup errors — school display is never critical path', async () => {
    const svc = load({ userRow: null, error: { message: 'boom' } });
    await expect(svc.resolveUserSchool('u-5')).resolves.toBeNull();
  });
});

describe('findSchoolByEmis', () => {
  it('looks a school up by its government EMIS id', async () => {
    const svc = load({ schoolRow: { id: 's-1', name: 'IMS(I-V) F-7/2', emis: '231', region: 'Urban-I' } });
    expect(await svc.findSchoolByEmis('231')).toMatchObject({ emis: '231', name: 'IMS(I-V) F-7/2' });
  });

  it('returns null for a blank or missing emis instead of querying', async () => {
    const svc = load({});
    expect(await svc.findSchoolByEmis('')).toBeNull();
    expect(await svc.findSchoolByEmis(null)).toBeNull();
    expect(fromCaptor).toHaveLength(0);
  });
});
