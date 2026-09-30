/**
 * The paper arrives WITH its Edit button: one interactive Flow message whose
 * header is the PDF (T0.1, 30 Sep 2026: accepted, delivered, rendered as a PDF
 * bubble with the body and the CTA under it, and the PDF opens from it).
 *
 * If Meta ever refuses that message, the paper must still reach her — so a
 * refused send falls back, in the same call, to the document by link followed
 * by a separate text-header Flow message carrying the same button.
 *
 * With editing switched off she gets a plain document and no button at all.
 *
 * The REAL WhatsApp service runs here; only HTTP (the axios stub) and the flag
 * table (Supabase) are faked, so the payload asserted is the one Meta would get.
 */
jest.mock('../../bot/shared/utils/constants', () => ({
  ...jest.requireActual('../../bot/shared/utils/constants'),
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
const mockLog = { logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() };
jest.mock('../../bot/shared/utils/logger', () => mockLog);
const mockFlags = { assessment_editing_enabled: true };
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

const cp = (s) => [...s].length;
const ARGS = {
  phone: '923000000000',
  url: 'https://signed.example/Grade3_Maths.pdf',
  filename: 'Grade3_Maths.pdf',
  caption: 'Grade 3 Maths · 20 questions',
  body: 'Grade 3 Maths\n20 questions · 25 marks',
  flowToken: 'u1:assessment-review:p1',
  user: { preferred_language: 'en' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.assessment_editing_enabled = true;
  process.env.ASSESSMENT_REVIEW_FLOW_ID = 'REVIEW_FLOW';
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.x' }] } });
});
afterAll(() => { delete process.env.ASSESSMENT_REVIEW_FLOW_ID; });

const sent = () => axios.post.mock.calls.map((c) => c[1]);

test('the spike result is the default mode', () => {
  expect(Delivery.EDIT_BUTTON_MODE).toBe('document_header');
});

test('document_header: ONE Flow message, the PDF as its header, "Edit questions/marks" as its button', async () => {
  const out = await Delivery.sendPaperWithEditButton(ARGS);
  expect(out).toEqual({ sent: true, mode: 'document_header' });
  expect(sent()).toHaveLength(1);
  const [m] = sent();
  expect(m.type).toBe('interactive');
  expect(m.interactive.type).toBe('flow');
  expect(m.interactive.header).toEqual({ type: 'document', document: { link: ARGS.url, filename: ARGS.filename } });
  expect(m.interactive.body.text).toBe(ARGS.body);
  expect(m.interactive.action.parameters).toMatchObject({
    flow_id: 'REVIEW_FLOW', flow_cta: 'Edit questions/marks', flow_token: ARGS.flowToken, flow_action: 'data_exchange',
  });
});

test('the button is ≤ 20 code points in every language — Urdu included', async () => {
  await Delivery.sendPaperWithEditButton({ ...ARGS, user: { preferred_language: 'ur' } });
  const cta = sent()[0].interactive.action.parameters.flow_cta;
  expect(cta).toMatch(/[؀-ۿ]/);
  expect(cp(cta)).toBeLessThanOrEqual(20);
});

test('a refused document-header message falls back: the PDF by link, then a text-header Flow with the same button', async () => {
  axios.post.mockRejectedValueOnce(Object.assign(new Error('400'), { response: { data: { error: { code: 131009 } } } }));
  const out = await Delivery.sendPaperWithEditButton(ARGS);
  expect(out).toMatchObject({ sent: true, mode: 'separate' });
  const [refused, doc, flow] = sent();
  expect(refused.interactive.header.type).toBe('document');
  expect(doc).toMatchObject({ type: 'document', document: { link: ARGS.url, filename: ARGS.filename, caption: ARGS.caption } });
  expect(flow.interactive.header.type).toBe('text');
  expect(flow.interactive.action.parameters.flow_cta).toBe('Edit questions/marks');
  expect(flow.interactive.action.parameters.flow_token).toBe(ARGS.flowToken);
  expect(mockLog.logError).toHaveBeenCalledWith(expect.stringMatching(/document-header flow refused/), expect.anything());
});

test('in the fallback, a paper that cannot be sent at all is reported unsent (no button offered for it)', async () => {
  axios.post.mockRejectedValue(new Error('down'));
  const out = await Delivery.sendPaperWithEditButton(ARGS);
  expect(out.sent).toBe(false);
  expect(sent()).toHaveLength(2); // the refused header message, the refused document; no Flow after
});

test('the fallback button failing never un-delivers the paper', async () => {
  axios.post
    .mockRejectedValueOnce(new Error('refused'))
    .mockResolvedValueOnce({ data: {} })
    .mockRejectedValueOnce(new Error('flow refused'));
  const out = await Delivery.sendPaperWithEditButton(ARGS);
  expect(out).toEqual({ sent: true, mode: 'separate', editButton: false });
});

test('editing switched off: a plain document, no Flow, no button', async () => {
  mockFlags.assessment_editing_enabled = false;
  const out = await Delivery.sendPaperWithEditButton(ARGS);
  expect(out).toEqual({ sent: true, mode: 'document' });
  expect(sent()).toHaveLength(1);
  expect(sent()[0].type).toBe('document');
});

test('no review Flow configured: a plain document', async () => {
  delete process.env.ASSESSMENT_REVIEW_FLOW_ID;
  delete process.env.ASSESSMENT_GEN_FLOW_ID;
  const out = await Delivery.sendPaperWithEditButton(ARGS);
  expect(out.mode).toBe('document');
});

test('sendAnswerKey sends the key by link and reports whether it went', async () => {
  await expect(Delivery.sendAnswerKey({ phone: ARGS.phone, url: 'https://k', filename: 'k.pdf', caption: 'Answer key' })).resolves.toBe(true);
  expect(sent()[0]).toMatchObject({ type: 'document', document: { link: 'https://k', filename: 'k.pdf' } });
  axios.post.mockRejectedValueOnce(new Error('x'));
  await expect(Delivery.sendAnswerKey({ phone: ARGS.phone, url: 'https://k', filename: 'k.pdf' })).resolves.toBe(false);
});
