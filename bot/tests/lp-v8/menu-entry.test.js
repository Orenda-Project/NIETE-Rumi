/**
 * FEAT-059 / bd-72dth — /menu → "Lesson Plans" opens the SAME menu the keyword
 * intercept opens (TDD, red first).
 *
 * The wiring already existed (FEAT-109); what did not exist was a test, so
 * nothing stopped the two entry points drifting apart. It also had no Urdu
 * copy, which the language-protocol skill requires for a teacher-facing string
 * on a flat en/ur deployment — and every such string has to fit its WhatsApp
 * field cap measured in CODE POINTS (an 87-char footer once took /language down
 * silently for hours).
 */

const mockFlowsSent = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(async (to, opts) => { mockFlowsSent.push({ to, ...opts }); return true; }),
  sendMessage: jest.fn(async () => true),
  sendInteractiveMessage: jest.fn(async () => true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  redis: { set: jest.fn(async () => 'OK'), get: jest.fn(async () => null), del: jest.fn(async () => 1) },
  set: jest.fn(async () => {}), get: jest.fn(async () => null), delete: jest.fn(async () => {}),
}));
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => ({
    select: function () { return this; },
    eq: function () { return this; },
    update: function () { return this; },
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (f, r) => Promise.resolve({ data: null, error: null }).then(f, r),
  })),
}));

const MenuService = require('../../shared/services/menu.service');

const cps = (s) => [...String(s || '')].length;

// WhatsApp interactive-message caps, in code points.
const HEADER_CAP = 60;
const BODY_CAP = 1024;
const BUTTON_CAP = 20;

const FLOW_ID = 'flow-abc-123';

beforeEach(() => {
  mockFlowsSent.length = 0;
  process.env.PAKISTAN_LP_FLOW_ID = FLOW_ID;
});
afterAll(() => { delete process.env.PAKISTAN_LP_FLOW_ID; });

describe('/menu → Lesson Plans', () => {
  test('sends the LP Flow, not the old free-text topic prompt', async () => {
    await MenuService._handleLessonPlanningChoice('user-1', 'sess-1', '923001234567', 'en');
    expect(mockFlowsSent).toHaveLength(1);
    expect(mockFlowsSent[0].flowId).toBe(FLOW_ID);
  });

  test('lands on the SAME flow id the keyword intercept uses', async () => {
    // Both entry points read process.env.PAKISTAN_LP_FLOW_ID — this test is what
    // stops them drifting apart.
    await MenuService._handleLessonPlanningChoice('user-1', 'sess-1', '923001234567', 'en');
    expect(mockFlowsSent[0].flowId).toBe(process.env.PAKISTAN_LP_FLOW_ID);
  });

  test('flow token is the user id first, so the endpoint can resolve her', async () => {
    await MenuService._handleLessonPlanningChoice('user-42', 'sess-1', '923001234567', 'en');
    expect(String(mockFlowsSent[0].flowToken).split(':')[0]).toBe('user-42');
  });

  test('falls back to the topic prompt when the Flow is not provisioned', async () => {
    delete process.env.PAKISTAN_LP_FLOW_ID;
    await MenuService._handleLessonPlanningChoice('user-1', 'sess-1', '923001234567', 'en');
    expect(mockFlowsSent).toHaveLength(0);
  });
});

describe('copy: bilingual and inside the WhatsApp caps', () => {
  test('an Urdu teacher gets Urdu, not English', async () => {
    await MenuService._handleLessonPlanningChoice('user-1', 'sess-1', '923001234567', 'ur');
    const sent = mockFlowsSent[0];
    expect(sent.body).toMatch(/[؀-ۿ]/);
    expect(sent.buttonText).toMatch(/[؀-ۿ]/);
  });

  test('an English teacher gets English', async () => {
    await MenuService._handleLessonPlanningChoice('user-1', 'sess-1', '923001234567', 'en');
    const sent = mockFlowsSent[0];
    expect(sent.body).not.toMatch(/[؀-ۿ]/);
  });

  test('every field fits its cap in CODE POINTS, both languages', async () => {
    for (const lang of ['en', 'ur']) {
      mockFlowsSent.length = 0;
      await MenuService._handleLessonPlanningChoice('user-1', 'sess-1', '923001234567', lang);
      const s = mockFlowsSent[0];
      expect(cps(s.header)).toBeLessThanOrEqual(HEADER_CAP);
      expect(cps(s.body)).toBeLessThanOrEqual(BODY_CAP);
      expect(cps(s.buttonText)).toBeLessThanOrEqual(BUTTON_CAP);
    }
  });

  test('an unknown language falls back to English rather than sending nothing', async () => {
    await MenuService._handleLessonPlanningChoice('user-1', 'sess-1', '923001234567', 'sw');
    expect(mockFlowsSent[0].body).toBeTruthy();
    expect(mockFlowsSent[0].body).not.toMatch(/[؀-ۿ]/);
  });

  test('the copy describes the lesson-level drill, not the old chapter-only picker', async () => {
    await MenuService._handleLessonPlanningChoice('user-1', 'sess-1', '923001234567', 'en');
    expect(mockFlowsSent[0].body.toLowerCase()).toMatch(/lesson/);
  });
});
