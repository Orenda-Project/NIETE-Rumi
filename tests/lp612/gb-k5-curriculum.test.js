'use strict';
/**
 * bd-rj6w0n.14.4 — which syllabus a teacher's lesson-plan menu reads, and which GB books it may list.
 *
 * Who is GB is book-curriculum.service (#4091): 'nbf_snc' for Gilgit-Baltistan, 'ict' otherwise. The allow-list is
 * the product decision for GB K-5: English, Urdu and Maths in every grade 1-5, Science and Social Studies
 * in 4-5, General Knowledge in 1-3, Islamiat in 1-5. Nothing else is a GB book.
 */
const mockUsers = {};
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn(() => {
    let id = null;
    const b = {
      select: () => b,
      eq: (c, v) => { if (c === 'id') id = v; return b; },
      maybeSingle: async () => ({ data: mockUsers[id] || null, error: null }),
    };
    return b;
  }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const C = require('../../bot/shared/services/lp612-curriculum.service');
const { isGbK5Enabled } = require('../../bot/shared/config/lp612-flags');

describe('the GB lane helpers (who is GB is book-curriculum.service, #4091)', () => {
  test('GB\'s curriculum key is #4091\'s nbf_snc, ICT\'s is ict', () => {
    expect(C.NBF_SNC).toBe('nbf_snc');
    expect(C.ICT).toBe('ict');
    expect(C).not.toHaveProperty('GB_K5');
    expect(C).not.toHaveProperty('FBISE');
  });

  test('languageForUserId reads her preferred_language; a miss is null', async () => {
    mockUsers['u-gb'] = { id: 'u-gb', preferred_language: 'ur' };
    expect(await C.languageForUserId('u-gb')).toBe('ur');
    expect(await C.languageForUserId('nobody')).toBeNull();
    expect(await C.languageForUserId(null)).toBeNull();
  });
});

describe('the GB K-5 allow-list', () => {
  const yes = [[1, 'English'], [5, 'Urdu'], [3, 'Math'], [2, 'Mathematics'], [4, 'Science'], [5, 'General Science'],
    [1, 'GK'], [3, 'General Knowledge'], [4, 'Social Studies'], [5, 'Islamiat'], [1, 'Islamiyat']];
  const no = [[3, 'Science'], [4, 'GK'], [3, 'Social Studies'], [6, 'English'], [2, 'Computer'], [0, 'Urdu']];
  test.each(yes)('grade %i %s is a GB book', (g, s) => expect(C.isGbK5Book(g, s)).toBe(true));
  test.each(no)('grade %i %s is not', (g, s) => expect(C.isGbK5Book(g, s)).toBe(false));

  test('gbK5Subjects lists the grade\'s books in menu order', () => {
    expect(C.gbK5Subjects(1).map((s) => s.key)).toEqual(['english', 'urdu', 'maths', 'gk', 'islamiat']);
    expect(C.gbK5Subjects(4).map((s) => s.key)).toEqual(['english', 'urdu', 'maths', 'science', 'sst', 'islamiat']);
    expect(C.gbK5Subjects(6)).toEqual([]);
  });
});

describe('LP_GB_K5_ENABLED', () => {
  const saved = process.env.LP_GB_K5_ENABLED;
  afterEach(() => { if (saved === undefined) delete process.env.LP_GB_K5_ENABLED; else process.env.LP_GB_K5_ENABLED = saved; });
  test('defaults off; only the literal true turns it on', () => {
    delete process.env.LP_GB_K5_ENABLED;
    expect(isGbK5Enabled()).toBe(false);
    process.env.LP_GB_K5_ENABLED = '1';
    expect(isGbK5Enabled()).toBe(false);
    process.env.LP_GB_K5_ENABLED = 'true';
    expect(isGbK5Enabled()).toBe(true);
  });
});
