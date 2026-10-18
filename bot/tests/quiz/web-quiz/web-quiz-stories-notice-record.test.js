'use strict';
/**
 * The storybook sheet's microphone notice, recorded on the server (web-quiz-stories.js event()): a story_page_read that
 * says the notice was shown (`notice: <version>`) marks "this child has seen this notice on this phone" through the
 * Trail's own record (TrailPage.noteNoticeShown), only with the live reader v3 on, the notice and the keep switches on,
 * and the exact version. The story_events row is the same in every case: the field is never kept.
 * Books and children are invented ("Testwala").
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-only-secret';

jest.mock('../../../shared/config/supabase', () => ({}));
const mockKidFromHub = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: (...a) => mockKidFromHub(...a) }));
jest.mock('../../../shared/storage/r2', () => ({ presignKey: async (key) => `https://r2.example.test/${key}` }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
const mockTp = { flags: jest.fn(), noteNoticeShown: jest.fn() };
jest.mock('../../../shared/services/quiz/web-quiz-trail-page', () => ({ NOTICE_V: 2, flags: (...a) => mockTp.flags(...a), noteNoticeShown: (...a) => mockTp.noteNoticeShown(...a) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const F = require('./__fixtures__/stories-testwala');
const Stories = require('../../../shared/services/quiz/web-quiz-stories');

const KID = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'hub-token';
const DEVICE = 'dev-testwala-1';
const LR3 = [['web_quiz_live_read_v3', true], ['web_quiz_challenge_realtime', true]];
const KEEP = ['web_quiz_challenge_keep_audio', true];
const READ = { words_total: 5, words_read: 4, skipped: 1, ms: 3000, ended: 'last_word' };

function seed(extra = []) {
  Stories._reset();
  const settings = [{ key: 'web_quiz_stories', value: true }, ...extra.map(([key, value]) => ({ key, value }))];
  Object.assign(supabase, makeFake({
    app_settings: settings,
    story_books: [F.book(1)],
    story_pages: JSON.parse(JSON.stringify([F.P2, F.P1, F.P3])),
    story_page_voices: [],
    story_questions: [],
    story_events: [],
  }));
  return supabase;
}
const send = (data, event = 'story_page_read') => Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 1, event, data }, { device: DEVICE });

beforeEach(() => {
  mockKidFromHub.mockReset();
  mockKidFromHub.mockImplementation(async (token) => (token === TOKEN ? { studentId: KID, grade: '2', rootId: null } : null));
  mockTp.flags.mockReset();
  mockTp.flags.mockResolvedValue({ consent: true, keep: true });
  mockTp.noteNoticeShown.mockReset();
  mockTp.noteNoticeShown.mockResolvedValue(true);
});

describe('the storybook sheet\'s notice record', () => {
  test('lr3 + keep on, the notice and keep switches on, the exact version: the child\'s phone record is written once; the row never carries the field', async () => {
    const db = seed([...LR3, KEEP]);
    const out = await send({ ...READ, notice: 2 });
    expect(out.ok).toBe(true);
    expect(mockTp.noteNoticeShown).toHaveBeenCalledTimes(1);
    expect(mockTp.noteNoticeShown).toHaveBeenCalledWith(KID, DEVICE);
    expect(db.db.story_events).toHaveLength(1);
    expect(db.db.story_events[0].data).toEqual(READ);
  });

  test.each([
    ['live reader v3 off', [KEEP], { consent: true, keep: true }, 2],
    ['keep off (stories side)', [...LR3], { consent: true, keep: true }, 2],
    ['notice switch off', [...LR3, KEEP], { consent: false, keep: true }, 2],
    ['keep off (Trail side)', [...LR3, KEEP], { consent: true, keep: false }, 2],
    ['an older version', [...LR3, KEEP], { consent: true, keep: true }, 1],
    ['a string version', [...LR3, KEEP], { consent: true, keep: true }, '2'],
    ['a newer version', [...LR3, KEEP], { consent: true, keep: true }, 3],
  ])('%s: nothing is recorded and the row is the same', async (_name, settings, tp, v) => {
    mockTp.flags.mockResolvedValue(tp);
    const db = seed(settings);
    await send({ ...READ, notice: v });
    expect(mockTp.noteNoticeShown).not.toHaveBeenCalled();
    expect(db.db.story_events[0].data).toEqual(READ);
  });

  test('switches on, but no field (every read after the first, and every page today): nothing is recorded, no switch read beyond today\'s', async () => {
    const db = seed([...LR3, KEEP]);
    await send(READ);
    expect(mockTp.noteNoticeShown).not.toHaveBeenCalled();
    expect(mockTp.flags).not.toHaveBeenCalled();
    expect(db.db.story_events[0].data).toEqual(READ);
  });

  test('only a page read carries it: the same field on a listen is ignored', async () => {
    seed([...LR3, KEEP]);
    await send({ notice: 2 }, 'story_page_listened');
    expect(mockTp.noteNoticeShown).not.toHaveBeenCalled();
  });

  test('a failed record never fails the read: the row is kept and the answer is ok', async () => {
    mockTp.noteNoticeShown.mockRejectedValue(new Error('down'));
    mockTp.flags.mockRejectedValue(new Error('down'));
    const db = seed([...LR3, KEEP]);
    const out = await send({ ...READ, notice: 2 });
    expect(out.ok).toBe(true);
    expect(db.db.story_events[0].data).toEqual(READ);
  });
});
