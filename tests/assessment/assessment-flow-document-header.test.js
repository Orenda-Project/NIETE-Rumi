/**
 * The paper and its Edit button arrive as ONE message: an interactive Flow
 * message whose header is the PDF itself.
 *
 * Proven against the sandbox Cloud API on 30 Sep 2026 — Meta accepted
 * `header: { type: 'document', document: { link, filename } }` on a Flow
 * message, delivered it, and it rendered as a PDF bubble with the body and
 * the CTA under it (desktop and phone). `sendFlow` only knew text and image
 * headers, so the orchestrator could not ask for it.
 *
 * A rejected send is logged at ERROR: a refused teacher-facing message at
 * `info` is how a silent outage lasts hours instead of minutes.
 */
jest.mock('../../bot/shared/utils/constants', () => ({
  ...jest.requireActual('../../bot/shared/utils/constants'),
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
const mockLog = { logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() };
jest.mock('../../bot/shared/utils/logger', () => mockLog);

const axios = require('axios');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.x' }] } });
});

const payloadOf = () => axios.post.mock.calls[0][1];

test('a document header is sent as { type: document, document: { link, filename } }', async () => {
  const ok = await WhatsAppService.sendFlow('923000000000', {
    flowId: 'F1',
    headerDocument: { link: 'https://signed.example/p.pdf', filename: 'Grade3_Maths.pdf' },
    body: 'Grade 3 Maths · 20 questions',
    buttonText: 'Edit questions/marks',
    flowToken: 'u:assessment-review:p',
  });
  expect(ok).toBe(true);
  const p = payloadOf();
  expect(p.interactive.type).toBe('flow');
  expect(p.interactive.header).toEqual({
    type: 'document', document: { link: 'https://signed.example/p.pdf', filename: 'Grade3_Maths.pdf' },
  });
  expect(p.interactive.body).toEqual({ text: 'Grade 3 Maths · 20 questions' });
  expect(p.interactive.action.parameters).toMatchObject({
    flow_cta: 'Edit questions/marks', flow_action: 'data_exchange', flow_token: 'u:assessment-review:p', flow_id: 'F1',
  });
});

test('text still wins over media, and image still works as before', async () => {
  await WhatsAppService.sendFlow('923000000000', {
    flowId: 'F1', header: 'Title', headerDocument: { link: 'https://x/p.pdf', filename: 'p.pdf' }, body: 'b', flowToken: 't',
  });
  expect(payloadOf().interactive.header).toEqual({ type: 'text', text: 'Title' });
  axios.post.mockClear();
  await WhatsAppService.sendFlow('923000000000', { flowId: 'F1', headerImage: 'https://x/i.png', body: 'b', flowToken: 't' });
  expect(payloadOf().interactive.header).toEqual({ type: 'image', image: { link: 'https://x/i.png' } });
});

test('a refused send returns false and is logged at ERROR, not info', async () => {
  axios.post.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 400'), {
    response: { data: { error: { code: 131009, message: 'Parameter value is not valid' } } },
  }));
  const ok = await WhatsAppService.sendFlow('923000000000', {
    flowId: 'F1', headerDocument: { link: 'https://x/p.pdf', filename: 'p.pdf' }, body: 'b', flowToken: 't',
  });
  expect(ok).toBe(false);
  expect(mockLog.logError).toHaveBeenCalled();
});
