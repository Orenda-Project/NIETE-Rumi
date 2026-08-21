/**
 * FEAT-059 / bd-njn7u Phase 2.0 — the conversation-history cache must never
 * carry system prompts (TDD, red first).
 *
 * getResponseWithFormat stores the turn back into its in-memory cache as
 * [{role:'system', ...}, ...history, user, assistant]. On the next cache-hit
 * turn that array comes back verbatim as "existing history", so the request
 * becomes [system NEW, system OLD, u1, a1, u2] — the previous turn's system
 * prompt, injected featureContext included, rides mid-conversation where the
 * model treats it as still-current instruction. They accumulate toward
 * CONVERSATION_HISTORY_LIMIT, and the splice(1,2) trim preserves the oldest
 * one by design.
 *
 * Today that only duplicates the platform prompt (token waste). The moment
 * Phase 2 injects LP context it becomes stale-context immortality: shelf
 * flushed, lesson superseded — the old block keeps riding in history and
 * contradicts the fresh one. This is the trap resurrected through a side
 * door, and it ships FIXED before any injection does.
 *
 * Invariant, stated once: history is user/assistant turns ONLY. The system
 * prompt is composed per request and never stored.
 */

/* eslint-disable global-require */

const capturedRequests = [];
jest.mock('../../shared/services/llm-client', () => ({
  getClient: () => ({
    chat: {
      completions: {
        create: jest.fn(async (req) => {
          capturedRequests.push(req);
          return { choices: [{ message: { content: 'ok — reply' } }] };
        }),
      },
    },
  }),
}));

jest.mock('../../shared/database/bot-helpers', () => ({
  getConversationHistory: jest.fn(async () => []),
}));

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const service = require('../../shared/services/openai.service');
const { CONVERSATION_HISTORY_LIMIT } = require('../../shared/utils/constants');

const systemMessagesIn = (req) => req.messages.filter((m) => m.role === 'system');

beforeEach(() => {
  capturedRequests.length = 0;
  service.clearHistory('u1');
  service.clearHistory('u2');
  service.clearHistory('u3');
});

describe('Phase 2.0 — history cache carries no system prompts', () => {
  test('second turn sends exactly ONE system message', async () => {
    await service.getResponseWithFormat('salam', 'u1', 'text', 'en');
    await service.getResponseWithFormat('aur sunao', 'u1', 'text', 'en');
    expect(capturedRequests).toHaveLength(2);
    expect(systemMessagesIn(capturedRequests[1])).toHaveLength(1);
    // and it is the fresh one, at the head — not a survivor mid-array
    expect(capturedRequests[1].messages[0].role).toBe('system');
  });

  test('a flushed featureContext is GONE from the next turn, everywhere in the request', async () => {
    const MARKER = 'LESSON_REF_MARKER_do_not_leak_XYZ';
    await service.getResponseWithFormat('is sabaq mein kya hai?', 'u1', 'text', 'en', null, `<lesson_reference>${MARKER}</lesson_reference>`);
    // Turn 2: no featureContext — the shelf was flushed between turns.
    await service.getResponseWithFormat('school mein sports day hai', 'u1', 'text', 'en');
    const leak = capturedRequests[1].messages.filter((m) => String(m.content).includes(MARKER));
    expect(leak).toHaveLength(0);
  });

  test('the stored cache itself holds user/assistant turns only', async () => {
    await service.getResponseWithFormat('salam', 'u1', 'text', 'en');
    const stored = service.conversationHistory.get('u1');
    expect(stored.filter((m) => m.role === 'system')).toHaveLength(0);
    expect(stored.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  test('a cache polluted by the OLD storage shape self-heals on the next turn', async () => {
    // What the pre-fix code left behind: system prompt at [0].
    service.conversationHistory.set('u2', [
      { role: 'system', content: 'OLD SYSTEM PROMPT with stale context' },
      { role: 'user', content: 'pehla sawal' },
      { role: 'assistant', content: 'pehla jawab' },
    ]);
    await service.getResponseWithFormat('doosra sawal', 'u2', 'text', 'en');
    const req = capturedRequests[0];
    expect(systemMessagesIn(req)).toHaveLength(1);
    expect(req.messages.some((m) => String(m.content).includes('OLD SYSTEM PROMPT'))).toBe(false);
    // The real turns survive the filter.
    expect(req.messages.some((m) => m.role === 'user' && m.content === 'pehla sawal')).toBe(true);
  });

  test('trimming still bounds the cache and drops the oldest pair first', async () => {
    const seeded = [];
    for (let i = 1; i <= 5; i += 1) {
      seeded.push({ role: 'user', content: `q${i}` }, { role: 'assistant', content: `a${i}` });
    }
    service.conversationHistory.set('u3', seeded);
    await service.getResponseWithFormat('q6', 'u3', 'text', 'en');
    const stored = service.conversationHistory.get('u3');
    expect(stored.length).toBeLessThanOrEqual(CONVERSATION_HISTORY_LIMIT);
    const contents = stored.map((m) => m.content);
    expect(contents).toContain('q6');            // newest kept
    expect(contents).not.toContain('q1');        // oldest pair dropped
    expect(contents).toContain('q2');            // exactly one pair dropped, not a purge
  });
});
