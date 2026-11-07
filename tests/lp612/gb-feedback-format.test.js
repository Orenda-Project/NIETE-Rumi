/**
 * bd-rj6w0n.14.16.19 — a GB teacher's 👍/👎 names WHICH format she rated.
 *
 * GB grade 1-5 teachers get two formats on one lane: the ready-made plans (the v10 card with the v9
 * plan, 6-10 pages, seeded with model_used 'offline_gb_v9_gate') and the on-request 2-page 6-12-style
 * plan. Both arrive through ICT's send, so both are already surveyed — but every verdict landed as
 * `lp612_<lang>`, the same as ICT 6-12, and the two GB formats could not be told apart.
 *
 * The tap now writes `lp612_gb_card_<lang>` for a ready-made plan and `lp612_gb_<lang>` for an
 * on-request one. Both keep the `lp612` prefix, so `lp_variant LIKE 'lp612%'` still selects the lane.
 * ICT is untouched.
 */

const mockSendMessage = jest.fn().mockResolvedValue(true);
const mockSendInteractiveButtons = jest.fn().mockResolvedValue(true);
const mockSendReaction = jest.fn().mockResolvedValue(true);

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendInteractiveButtons: (...a) => mockSendInteractiveButtons(...a),
  sendReaction: (...a) => mockSendReaction(...a),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  set: jest.fn(), get: jest.fn(), delete: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(), getCurrentCorrelationId: () => undefined,
}));

// Results by table: each read of a table settles with that table's row.
const mockRows = {};
const mockInserts = [];
const mockReads = [];
function mockBuilder(table) {
  const state = { table, filters: [], insert: null };
  const settle = () => {
    if (state.insert) {
      mockInserts.push({ table, row: state.insert });
      return Promise.resolve({ data: { id: 'fb-1' }, error: null });
    }
    mockReads.push(state);
    return Promise.resolve({ data: mockRows[table] || null, error: null });
  };
  const b = {
    insert: (p) => { state.insert = p; return b; },
    update: () => b,
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    order: () => b,
    limit: () => b,
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: jest.fn(() => Promise.resolve({ data: [], error: null })),
}));

const Feedback = require('../../bot/shared/services/lp612-feedback.service');

const PHONE = '923001111111';
const GB_ID = 'nbf_snc_grade_2_english.c04.s013';
const GB_SEGMENT = {
  segment_id: GB_ID, grade: 2, subject: 'English', curriculum: 'nbf_snc',
  chapter_number: 4, subtopic_title: 'Nouns', menu_title: 'Nouns',
};
const ICT_ID = 'grade_9_chemistry.c01.p007-008';
const ICT_SEGMENT = {
  segment_id: ICT_ID, grade: 9, subject: 'Chemistry', curriculum: null,
  chapter_number: 1, subtopic_title: 'Branches', menu_title: 'Branches',
};

const variantWritten = () => {
  const ins = mockInserts.find((i) => i.table === 'lp_feedback');
  return ins && ins.row.lp_variant;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInserts.length = 0;
  mockReads.length = 0;
  for (const k of Object.keys(mockRows)) delete mockRows[k];
  mockRows.users = { id: 'u-1', preferred_language: 'en' };
});

test('a 👍 on a ready-made GB plan (card + v9) is written as lp612_gb_card_<lang>', async () => {
  mockRows.niete_lp612_segments = GB_SEGMENT;
  mockRows.niete_gb_lp_renders = { model_used: 'offline_gb_v9_gate' };

  await Feedback.handleFeedbackButton(`lp612_fb_yes_en_${GB_ID}`, PHONE);

  expect(variantWritten()).toBe('lp612_gb_card_en');
  const lookup = mockReads.find((r) => r.table === 'niete_gb_lp_renders');
  expect(lookup.filters).toEqual(expect.arrayContaining([['segment_id', GB_ID], ['lang', 'en']]));
});

test('a 👎 on an on-request GB plan (2-page) is written as lp612_gb_<lang>', async () => {
  mockRows.niete_lp612_segments = GB_SEGMENT;
  mockRows.niete_gb_lp_renders = { model_used: 'anthropic/claude-sonnet' };

  await Feedback.handleFeedbackButton(`lp612_fb_no_ur_${GB_ID}`, PHONE);

  expect(variantWritten()).toBe('lp612_gb_ur');
});

test('an ICT 6-12 verdict is unchanged: lp612_<lang>, and no GB render is read', async () => {
  mockRows.niete_lp612_segments = ICT_SEGMENT;

  await Feedback.handleFeedbackButton(`lp612_fb_yes_en_${ICT_ID}`, PHONE);

  expect(variantWritten()).toBe('lp612_en');
  expect(mockReads.some((r) => r.table === 'niete_gb_lp_renders')).toBe(false);
});
