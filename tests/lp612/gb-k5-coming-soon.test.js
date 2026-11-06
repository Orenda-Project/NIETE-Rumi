'use strict';
/**
 * bd-rj6w0n.14.5 — a GB book with no ready plans is listed as "Coming Soon" and cannot be opened.
 *
 * A GB teacher's subject screen lists every allow-listed book for her grade, in menu order. A book
 * whose plans are ready keeps its normal row (step lp612_subject). Any other book, including one with
 * imported segments but no ready render, gets a Coming Soon row whose tap is refused.
 */
const mockQueries = [];
let mockRows = [];
function mockBuilder(table) {
  const state = { table, filters: [] };
  mockQueries.push(state);
  const b = {
    select: (cols) => { state.select = cols; return b; },
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    in: (c, v) => { state.in = [c, v]; return b; },
    limit: (n) => { state.limit = n; return b; },
    then: (res, rej) => {
      const names = state.in ? state.in[1] : [];
      const data = mockRows.filter((r) => names.includes(r.subject)).slice(0, state.limit || 1000);
      return Promise.resolve({ data, error: null }).then(res, rej);
    },
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Shelf = require('../../bot/shared/services/lp612-gb-shelf.service');

const item = (subject) => ({
  id: subject,
  'main-content': { title: subject, description: '3 chapters', metadata: 'Grade 4 · 20 lessons' },
  'on-click-action': { name: 'data_exchange', payload: { step: 'lp612_subject', grade: '4', subject } },
});
const GB_EN = { curriculum: 'nbf_snc', language: 'en' };

describe('gbShelfItems', () => {
  const build = jest.fn();
  const ready = jest.fn();
  const deps = { buildSubjectItems: build, readyBookKeys: ready };
  beforeEach(() => { build.mockReset(); ready.mockReset(); });

  test('every allow-listed book for the grade, in order; ready books keep their normal row', async () => {
    build.mockResolvedValue([item('English'), item('Math'), item('Science')]);
    ready.mockResolvedValue(new Set(['english', 'maths']));
    const rows = await Shelf.gbShelfItems(4, GB_EN, deps);
    expect(rows.map((r) => r['main-content'].title))
      .toEqual(['English', 'Urdu', 'Math', 'Science', 'Social Studies', 'Islamiat']);
    expect(rows[0]).toEqual(item('English'));
    expect(rows[2]).toEqual(item('Math'));
    expect(build).toHaveBeenCalledWith(4, GB_EN);
    expect(ready).toHaveBeenCalledWith(4);
  });

  test('a book with segments but no ready plans is Coming Soon and cannot be opened', async () => {
    build.mockResolvedValue([item('English'), item('Science')]);
    ready.mockResolvedValue(new Set(['english']));
    const rows = await Shelf.gbShelfItems(4, GB_EN, deps);
    const science = rows.find((r) => r['main-content'].title === 'Science');
    expect(science['main-content'].description).toBe('Coming Soon');
    expect(science['on-click-action'].payload.step).toBe('lp612_gb_soon');
    for (const r of rows.filter((x) => x['main-content'].description === 'Coming Soon')) {
      expect(r['on-click-action'].payload.step).not.toBe('lp612_subject');
    }
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  test('no ready books: every row is Coming Soon (Grade 1 has no Science or Social Studies)', async () => {
    build.mockResolvedValue([]);
    ready.mockResolvedValue(new Set());
    const rows = await Shelf.gbShelfItems(1, GB_EN, deps);
    expect(rows.map((r) => r['main-content'].title))
      .toEqual(['English', 'Urdu', 'Mathematics', 'General Knowledge', 'Islamiat']);
    expect(rows.every((r) => r['main-content'].description === 'Coming Soon')).toBe(true);
  });

  test('an Urdu teacher reads the Coming Soon label in Urdu, within the 20-code-point cap', async () => {
    build.mockResolvedValue([]);
    ready.mockResolvedValue(new Set());
    const rows = await Shelf.gbShelfItems(2, { curriculum: 'nbf_snc', language: 'ur' }, deps);
    const desc = rows[0]['main-content'].description;
    expect(desc).toBe('جلد آ رہا ہے');
    expect([...desc].length).toBeLessThanOrEqual(20);
  });
});

describe('readyBookKeys', () => {
  beforeEach(() => { mockQueries.length = 0; });

  test('one ready render per allow-listed book of the grade, from current nbf_snc segments', async () => {
    // Ready renders as the DB holds them; Computer is not a GB book and Science is not ready.
    mockRows = [{ subject: 'Math' }, { subject: 'English' }, { subject: 'Computer' }];
    const keys = await Shelf.readyBookKeys(4);
    expect([...keys].sort()).toEqual(['english', 'maths']);
    expect(mockQueries).toHaveLength(6); // grade 4: English, Urdu, Maths, Science, SST, Islamiat
    for (const q of mockQueries) {
      expect(q.table).toBe('niete_lp612_renders');
      expect(q.limit).toBe(1);
      expect(q.in[0]).toBe('niete_lp612_segments.subject');
      expect(q.filters).toEqual(expect.arrayContaining([
        ['status', 'ready'],
        ['niete_lp612_segments.curriculum', 'nbf_snc'],
        ['niete_lp612_segments.grade', 4],
        ['niete_lp612_segments.is_current', true],
      ]));
    }
    const maths = mockQueries.find((q) => q.in[1].includes('Math'));
    expect(maths.in[1]).toEqual(expect.arrayContaining(['Math', 'Maths', 'Mathematics']));
  });
});

describe('refuseComingSoon', () => {
  test('a tap on a Coming Soon row is refused in the teacher\'s language', () => {
    expect(Shelf.refuseComingSoon('en').data.error.message).toMatch(/coming soon/i);
    expect(Shelf.refuseComingSoon('ur').data.error.message).toMatch(/[؀-ۿ]/);
  });
});
