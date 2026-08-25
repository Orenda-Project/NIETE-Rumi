/**
 * One row per teacher must not mean one task per teacher.
 *
 * Collapsing many cache keys into a single row removed a whole class of bug — a stale
 * earlier step can no longer be read while she is on a later one. But it introduced
 * the mirror risk, and this file exists because the migration did introduce it:
 *
 *   Before, video state lived in its own cache keys and the menu's state lived on a
 *   different table entirely, so both survived side by side. After, they share one
 *   row — so opening the menu part-way through a video silently destroyed the video.
 *
 * A teacher typing /video, being asked for a topic, tapping /menu to check something,
 * and then sending her topic would have had it land in general chat. That is the exact
 * drift-between-flows failure this whole workstream is meant to remove, reintroduced
 * by the fix for it.
 *
 * Two rules follow, both pinned below:
 *   1. Navigation must not overwrite work. Opening the menu is navigation.
 *   2. Navigation must not count as being busy — a teacher who glanced at the menu is
 *      not mid-task, and treating her as such delays her scheduled reports.
 */

const mockState = { getState: jest.fn(), setState: jest.fn(), clearState: jest.fn() };
const mockResume = { OFFERED: 'offered_resume', TASK_LABEL: { video: { en: 'teaching video', ur: 'x' } } };

jest.mock('../../bot/shared/services/conversation-state.service', () => mockState);
jest.mock('../../bot/shared/services/conversation-resume.service', () => mockResume);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendFeatureMenuCarousel: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  storeConversation: jest.fn(), getOrCreateSession: jest.fn().mockResolvedValue('s-1'),
}));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn(() => ({
    select: () => ({
      eq: () => ({
        not: () => ({ gte: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
        in: () => ({ gte: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
      }),
    }),
  })),
}));

const USER = '11111111-2222-3333-4444-555555555555';

beforeEach(() => {
  jest.clearAllMocks();
  mockState.setState.mockImplementation((u, s) => Promise.resolve({ ...s, stack: [] }));
  mockState.clearState.mockResolvedValue(true);
});

describe('navigation must not destroy work', () => {
  const MenuService = require('../../bot/shared/services/menu.service');

  it('opening the menu does NOT overwrite an in-progress video', async () => {
    mockState.getState.mockResolvedValue({
      flow: 'video', step: 'awaiting_topic', payload: { sessionId: 's-0' }, stack: [],
    });

    await MenuService._updateConversationState(USER, 's-1', { current_state: 'AWAITING_MENU_CHOICE' });

    // Nothing may be written over her video. She is mid-task; the menu is a glance.
    const wroteOverVideo = mockState.setState.mock.calls.some(([, arg]) => arg.flow === 'menu');
    expect(wroteOverVideo).toBe(false);
  });

  it('still records the menu wait when she is not mid-anything', async () => {
    mockState.getState.mockResolvedValue(null);

    await MenuService._updateConversationState(USER, 's-1', { current_state: 'AWAITING_MENU_CHOICE' });

    expect(mockState.setState).toHaveBeenCalledWith(USER, expect.objectContaining({
      flow: 'menu', step: 'AWAITING_MENU_CHOICE',
    }));
  });

  it('a coaching prompt still replaces a stale menu wait', async () => {
    // The reverse direction is fine and must keep working: starting real work while a
    // menu glance is parked should take over, because that IS the teacher choosing.
    mockState.getState.mockResolvedValue({ flow: 'menu', step: 'AWAITING_MENU_CHOICE', payload: {}, stack: [] });

    await MenuService._updateConversationState(USER, 's-1', { current_state: 'AWAITING_CLASSROOM_AUDIO' });

    expect(mockState.setState).toHaveBeenCalledWith(USER, expect.objectContaining({ flow: 'coaching' }));
  });
});

describe('navigation must not count as being busy', () => {
  const TeacherState = require('../../bot/shared/services/teacher-state.service');

  it('a parked menu glance does not make her busy', async () => {
    // probeTeacherBusy gates whether a scheduled quiz report is delivered or deferred.
    // The menu wait lasts an hour, so counting it as busy would push a teacher's report
    // back for an hour every time she opened the menu — a silent delivery regression.
    mockState.getState.mockResolvedValue({ flow: 'menu', step: 'AWAITING_MENU_CHOICE', payload: {}, stack: [] });

    const res = await TeacherState.probeTeacherBusy(USER);
    expect(res.busy).toBe(false);
  });

  it('real work does make her busy', async () => {
    mockState.getState.mockResolvedValue({ flow: 'video', step: 'awaiting_topic', payload: {}, stack: [] });

    const res = await TeacherState.probeTeacherBusy(USER);
    expect(res).toMatchObject({ busy: true, feature: 'video' });
  });

  it('an unanswered resume offer does not make her busy', async () => {
    // She has been asked and has not replied. That is waiting on us, not on her.
    mockState.getState.mockResolvedValue({ flow: 'video', step: 'offered_resume', payload: {}, stack: [] });

    const res = await TeacherState.probeTeacherBusy(USER);
    expect(res.busy).toBe(false);
  });
});
