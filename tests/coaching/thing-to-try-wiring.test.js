/**
 * v10 coaching test (bd-v0toag.8): the thing to try is wired where the teacher meets it.
 *
 * 1. The plan PDF goes out with the caption thing-to-try.planCaption returns (today's caption
 *    for everyone but C and D, and on any failure).
 * 2. After a recording, the "Quick reminder" of her last commitment is sent only when
 *    thing-to-try.sendsPriorReminder says so (not for C and D).
 */
const mockTables = {};
function mockBuilderFor(table) {
  let rows = [...(mockTables[table] || [])];
  const b = {
    select: () => b,
    eq: (col, val) => { rows = rows.filter((r) => String(r[col]) === String(val)); return b; },
    in: (col, vals) => { rows = rows.filter((r) => vals.map(String).includes(String(r[col]))); return b; },
    not: () => b,
    order: () => b,
    limit: () => b,
    range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
    single: () => Promise.resolve({ data: rows[0] || null, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
    insert: (payload) => {
      const ret = { select: () => ret, single: () => Promise.resolve({ data: { id: 'x', ...payload }, error: null }),
        then: (f, r) => Promise.resolve({ data: [payload], error: null }).then(f, r) };
      return ret;
    },
    update: () => b,
    then: (f, r) => Promise.resolve({ data: rows, error: null }).then(f, r),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((key) => `https://s3.example/bucket/${key}`),
  getPresignedUrl: jest.fn(async (url) => `${url}?sig`),
  uploadClassroomAudio: jest.fn(),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendDocumentByLink: jest.fn(async () => ({ messages: [{ id: 'w' }] })),
  sendMessage: jest.fn(async () => true),
  sendVoicenoteFromR2Key: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => 'en'), setUserLanguage: jest.fn(),
}));
const mockThing = { planCaption: jest.fn(), sendsPriorReminder: jest.fn() };
jest.mock('../../bot/shared/services/coaching/thing-to-try', () => ({
  planCaption: (...a) => mockThing.planCaption(...a),
  sendsPriorReminder: (...a) => mockThing.sendsPriorReminder(...a),
}));

const WA = require('../../bot/shared/services/whatsapp.service');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const Delivery = require('../../bot/shared/services/lp-v8-delivery.service');
const Processor = require('../../bot/shared/services/coaching/transcription-processor.service');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

const LESSON = 'grade_1_english_ch1_seg2';
const CATALOG = {
  catalog_version: 'v8', counts: { books: 1, chapters: 1, lessons: 1 },
  books: [{ stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{ number: 1, title: 'C1', title_short: 'C1', lessons: [{
      lesson_id: LESSON, segment_index: 2, lp_type: 'content', day_label: 'Day 2', section: 'S',
      section_short: 'S', topic: 'T', topic_short: 'T', pages: [1], pages_label: 'p.1',
      row: { title: 'S', description: 'D', metadata: 'M' },
    }] }] }],
};

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockTables.users = [{ id: 'u1', phone_number: '923001234567', preferred_language: 'ur', school_id: 's1' }];
  mockTables.app_settings = [];
  mockTables.niete_lp_assets = [{
    id: 'a1', lesson_id: LESSON, asset_kind: 'lesson', catalog_version: 'v8', r2_key: `lp-cache/v8/${LESSON}/s.pdf`,
    content_hash: 's', version_stamp: 's', is_current: true, created_at: 's',
  }];
});

describe('plan delivery caption', () => {
  test('the PDF goes out with the caption planCaption returns', async () => {
    mockThing.planCaption.mockImplementation(async ({ caption }) => `${caption}\n\n★ try this`);
    await Delivery.deliverV8Lesson({ userId: 'u1', lessonId: LESSON });
    const sentCaption = WA.sendDocumentByLink.mock.calls[0][3];
    const args = mockThing.planCaption.mock.calls[0][0];
    expect(args).toMatchObject({ userId: 'u1', lessonId: LESSON, lang: 'ur' });
    expect(args.caption).toBeTruthy();
    expect(sentCaption).toBe(`${args.caption}\n\n★ try this`);
  });

  test('when planCaption hands back today\'s caption, that is what is sent', async () => {
    mockThing.planCaption.mockImplementation(async ({ caption }) => caption);
    await Delivery.deliverV8Lesson({ userId: 'u1', lessonId: LESSON });
    expect(WA.sendDocumentByLink.mock.calls[0][3]).toBe(mockThing.planCaption.mock.calls[0][0].caption);
  });
});

describe('prior commitment reminder after a recording', () => {
  const SESSION = { user_id: 'u1' };
  const prior = (pa) => { mockTables.coaching_sessions = [{ user_id: 'u1', prioritized_action: pa }]; };
  const YES = { action: 'Ask a why question', teacher_response: 'yes' };
  const reminder = getCoachingMessage('priorActionReminder', 'en').replace('{{action}}', YES.action);

  test('sent when sendsPriorReminder is true (A, B, outside the draw)', async () => {
    prior(YES);
    mockThing.sendsPriorReminder.mockResolvedValue(true);
    await Processor.sendPriorActionReminder(SESSION, '923001234567');
    expect(WA.sendMessage).toHaveBeenCalledWith('923001234567', reminder);
    expect(mockThing.sendsPriorReminder).toHaveBeenCalledWith('u1');
  });

  test('not sent when sendsPriorReminder is false (C, D)', async () => {
    prior(YES);
    mockThing.sendsPriorReminder.mockResolvedValue(false);
    await Processor.sendPriorActionReminder(SESSION, '923001234567');
    expect(WA.sendMessage).not.toHaveBeenCalled();
  });

  test('no yes on the last commitment: nothing sent, group not even asked', async () => {
    prior({ action: 'x', teacher_response: 'no' });
    await Processor.sendPriorActionReminder(SESSION, '923001234567');
    expect(WA.sendMessage).not.toHaveBeenCalled();
    expect(mockThing.sendsPriorReminder).not.toHaveBeenCalled();
  });

  test('never throws', async () => {
    prior(YES);
    mockThing.sendsPriorReminder.mockRejectedValue(new Error('x'));
    await expect(Processor.sendPriorActionReminder(SESSION, '923001234567')).resolves.toBeUndefined();
  });
});
