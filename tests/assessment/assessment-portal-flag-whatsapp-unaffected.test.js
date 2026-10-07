/**
 * bd-6faz8m — the portal has its own paper-editing switch
 * (portal_assessment_editing_enabled). WhatsApp keeps assessment_editing_enabled
 * and must not notice the new row at all.
 */
jest.mock('../../bot/shared/utils/constants', () => ({
  ...jest.requireActual('../../bot/shared/utils/constants'),
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const mockFlags = {};
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({
    select: () => ({
      eq: (_k, key) => ({
        maybeSingle: async () => ({ data: key in mockFlags ? { value: mockFlags[key] } : null, error: null }),
      }),
    }),
  }),
}));

const axios = require('axios');
const Delivery = require('../../bot/shared/services/assessment/assessment-delivery');

const ARGS = {
  phone: '923000000000',
  url: 'https://signed.example/Grade3_Maths.pdf',
  filename: 'Grade3_Maths.pdf',
  caption: 'Grade 3 Maths · 20 questions',
  body: 'Grade 3 Maths\n20 questions · 25 marks',
  flowToken: 'u1:assessment-review:p1',
  user: { preferred_language: 'en' },
};
const sent = () => axios.post.mock.calls.map((c) => c[1]);
const hasFlowButton = () => sent().some((m) => m.type === 'interactive' && m.interactive?.type === 'flow');

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockFlags)) delete mockFlags[k];
  process.env.ASSESSMENT_REVIEW_FLOW_ID = 'REVIEW_FLOW';
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.x' }] } });
});
afterAll(() => { delete process.env.ASSESSMENT_REVIEW_FLOW_ID; });

describe('WhatsApp editing ignores the portal switch', () => {
  test('assessment_editing_enabled true + portal false -> WhatsApp still sends the Edit button', async () => {
    mockFlags.assessment_editing_enabled = true;
    mockFlags.portal_assessment_editing_enabled = false;
    await Delivery.sendPaperWithEditButton(ARGS);
    expect(hasFlowButton()).toBe(true);
  });

  test('assessment_editing_enabled false + portal true -> WhatsApp sends no Edit button', async () => {
    mockFlags.assessment_editing_enabled = false;
    mockFlags.portal_assessment_editing_enabled = true;
    await Delivery.sendPaperWithEditButton(ARGS);
    expect(hasFlowButton()).toBe(false);
  });
});
