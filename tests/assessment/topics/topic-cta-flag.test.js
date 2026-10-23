/**
 * bd-6clakk.6 — the WhatsApp "paper on topics" button has its own switch, so prod can carry the code with
 * the button hidden until the A/B test starts. Fail closed: only a written true turns it on.
 */
const mockRow = { data: null, error: null, throws: false };
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../bot/shared/config/supabase', () => {
  const q = {
    select: () => q,
    eq: (col, key) => { q.key = key; return q; },
    maybeSingle: async () => {
      if (mockRow.throws) throw new Error('network');
      return { data: mockRow.data, error: mockRow.error };
    },
  };
  return { from: (table) => { q.table = table; return q; }, q };
});

const Flags = require('../../../bot/shared/config/feature-flags');
const supabase = require('../../../bot/shared/config/supabase');

beforeEach(() => { mockRow.data = null; mockRow.error = null; mockRow.throws = false; });

test('reads its own app_settings key', async () => {
  expect(Flags.ASSESSMENT_TOPIC_CTA_KEY).toBe('assessment_topic_cta_enabled');
  mockRow.data = { value: 'true' };
  expect(await Flags.isAssessmentTopicCtaEnabled()).toBe(true);
  expect(supabase.q.table).toBe('app_settings');
  expect(supabase.q.key).toBe('assessment_topic_cta_enabled');
});

test.each([
  ['absent row', null],
  ['false', { value: 'false' }],
  ['a stray string', { value: 'teachers' }],
])('%s -> off', async (_label, data) => {
  mockRow.data = data;
  expect(await Flags.isAssessmentTopicCtaEnabled()).toBe(false);
});

test('a failed read -> off', async () => {
  mockRow.error = { message: 'boom' };
  expect(await Flags.isAssessmentTopicCtaEnabled()).toBe(false);
  mockRow.error = null;
  mockRow.throws = true;
  expect(await Flags.isAssessmentTopicCtaEnabled()).toBe(false);
});
