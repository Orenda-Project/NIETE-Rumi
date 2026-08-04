/**
 * bd-2508 follow-up — confirm before ending a coaching conversation.
 *
 * Before this fix, ANY "/" message during `conducting_conversation` set the
 * session to `abandoned` with no warning. Escaping the 269-hour trap and
 * destroying the reflection were the same action.
 *
 * These tests pin the three outcomes:
 *   1. /menu + /help  — never gated, session left running (the escape hatch)
 *   2. service command — confirm first, then PAUSE (never abandon)
 *   3. RESUME — pick the questions back up
 *
 * The progress line must NOT hardcode a question total:
 * NUM_REFLECTIVE_QUESTIONS is 1 today (was 3), so a literal would go stale.
 */

const fs = require('fs');

jest.mock('../../bot/shared/config/supabase');
// Mirrors the REAL RailwayRedisService interface: setex(key, seconds, value),
// get(key) which already JSON-parses, and delete(key) — there is no `del`.
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(),
  setex: jest.fn().mockResolvedValue('OK'),
  delete: jest.fn().mockResolvedValue(1),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn().mockResolvedValue('en'),
}));

const CoachingPauseService = require('../../bot/shared/services/coaching/coaching-pause.service');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const redis = require('../../bot/shared/services/cache/railway-redis.service');
const supabase = require('../../bot/shared/config/supabase');

const SERVICE_SRC = require.resolve(
  '../../bot/shared/services/coaching/coaching-pause.service'
);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('bd-2508 follow-up: confirm before ending a coaching conversation', () => {
  describe('service labels — the prompt names what SHE asked for', () => {
    it('maps each service command to a teacher-facing label', () => {
      expect(CoachingPauseService.labelFor('/lessonplan')).toBe('a lesson plan');
      expect(CoachingPauseService.labelFor('/video')).toBe('a video');
      expect(CoachingPauseService.labelFor('/quiz')).toBe('a quiz');
      expect(CoachingPauseService.labelFor('/readingtest')).toBe('a reading assessment');
      expect(CoachingPauseService.labelFor('/assessment')).toBe('an assessment');
    });

    it('is case-insensitive and falls back to a neutral word', () => {
      expect(CoachingPauseService.labelFor('/LessonPlan')).toBe('a lesson plan');
      expect(CoachingPauseService.labelFor('/somethingnew')).toBe('that');
    });

    it('never hardcodes "lesson plan" for a different service', () => {
      expect(CoachingPauseService.labelFor('/video')).not.toMatch(/lesson/i);
    });
  });

  describe('the escape hatch stays open (the 269-hour regression guard)', () => {
    it('/menu and /help are never gated', () => {
      expect(CoachingPauseService.isAlwaysAllowed('/menu')).toBe(true);
      expect(CoachingPauseService.isAlwaysAllowed('/help')).toBe(true);
      expect(CoachingPauseService.isAlwaysAllowed('/MENU')).toBe(true);
    });

    it('service commands ARE gated', () => {
      for (const cmd of ['/lessonplan', '/video', '/quiz', '/readingtest', '/assessment']) {
        expect(CoachingPauseService.isAlwaysAllowed(cmd)).toBe(false);
      }
    });
  });

  describe('the confirmation prompt', () => {
    it('names the service, both replies, and reassures about answers', async () => {
      await CoachingPauseService.askToConfirmSwitch(
        '92300000000',
        'user-1',
        { id: 's-1', conversation_state: { questions_answered: 0 } },
        '/video',
        '/video volcanoes'
      );

      const text = WhatsAppService.sendMessage.mock.calls[0][1];
      expect(text).toMatch(/coaching reflection/i);
      expect(text).toContain('a video');
      expect(text).toMatch(/\*YES\*/);
      expect(text).toMatch(/\*NO\*/);
      expect(text).not.toMatch(/lesson plan/i); // must not leak the example
      expect(text).toMatch(/remind you this evening/i);
    });

    it('mentions kept answers only when there ARE answers', async () => {
      await CoachingPauseService.askToConfirmSwitch(
        '92300000000',
        'user-1',
        { id: 's-1', conversation_state: { questions_answered: 1 } },
        '/quiz',
        '/quiz'
      );
      expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/kept/i);
    });

    it('stashes the FULL original message so args survive a YES', async () => {
      await CoachingPauseService.askToConfirmSwitch(
        '92300000000',
        'user-1',
        { id: 's-1', conversation_state: { questions_answered: 1 } },
        '/lessonplan',
        '/lessonplan grade 4 maths'
      );
      const payload = JSON.parse(redis.setex.mock.calls[0][2]);
      expect(payload.fullMessage).toBe('/lessonplan grade 4 maths');
      expect(payload.sessionId).toBe('s-1');
    });

    it('counts answers from the questions array when the counter is absent', async () => {
      await CoachingPauseService.askToConfirmSwitch(
        '92300000000',
        'user-1',
        {
          id: 's-1',
          conversation_state: {
            questions: [{ answer: 'yes I did' }, { answer: null }],
          },
        },
        '/video',
        '/video'
      );
      expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/1 answer\b/);
    });
  });

  describe('pausing, not abandoning', () => {
    it('sets status to paused and records why', async () => {
      const eq = jest.fn().mockResolvedValue({});
      const update = jest.fn().mockReturnValue({ eq });
      supabase.from.mockReturnValue({ update });

      await CoachingPauseService.pauseSession('s-1', 'switched_to:/video');

      const payload = update.mock.calls[0][0];
      expect(payload.status).toBe('paused');
      expect(payload.status).not.toBe('abandoned'); // the whole point
      expect(payload.pause_reason).toBe('switched_to:/video');
      expect(payload.paused_at).toBeTruthy();
      expect(eq).toHaveBeenCalledWith('id', 's-1');
    });
  });

  describe('the menu-digit exemption is narrow', () => {
    it('matches only a bare 1-4', () => {
      ['1', '2', '3', '4'].forEach((d) =>
        expect(CoachingPauseService.isMenuDigit(d)).toBe(true)
      );
    });

    it('does not match a real answer that merely starts with a digit', () => {
      ['5', '12', '1.', '1 yes', 'I did 2 things', '2⃣', '', ' 1'].forEach((s) =>
        expect(CoachingPauseService.isMenuDigit(s)).toBe(false)
      );
    });
  });

  describe('yes / no parsing', () => {
    it('accepts English and Urdu-transliterated yes', () => {
      ['yes', 'YES', 'y', 'haan', 'han', 'ji'].forEach((s) =>
        expect(CoachingPauseService.isYes(s)).toBe(true)
      );
    });

    it('accepts English and Urdu-transliterated no', () => {
      ['no', 'NO', 'n', 'nahi', 'nahin'].forEach((s) =>
        expect(CoachingPauseService.isNo(s)).toBe(true)
      );
    });

    it('treats anything else as neither', () => {
      ['maybe', 'I think so', '', 'yesterday'].forEach((s) => {
        expect(CoachingPauseService.isYes(s)).toBe(false);
        expect(CoachingPauseService.isNo(s)).toBe(false);
      });
    });

    it('does not treat a bare digit as yes/no — it is a menu choice or an answer', () => {
      expect(CoachingPauseService.isYes('1')).toBe(false);
      expect(CoachingPauseService.isNo('2')).toBe(false);
    });
  });

  describe('menu path — the gate the interceptor cannot apply', () => {
    // A menu pick arrives as a button/digit the coaching interceptor deliberately
    // DEFERS, so MenuService is the only place left to ask.
    const withActiveSession = () => {
      const maybeSingle = jest.fn().mockResolvedValue({
        data: { id: 's-9', conversation_state: { questions_answered: 0 } },
      });
      supabase.from.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }),
          }),
        }),
      });
    };
    const withNoSession = () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null });
      supabase.from.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }),
          }),
        }),
      });
    };

    it('gates every service-starting pick, on both surfaces', async () => {
      for (const sel of ['menu_lesson_plan', 'menu_video', 'menu_reading', 2, 3]) {
        withActiveSession();
        jest.clearAllMocks();
        withActiveSession();
        expect(await CoachingPauseService.guardMenuSelection(sel, 'u-1', '92300000000')).toBe(true);
      }
    });

    it('gates "new coaching session" too — the old reflection must not be orphaned', async () => {
      withActiveSession();
      expect(await CoachingPauseService.guardMenuSelection('menu_coaching', 'u-1', '92300000000')).toBe(true);
      expect(WhatsAppService.sendMessage.mock.calls[0][1]).toContain('a new coaching session');
    });

    it('does NOT gate general chat — it starts no service', async () => {
      withActiveSession();
      expect(await CoachingPauseService.guardMenuSelection('menu_other', 'u-1', '92300000000')).toBe(false);
      expect(await CoachingPauseService.guardMenuSelection(4, 'u-1', '92300000000')).toBe(false);
      expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    });

    it('does not gate when no reflection is in flight', async () => {
      withNoSession();
      expect(await CoachingPauseService.guardMenuSelection('menu_video', 'u-1', '92300000000')).toBe(false);
      expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    });

    it('stashes the selector so YES can dispatch it — a pick has no replayable text', async () => {
      withActiveSession();
      await CoachingPauseService.guardMenuSelection('menu_video', 'u-1', '92300000000');
      const payload = JSON.parse(redis.setex.mock.calls[0][2]);
      expect(payload.menuSelector).toBe('menu_video');
      expect(payload.fullMessage).toBeNull();
    });

    it('the button path asks BEFORE clearing the menu state', () => {
      // Clearing first would make the YES replay hit "selection has expired".
      const src = fs.readFileSync(
        require.resolve('../../bot/shared/services/menu.service'), 'utf8'
      );
      const guard = src.indexOf('guardMenuSelection');
      const clear = src.indexOf('redisService.delete(stateKey)');
      expect(guard).toBeGreaterThan(-1);
      expect(clear).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(clear);
    });
  });

  describe('redis interface — real method names, no double-parse', () => {
    it('clears via delete(), not del() — RailwayRedisService has no del', async () => {
      await CoachingPauseService.clearPendingConfirmation('user-1');
      expect(redis.delete).toHaveBeenCalledWith('coaching:confirm_switch:user-1');
    });

    it('does not re-parse the payload — get() already JSON-parses', async () => {
      redis.get.mockResolvedValue({ sessionId: 's-1', command: '/video' });
      const pending = await CoachingPauseService.getPendingConfirmation('user-1');
      expect(pending.sessionId).toBe('s-1');
    });

    it('drops a corrupt (raw-string) payload instead of trapping the teacher', async () => {
      redis.get.mockResolvedValue('not-json');
      const pending = await CoachingPauseService.getPendingConfirmation('user-1');
      expect(pending).toBeNull();
      expect(redis.delete).toHaveBeenCalled();
    });

    it('returns null when nothing is pending', async () => {
      redis.get.mockResolvedValue(null);
      expect(await CoachingPauseService.getPendingConfirmation('user-1')).toBeNull();
    });
  });

  describe('progress line adapts to the real question count', () => {
    it('imports the constant and never hardcodes a total', () => {
      const src = fs.readFileSync(SERVICE_SRC, 'utf8');
      expect(src).toMatch(/require\(.*coaching-debrief\.config.*\)/);
      expect(src).not.toMatch(/of 4 questions/);
    });

    it('sources every teacher-facing string from the coaching catalog', () => {
      const src = fs.readFileSync(SERVICE_SRC, 'utf8');
      expect(src).toMatch(/require\(.*coaching-messages.*\)/);
      // The prompt text itself must NOT be inline — it belongs in the catalog so
      // a fork can translate it (tests/setup/no-hardcoded-coaching-strings).
      expect(src).not.toMatch(/Hold on —/);
    });

    it('the catalog carries Urdu for every new pause string', () => {
      const { COACHING_MESSAGES } = require('../../bot/shared/config/coaching-messages');
      for (const key of [
        'switchConfirmSingle', 'switchConfirmMulti', 'switchKeptWithAnswers',
        'switchKeptNoAnswers', 'switchDeclined', 'pausedEveningReminder',
      ]) {
        expect(COACHING_MESSAGES[key]).toBeDefined();
        expect(typeof COACHING_MESSAGES[key].ur).toBe('string');
        expect(COACHING_MESSAGES[key].ur.length).toBeGreaterThan(0);
      }
    });

    it('leaves no unsubstituted placeholder in the rendered prompt', async () => {
      await CoachingPauseService.askToConfirmSwitch(
        '92300000000', 'user-1',
        { id: 's-1', conversation_state: { questions_answered: 1 } },
        '/quiz', '/quiz'
      );
      expect(WhatsAppService.sendMessage.mock.calls[0][1]).not.toMatch(/\{\{|\}\}/);
    });
  });

  describe('evening window', () => {
    it('fires at 20 and 21 only', () => {
      expect(CoachingPauseService.isEveningWindow(19)).toBe(false);
      expect(CoachingPauseService.isEveningWindow(20)).toBe(true);
      expect(CoachingPauseService.isEveningWindow(21)).toBe(true);
      expect(CoachingPauseService.isEveningWindow(22)).toBe(false);
      expect(CoachingPauseService.isEveningWindow(9)).toBe(false);
    });
  });
});
