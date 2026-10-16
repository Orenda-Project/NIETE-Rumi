/**
 * /observe2: how the coach is told to send the recording (pilot sheet R2).
 *
 * R2. A coach recorded with the phone's voice recorder app, as the form asks, sealed the form, and
 * followed the bot's next step: "In the recorder app, tap Share → WhatsApp → this chat". That sends
 * the file as an AUDIO attachment, which WhatsApp refuses over 16 MB. A recorder app passes 16 MB
 * after about 17 minutes, so every full lesson sent that way is refused on the phone and never
 * reaches the bot. As a DOCUMENT, WhatsApp carries up to 100 MB, and the bot already takes it.
 * Every place that asks for the recording now says to send it as a document, and how.
 * (R12, recording with the app rather than a voice note: recording-photo-pause.test.js.)
 *
 * Each message is read where the coach reads it: the seal, the period button and the visit
 * planner's Start run for real; WhatsApp, the database and the bind are mocked at the boundary.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  setState: jest.fn(() => Promise.resolve(true)), getState: jest.fn(() => Promise.resolve(null)), clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/handlers/observe-visit-flow.handler', () => ({
  handle: jest.fn(() => Promise.resolve({ boundTeacher: { teacher_ext_id: 'tx1', school_ext_id: 'sx1', teacher_name: 'Rabia', user_id: 'teacher-1' } })),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Endpoint = require('../../bot/shared/routes/observe2-form-endpoint');
const Start = require('../../bot/shared/services/observe/observe2/start');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');

const token = (formId) => `coach-1:observe2-form:${formId}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };

const PART_1_OK = {
  screen: 'PART_ONE', present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'],
  p1_listen_other: '', p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow', p1_notes: '',
};
const PART_2_OK = {
  screen: 'PART_TWO', p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'],
  p2_listen_other: '', p2_materials: 'children', p2_change: 'no', p2_notes: '',
};
const PLAN_NONE = { screen: 'LESSON_PLAN', fv: '4', lp: 'none' };
const AFTER_OK = { screen: 'AFTER', incident: 'none', detail: '', note: '', priority: 'C8', seal_ok: true };

// What "send it as a document" has to say, in each language. 📎 is the attach button on Android
// (most coaches); iPhone saves a Voice Memo to Files first, then attaches it the same way.
const SAYS_DOCUMENT = { en: /\*Document\*/, ur: /\*Document\*/ };
const SHARE_TO_WHATSAPP = /Share\*?\s*(→|،?\s*پھر)\s*\*?WhatsApp/;

function coachIn(lang) {
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: lang, role: 'coach' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', role: 'teacher' },
    ],
  });
}

async function sealedForm() {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: { teacher_ext_id: 'tx1' } });
  Object.assign(row(form.id), { period_minutes: 30 });
  await Endpoint.handleObserve2FormDataExchange(token(form.id), 'PART_ONE', PART_1_OK);
  await Endpoint.handleObserve2FormDataExchange(token(form.id), 'PART_TWO', PART_2_OK);
  await Endpoint.handleObserve2FormDataExchange(token(form.id), 'LESSON_PLAN', PLAN_NONE);
  const sealed = await Endpoint.handleObserve2FormDataExchange(token(form.id), 'AFTER', AFTER_OK);
  await flush();
  return { id: form.id, sealed };
}

beforeEach(() => {
  jest.clearAllMocks();
  coachIn('en');
});

describe('R2: after the seal, the chat says how to send a long recording', () => {
  ['en', 'ur'].forEach((lang) => {
    test(`${lang}: send it as a document, with the steps; never Share → WhatsApp, which WhatsApp refuses over 16 MB`, async () => {
      coachIn(lang);
      await sealedForm();
      expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
      const [to, text] = WhatsAppService.sendMessage.mock.calls[0];
      expect(to).toBe('923000000001');
      expect(text).toMatch(SAYS_DOCUMENT[lang]);
      expect(text).toContain('📎');
      expect(text).toMatch(/16 MB/);
      expect(text).toMatch({ en: /iPhone/, ur: /آئی فون/ }[lang]);
      expect(text).not.toMatch(SHARE_TO_WHATSAPP);
    });
  });

  test('the sealed screen points to the chat and says "as a document"', async () => {
    const { sealed } = await sealedForm();
    expect(sealed.screen).toBe('SEALED');
    expect(sealed.data.next_line).toMatch(/as a document/i);
  });

  test('a sealed form opened again says the same', async () => {
    const { id } = await sealedForm();
    const again = await Endpoint.handleObserve2FormInit(token(id));
    expect(again.screen).toBe('CONTINUE');
    const line = JSON.stringify(again.data);
    expect(line).toMatch(/recording/i);
    expect(line).toMatch(/as a document/i);
  });

  test('every other line that asks for the recording again says "as a document" too', () => {
    for (const lang of ['en', 'ur']) {
      const S = observe2Strings(lang);
      expect(S.duplicate_form_waiting).toMatch(SAYS_DOCUMENT[lang]);
      expect(S.moments_untimed).toMatch(SAYS_DOCUMENT[lang]);
    }
  });
});

describe('the period button: the before-the-lesson steps end with "send it as a document"', () => {
  const COACH = (lang) => ({ id: 'coach-1', role: 'coach', preferred_language: lang });
  ['en', 'ur'].forEach((lang) => {
    test(`${lang}`, async () => {
      jest.spyOn(Store, 'getForm').mockResolvedValueOnce({ ok: true, form: { id: 'form-1', observer_user_id: 'coach-1' } });
      jest.spyOn(Store, 'setPeriod').mockResolvedValueOnce({ ok: true });
      process.env.OBSERVE2_FIELD_FORM_FLOW_ID = 'F-FORM';
      try {
        expect(await Start.handlePeriodButton(COACH(lang), '923000000001', 'obs2_period:form-1:30')).toBe(true);
      } finally { delete process.env.OBSERVE2_FIELD_FORM_FLOW_ID; }
      const [, flow] = WhatsAppService.sendFlow.mock.calls[0];
      const last = flow.body.split('\n').pop();
      expect(last).toMatch(SAYS_DOCUMENT[lang]);
      expect(last).toContain('📎');
      expect([...flow.body].length).toBeLessThanOrEqual(1024);
    });
  });
});

describe('/observe (classic): the visit brief asks for the recording', () => {
  const { handleObserveVisitFlow } = require('../../bot/shared/handlers/flow-response.handler');
  const reply = { interactive: { nfm_reply: { response_json: JSON.stringify({ step: 'start', teacher_ext_id: 'tx1', school_ext_id: 'sx1', flow_token: 'coach-1' }) } } };

  test('ur, teacher named in Latin script: every paragraph of the brief opens right to left', async () => {
    // WhatsApp lays out each paragraph from its first strong character. "🎙️ *Rabia* کے سبق ..." opened
    // on the Latin name, so the whole Urdu sentence was laid out left to right and read scrambled.
    coachIn('ur');
    await handleObserveVisitFlow(reply, '923000000001', 'coach-1');
    const brief = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).find((t) => /🎙️/.test(t));
    expect(brief).toContain('Rabia');
    const firstStrong = (para) => {
      for (const ch of para) {
        if (ch === '‏') return 'rtl';
        if (ch === '‎') return 'ltr';
        if (/\p{L}/u.test(ch)) return /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(ch) ? 'rtl' : 'ltr';
      }
      return null;
    };
    brief.split('\n').filter((p) => p.trim()).forEach((p) => expect(firstStrong(p)).toBe('rtl'));
  });

  ['en', 'ur'].forEach((lang) => {
    test(`${lang}: a recording from the recorder app goes as a document`, async () => {
      coachIn(lang);
      await handleObserveVisitFlow(reply, '923000000001', 'coach-1');
      const brief = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).find((t) => /🎙️/.test(t));
      expect(brief).toBeTruthy();
      expect(brief).toMatch(SAYS_DOCUMENT[lang]);
      expect(brief).toContain('📎');
    });
  });
});
