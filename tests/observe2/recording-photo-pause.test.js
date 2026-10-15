/**
 * /observe2: "the recording pauses whenever the coach takes a photo" (pilot sheet R12).
 *
 * Most coaches record the lesson with a WhatsApp voice note: WhatsApp's own encoding is on about two
 * in three /observe2 recordings. A voice note is recorded by WhatsApp in a chat's message bar, and it
 * stops when the coach opens the camera to take a photo. A phone's voice recorder app keeps recording
 * in the background. The form already asks for the recorder app, but never said why, so the steps
 * now say it where the coach meets it: before the lesson (the chat message with the form) and at
 * the photo step. Photos taken with the camera during the lesson go in with "Upload saved photos".
 *
 * The period button runs for real (WhatsApp and the store mocked at the boundary); the Flow is read
 * from its generator and from the JSON that is published.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe2/field-form.store', () => ({
  getForm: jest.fn(() => Promise.resolve({ ok: true, form: { id: 'form-1', observer_user_id: 'coach-1' } })),
  setPeriod: jest.fn(() => Promise.resolve({ ok: true })),
}));

const fs = require('fs');
const path = require('path');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Start = require('../../bot/shared/services/observe/observe2/start');
const { buildFieldFormFlow } = require('../../bot/shared/services/observe/observe2/field-form.flow');

const COACH = (lang) => ({ id: 'coach-1', role: 'coach', preferred_language: lang });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OBSERVE2_FIELD_FORM_FLOW_ID = 'F-FORM';
});
afterAll(() => { delete process.env.OBSERVE2_FIELD_FORM_FLOW_ID; });

async function beforeTheLesson(lang) {
  expect(await Start.handlePeriodButton(COACH(lang), '923000000001', 'obs2_period:form-1:30')).toBe(true);
  const [, flow] = WhatsAppService.sendFlow.mock.calls[0];
  return flow.body;
}

describe('before the lesson: record with the voice recorder app, and why', () => {
  test('en: a WhatsApp voice note stops when the camera opens; the recorder app keeps recording', async () => {
    const body = await beforeTheLesson('en');
    const step1 = body.split('\n').find((l) => l.startsWith('1️⃣'));
    expect(step1).toMatch(/voice recorder app/);
    expect(step1).toMatch(/keeps recording while you take photos/i);
    expect(step1).toMatch(/WhatsApp voice note stops when the camera opens/i);
  });

  test('ur: the same, in Urdu', async () => {
    const body = await beforeTheLesson('ur');
    const step1 = body.split('\n').find((l) => l.startsWith('1️⃣'));
    expect(step1).toMatch(/وائس ریکارڈر ایپ/);
    expect(step1).toMatch(/تصویر/);
    expect(step1).toMatch(/وائس نوٹ[^\n]*کیمرہ[^\n]*رک/);
  });

  ['en', 'ur'].forEach((lang) => {
    test(`${lang}: photos taken with the camera during the lesson are added with "Upload saved photos"`, async () => {
      const body = await beforeTheLesson(lang);
      const step2 = body.split('\n').find((l) => l.startsWith('2️⃣'));
      expect(step2).toMatch(/Upload saved photos/);
      expect([...body].length).toBeLessThanOrEqual(1024);
    });
  });
});

describe('the photo step says the same where the coach meets it', () => {
  const photosText = (flow) => JSON.stringify(flow.screens.find((s) => s.id === 'PHOTOS').layout);

  test('the PHOTOS screen: the recorder app keeps recording, a WhatsApp voice note pauses, saved photos go in with Upload saved photos', () => {
    const text = photosText(buildFieldFormFlow());
    expect(text).toMatch(/voice recorder app keeps recording/i);
    expect(text).toMatch(/WhatsApp voice note pauses/i);
    expect(text).toMatch(/Upload saved photos/);
  });

  test('the committed Flow JSON carries it (the generator was run)', () => {
    const dir = path.join(__dirname, '../../docs/flows');
    const file = fs.readdirSync(dir).find((f) => /observe2.*field.*form.*\.json$/i.test(f));
    expect(file).toBeTruthy();
    const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    expect(photosText(json)).toMatch(/WhatsApp voice note pauses/i);
  });
});
