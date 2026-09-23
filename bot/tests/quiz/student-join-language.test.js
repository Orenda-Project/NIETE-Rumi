'use strict';
/**
 * A child who opens an URDU quiz link must not meet English on the way in.
 *
 * Render QA found three English surfaces between the link and question 1 of an
 * Urdu quiz: the join Flow's screen (title, heading, both labels, both helper
 * lines, the submit button), the "Start" button on the message that opens it,
 * and the fallback teacher/topic handed to the Flow. The screen could not be
 * fixed in the bot alone, because the published Flow asset hardcoded its words.
 *
 * The fix is a second, LOCALIZED join Flow whose every visible word is a
 * `${data.*}` binding, filled here from the catalog in the quiz language, so one
 * published asset serves both languages. It lives behind its own env var so the
 * currently published (English) Flow keeps working until the new one is live on
 * each WABA:
 *   - localized id set  → every child gets it, in the quiz language;
 *   - only the legacy id → an English child keeps it exactly as before, and an
 *     Urdu child is asked in chat, in Urdu, rather than shown the English form.
 *
 * Only the network is replaced: axios (sendFlow) and fetch (sendMessage). The
 * share service, the catalog and whatsapp.service all run for real, so these
 * assert what Meta would actually receive.
 */

process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'test-token';
process.env.PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || 'test-phone-id';

jest.mock('axios');
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn(),
  setNX: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/student-identity.service', () => ({
  findByPhone: jest.fn().mockResolvedValue([]),
  remember: jest.fn().mockResolvedValue({ id: 'stu-1' }),
  touch: jest.fn().mockResolvedValue(undefined),
  normalisePhone: (p) => String(p || '').replace(/\D/g, ''),
}));

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const share = require('../../shared/services/quiz/video-quiz-share.service');

const FLOW_V2 = path.join(__dirname, '..', '..', '..', 'docs', 'flows', 'student-join-flow-v2.json');
const PHONE = '923001234567';
const cp = (s) => [...String(s)].length;

// The words the English asset hardcodes. None of them may reach an Urdu child.
const ENGLISH_CHROME = /Before we start|has sent you a quiz|Your name|Your class|So your teacher|For example|Start the quiz|Your teacher|today’s lesson/;

let shareCode;

function stubShareCodeLookup() {
  const supabase = require('../../shared/config/supabase');
  supabase.from.mockImplementation(() => {
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: shareCode }),
    };
    return chain;
  });
}

function flowPayloads() {
  return axios.post.mock.calls
    .map((c) => c[1])
    .filter((p) => p && p.interactive && p.interactive.type === 'flow');
}

function textBodies() {
  return global.fetch.mock.calls
    .map((c) => JSON.parse(c[1].body))
    .filter((p) => p.type === 'text')
    .map((p) => p.text.body);
}

function onlyFlow() {
  const flows = flowPayloads();
  expect(flows).toHaveLength(1);
  return flows[0].interactive.action.parameters;
}

const ENV_KEYS = ['STUDENT_JOIN_LOCALIZED_FLOW_ID', 'STUDENT_JOIN_FLOW_ID'];
const saved = {};

beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.2' }] }),
  });
  shareCode = {
    id: 'sc-1', quiz_id: 'q1', video_id: 'v1', teacher_user_id: 'u1',
    teacher_name: 'مس عائشہ', topic: 'واحد اور جمع', language: 'ur',
    active: true, expires_at: null,
  };
  stubShareCodeLookup();
});

describe('the localized join Flow speaks the quiz language', () => {
  beforeEach(() => {
    process.env.STUDENT_JOIN_LOCALIZED_FLOW_ID = 'join-localized-1';
    process.env.STUDENT_JOIN_FLOW_ID = 'join-legacy-1';
  });

  test('an Urdu quiz: the button and every word on the screen are Urdu', async () => {
    await share.beginFromCode(PHONE, 'K7RM2Q');

    const params = onlyFlow();
    // The localized asset wins over the legacy one whenever it is configured.
    expect(params.flow_id).toBe('join-localized-1');
    expect(params.flow_cta).toBe('شروع کریں');
    expect(params.flow_action_payload.screen).toBe('WHO');

    const data = params.flow_action_payload.data;
    expect(data.title).toBe('شروع کرنے سے پہلے');
    expect(data.heading).toContain('مس عائشہ');
    expect(data.heading).toContain('نے آپ کو quiz بھیجا ہے');
    expect(data.topic).toBe('واحد اور جمع');
    expect(data.name_label).toBe('آپ کا نام');
    expect(data.class_label).toBe('آپ کی جماعت');
    expect(data.name_help).toMatch(/[؀-ۿ]/);
    expect(data.class_help).toMatch(/[؀-ۿ]/);
    expect(data.cta).toContain('شروع کریں');
    for (const v of Object.values(data)) expect(v).not.toMatch(ENGLISH_CHROME);
  });

  test('an English quiz: the same asset, in English', async () => {
    shareCode = { ...shareCode, teacher_name: 'Miss Ayesha', topic: 'A Balanced Diet', language: 'en' };

    await share.beginFromCode(PHONE, 'K7RM2Q');

    const params = onlyFlow();
    expect(params.flow_id).toBe('join-localized-1');
    expect(params.flow_cta).toBe('Start');
    const data = params.flow_action_payload.data;
    expect(data).toEqual({
      title: 'Before we start',
      heading: 'Miss Ayesha has sent you a quiz',
      topic: 'A Balanced Diet',
      name_label: 'Your name',
      name_help: 'So your teacher can see how you did',
      class_label: 'Your class',
      class_help: 'For example: Grade 4, or 1-B',
      cta: 'Start the quiz',
    });
  });

  test('the data sent is exactly the data the published Flow declares — no more, no less', async () => {
    // A key the screen does not declare is a Meta-side unknown; a declared key
    // left out renders as a blank or a literal ${data.x} on the child's phone.
    const flow = JSON.parse(fs.readFileSync(FLOW_V2, 'utf8'));
    const declared = Object.keys(flow.screens[0].data).sort();

    for (const language of ['ur', 'en']) {
      jest.clearAllMocks();
      shareCode = { ...shareCode, language };
      await share.beginFromCode(PHONE, 'K7RM2Q');
      expect(Object.keys(onlyFlow().flow_action_payload.data).sort()).toEqual(declared);
    }
  });

  test('a missing teacher name and topic fall back in the quiz language, not in English', async () => {
    shareCode = { ...shareCode, teacher_name: null, topic: null };

    await share.beginFromCode(PHONE, 'K7RM2Q');

    const data = onlyFlow().flow_action_payload.data;
    expect(data.heading).toContain('آپ کے استاد');
    expect(data.topic).toBe('آج کا سبق');
    for (const v of Object.values(data)) expect(v).not.toMatch(ENGLISH_CHROME);
  });

  test('a teacher name that would overflow the 80-code-point heading is never cut: the heading names "your teacher" instead', async () => {
    shareCode = { ...shareCode, teacher_name: 'استاد '.repeat(16).trim() };

    await share.beginFromCode(PHONE, 'K7RM2Q');

    const params = onlyFlow();
    const data = params.flow_action_payload.data;
    expect(cp(data.heading)).toBeLessThanOrEqual(80);
    expect(data.heading).toContain('آپ کے استاد');
    // The greeting above the button still carries the full name.
    expect(flowPayloads()[0].interactive.body.text).toContain(shareCode.teacher_name);
  });

  test('an English heading around an Urdu-script name keeps the name isolated, so the line reads left to right', async () => {
    shareCode = { ...shareCode, teacher_name: 'مس عائشہ', topic: 'A Balanced Diet', language: 'en' };

    await share.beginFromCode(PHONE, 'K7RM2Q');

    const data = onlyFlow().flow_action_payload.data;
    expect(data.heading).toBe('⁨مس عائشہ⁩ has sent you a quiz');
  });

  test('the greeting above the button isolates a teacher name in the other script, so its paragraph keeps the quiz direction', async () => {
    // The greeting's second paragraph OPENS with the name. A phone lays each
    // paragraph out from its first strong character, so a Latin name made an
    // Urdu line run left to right (read from the right: "بھیجا ہے۔ quiz …
    // Miss Ayesha"), and an Urdu name did the same to an English line. An
    // isolate is skipped when the direction is chosen.
    shareCode = { ...shareCode, teacher_name: 'Miss Ayesha', language: 'ur' };
    await share.beginFromCode(PHONE, 'K7RM2Q');
    expect(flowPayloads()[0].interactive.body.text).toContain('*⁨Miss Ayesha⁩* نے آپ کو');

    jest.clearAllMocks();
    shareCode = { ...shareCode, teacher_name: 'مس عائشہ', topic: 'A Balanced Diet', language: 'en' };
    await share.beginFromCode(PHONE, 'K7RM2Q');
    expect(flowPayloads()[0].interactive.body.text).toContain('*⁨مس عائشہ⁩* has sent you a quiz');

    // Same script: untouched.
    jest.clearAllMocks();
    shareCode = { ...shareCode, teacher_name: 'Miss Ayesha', language: 'en' };
    await share.beginFromCode(PHONE, 'K7RM2Q');
    expect(flowPayloads()[0].interactive.body.text).toContain('*Miss Ayesha* has sent you a quiz');
  });

  test('every value fits the Flow field it lands in (code points)', async () => {
    for (const language of ['ur', 'en']) {
      jest.clearAllMocks();
      shareCode = { ...shareCode, language };
      await share.beginFromCode(PHONE, 'K7RM2Q');
      const params = onlyFlow();
      const d = params.flow_action_payload.data;
      // Present first: a missing value would measure as the 9 letters of "undefined".
      for (const k of ['title', 'heading', 'name_label', 'class_label', 'name_help', 'class_help', 'cta']) {
        expect({ k, type: typeof d[k] }).toEqual({ k, type: 'string' });
      }
      expect(cp(params.flow_cta)).toBeLessThanOrEqual(20);   // Flow CTA
      expect(cp(d.title)).toBeLessThanOrEqual(30);           // screen title
      expect(cp(d.heading)).toBeLessThanOrEqual(80);         // TextHeading
      expect(cp(d.name_label)).toBeLessThanOrEqual(20);      // TextInput label
      expect(cp(d.class_label)).toBeLessThanOrEqual(20);
      expect(cp(d.name_help)).toBeLessThanOrEqual(80);       // TextInput helper-text
      expect(cp(d.class_help)).toBeLessThanOrEqual(80);
      expect(cp(d.cta)).toBeLessThanOrEqual(35);             // Footer label
    }
  });
});

describe('until the localized Flow is published, the legacy English Flow still works', () => {
  beforeEach(() => { process.env.STUDENT_JOIN_FLOW_ID = 'join-legacy-1'; });

  test('an English child gets the legacy Flow exactly as before', async () => {
    shareCode = { ...shareCode, teacher_name: 'Miss Ayesha', topic: 'A Balanced Diet', language: 'en' };

    await share.beginFromCode(PHONE, 'K7RM2Q');

    const params = onlyFlow();
    expect(params.flow_id).toBe('join-legacy-1');
    expect(params.flow_cta).toBe('Start');
    // The legacy asset declares only these two; sending it more would be
    // sending data to a screen that never asked for it.
    expect(params.flow_action_payload.data).toEqual({ teacher: 'Miss Ayesha', topic: 'A Balanced Diet' });
  });

  test('an Urdu child is asked in Urdu chat instead of being shown the English form', async () => {
    await share.beginFromCode(PHONE, 'K7RM2Q');

    expect(flowPayloads()).toHaveLength(0);
    const bodies = textBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('پہلے — آپ کا نام کیا ہے؟');
    expect(bodies[0]).not.toMatch(ENGLISH_CHROME);
  });
});

describe('no join Flow configured at all', () => {
  test('both languages are asked in chat, in their own language', async () => {
    await share.beginFromCode(PHONE, 'K7RM2Q');
    expect(flowPayloads()).toHaveLength(0);
    expect(textBodies()[0]).toContain('پہلے — آپ کا نام کیا ہے؟');

    jest.clearAllMocks();
    shareCode = { ...shareCode, teacher_name: 'Miss Ayesha', topic: 'A Balanced Diet', language: 'en' };
    await share.beginFromCode(PHONE, 'K7RM2Q');
    expect(flowPayloads()).toHaveLength(0);
    expect(textBodies()[0]).toContain('First — what is your name?');
  });
});
