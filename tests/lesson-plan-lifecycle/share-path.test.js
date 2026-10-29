'use strict';
/**
 * "Send on WhatsApp" from the portal — a teacher sending a lesson plan to her own WhatsApp — is an ask
 * of its own, and leaves its lifecycle row (source niete_portal_share, channel portal).
 *
 * The share is the portal's ShareActions button (POST /api/portal/share/whatsapp → the bot's
 * /api/internal/share/send → sendShare). It delivers the plan's PDF as a template message. Only a
 * LESSON PLAN is an ask here: a paper or a report shared the same way is not a lesson plan, and an
 * answer key is not a lesson-plan ask. sendShare's own answer never changes.
 *
 * Driven through the real sendShare and the real lifecycle writer; its injectable deps stand in for
 * the user read, the item read and Meta, and Supabase is the in-memory double.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const mockEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockEvent(...a), getCurrentCorrelationId: () => undefined }));

const { createMemorySupabase } = require('../quiz/helpers/memory-supabase');

let mockDb;
let mockCalls = 0;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => { mockCalls += 1; return mockDb.from(t); } }));

const Share = require('../../bot/shared/services/share-send.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const USER = { id: TEACHER, phone_number: '923001234567', preferred_language: 'ur' };
const SENT_AT = new Date('2026-10-13T09:00:05.000Z');
const K5_ITEM = {
  kind: 'lesson', itemRef: 'lesson:k5:grade_1_english_ch1_seg3:lesson', title: 'Topic 3', grade: 1, subject: 'English',
  answerKey: false, pdfUrl: 'https://signed.example/k5.pdf',
};
const G612_ITEM = {
  kind: 'lesson', itemRef: 'lesson:grade_8_mathematics.c05.p071-073:ur', title: 'Set-builder notation', grade: 8,
  subject: 'Mathematics', pdfUrl: 'https://signed.example/612.pdf',
};

function deps(over = {}) {
  return {
    templateName: () => 'share_lesson_plan_v1',
    user: async () => USER,
    item: async () => K5_ITEM,
    now: () => SENT_AT,
    sendTemplate: jest.fn().mockResolvedValue(true),
    ...over,
  };
}
const asks = () => mockDb.table('lesson_plan_requests');

const ENV_KEYS = ['LP_LIFECYCLE_PATHS', 'REGION'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.LP_LIFECYCLE_PATHS;
  process.env.REGION = 'niete';
  mockDb = createMemorySupabase({ lesson_plan_requests: [], users: [USER] });
  mockCalls = 0;
  mockEvent.mockClear();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

describe('a lesson plan she sends to her own WhatsApp from the portal', () => {
  beforeEach(() => { process.env.LP_LIFECYCLE_PATHS = 'niete_portal_share'; });

  test('a grade 1-5 plan Meta accepted → ONE completed row; the answer is unchanged', async () => {
    const out = await Share.sendShare({ userId: TEACHER, kind: 'lesson', id: 'k5:grade_1_english_ch1_seg3' }, deps());
    expect(out).toEqual({ status: 'sent', at: SENT_AT.toISOString() });
    expect(asks()).toHaveLength(1);
    expect(asks()[0]).toEqual(expect.objectContaining({
      user_id: TEACHER, phone_number: '923001234567', language: 'ur', status: 'completed',
      source: 'niete_portal_share', channel: 'portal', region: 'niete', artifact_ref: 'grade_1_english_ch1_seg3',
      topic: 'Topic 3', grade: 1, subject: 'English', delivered_at: SENT_AT.toISOString(), error_code: null,
    }));
  });

  test('a grade 6-12 plan names its segment', async () => {
    await Share.sendShare({ userId: TEACHER, kind: 'lesson', id: 'g612:render-1' }, deps({ item: async () => G612_ITEM }));
    expect(asks()[0]).toEqual(expect.objectContaining({
      artifact_ref: 'grade_8_mathematics.c05.p071-073', grade: 8, subject: 'Mathematics', topic: 'Set-builder notation',
    }));
  });

  test.each([
    ['Meta refused it', { sendTemplate: jest.fn().mockResolvedValue(false) }, { status: 'failed', reason: 'refused', code: null, message: null }, 'DELIVERY_FAILED'],
    ['the template is not configured', { templateName: () => null }, { status: 'unavailable', reason: 'not_configured' }, 'DELIVERY_FAILED'],
  ])('%s → ONE failed row; the answer is unchanged', async (_label, over, answer, code) => {
    const out = await Share.sendShare({ userId: TEACHER, kind: 'lesson', id: 'k5:grade_1_english_ch1_seg3' }, deps(over));
    expect(out).toEqual(answer);
    expect(asks()).toHaveLength(1);
    expect(asks()[0]).toEqual(expect.objectContaining({ status: 'failed', error_code: code, source: 'niete_portal_share', delivered_at: null }));
  });

  test.each([
    ['the plan is not hers / not there', { item: async () => null }, { status: 'not_found' }],
    ['the id is no lesson the portal can name (no k5: / g612: prefix)', { item: async () => ({ unsupported: 'lesson_source' }) },
      { status: 'unavailable', reason: 'lesson_source' }],
  ])('%s → NO row: an id that names no plan of hers is not an ask; the answer is unchanged', async (_label, over, answer) => {
    const out = await Share.sendShare({ userId: TEACHER, kind: 'lesson', id: 'k5:grade_1_english_ch1_seg3' }, deps(over));
    expect(out).toEqual(answer);
    expect(asks()).toHaveLength(0);
  });

  test('an answer key, a paper, or a malformed request is not a lesson-plan ask', async () => {
    await Share.sendShare({ userId: TEACHER, kind: 'lesson', id: 'k5:grade_1_english_ch1_seg3:answer_key' }, deps({ item: async () => ({ ...K5_ITEM, answerKey: true }) }));
    await Share.sendShare({ userId: TEACHER, kind: 'paper', id: 'paper-1' }, deps({ item: async () => ({ kind: 'paper', title: 'Ch 1', pdfUrl: 'x' }) }));
    await Share.sendShare({ userId: TEACHER, kind: 'lesson', id: '' }, deps());
    expect(asks()).toHaveLength(0);
  });
});

describe('switched off', () => {
  test('no row, no database call, the same answer', async () => {
    const out = await Share.sendShare({ userId: TEACHER, kind: 'lesson', id: 'k5:grade_1_english_ch1_seg3' }, deps());
    expect(out).toEqual({ status: 'sent', at: SENT_AT.toISOString() });
    expect(asks()).toHaveLength(0);
    expect(mockCalls).toBe(0);
  });
});

describe('a recorder that throws while describing the share — reported, never silent, the answer untouched', () => {
  // An item whose answer-key flag cannot be read: the send itself already fails on it (the file name reads
  // the flag), and the recorder reads the same flag. The share's answer is what the send made of it.
  const unreadableItem = () => new Proxy({ ...K5_ITEM }, {
    get: (target, key) => {
      if (key === 'answerKey') throw new TypeError('answerKey unreadable');
      return target[key];
    },
  });

  test('switched on: the same answer, no row, and the recorder throw is counted', async () => {
    process.env.LP_LIFECYCLE_PATHS = 'niete_portal_share';
    const out = await Share.sendShare({ userId: TEACHER, kind: 'lesson', id: 'k5:grade_1_english_ch1_seg3' }, deps({ item: async () => unreadableItem() }));
    expect(out).toEqual({ status: 'failed', reason: 'error' });
    expect(asks()).toHaveLength(0);
    expect(mockEvent).toHaveBeenCalledWith('lesson_plan.lifecycle.write_failed',
      expect.objectContaining({ code: 'THROWN', source: 'niete_portal_share' }));
  });

  test('switched off: the same answer, and nothing is said', async () => {
    const out = await Share.sendShare({ userId: TEACHER, kind: 'lesson', id: 'k5:grade_1_english_ch1_seg3' }, deps({ item: async () => unreadableItem() }));
    expect(out).toEqual({ status: 'failed', reason: 'error' });
    expect(mockEvent).not.toHaveBeenCalledWith('lesson_plan.lifecycle.write_failed', expect.anything());
    expect(mockCalls).toBe(0);
  });
});

describe('a lifecycle writer that cannot even load never reaches the share', () => {
  test('the share answers exactly as it would, and nothing throws', async () => {
    let out;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../bot/shared/services/lesson-plan-lifecycle.service', () => { throw new Error('module broken'); });
      const FreshShare = require('../../bot/shared/services/share-send.service');
      process.env.LP_LIFECYCLE_PATHS = 'niete_portal_share';
      out = await FreshShare.sendShare({ userId: TEACHER, kind: 'lesson', id: 'k5:grade_1_english_ch1_seg3' }, deps());
    });
    expect(out).toEqual({ status: 'sent', at: SENT_AT.toISOString() });
  });
});
