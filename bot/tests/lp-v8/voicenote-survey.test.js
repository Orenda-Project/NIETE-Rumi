/**
 * FEAT-059 / bd-vw0aj — the voicenote survey (TDD, red first).
 *
 * Operator direction (2026-08-18/20): Rawalpindi asked "which did you prefer — lesson plan,
 * voice note, or both?". We are NOT asking that. Ranking our own artefacts tells us nothing about
 * whether the lesson happened, and it invites the teacher to grade us instead of telling us
 * something useful. ICT asks what she DID with it.
 *
 *   Q1  Did you find the voice note and the lesson plan useful?      👍 / 👎
 *   Q2  (on 👍, only when a voice note actually landed)
 *       Did you get to use it in class?   Taught it today / Planning to / Not yet
 *   👎  unchanged — the existing free-text reason capture.
 *
 * Everything renders in HER language (`users.preferred_language`; NIETE is flat en/ur).
 */

const mockTables = { lesson_plans: [], lp_feedback: [], users: [] };
const mockInserts = { lp_feedback: [] };
const mockUpdates = [];

function mockBuilderFor(table) {
  let rows = [...(mockTables[table] || [])];
  const b = {
    select: () => b,
    eq: (col, val) => {
      if (b.__pendingUpdate) { mockUpdates.push({ table, col, val, patch: b.__pendingUpdate }); }
      rows = rows.filter((r) => String(r[col]) === String(val));
      return b;
    },
    maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
    single: () => Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no rows' } }),
    insert: (payload) => {
      const row = { id: 'fb-1', ...payload };
      mockInserts.lp_feedback.push(row);
      mockTables.lp_feedback = [...(mockTables.lp_feedback || []), row];
      const ret = {
        select: () => ret,
        single: () => Promise.resolve({ data: row, error: null }),
        then: (f, r) => Promise.resolve({ data: [row], error: null }).then(f, r),
      };
      return ret;
    },
    update: (patch) => { b.__pendingUpdate = patch; return b; },
    then: (f, r) => Promise.resolve({ data: rows, error: null }).then(f, r),
  };
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));

const sent = { buttons: [], messages: [] };
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendInteractiveButtons: jest.fn(async (phone, payload) => { sent.buttons.push({ phone, ...payload }); return true; }),
  sendMessage: jest.fn(async (phone, body) => { sent.messages.push({ phone, body }); return true; }),
}));

jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  set: jest.fn(async () => true), get: jest.fn(async () => null), del: jest.fn(async () => true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Feedback = require('../../shared/services/lp-feedback.service');

const LP_ID = '11111111-2222-3333-4444-555555555555';

function seedLesson({ triggerMode, language }) {
  mockTables.users = [{ id: 'user-1', phone_number: '923001234567', preferred_language: language }];
  mockTables.lesson_plans = [{
    id: LP_ID, user_id: 'user-1', topic: 'Introducing Myself', grade: '1', subject: 'english',
    type: 'lesson_plan',
    content: { chapter_number: 1, segment_number: 3, lp_variant: 'niete_v8_segment',
               grade: 1, subject: 'english', trigger_mode: triggerMode },
  }];
}

beforeEach(() => {
  for (const k of Object.keys(mockTables)) mockTables[k] = [];
  mockInserts.lp_feedback = [];
  mockUpdates.length = 0;
  sent.buttons = []; sent.messages = [];
});

describe('Q2 — what she did with it', () => {
  test('👍 after a voice note asks whether she taught it, with three options', async () => {
    seedLesson({ triggerMode: 'after_voice_note', language: 'en' });

    await Feedback.handleFeedbackButton(`lp_feedback_yes_${LP_ID}`, '923001234567');

    expect(sent.buttons).toHaveLength(1);
    const ids = sent.buttons[0].buttons.map((x) => x.id);
    expect(ids).toEqual([
      `lp_used_taught_${LP_ID}`,
      `lp_used_planned_${LP_ID}`,
      `lp_used_not_yet_${LP_ID}`,
    ]);
    // Never rank our own artefacts against each other.
    expect(JSON.stringify(sent.buttons[0])).not.toMatch(/both|prefer/i);
  });

  test('👍 with NO voice note keeps the plain thank-you — no usage question', async () => {
    seedLesson({ triggerMode: 'after_pdf_only', language: 'en' });

    await Feedback.handleFeedbackButton(`lp_feedback_yes_${LP_ID}`, '923001234567');

    expect(sent.buttons).toHaveLength(0);
    expect(sent.messages).toHaveLength(1);
  });

  test('the usage question renders in her language', async () => {
    seedLesson({ triggerMode: 'after_voice_note', language: 'ur' });

    await Feedback.handleFeedbackButton(`lp_feedback_yes_${LP_ID}`, '923001234567');

    const body = sent.buttons[0].body;
    expect(body).toMatch(/[؀-ۿ]/);                 // Urdu, not the English fallback
    for (const btn of sent.buttons[0].buttons) {
      expect([...btn.title].length).toBeLessThanOrEqual(20); // WhatsApp cap, in CODE POINTS
    }
  });

  test('tapping an option records what she did', async () => {
    seedLesson({ triggerMode: 'after_voice_note', language: 'en' });
    mockTables.lp_feedback = [{ id: 'fb-1', lesson_plan_id: LP_ID }];

    const handled = await Feedback.handleUsageButton(`lp_used_taught_${LP_ID}`, '923001234567');

    expect(handled).toBe(true);
    expect(mockUpdates.some((u) => u.table === 'lp_feedback' && u.patch.used_in_class === 'taught')).toBe(true);
  });

  test('each option maps to its own stored value', async () => {
    for (const [suffix, value] of [['taught', 'taught'], ['planned', 'planned'], ['not_yet', 'not_yet']]) {
      mockUpdates.length = 0;
      seedLesson({ triggerMode: 'after_voice_note', language: 'en' });
      mockTables.lp_feedback = [{ id: 'fb-1', lesson_plan_id: LP_ID }];

      await Feedback.handleUsageButton(`lp_used_${suffix}_${LP_ID}`, '923001234567');

      expect(mockUpdates.some((u) => u.patch.used_in_class === value)).toBe(true);
    }
  });

  test('an unrelated button id is not claimed by the usage handler', async () => {
    expect(await Feedback.handleUsageButton('menu_lesson_plan', '923001234567')).toBe(false);
  });
});

describe('Q1 — the usefulness question', () => {
  test('names BOTH artefacts when a voice note was delivered', async () => {
    const body = Feedback.__promptBodyForTests('en', 'after_voice_note');
    expect(body).toMatch(/voice note/i);
    expect(body).toMatch(/lesson plan/i);
  });

  test('names only the lesson plan when no voice note was delivered', async () => {
    const body = Feedback.__promptBodyForTests('en', 'after_pdf_only');
    expect(body).not.toMatch(/voice note/i);
  });
});
