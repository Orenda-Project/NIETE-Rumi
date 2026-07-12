/**
 * PreGenLookupService tests
 *
 * Locks in the fix: subject must be part of the WHERE, or `.single()` will throw when
 * two subjects share a chapter_number in the same grade+curriculum (e.g. English Ch1 AND
 * Maths Ch1).
 */

const mockResultQueue = [];
const mockCapturedCalls = [];

function mockMakeBuilder(tableName) {
  const state = { table: tableName, filters: [] };
  const record = (fn) => (...args) => {
    state.filters.push({ fn, args });
    return builder;
  };
  const terminalRecord = (fn) => (...args) => {
    state.filters.push({ fn, args });
    mockCapturedCalls.push({ ...state, filters: [...state.filters] });
    const next = mockResultQueue.shift();
    return Promise.resolve(next || { data: null, error: null });
  };
  const builder = {
    select: record('select'),
    eq: record('eq'),
    limit: record('limit'),
    single: terminalRecord('single'),
    maybeSingle: terminalRecord('maybeSingle'),
  };
  return builder;
}

jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((tableName) => mockMakeBuilder(tableName)),
}));

jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(),
}));

const PreGenLookupService = require('../../shared/services/pregen-lookup.service');

describe('PreGenLookupService.findPreGenLP', () => {
  beforeEach(() => {
    mockResultQueue.length = 0;
    mockCapturedCalls.length = 0;
    jest.clearAllMocks();
  });

  it('filters by curriculum, grade, subject AND chapter_number', async () => {
    mockResultQueue.push({ data: { pdf_r2_key_en: 'k', generation_status: 'completed' }, error: null });

    await PreGenLookupService.findPreGenLP({
      curriculum: 'punjab_snc_2020',
      grade: 1,
      subject: 'english',
      chapterNumber: 1,
    });

    const eqCalls = mockCapturedCalls[0].filters.filter(f => f.fn === 'eq').map(f => f.args);
    expect(eqCalls).toEqual(
      expect.arrayContaining([
        ['curriculum', 'punjab_snc_2020'],
        ['grade', 1],
        ['subject', 'english'],
        ['chapter_number', 1],
      ]),
    );
  });

  it('returns null when generation_status is not completed', async () => {
    mockResultQueue.push({ data: { pdf_r2_key_en: 'k', generation_status: 'pending' }, error: null });

    const result = await PreGenLookupService.findPreGenLP({
      curriculum: 'punjab_snc_2020',
      grade: 1,
      subject: 'english',
      chapterNumber: 1,
    });

    expect(result).toBeNull();
  });

  it('returns null on error or missing row', async () => {
    mockResultQueue.push({ data: null, error: { message: 'no rows' } });

    const result = await PreGenLookupService.findPreGenLP({
      curriculum: 'punjab_snc_2020',
      grade: 1,
      subject: 'english',
      chapterNumber: 99,
    });

    expect(result).toBeNull();
  });
});
