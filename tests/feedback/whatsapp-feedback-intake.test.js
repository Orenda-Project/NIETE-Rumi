'use strict';
/**
 * /feedback and /bug on WhatsApp: a teacher or a coach tells the team about a problem or an idea without leaving the
 * chat. /feedback asks what it is about (three buttons), /bug goes straight to "what isn't working?", and the next
 * message, typed or a voice note, is kept as ONE whatsapp_feedback row with a reference number she is given back.
 *
 * Driven through the service's real code with only its boundaries faked: Supabase (a stateful in-memory table with
 * the table's real UNIQUE columns), Redis (in memory, expiring), the WhatsApp sender, R2 and the transcriber.
 */
const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const SERVICE = '../../bot/shared/services/feedback/whatsapp-feedback-intake.service';
const UID = '11111111-2222-4333-8444-555555555555';
const PHONE = '923001112233';
const TEACHER = { id: UID, name: 'Ayesha Khan', role: 'teacher', preferred_language: 'en', registration_completed: true };
const REF_RX = /^NF-[A-HJKMNP-Z2-9]{5}$/;

let Svc;
let db;
let redis;
let sent;

function deps(over = {}) {
  return {
    supabase: db,
    redis,
    sender: {
      sendMessage: jest.fn(async (to, text) => { sent.push({ to, text }); return true; }),
      sendInteractiveButtons: jest.fn(async (to, opts) => { sent.push({ to, buttons: opts }); return true; }),
      downloadMedia: jest.fn(async () => Buffer.from('OggS-voice')),
    },
    uploadBuffer: jest.fn(async (buf, key) => `https://r2.example/${key}`),
    transcribe: jest.fn(async () => ({ text: 'The lesson plan PDF does not open', language: 'en' })),
    getUserLanguage: jest.fn(async () => 'en'),
    env: {},
    now: () => new Date('2026-11-04T10:00:00Z'),
    log: jest.fn(),
    ...over,
  };
}

const rows = () => db.rows('whatsapp_feedback');
const lastText = () => [...sent].reverse().find((s) => s.text)?.text || '';

beforeEach(() => {
  jest.resetModules();
  Svc = require(SERVICE);
  db = createMemorySupabase({ whatsapp_feedback: [] }, { unique: { whatsapp_feedback: ['wa_message_id'] } });
  redis = createMemoryRedis();
  sent = [];
});

describe('the triggers', () => {
  test.each([
    ['/feedback', 'feedback', ''],
    ['/Feedback', 'feedback', ''],
    ['  /feedback  ', 'feedback', ''],
    ['/bug', 'bug', ''],
    ['/BUG.', 'bug', ''],
    ['⁦/feedback⁩', 'feedback', ''],
    ['/bug the PDF does not open', 'bug', 'the PDF does not open'],
    ['/feedback please add Urdu audio', 'feedback', 'please add Urdu audio'],
  ])('%j is %s', (text, command, inline) => {
    expect(Svc.parseTrigger(text)).toEqual({ command, inline });
  });

  test.each([['feedback'], ['bug'], ['give me feedback on my lesson'], ['/feedbacks'], ['/bugs'], ['/menu'], [''], [null]])(
    '%j is not a trigger (a bare word routes to coaching as today)', (text) => {
      expect(Svc.parseTrigger(text)).toBeNull();
    },
  );

  test('the slash canonicaliser knows both commands, so "feedback/" and a slip reach the door', () => {
    const { canonicalizeSlashCommand } = require('../../bot/shared/utils/slash-command');
    expect(canonicalizeSlashCommand('feedback/').text).toBe('/feedback');
    expect(canonicalizeSlashCommand('/ bug').text).toBe('/bug');
    expect(canonicalizeSlashCommand('/fedback').text).toBe('/feedback');
  });
});

describe('/feedback: three buttons, then one message', () => {
  test('/feedback sends the three topics as reply buttons and waits for the tap', async () => {
    const d = deps();
    expect(await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/feedback', messageId: 'wamid.T1' }, d)).toBe(true);
    const buttons = sent.find((s) => s.buttons).buttons.buttons;
    expect(buttons.map((b) => b.id)).toEqual(['nfb_topic_broken', 'nfb_topic_idea', 'nfb_topic_other']);
    for (const b of buttons) expect([...b.title].length).toBeLessThanOrEqual(20);
    expect(await redis.get(Svc.awaitingKey(UID))).toMatchObject({ stage: 'topic', command: 'feedback' });
    expect(rows()).toEqual([]);
  });

  test('a tap asks for the message; the typed answer is saved as one row with a reference', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/feedback', messageId: 'wamid.T1' }, d);
    expect(await Svc.tryHandleButton({ user: TEACHER, from: PHONE, buttonId: 'nfb_topic_idea' }, d)).toBe(true);
    expect(lastText()).toMatch(/voice note/i);

    expect(await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: '  Please add Urdu PDFs  ', messageId: 'wamid.M1' }, d)).toBe(true);

    expect(rows()).toHaveLength(1);
    const row = rows()[0];
    expect(row).toMatchObject({
      user_id: UID, role: 'teacher', command: 'feedback', topic: 'idea', message: 'Please add Urdu PDFs',
      audio_key: null, transcript: null, language: 'en', wa_message_id: 'wamid.M1',
    });
    expect(row.ref).toMatch(REF_RX);
    expect(lastText()).toContain(row.ref);
    expect(await redis.get(Svc.awaitingKey(UID))).toBeNull();
  });

  test('typing instead of tapping still files the report, as "other"', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/feedback', messageId: 'wamid.T1' }, d);
    await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'The portal is slow', messageId: 'wamid.M2' }, d);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ command: 'feedback', topic: 'other', message: 'The portal is slow' });
  });

  test('the row carries exactly the table\'s columns and nothing else', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'Quiz never arrives', messageId: 'wamid.M3' }, d);
    const { id, ...row } = rows()[0];
    expect(Object.keys(row).sort()).toEqual(
      ['audio_key', 'command', 'language', 'message', 'ref', 'role', 'topic', 'transcript', 'user_id', 'wa_message_id'],
    );
  });
});

describe('/bug: straight to the message', () => {
  test('/bug skips the buttons and files the next message as broken', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    expect(sent.some((s) => s.buttons)).toBe(false);
    await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'The quiz link is broken', messageId: 'wamid.M4' }, d);
    expect(rows()[0]).toMatchObject({ command: 'bug', topic: 'broken', message: 'The quiz link is broken' });
  });

  test('words after the command are the report: filed at once, no waiting', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug the PDF does not open', messageId: 'wamid.T2' }, d);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ command: 'bug', topic: 'broken', message: 'the PDF does not open', wa_message_id: 'wamid.T2' });
    expect(await redis.get(Svc.awaitingKey(UID))).toBeNull();
  });
});

describe('leaving, duplicates, retry', () => {
  test('a slash command while waiting cancels: nothing is saved and the command goes on to its own door', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    expect(await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: '/menu', messageId: 'wamid.M5' }, d)).toBe(false);
    expect(rows()).toEqual([]);
    expect(await redis.get(Svc.awaitingKey(UID))).toBeNull();
    // and the message after it is not taken
    expect(await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'hello', messageId: 'wamid.M6' }, d)).toBe(false);
  });

  test('a text with nobody waiting is not ours', async () => {
    expect(await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'hello', messageId: 'wamid.M7' }, deps())).toBe(false);
  });

  test('the same WhatsApp message delivered twice makes ONE row and one thank-you', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'Nothing loads', messageId: 'wamid.DUP' }, d);
    // the webhook redelivers before the awaiting key is gone from this process's view: put it back
    await redis.set(Svc.awaitingKey(UID), { stage: 'message', command: 'bug', topic: 'broken' }, 1800);
    const before = sent.length;
    expect(await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'Nothing loads', messageId: 'wamid.DUP' }, d)).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(sent.length).toBe(before);
  });

  test('a duplicate that gets past the cache is stopped by the table\'s unique message id', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'Nothing loads', messageId: 'wamid.DUP2' }, d);
    const ref = rows()[0].ref;
    redis.reset(); // Redis lost everything (a restart)
    await redis.set(Svc.awaitingKey(UID), { stage: 'message', command: 'bug', topic: 'broken' }, 1800);
    await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'Nothing loads', messageId: 'wamid.DUP2' }, d);
    expect(rows()).toHaveLength(1);
    expect(lastText()).toContain(ref);
  });

  test('a failed save keeps her words; "retry" saves them, once', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    const realFrom = db.from;
    db.from = jest.fn((t) => {
      const q = realFrom(t);
      if (t === 'whatsapp_feedback') q.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '08006', message: 'connection failure' } }) }) });
      return q;
    });
    expect(await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'Attendance will not save', messageId: 'wamid.M8' }, d)).toBe(true);
    expect(rows()).toEqual([]);
    expect(lastText()).toMatch(/retry/i);

    db.from = realFrom;
    expect(await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'retry', messageId: 'wamid.M9' }, d)).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ message: 'Attendance will not save', wa_message_id: 'wamid.M8' });
    expect(lastText()).toContain(rows()[0].ref);
  });

  test('an empty message keeps her waiting and asks again', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    expect(await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: '   ', messageId: 'wamid.M10' }, d)).toBe(true);
    expect(rows()).toEqual([]);
    expect(await redis.get(Svc.awaitingKey(UID))).not.toBeNull();
  });

  test('a long message is kept to 2000 characters', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'x'.repeat(2500), messageId: 'wamid.M11' }, d);
    expect(rows()[0].message).toHaveLength(2000);
  });
});

describe('a voice note', () => {
  test('is transcribed, kept in R2 and saved with its key and transcript', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    expect(await Svc.tryHandleVoice({ user: TEACHER, from: PHONE, messageId: 'wamid.V1', audioId: 'media-1', durationSeconds: 20 }, d)).toBe(true);

    expect(d.sender.downloadMedia).toHaveBeenCalledWith('media-1');
    expect(d.uploadBuffer).toHaveBeenCalledTimes(1);
    const [, key, type] = d.uploadBuffer.mock.calls[0];
    expect(key).toBe(`feedback_audio/${UID}/2026-11/wa_wamid.V1.ogg`);
    expect(type).toBe('audio/ogg');
    expect(rows()[0]).toMatchObject({
      command: 'bug', topic: 'broken', message: null, audio_key: key,
      transcript: 'The lesson plan PDF does not open', wa_message_id: 'wamid.V1',
    });
    expect(lastText()).toContain(rows()[0].ref);
  });

  test('an empty transcript keeps her waiting and asks her to send it again; nothing is saved', async () => {
    const d = deps({ transcribe: jest.fn(async () => ({ text: '  ', language: 'en' })) });
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    expect(await Svc.tryHandleVoice({ user: TEACHER, from: PHONE, messageId: 'wamid.V2', audioId: 'media-2', durationSeconds: 3 }, d)).toBe(true);
    expect(rows()).toEqual([]);
    expect(d.uploadBuffer).not.toHaveBeenCalled();
    expect(lastText()).toMatch(/hear/i);
    expect(await redis.get(Svc.awaitingKey(UID))).not.toBeNull();
  });

  test('a transcriber outage still saves the voice note (the audio is the report)', async () => {
    const d = deps({ transcribe: jest.fn(async () => { throw new Error('asr down'); }) });
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    await Svc.tryHandleVoice({ user: TEACHER, from: PHONE, messageId: 'wamid.V3', audioId: 'media-3', durationSeconds: 20 }, d);
    expect(rows()[0]).toMatchObject({ transcript: null, audio_key: expect.stringMatching(/^feedback_audio\//) });
  });

  test('with nobody waiting a voice note is not ours (nothing downloaded)', async () => {
    const d = deps();
    expect(await Svc.tryHandleVoice({ user: TEACHER, from: PHONE, messageId: 'wamid.V4', audioId: 'media-4', durationSeconds: 20 }, d)).toBe(false);
    expect(d.sender.downloadMedia).not.toHaveBeenCalled();
  });

  test('a recording longer than five minutes is not feedback: it goes on to its own route and the wait ends', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    expect(await Svc.tryHandleVoice({ user: TEACHER, from: PHONE, messageId: 'wamid.V5', audioId: 'media-5', durationSeconds: 1800 }, d)).toBe(false);
    expect(d.sender.downloadMedia).not.toHaveBeenCalled();
    expect(await redis.get(Svc.awaitingKey(UID))).toBeNull();
  });

  test('the same voice note delivered twice is downloaded and saved once', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    await Promise.all([
      Svc.tryHandleVoice({ user: TEACHER, from: PHONE, messageId: 'wamid.V6', audioId: 'media-6', durationSeconds: 20 }, d),
      Svc.tryHandleVoice({ user: TEACHER, from: PHONE, messageId: 'wamid.V6', audioId: 'media-6', durationSeconds: 20 }, d),
    ]);
    expect(rows()).toHaveLength(1);
    expect(d.sender.downloadMedia).toHaveBeenCalledTimes(1);
  });
});

describe('who may send, and how much', () => {
  test('someone who is not registered is told to register first; nothing waits', async () => {
    const d = deps();
    const guest = { id: UID, role: null, preferred_language: 'en', registration_completed: false, name: null };
    expect(await Svc.tryHandleTrigger({ user: guest, from: PHONE, messageBody: '/feedback', messageId: 'wamid.T1' }, d)).toBe(true);
    expect(lastText()).toMatch(/register/i);
    expect(await redis.get(Svc.awaitingKey(UID))).toBeNull();
  });

  test('when the account lookup FAILED she is not told to register (the fault is ours)', async () => {
    const d = deps();
    expect(await Svc.tryHandleTrigger({ user: null, from: PHONE, messageBody: '/feedback', messageId: 'wamid.T1', lookupFailed: true }, d)).toBe(true);
    expect(lastText()).not.toMatch(/register first/i);
    expect(lastText().length).toBeGreaterThan(0);
  });

  test('twenty reports in a day is the cap: the twenty-first is turned away kindly', async () => {
    const recent = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`, user_id: UID, created_at: '2026-11-04T05:00:00Z', ref: `NF-AAAA${i}`, wa_message_id: `w${i}`,
    }));
    db = createMemorySupabase({ whatsapp_feedback: recent }, { unique: { whatsapp_feedback: ['wa_message_id'] } });
    const d = deps();
    expect(await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d)).toBe(true);
    expect(lastText()).toMatch(/tomorrow/i);
    expect(await redis.get(Svc.awaitingKey(UID))).toBeNull();
  });

  test('yesterday\'s reports do not count toward today', async () => {
    const old = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`, user_id: UID, created_at: '2026-11-02T05:00:00Z', ref: `NF-AAAA${i}`, wa_message_id: `w${i}`,
    }));
    db = createMemorySupabase({ whatsapp_feedback: old }, { unique: { whatsapp_feedback: ['wa_message_id'] } });
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    expect(await redis.get(Svc.awaitingKey(UID))).toMatchObject({ stage: 'message' });
  });

  test('a coach can send it too, and her role is kept on the row', async () => {
    const coach = { ...TEACHER, role: 'coach' };
    const d = deps();
    await Svc.tryHandleTrigger({ user: coach, from: PHONE, messageBody: '/bug the visit form froze', messageId: 'wamid.T9' }, d);
    expect(rows()[0]).toMatchObject({ role: 'coach' });
  });
});

describe('the kill switch', () => {
  test.each([
    [{}, true],
    [{ RAILWAY_ENVIRONMENT_NAME: 'sandbox' }, true],
    [{ RAILWAY_ENVIRONMENT_NAME: 'staging' }, false],
    [{ RAILWAY_ENVIRONMENT_NAME: 'production' }, false],
    [{ RAILWAY_ENVIRONMENT_NAME: 'production', WHATSAPP_FEEDBACK: 'on' }, true],
    [{ RAILWAY_ENVIRONMENT_NAME: 'sandbox', WHATSAPP_FEEDBACK: 'off' }, false],
  ])('%j → %s', (env, on) => {
    expect(Svc.isEnabled(env)).toBe(on);
  });

  test('switched off, /feedback is not taken (it reaches the chat as today) and a waiting teacher is let go', async () => {
    const d = deps({ env: { WHATSAPP_FEEDBACK: 'off' } });
    expect(await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/feedback', messageId: 'wamid.T1' }, d)).toBe(false);
    await redis.set(Svc.awaitingKey(UID), { stage: 'message', command: 'bug', topic: 'broken' }, 1800);
    expect(await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'hello', messageId: 'wamid.M1' }, d)).toBe(false);
    expect(rows()).toEqual([]);
  });
});

describe('privacy and copy', () => {
  test('no log line carries her words, her phone or a raw users.id', async () => {
    const d = deps();
    await Svc.tryHandleTrigger({ user: TEACHER, from: PHONE, messageBody: '/bug', messageId: 'wamid.T1' }, d);
    await Svc.tryHandleText({ user: TEACHER, from: PHONE, messageBody: 'Secret words about Ms Bushra', messageId: 'wamid.M1' }, d);
    const logged = JSON.stringify(d.log.mock.calls);
    expect(d.log).toHaveBeenCalled();
    expect(logged).not.toContain('Secret words');
    expect(logged).not.toContain(PHONE);
    expect(logged).not.toContain(UID);
  });

  test('every string exists in English and Urdu, within WhatsApp\'s caps', () => {
    const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
    const keys = Object.keys(UX_STRINGS).filter((k) => k.startsWith('waFeedback'));
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of keys) {
      for (const lang of ['en', 'ur']) {
        const s = UX_STRINGS[k][lang];
        expect(typeof s).toBe('string');
        expect([...s].length).toBeLessThanOrEqual(k.startsWith('waFeedbackTopic') ? 20 : 1024);
      }
    }
  });

  test('in Urdu the reference and the commands are isolated so they read left to right', async () => {
    const d = deps();
    const ur = { ...TEACHER, preferred_language: 'ur' };
    d.getUserLanguage = jest.fn(async () => 'ur');
    await Svc.tryHandleTrigger({ user: ur, from: PHONE, messageBody: '/bug the quiz froze', messageId: 'wamid.T1' }, d);
    const ref = rows()[0].ref;
    expect(rows()[0].language).toBe('ur');
    expect(lastText()).toContain(`⁦${ref}⁩`);
  });
});
