/**
 * The SUBJECT row of a fully-Urdu subject speaks Urdu, furniture included.
 *
 * The chapter and subtopic rows were localised (catalog-urdu-furniture.test.js);
 * the subject row one screen earlier was not. It rendered `۱۹ chapters` and
 * `Grade ۹ · ۱۰۲ lessons` — Urdu digits beside English nouns, which in a
 * right-to-left row read backwards, and a middle dot against an Urdu digit,
 * which Noto Nastaliq renders as a ZERO (`۹ ·` reads as 90).
 */

let mockRows = [];

function mockBuilder() {
  const state = { filters: [], or: null };
  const rows = () => {
    let out = mockRows.filter((r) => state.filters.every(([c, v]) => r[c] === undefined || r[c] === v));
    const m = state.or && /grade\.eq\.(\d+)/.exec(state.or);
    if (m) out = out.filter((r) => r.grade === Number(m[1]) || (r.also_grades || []).includes(Number(m[1])));
    return out;
  };
  const b = {
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    in: () => b,
    or: (expr) => { state.or = expr; return b; },
    order: () => b,
    limit: () => b,
    range: (from, to) => ({
      then: (res, rej) => Promise.resolve({ data: rows().slice(from, to + 1), error: null }).then(res, rej),
    }),
    then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockBuilder()) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Catalog = require('../../bot/shared/services/lp612-catalog.service');
const { TITLE_CAP, DESC_CAP, META_CAP } = require('../../bot/shared/services/lp-v8-catalog.service');

const cps = (s) => [...String(s == null ? '' : s)].length;
const RLM = '‏';
const DOT_BESIDE_URDU_DIGIT = /[۰-۹]\s*·|·\s*[۰-۹]/;

const row = (over = {}) => ({
  segment_id: 'grade_9_urdu.c01.p001', grade: 9, subject: 'Urdu', language: 'ur',
  book_stem: 'grade_9_urdu', chapter_key: 'c01', order_index: 1, lp_type: 'content',
  is_religious: false, ...over,
});

// Two chapters, three lessons, all Urdu.
const urduSubject = () => [
  row(),
  row({ segment_id: 's2', order_index: 2 }),
  row({ segment_id: 's3', chapter_key: 'c02', order_index: 3 }),
];

const subjectRow = async (name = 'Urdu') => {
  const items = await Catalog.buildSubjectItems(9);
  return items.find((it) => it.id === name)['main-content'];
};

beforeEach(() => {
  mockRows = [];
  delete process.env.LP_612_RELIGIOUS_ENABLED;
});

describe('a fully-Urdu subject row', () => {
  test('counts chapters as ابواب, not "chapters"', async () => {
    mockRows = urduSubject();
    const mc = await subjectRow();
    expect(mc.description).toBe(`${RLM}۲ ابواب`);
  });

  test('says باب for a single chapter', async () => {
    mockRows = [row()];
    const mc = await subjectRow();
    expect(mc.description).toBe(`${RLM}۱ باب`);
  });

  test('gives grade and lessons as جماعت and اسباق, joined by the Urdu comma', async () => {
    mockRows = urduSubject();
    const mc = await subjectRow();
    expect(mc.metadata).toBe(`${RLM}جماعت ۹، ۳ اسباق`);
  });

  test('carries no English furniture and no dot beside an Urdu digit', async () => {
    mockRows = urduSubject();
    const mc = await subjectRow();
    for (const field of [mc.description, mc.metadata]) {
      expect(field).not.toMatch(/chapter|lesson|Grade/i);
      expect(field).not.toMatch(DOT_BESIDE_URDU_DIGIT);
    }
  });

  test('stays inside every field cap, in code points', async () => {
    mockRows = Array.from({ length: 150 }, (_, i) => row({
      segment_id: `s${i}`, chapter_key: `c${i % 40}`, order_index: i + 1,
    }));
    const mc = await subjectRow();
    expect(cps(mc.title)).toBeLessThanOrEqual(TITLE_CAP);
    expect(cps(mc.description)).toBeLessThanOrEqual(DESC_CAP);
    expect(cps(mc.metadata)).toBeLessThanOrEqual(META_CAP);
    expect(mc.description).toBe(`${RLM}۴۰ ابواب`);
  });
});

describe('English and mixed subjects are unchanged', () => {
  test('an English subject keeps its English furniture', async () => {
    mockRows = [row({ subject: 'Physics', language: 'en', book_stem: 'grade_9_physics' })];
    const mc = await subjectRow('Physics');
    expect(mc.description).toBe('1 chapter');
    expect(mc.metadata).toBe('Grade 9 · 1 lesson');
  });

  test('a subject with an English and an Urdu edition is not an Urdu subject', async () => {
    mockRows = [
      row({ subject: 'Pakistan Studies', language: 'en', book_stem: 'ps_en' }),
      row({ subject: 'Pakistan Studies', language: 'ur', book_stem: 'ps_ur', segment_id: 's2' }),
    ];
    const mc = await subjectRow('Pakistan Studies');
    expect(mc.description).toBe('2 chapters');
    expect(mc.metadata).toBe('Grade 9 · 2 lessons');
  });
});
