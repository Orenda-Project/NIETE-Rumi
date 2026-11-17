/**
 * bd-97daxo.33 — scripts/load-school-districts.js: writes schools.district for a region's schools from a CSV
 * (scripts/data/gb-school-districts.csv, Moawin's workbook tab 3), and nothing else.
 *
 * The plan (pure, tested here): match each CSV row to ONE school of the region — by EMIS, else by trimmed name — and
 * refuse the whole load when any row is unmatched, ambiguous, has no district, names a district the area file does
 * not know, or when a region school would be left with none. Never a write to schools.region. The run (I/O) is a dry
 * run unless --commit, and writes an undo file before the first write.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../../scripts/load-school-districts');

const GB = 'Gilgit-Baltistan';
const school = (id, name, emis, district = null, extra = {}) => ({ id, name, emis, region: GB, district, is_active: true, is_probable_test: false, ...extra });
const SCHOOLS = [
  school('s1', 'MF Community School Warza Basin', '11676'),
  school('s2', 'MF Community School Hoto - MF community', null),
  school('s3', 'Akbarya Middle School Shigar - MF community', '71657', 'Shigar'),
  school('t1', 'GB Test School (Rumi QA)', null, null, { is_probable_test: true }),
];
const row = (school_name, emis, area, district) => ({ school_name, emis, area, district });
const CSV_ROWS = [
  row('MF Community School Warza Basin ', '11676', 'Gilgit', 'Gilgit'),
  row('MF  Community School Hoto - MF community', '', 'Baltistan', 'Skardu'),
  row('Akbarya Middle School Shigar - MF community', '71657', 'Baltistan', 'Shigar'),
];

describe('parseCsv', () => {
  test('header row, trimmed cells, quoted commas', () => {
    const text = 'school_name,emis,area,district\n"School, One",123,Gilgit,Gilgit\nTwo ,,Baltistan, Skardu\n';
    expect(L.parseCsv(text)).toEqual([
      { school_name: 'School, One', emis: '123', area: 'Gilgit', district: 'Gilgit' },
      { school_name: 'Two', emis: '', area: 'Baltistan', district: 'Skardu' },
    ]);
  });
});

describe('planDistrictLoad', () => {
  test('EMIS first, else the trimmed name (spaces collapsed, any case); unchanged rows are not written', () => {
    const plan = L.planDistrictLoad(CSV_ROWS, SCHOOLS, { region: GB });
    expect(plan.refused).toEqual([]);
    expect(plan.updates).toEqual([
      { id: 's1', name: 'MF Community School Warza Basin', emis: '11676', from: null, to: 'Gilgit', area: 'Gilgit', by: 'emis' },
      { id: 's2', name: 'MF Community School Hoto - MF community', emis: null, from: null, to: 'Skardu', area: 'Baltistan', by: 'name' },
    ]);
    expect(plan.unchanged.map((u) => u.id)).toEqual(['s3']);
    // a test school is not the region's to fill
    expect(plan.missing).toEqual([]);
  });

  test('every refusal is listed, and any refusal means no update at all', () => {
    const plan = L.planDistrictLoad([
      ...CSV_ROWS,
      row('Nowhere School', '999', 'Gilgit', 'Gilgit'),
      row('No District', '11676', 'Gilgit', ''),
      row('Hunza Valley School', '', 'Gilgit', 'Hunza'),
      row('MF Community School Warza Basin', '', 'Baltistan', 'Gilgit'),
    ], SCHOOLS, { region: GB });
    expect(plan.updates).toEqual([]);
    expect(plan.refused.map((r) => r.reason)).toEqual([
      'no school of the region matches it (EMIS or name)',
      'no district',
      "district 'Hunza' is in no area of dashboard/config/gb-areas.json",
      "area 'Baltistan' does not hold district 'Gilgit' (gb-areas.json)",
    ]);
  });

  test('a school two rows claim, or a name two schools share, is refused', () => {
    const twice = L.planDistrictLoad([...CSV_ROWS, row('Warza again', '11676', 'Gilgit', 'Gilgit')], SCHOOLS, { region: GB });
    expect(twice.refused.map((r) => r.reason)).toEqual(['school already matched by another row']);
    const shared = L.planDistrictLoad([row('Same', '', 'Gilgit', 'Gilgit')], [school('a', 'Same', null), school('b', 'same', null)], { region: GB });
    expect(shared.refused.map((r) => r.reason)).toContain('more than one school of the region has this name');
    expect(shared.updates).toEqual([]);
  });

  test('a school of another region is never matched, even by EMIS', () => {
    const plan = L.planDistrictLoad([row('IMSG Sihala', '101', 'Gilgit', 'Gilgit')], [school('x', 'IMSG Sihala', '101', null, { region: 'Sihala' })], { region: GB });
    expect(plan.refused.map((r) => r.reason)).toEqual(['no school of the region matches it (EMIS or name)']);
  });

  test('a counted school of the region that no row names is reported as missing (and refused)', () => {
    const plan = L.planDistrictLoad(CSV_ROWS.slice(0, 2), SCHOOLS, { region: GB });
    expect(plan.missing.map((m) => m.id)).toEqual(['s3']);
    expect(plan.updates).toEqual([]);
    expect(plan.refused.map((r) => r.reason)).toEqual(['a school of the region is in no row: Akbarya Middle School Shigar - MF community']);
  });

  test('an existing different district is changed only when the plan says so (from → to shown)', () => {
    const plan = L.planDistrictLoad([row('Akbarya Middle School Shigar - MF community', '71657', 'Baltistan', 'Skardu'), ...CSV_ROWS.slice(0, 2)], SCHOOLS, { region: GB });
    expect(plan.updates.find((u) => u.id === 's3')).toMatchObject({ from: 'Shigar', to: 'Skardu' });
  });
});

describe('run', () => {
  const fakeDb = (schools) => {
    const writes = [];
    return {
      writes,
      readSchools: async (region) => schools.filter((s) => s.region === region).map((s) => ({ ...s })),
      writeDistrict: async (id, district) => { writes.push({ id, district }); },
    };
  };

  test('a dry run writes nothing, not even an undo file', async () => {
    const db = fakeDb(SCHOOLS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'districts-'));
    const undoFile = path.join(dir, 'undo.json');
    const out = await L.run({ db, rows: CSV_ROWS, region: GB, commit: false, undoFile });
    expect(out.committed).toBe(false);
    expect(db.writes).toEqual([]);
    expect(fs.existsSync(undoFile)).toBe(false);
  });

  test('--commit: the undo file first (every school\'s district before), then only district writes', async () => {
    const db = fakeDb(SCHOOLS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'districts-'));
    const undoFile = path.join(dir, 'undo.json');
    const out = await L.run({ db, rows: CSV_ROWS, region: GB, commit: true, undoFile });
    expect(out.committed).toBe(true);
    expect(db.writes).toEqual([{ id: 's1', district: 'Gilgit' }, { id: 's2', district: 'Skardu' }]);
    const undo = JSON.parse(fs.readFileSync(undoFile, 'utf8'));
    expect(undo.region).toBe(GB);
    expect(undo.before).toEqual([{ id: 's1', district: null }, { id: 's2', district: null }]);
  });

  test('--commit refuses without an undo file, and refuses when the plan has a refusal', async () => {
    await expect(L.run({ db: fakeDb(SCHOOLS), rows: CSV_ROWS, region: GB, commit: true })).rejects.toThrow(/undo/);
    const db = fakeDb(SCHOOLS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'districts-'));
    await expect(L.run({ db, rows: [...CSV_ROWS, row('Nowhere', '9', 'Gilgit', 'Gilgit')], region: GB, commit: true, undoFile: path.join(dir, 'u.json') }))
      .rejects.toThrow(/refused/);
    expect(db.writes).toEqual([]);
  });

  test('undo: puts every district back as the undo file has it', async () => {
    const db = fakeDb(SCHOOLS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'districts-'));
    const undoFile = path.join(dir, 'undo.json');
    fs.writeFileSync(undoFile, JSON.stringify({ region: GB, before: [{ id: 's1', district: null }, { id: 's3', district: 'Shigar' }] }));
    const dry = await L.undo({ db, undoFile, commit: false });
    expect(dry.committed).toBe(false);
    expect(db.writes).toEqual([]);
    await L.undo({ db, undoFile, commit: true });
    expect(db.writes).toEqual([{ id: 's1', district: null }, { id: 's3', district: 'Shigar' }]);
  });
});
