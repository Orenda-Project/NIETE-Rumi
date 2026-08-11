/**
 * A tap carries its own intent. Missing state must never swallow it.
 *
 * `menu_lesson_plan` says exactly what the teacher wants. The handler used to look
 * up a 5-minute Redis key holding {sessionId, from, language, askedAt} — every field
 * recomputable — and when it had expired it replied "That menu selection has expired.
 * Type /menu to see options again." and returned. The intent was thrown away to
 * enforce a gate that guarded nothing.
 *
 * NIETE production, 14 days: 1,103 taps hit that dead end across 720 distinct
 * teachers — 41% of the 1,758 teachers active in the window, and 20% of all 5,440
 * menu taps. 36% of sessions that opened the menu opened it again.
 *
 * So: state is CONTEXT, never PERMISSION. With no state the handler recomputes the
 * context and routes anyway.
 */

const mockWhatsApp = { sendMessage: jest.fn(), sendFlow: jest.fn(), sendFeatureMenuCarousel: jest.fn() };
const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn(), redis: { setex: jest.fn(), get: jest.fn(), del: jest.fn() } };
const mockState = { getState: jest.fn(), setState: jest.fn(), clearState: jest.fn() };
const mockSupabase = { from: jest.fn() };
const mockLessonPlanning = { handleLessonPlanRequest: jest.fn() };
const mockTrainingEntry = { openTrainingFlow: jest.fn() };

jest.mock('../../bot/shared/services/whatsapp.service', () => mockWhatsApp);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/services/conversation-state.service', () => mockState);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/services/lesson-planning.service', () => mockLessonPlanning);
jest.mock('../../bot/shared/services/training/training-entry.service', () => mockTrainingEntry);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  storeConversation: jest.fn(),
  getOrCreateSession: jest.fn().mockResolvedValue('session-recomputed'),
}));

const MenuService = require('../../bot/shared/services/menu.service');

const USER = { id: '11111111-2222-3333-4444-555555555555' };
const FROM = '923000000000';

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }) }),
    update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
  }));
  mockWhatsApp.sendFlow.mockResolvedValue(true);
});

/** Every reply the bot sent, flattened, so we can assert nothing dead-ends. */
const repliesSent = () => mockWhatsApp.sendMessage.mock.calls.map((c) => String(c[1] ?? '')).join(' | ');

describe('menu tap with no surviving state', () => {
  beforeEach(() => {
    // The 5-minute window has passed — this is the 1-in-5 case in production.
    mockRedis.get.mockResolvedValue(null);
    mockState.getState.mockResolvedValue(null);
  });

  it('still opens lesson planning', async () => {
    await MenuService.handleMenuButtonResponse(USER, FROM, 'menu_lesson_plan', 'en');

    expect(repliesSent()).not.toMatch(/expired/i);
    // Routed: either the LP Flow went out, or the topic prompt did — not a dead end.
    const routed = mockWhatsApp.sendFlow.mock.calls.length > 0 || mockRedis.redis.setex.mock.calls.length > 0 || mockState.setState.mock.calls.length > 0;
    expect(routed).toBe(true);
  });

  it('still opens training', async () => {
    await MenuService.handleMenuButtonResponse(USER, FROM, 'menu_training', 'en');

    expect(repliesSent()).not.toMatch(/expired/i);
    expect(mockTrainingEntry.openTrainingFlow).toHaveBeenCalled();
  });

  it('never tells a teacher her own tap expired', async () => {
    for (const id of ['menu_lesson_plan', 'menu_training', 'menu_coaching']) {
      jest.clearAllMocks();
      mockWhatsApp.sendFlow.mockResolvedValue(true);
      mockRedis.get.mockResolvedValue(null);
      mockState.getState.mockResolvedValue(null);

      await MenuService.handleMenuButtonResponse(USER, FROM, id, 'en');
      expect(repliesSent()).not.toMatch(/expired|no longer valid|start over|see options again/i);
    }
  });

  it('recomputes the session it needs instead of refusing for want of one', async () => {
    const { getOrCreateSession } = require('../../bot/shared/database/bot-helpers');
    await MenuService.handleMenuButtonResponse(USER, FROM, 'menu_lesson_plan', 'en');
    expect(getOrCreateSession).toHaveBeenCalledWith(USER.id);
  });
});

describe('menu tap with state present', () => {
  it('uses the stored context and still routes', async () => {
    mockRedis.get.mockResolvedValue({ sessionId: 'session-stored', from: FROM, language: 'en' });
    mockState.getState.mockResolvedValue({ flow: 'menu', step: 'awaiting_selection', payload: { sessionId: 'session-stored' } });

    await MenuService.handleMenuButtonResponse(USER, FROM, 'menu_lesson_plan', 'en');

    expect(repliesSent()).not.toMatch(/expired/i);
    // Same "did it route?" signal as the no-state case: the LP Flow went out, or the
    // topic prompt did. Which one depends on whether the Flow id is provisioned.
    const routed =
      mockWhatsApp.sendFlow.mock.calls.length > 0 ||
      mockRedis.redis.setex.mock.calls.length > 0 ||
      mockState.setState.mock.calls.length > 0;
    expect(routed).toBe(true);
  });

  it('consumes the stored state so one tap is answered once', async () => {
    mockRedis.get.mockResolvedValue({ sessionId: 'session-stored', from: FROM, language: 'en' });
    await MenuService.handleMenuButtonResponse(USER, FROM, 'menu_lesson_plan', 'en');
    expect(mockRedis.delete).toHaveBeenCalledWith(`user:${USER.id}:awaiting_menu_selection`);
  });
});
