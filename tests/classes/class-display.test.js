/**
 * The portal's class rows must distinguish a morning from an evening class.
 *
 * Found live on staging: the internal API built its own display string and had
 * never been taught about shifts, so "Grade 6 - C" morning and "Grade 6 - C"
 * evening rendered identically and the shift was absent from the payload. Two
 * display builders is the same mistake as two writers.
 */
const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { classDisplay } = require('../../bot/shared/routes/class-manager-endpoint');

describe('classDisplay is the single source of a class row label', () => {
  it('marks the evening class and leaves morning unmarked', () => {
    const who = { preferred_language: 'en' };
    expect(classDisplay('grade_6', 'C', who, 'morning')).toBe('Grade 6 - C');
    expect(classDisplay('grade_6', 'C', who, 'evening')).toBe('Grade 6 - C (Evening)');
  });

  it('gives the two shifts DIFFERENT labels, so a list of them is readable', () => {
    const who = { preferred_language: 'en' };
    expect(classDisplay('grade_6', 'C', who, 'morning'))
      .not.toBe(classDisplay('grade_6', 'C', who, 'evening'));
  });

  it('localises the shift marker', () => {
    expect(classDisplay('grade_6', 'C', { preferred_language: 'ur' }, 'evening')).toContain('شام');
  });
});
