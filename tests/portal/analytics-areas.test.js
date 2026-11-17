/**
 * bd-97daxo.33 — areas: Moawin's Gilgit-Baltistan view split into Gilgit and Baltistan by schools.district,
 * from data (dashboard/config/gb-areas.json). Access stays on schools.region; FDE's six have no areas.
 */
const Areas = require('../../dashboard/lib/analytics-areas');

const GB = 'Gilgit-Baltistan';
const SIX = ['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol'];

describe('areasFor', () => {
  test('FDE\'s six have no areas: null, so FDE never meets the area rule', () => {
    expect(Areas.areasFor(SIX)).toBeNull();
    expect(Areas.areasFor([])).toBeNull();
    expect(Areas.areasFor(null)).toBeNull();
  });

  test('Gilgit-Baltistan: Gilgit then Baltistan, then Area not set; every district from the file', () => {
    const plan = Areas.areasFor([GB]);
    expect(plan.areas).toEqual(['Gilgit', 'Baltistan']);
    expect(plan.buckets).toEqual(['Gilgit', 'Baltistan', Areas.AREA_NOT_SET]);
    expect(plan.regions).toEqual([GB]);
    expect(plan.districts).toEqual({ Gilgit: ['Gilgit', 'Diamer', 'Astore', 'Ghizer', 'Darel'], Baltistan: ['Skardu', 'Shigar', 'Ghanche', 'Kharmang'] });
    for (const d of ['Gilgit', 'Diamer', 'Astore', 'Ghizer', 'Darel']) expect(plan.areaOf(d)).toBe('Gilgit');
    for (const d of ['Skardu', 'Shigar', 'Ghanche', 'Kharmang']) expect(plan.areaOf(d)).toBe('Baltistan');
    expect(plan.areaOf(' skardu ')).toBe('Baltistan');
    expect(plan.areaOf('Hunza')).toBeNull();
    expect(plan.areaOf(null)).toBeNull();
  });

  test('the registry spelling decides nothing about case', () => {
    expect(Areas.areasFor(['gilgit-baltistan']).areas).toEqual(['Gilgit', 'Baltistan']);
  });
});

describe('parseAreaFilter', () => {
  const plan = Areas.areasFor([GB]);
  test.each([
    [undefined, null, 'all'], [null, null, 'all'], ['', null, 'all'], ['all', null, 'all'], ['ALL', null, 'all'],
    // what the page sent before areas: the whole region
    ['Gilgit-Baltistan', null, 'all'], ['gilgit-baltistan', null, 'all'],
    ['Gilgit', 'Gilgit', 'Gilgit'], ['baltistan', 'Baltistan', 'Baltistan'], [' Baltistan ', 'Baltistan', 'Baltistan'],
    ['area not set', Areas.AREA_NOT_SET, Areas.AREA_NOT_SET],
  ])('%p → %p', (raw, region, key) => {
    expect(Areas.parseAreaFilter(raw, plan)).toEqual({ ok: true, region, key });
  });
  test.each([['Sihala'], ['Skardu'], ['unassigned'], [42]])('%p is refused', (raw) => {
    expect(Areas.parseAreaFilter(raw, plan)).toEqual({ ok: false });
  });
});

describe('placeSchools / placeMembers / trimAreaNotSet', () => {
  const plan = Areas.areasFor([GB]);
  const districtById = new Map([['g1', 'Gilgit'], ['g2', 'Skardu'], ['g3', null], ['g4', 'Hunza']]);
  const schools = [
    { id: 'g1', region: GB, name: 'A' }, { id: 'g2', region: 'gilgit-baltistan', name: 'B' },
    { id: 'g3', region: GB, name: 'C' }, { id: 'g4', region: GB, name: 'D' },
    { id: 's1', region: 'Sihala', name: 'ICT' }, { id: 'x', region: 'Baltistan', name: 'stray' },
  ];

  test('a GB school takes its area (or Area not set) and its district; anything else is in no bucket', () => {
    const out = Areas.placeSchools(plan, schools, districtById);
    expect(out.map((s) => [s.id, s.region, s.district])).toEqual([
      ['g1', 'Gilgit', 'Gilgit'], ['g2', 'Baltistan', 'Skardu'], ['g3', Areas.AREA_NOT_SET, null],
      ['g4', Areas.AREA_NOT_SET, 'Hunza'], ['s1', null, null], ['x', null, null],
    ]);
    // pure: the rows read are not changed
    expect(schools[0].region).toBe(GB);
  });

  test('a member whose home is the region by users.region reads as Area not set; others are untouched', () => {
    const out = Areas.placeMembers(plan, [{ user_id: 'm1', region: GB }, { user_id: 'm2', region: 'ICT' }, { user_id: 'm3', region: null }]);
    expect(out.map((m) => m.region)).toEqual([Areas.AREA_NOT_SET, 'ICT', null]);
  });

  test('Area not set leaves every region list unless a counted school is in it', () => {
    const body = {
      success: true,
      regions: [{ region: 'Gilgit' }, { region: 'Baltistan' }, { region: Areas.AREA_NOT_SET }],
      sectorSubjects: [{ region: 'Gilgit' }, { region: Areas.AREA_NOT_SET }],
      human: { regions: [{ region: 'Gilgit' }, { region: Areas.AREA_NOT_SET }] },
      dc: { regions: [{ region: Areas.AREA_NOT_SET }] },
    };
    const trimmed = Areas.trimAreaNotSet(body, false);
    expect(trimmed.regions.map((r) => r.region)).toEqual(['Gilgit', 'Baltistan']);
    expect(trimmed.sectorSubjects.map((r) => r.region)).toEqual(['Gilgit']);
    expect(trimmed.human.regions.map((r) => r.region)).toEqual(['Gilgit']);
    expect(trimmed.dc.regions).toEqual([]);
    expect(Areas.trimAreaNotSet(body, true)).toBe(body);
  });
});

describe('loadPlacement', () => {
  const plan = Areas.areasFor([GB]);
  test('one read narrowed to the view\'s regions; Area not set is needed only for a counted school', async () => {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [
        { id: 'g1', district: 'Gilgit', is_active: true, is_probable_test: false },
        { id: 'g2', district: ' Skardu ', is_active: true, is_probable_test: false },
        // no district, but a test school: not counted, so no Area not set card
        { id: 't1', district: null, is_active: true, is_probable_test: true },
      ] };
    };
    const out = await Areas.loadPlacement(query, plan);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual([[GB]]);
    expect(calls[0].sql).toMatch(/FROM schools WHERE region = ANY\(\$1::text\[\]\)/);
    expect([...out.districtById]).toEqual([['g1', 'Gilgit'], ['g2', 'Skardu'], ['t1', null]]);
    expect(out.needsNotSet).toBe(false);
  });

  test('a counted school with no area needs the Area not set card', async () => {
    const query = async () => ({ rows: [{ id: 'g9', district: '', is_active: true, is_probable_test: false }] });
    expect((await Areas.loadPlacement(query, plan)).needsNotSet).toBe(true);
  });

  test('before the migration (no district column) every school is Area not set, never a failed page', async () => {
    let n = 0;
    const query = async (sql) => {
      n += 1;
      if (/SELECT id, district/.test(sql)) { const e = new Error('column "district" does not exist'); e.code = '42703'; throw e; }
      return { rows: [{ id: 'g1', district: null, is_active: true, is_probable_test: false }] };
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await Areas.loadPlacement(query, plan);
    warn.mockRestore();
    expect(n).toBe(2);
    expect(out.needsNotSet).toBe(true);
    expect(out.districtById.get('g1')).toBeNull();
  });

  test('any other read error is not swallowed', async () => {
    const query = async () => { throw new Error('pool exhausted'); };
    await expect(Areas.loadPlacement(query, plan)).rejects.toThrow('pool exhausted');
  });
});
