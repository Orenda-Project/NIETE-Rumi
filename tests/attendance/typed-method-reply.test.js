/**
 * A principal who TYPES instead of tapping. (bd-43520, checklist Class A row 4)
 *
 * The tap-or-voice question is two reply buttons, and Class A of the pre-merge
 * checklist names this exact gap: WhatsApp delivers a user's answer through four
 * webhook shapes, and free text is one of them. People type "voice" instead of
 * tapping — the deleted implementation had a whole VOICE_KEYWORDS list for it.
 *
 * Without this, a principal who types lands in general chat and gets an LLM answer
 * to a question they did not ask, and the roll call is silently lost.
 *
 * The interception is deliberately NARROW: it fires only while the question is open
 * AND the message actually reads as an answer to it. A principal who says
 * "attendance" and then changes their mind and asks for a lesson plan must get a
 * lesson plan, not a register.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const router = require('../../bot/shared/services/attendance-router.service');

describe('reading a typed answer', () => {
  it('understands the tap option in the words people use', () => {
    ['tap', 'Tap', 'tapping', 'mark by tapping', '1'].forEach((text) => {
      expect(router.readTypedMethod(text)).toBe('att_method_tap');
    });
  });

  it('understands the voice option, in both scripts', () => {
    ['voice', 'voice note', 'Mark by voice note', 'آواز', 'awaz', 'bolo', '2'].forEach((text) => {
      expect(router.readTypedMethod(text)).toBe('att_method_voice');
    });
  });

  it('refuses anything that is not an answer to the question', () => {
    ['send me a lesson plan', 'quiz for grade 5', 'hello', '', null, 'thanks'].forEach((text) => {
      expect(router.readTypedMethod(text)).toBeNull();
    });
  });

  it('does not read "no voice note today" as choosing voice', () => {
    // A negation is not a selection. Re-asking is cheap; guessing is not.
    expect(router.readTypedMethod('not by voice')).toBeNull();
  });
});

describe('the question is remembered while it is open', () => {
  const mockRows = new Map();

  beforeEach(() => {
    mockRows.clear();
    mockRows.set('p1', { conversation_state: null, conversation_state_expires_at: null });
    mockSupabase.from.mockImplementation((table) => {
      if (table !== 'users') return {};
      return {
        select: () => ({
          eq: (col, id) => ({
            maybeSingle: async () => ({
              data: { id: 'p1', role: 'principal', school_id: 'sch1', ...(mockRows.get(id) || {}) },
              error: null,
            }),
          }),
        }),
        update: (patch) => ({
          eq: (col, id) => {
            mockRows.set(id, { ...(mockRows.get(id) || {}), ...patch });
            return Promise.resolve({ error: null });
          },
        }),
      };
    });
  });

  it('is closed until the question has been asked', async () => {
    expect(await router.methodQuestionOpen('p1')).toBe(false);
  });

  it('opens when the question is asked and closes when it is answered', async () => {
    await router.openMethodQuestion('p1');
    expect(await router.methodQuestionOpen('p1')).toBe(true);

    await router.closeMethodQuestion('p1');
    expect(await router.methodQuestionOpen('p1')).toBe(false);
  });
});

describe('the handler wiring', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '../..');
  const TEXT = fs.readFileSync(path.join(ROOT, 'bot/shared/handlers/text-message.handler.js'), 'utf8');
  const BOT = fs.readFileSync(path.join(ROOT, 'bot/whatsapp-bot.js'), 'utf8');

  it('the text handler consults the open question before anything else claims the message', () => {
    const typedAt = TEXT.indexOf('readTypedMethod');
    const keywordAt = TEXT.indexOf('AttendanceRouter.detect(messageBody)');
    expect(typedAt).toBeGreaterThan(-1);
    expect(typedAt).toBeLessThan(keywordAt);
  });

  it('asking the question opens it', () => {
    const askBranch = TEXT.slice(TEXT.indexOf("case 'ASK_METHOD':"));
    expect(askBranch.slice(0, 400)).toContain('openMethodQuestion');
  });

  it('a tap closes it too, so a later typed word is not read as an answer', () => {
    expect(BOT).toContain('closeMethodQuestion');
  });
});
