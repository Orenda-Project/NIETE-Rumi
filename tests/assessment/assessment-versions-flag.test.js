/**
 * assessment_versions_enabled — the transitional switch for versioned editing.
 *
 * It decides three things together: whether the review Flow opens on the new
 * ✓/✗ LIST or the old KEEP screen, whether a delivered paper carries the Edit
 * button, and whether "Make my paper" makes a new version. It must be flipped
 * together with the review Flow publish, so it fails CLOSED: an absent row, a
 * malformed value or a failed lookup all mean the old path.
 */
const mockRow = { current: null, error: null, throws: false };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          if (mockRow.throws) throw new Error('network');
          return { data: mockRow.current, error: mockRow.error };
        },
      }),
    }),
  }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const Flags = require('../../bot/shared/config/feature-flags');

beforeEach(() => { mockRow.current = null; mockRow.error = null; mockRow.throws = false; });

test('names the key the migration seeds', () => {
  expect(Flags.ASSESSMENT_VERSIONS_KEY).toBe('assessment_versions_enabled');
});

test.each([
  ['true (jsonb boolean)', { value: true }, true],
  ['"true" (string)', { value: 'true' }, true],
  ['false', { value: false }, false],
  ['absent row', null, false],
  ['garbage', { value: 'yes please' }, false],
])('%s → %s', async (_n, row, expected) => {
  mockRow.current = row;
  await expect(Flags.isAssessmentVersionsEnabled()).resolves.toBe(expected);
});

test('a failed lookup is OFF', async () => {
  mockRow.throws = true;
  await expect(Flags.isAssessmentVersionsEnabled()).resolves.toBe(false);
  mockRow.throws = false;
  mockRow.error = { message: 'boom' };
  await expect(Flags.isAssessmentVersionsEnabled()).resolves.toBe(false);
});
