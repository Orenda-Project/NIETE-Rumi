'use strict';
/**
 * bd-pni007 — obs612, FDE's grade 6-12 observation tools as data: the wording is FDE's (generated from the
 * Annexure G excerpt, never hand-edited), the tool a lesson gets is the operator's 11 Nov defaults, and the
 * arithmetic is FDE's (English /148, Urdu /156, % = score x 100 / total, Section 7's bands on the %).
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockRows = { value: [] };
const mockFail = { on: false };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const q = {
      select: () => q,
      eq: (col, v) => {
        if (table === 'users') return { maybeSingle: async () => ({ data: { region: 'sihala' }, error: null }) };
        return Promise.resolve(mockFail.on ? { data: null, error: { message: 'down' } } : { data: mockRows.value, error: null });
      },
      in: () => Promise.resolve({ data: [], error: null }),
    };
    return q;
  }),
}));
jest.mock('../../bot/shared/services/region-registry', () => ({ organizationForRegion: async () => 'niete' }));

const { execFileSync } = require('child_process');
const path = require('path');
const O = require('../../bot/shared/services/coaching/frameworks/obs612');
const Switch = require('../../bot/shared/services/coaching/obs612-switch');

const ROOT = path.join(__dirname, '..', '..');

describe('the rubric data', () => {
  test('obs612.rubric.json is what the generator makes from the FDE excerpt (never hand-edited)', () => {
    const out = execFileSync('node', ['bot/scripts/build-obs612-rubric.js', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toMatch(/current/);
  });

  test('three tools, one id each, labelled FDE v1', () => {
    expect(O.IDS).toEqual({ gen: 'obs612-gen-v1', msci: 'obs612-msci-v1', enur: 'obs612-enur-v1' });
    expect(O.LABEL).toBe('FDE v1');
    expect(O.RUBRIC.source.letter).toBe('F.1-159/2010 (Academics)');
  });

  test("the General form: FDE's 35 Yes/No items in 6 sections, worded as printed", () => {
    const g = O.TOOLS.gen;
    expect(g.sections.map((s) => [s.key, s.items.length])).toEqual([
      ['env', 6], ['delivery', 10], ['management', 9], ['command', 6], ['assessment', 2], ['work', 2],
    ]);
    expect(g.sections[0].items[0].text).toBe('Well lit and airy classroom');
    // FDE's own lower case, kept
    expect(g.sections[1].items[6].text).toBe('organized pair and group activities');
    expect(g.sections[4].items[0].text).toBe('Students are assessed during and end of lesson.');
  });

  test('Maths & Science: 11 indicators at Level 0-3 with FDE level text, the 5-student check, the plan', () => {
    const m = O.TOOLS.msci;
    expect(m.indicators).toHaveLength(11);
    expect(m.indicators[1].text).toBe('A meticulous introduction/ opening provided based on specific Student Learning Outcomes (SLOs)');
    expect(m.indicators[1].levels[1]).toBe('Teacher begins with the current SLO and links it broadly to the topic.');
    expect(m.indicators.map((i) => i.stage)).toEqual([
      'Before the lesson', ...Array(8).fill('During the lesson'), 'After the lesson', 'After the lesson',
    ]);
    expect(m.student_check.levels[0]).toBe('Out of 5 students assessed, 1 or less student showed good understanding of the lesson taught');
    expect(m.development_plan.columns).toEqual(['Development area', 'Current level', 'Teacher goal', 'Action plan for the teacher']);
  });

  test("English & Urdu: sections, sheets and FDE's totals (148 / 156)", () => {
    const e = O.TOOLS.enur;
    expect(e.sheets).toEqual({ en: { label: 'English', max: 148 }, ur: { label: 'Urdu', max: 156 } });
    expect(O.requiredItems(O.IDS.enur, 'en')).toHaveLength(37);
    expect(O.requiredItems(O.IDS.enur, 'ur')).toHaveLength(39);
    expect(O.enurSections('en').map((s) => s.key)).not.toContain('s2d');
    expect(O.enurSections('ur').map((s) => s.key)).not.toContain('s2c');
    expect(e.scale.labels).toEqual(['Needs Improvement', 'Developing', 'Proficient', 'Excellent']);
    expect(e.feedback.map((f) => f.key)).toEqual(['strengths', 'areas', 'recommendations', 'timeline']);
    // FDE's slips ship as printed and are flagged.
    expect(e.fde_notes.join(' ')).toMatch(/4 B/);
    expect(e.fde_notes.join(' ')).toMatch(/4 D/);
  });
});

describe('which tool a lesson gets (operator 11 Nov defaults)', () => {
  test.each([
    [1, 'english', null],
    [5, 'maths', null],
    [6, 'english', ['enur', 'en']],
    [7, 'urdu', ['enur', 'ur']],
    [8, 'english', ['enur', 'en']],
    [6, 'maths', ['msci', null]],
    [7, 'science', ['msci', null]],
    [8, 'maths', ['msci', null]], // gap: FDE prints VI-VII
    // bd-ra8xu.40 (operator 12 Nov ~11:00): FDE's tools are for grades 6-8 only; 9-12 stays on FICO.
    [9, 'maths', null],
    [12, 'english', null],
    [10, null, null],
    [8, 'islamiat', ['gen', null]],
    [7, 'islamiat', ['gen', null]],
    [6, 'other', ['gen', null]],
    [6, null, ['gen', null]],
    [null, 'maths', null],
    [13, 'maths', null],
  ])('grade %p, %p', (grade, subject, want) => {
    const got = O.toolFor(grade, subject);
    if (want === null) expect(got).toBeNull();
    else expect([got.tool, got.sheet, got.rubricId]).toEqual([want[0], want[1], O.IDS[want[0]]]);
  });
});

describe('the arithmetic', () => {
  const all = (id, sheet, v) => Object.fromEntries(O.requiredItems(id, sheet).map((i) => [i.key, v]));

  test('English: score x 100 / 148, and the band on the %', () => {
    const full = O.score(O.IDS.enur, 'en', all(O.IDS.enur, 'en', 4));
    expect([full.total, full.max, full.pct, full.band.label, full.missing]).toEqual([148, 148, 100, 'Excellent', []]);
    const low = O.score(O.IDS.enur, 'en', all(O.IDS.enur, 'en', 1));
    expect([low.total, low.pct, low.band.label]).toEqual([37, 25, 'Needs Improvement']);
    const mixed = O.score(O.IDS.enur, 'en', { ...all(O.IDS.enur, 'en', 3), s5_1: 1, s5_2: 1 });
    expect(mixed.total).toBe(107);
    expect(mixed.pct).toBe(72.3);
    expect(mixed.band.label).toBe('Proficient');
    expect(mixed.sections.find((s) => s.key === 's5')).toMatchObject({ score: 8, max: 16 });
  });

  test('Urdu: out of 156; a band edge', () => {
    const s = O.score(O.IDS.enur, 'ur', all(O.IDS.enur, 'ur', 3));
    expect([s.total, s.max, s.pct, s.band.label]).toEqual([117, 156, 75, 'Proficient']);
    expect(O.bandFor(89.9).label).toBe('Proficient');
    expect(O.bandFor(90).label).toBe('Excellent');
    expect(O.bandFor(49.9).label).toBe('Needs Improvement');
    expect(O.bandFor(50).label).toBe('Developing');
  });

  test('General form: Yes counts per section, no score', () => {
    const s = O.score(O.IDS.gen, null, { ...all(O.IDS.gen, null, 'yes'), env_2: 'no', work_2: 'No' });
    expect(s.sections[0]).toMatchObject({ key: 'env', yes: 5, of: 6 });
    expect([s.yes, s.of, s.missing]).toEqual([33, 35, []]);
    expect(s.pct).toBeUndefined();
  });

  test('Maths & Science: levels as given, no total; the plan starts on the lowest', () => {
    const a = { ...all(O.IDS.msci, null, '2'), i9: '1', students: '2' };
    const s = O.score(O.IDS.msci, null, a);
    expect(s.indicators.find((i) => i.key === 'i9').level).toBe(1);
    expect(s.students).toBe(2);
    expect(s.total).toBeUndefined();
    expect(O.lowestIndicator(a)).toEqual({ key: 'i9', n: 9, level: 1 });
  });

  test('an unanswered or invalid item is missing, never counted', () => {
    const s = O.score(O.IDS.enur, 'en', { s2b_1: 4, s2b_2: 9 });
    expect(s.total).toBe(4);
    expect(s.missing).toContain('s2b_2');
    expect(s.missing).toHaveLength(36);
  });
});

describe('the switch (app_settings.obs612_coach), default off', () => {
  beforeEach(() => { Switch._resetCache(); mockRows.value = []; mockFail.on = false; });
  const U = '11111111-1111-1111-1111-111111111111';

  test('no row, a failed read, an unknown value: off', async () => {
    expect(await Switch.isOn({ userId: U, region: 'sihala' })).toBe(false);
    Switch._resetCache(); mockFail.on = true;
    expect(await Switch.isOn({ userId: U, region: 'sihala' })).toBe(false);
    Switch._resetCache(); mockFail.on = false; mockRows.value = [{ key: 'obs612_coach', value: 'maybe' }];
    expect(await Switch.isOn({ userId: U, region: 'sihala' })).toBe(false);
  });

  test('one account only', async () => {
    mockRows.value = [{ key: 'obs612_coach', value: { [`user:${U}`]: 'on' } }];
    expect(await Switch.isOn({ userId: U, region: 'sihala' })).toBe(true);
    expect(await Switch.isOn({ userId: '22222222-2222-2222-2222-222222222222', region: 'sihala' })).toBe(false);
  });

  test('every ICT coach (organization), and the region read when not given', async () => {
    mockRows.value = [{ key: 'obs612_coach', value: { ict: 'on' } }];
    expect(await Switch.isOn({ userId: U, region: 'sihala' })).toBe(true);
    expect(await Switch.isOn({ userId: U })).toBe(true);
  });
});
