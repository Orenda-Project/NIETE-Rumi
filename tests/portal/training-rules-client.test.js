/**
 * bd-2480 / bd-2481 — the portal asks the bot for training decisions.
 *
 * WHY
 * ---
 * The portal kept its own copy of the bot's training rules. The copies rotted,
 * while the portal's comments still claimed parity ("mirror the WhatsApp
 * endpoint's rule exactly", "Same rule as the WhatsApp Flow"):
 *
 *   - a capstone pass did not count as a level pass, so the first Beacon House
 *     certificate ever issued is invisible to the portal;
 *   - "ready for exam" used the pre-bd-2447 ">=1 module per course" proxy — a
 *     fix already announced as shipped;
 *   - a missing vendor row defaulted to chain-locked here, unlocked on the bot;
 *   - the module-order gate (bd-2448) did not exist on the portal AT ALL, so a
 *     teacher could open any module in any order.
 *
 * This client is deliberately dumb. It has no rules of its own and no local
 * fallback — a fallback IS a second implementation, which is the whole bug.
 *
 * FAIL CLOSED — the property that makes the new dependency safe
 * -------------------------------------------------------------
 * Routing gates through the bot makes the bot an availability floor for portal
 * training. That is an accepted trade (operator, 2026-08-02), and it is only
 * safe because an unreachable bot LOCKS things rather than opening them.
 *
 * A gate that answers "ok" when it could not reach the authority is not a gate.
 * That is bd-2452's bug class — a level rendering "🔒 Locked" and starting
 * anyway — and bd-2461's, where a swallowed failure still reported success.
 * Every failure path below must deny.
 */

let axiosPost;
let client;

const BOT = 'https://bot.example.test';
const KEY = 'shared-secret-key';
const USER = 'user-uuid-1';

beforeEach(() => {
  jest.resetModules();
  process.env.MAIN_BOT_URL = BOT;
  process.env.INTERNAL_API_KEY = KEY;
  axiosPost = jest.fn();
  jest.doMock('axios', () => ({ post: axiosPost, get: jest.fn() }), { virtual: true });
  client = require('../../dashboard/services/training-rules.service');
});

afterEach(() => {
  delete process.env.MAIN_BOT_URL;
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('bd-2480 — the client talks to the bot, and carries the answer verbatim', () => {
  it('posts level-states to the bot with the shared key', async () => {
    axiosPost.mockResolvedValueOnce({ data: { success: true, levels: [] } });

    await client.getLevelStates(USER);

    const [url, body, config] = axiosPost.mock.calls[0];
    expect(url).toBe(`${BOT}/api/internal/training/level-states`);
    expect(body).toEqual({ userId: USER });
    expect(config.headers['x-api-key']).toBe(KEY);
  });

  it('returns the bot\'s level states untouched — capstone certification included', async () => {
    const levels = [
      { id: 18, order_index: 2, name: 'English', state: 'certified', unlock_logic: 'all_modules' },
    ];
    axiosPost.mockResolvedValueOnce({ data: { success: true, levels } });

    const out = await client.getLevelStates(USER);

    expect(out).toEqual(levels);
  });

  it('sets a timeout so a hung bot cannot hang the portal request', async () => {
    axiosPost.mockResolvedValueOnce({ data: { success: true, levels: [] } });
    await client.getLevelStates(USER);
    expect(axiosPost.mock.calls[0][2].timeout).toBeGreaterThan(0);
  });

  it('passes a level gate through with the bot\'s own message and number', async () => {
    axiosPost.mockResolvedValueOnce({
      data: {
        success: true, ok: false, status: 403,
        message: 'Pass Level 1\'s grand quiz first to unlock this level.',
        previous_level_order: 1,
      },
    });

    const gate = await client.checkLevelUnlocked(USER, 12);

    expect(gate).toMatchObject({
      ok: false, status: 403, previous_level_order: 1,
      message: 'Pass Level 1\'s grand quiz first to unlock this level.',
    });
  });

  it('opens a level the bot says is open', async () => {
    axiosPost.mockResolvedValueOnce({ data: { success: true, ok: true } });
    const gate = await client.checkLevelUnlocked(USER, 11);
    expect(gate.ok).toBe(true);
  });
});

describe('bd-2481 — the module-order gate the portal never had', () => {
  it('asks the bot whether a module may be opened', async () => {
    axiosPost.mockResolvedValueOnce({ data: { success: true, ok: true } });

    await client.checkModuleUnlocked(USER, 223);

    const [url, body] = axiosPost.mock.calls[0];
    expect(url).toBe(`${BOT}/api/internal/training/module-unlocked`);
    expect(body).toEqual({ userId: USER, moduleId: 223 });
  });

  it('refuses an out-of-order module with the bot\'s message', async () => {
    axiosPost.mockResolvedValueOnce({
      data: { success: true, ok: false, message: 'That module is locked until you finish the ones before it.' },
    });

    const gate = await client.checkModuleUnlocked(USER, 999);

    expect(gate.ok).toBe(false);
    expect(gate.message).toBe('That module is locked until you finish the ones before it.');
  });
});

describe('bd-2480 — the exam gate covers grand quizzes AND capstones', () => {
  it('asks the bot, passing the vendor scope through', async () => {
    axiosPost.mockResolvedValueOnce({ data: { success: true, ok: true } });

    await client.checkExamGate(USER, 2, 'beacon_house');

    const [url, body] = axiosPost.mock.calls[0];
    expect(url).toBe(`${BOT}/api/internal/training/exam-gate`);
    expect(body).toEqual({ userId: USER, levelOrder: 2, vendorKey: 'beacon_house' });
  });

  it('keeps the bot\'s refusal reason so the portal need not re-derive one', async () => {
    axiosPost.mockResolvedValueOnce({
      data: { success: true, ok: false, reason: 'already_passed', message: 'You have already passed this level exam.' },
    });

    const gate = await client.checkExamGate(USER, 2, 'beacon_house');

    expect(gate).toMatchObject({ ok: false, reason: 'already_passed' });
  });
});

/**
 * The section that matters most. Every one of these is a way the authority can
 * be unavailable, and every one must DENY.
 */
describe('bd-2480 — fail closed, always', () => {
  const failures = [
    ['the bot is unreachable', () => axiosPost.mockRejectedValueOnce(new Error('ECONNREFUSED'))],
    ['the request times out', () => axiosPost.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))],
    ['the bot returns 500', () => axiosPost.mockRejectedValueOnce(Object.assign(new Error('Request failed'), { response: { status: 500, data: { success: false } } }))],
    ['the bot rejects the key', () => axiosPost.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { response: { status: 401, data: { success: false } } }))],
    ['the bot answers success:false', () => axiosPost.mockResolvedValueOnce({ data: { success: false, error: 'Training lookup failed' } })],
    ['the bot answers an empty body', () => axiosPost.mockResolvedValueOnce({ data: null })],
  ];

  it.each(failures)('a level gate DENIES when %s', async (_label, arrange) => {
    arrange();
    const gate = await client.checkLevelUnlocked(USER, 12);
    expect(gate.ok).toBe(false);
  });

  it.each(failures)('a module gate DENIES when %s', async (_label, arrange) => {
    arrange();
    const gate = await client.checkModuleUnlocked(USER, 223);
    expect(gate.ok).toBe(false);
  });

  it.each(failures)('an exam gate DENIES when %s', async (_label, arrange) => {
    arrange();
    const gate = await client.checkExamGate(USER, 2, null);
    expect(gate.ok).toBe(false);
  });

  it('a denied gate never throws — the caller gets an answer it can render', async () => {
    axiosPost.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const gate = await client.checkLevelUnlocked(USER, 12);
    expect(gate.message).toEqual(expect.any(String));
    expect(gate.message.length).toBeGreaterThan(0);
  });

  it('denies without calling the bot at all when MAIN_BOT_URL is unset', async () => {
    // A gate that silently vanishes with its config is not a gate (PR #83).
    jest.resetModules();
    delete process.env.MAIN_BOT_URL;
    jest.doMock('axios', () => ({ post: axiosPost, get: jest.fn() }), { virtual: true });
    client = require('../../dashboard/services/training-rules.service');

    const gate = await client.checkLevelUnlocked(USER, 12);

    expect(gate.ok).toBe(false);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('denies without calling the bot at all when INTERNAL_API_KEY is unset', async () => {
    jest.resetModules();
    delete process.env.INTERNAL_API_KEY;
    jest.doMock('axios', () => ({ post: axiosPost, get: jest.fn() }), { virtual: true });
    client = require('../../dashboard/services/training-rules.service');

    const gate = await client.checkLevelUnlocked(USER, 12);

    expect(gate.ok).toBe(false);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('level states surface the failure rather than pretending the teacher has none', async () => {
    // An empty catalogue is a legitimate answer ("no training assigned"), so
    // returning [] on error would render a plausible lie. Callers must be able
    // to tell "nothing assigned" from "could not ask".
    axiosPost.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(client.getLevelStates(USER)).rejects.toThrow();
  });
});

describe('bd-2480 — the client holds no rules of its own', () => {
  it('exposes no local fallback that could re-derive a decision', () => {
    // A fallback is a second implementation, which is the bug being removed.
    //
    // Comments are stripped first: this file SHOULD discuss unlock_logic and
    // ready_for_quiz at length, because explaining which rules moved and why
    // is the point of the docblock. What must not exist is code that decides.
    const raw = require('fs').readFileSync(
      require.resolve('../../dashboard/services/training-rules.service'), 'utf8',
    );
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments, leaving http:// alone

    // Inputs to a rule, and coercion of the bot's answer, are fine — the client
    // has to name `is_passed` to hand it back. What must not appear is anything
    // that DECIDES: reading the source data a rule is computed from, or
    // comparing scores against a bar.
    expect(code).not.toMatch(/unlock_logic/);
    expect(code).not.toMatch(/quiz_kind/);
    expect(code).not.toMatch(/passing_pct|module_passing_pct/);
    expect(code).not.toMatch(/coursesCompleted|coursesStarted|ready_for_quiz|certified/);
    // No arithmetic on level ordering — deriving "the previous level" here is
    // exactly how the two surfaces ended up disagreeing about lock state.
    expect(code).not.toMatch(/order_index/);
    // No grading. `score === total`, `>= someBar`, or any percentage maths
    // would be a second copy of the pass rule (bd-2483).
    expect(code).not.toMatch(/score\s*[=><]/);
    expect(code).not.toMatch(/totalQuestions\s*[=><]/);
    expect(code).not.toMatch(/\/\s*total|\*\s*100/);
  });
});

describe('bd-te5lae — capstone marking is asked of the bot, never done in the portal', () => {
  it('posts the question and the answer to capstone-score, with a timeout sized for marking', async () => {
    axiosPost.mockResolvedValueOnce({ data: { success: true, score: 4, feedback: 'Good.' } });

    const out = await client.scoreCapstoneAnswer({ id: 900, question_text: 'Q1' }, 'my answer');

    const [url, body, config] = axiosPost.mock.calls[0];
    expect(url).toBe(`${BOT}/api/internal/training/capstone-score`);
    expect(body).toEqual({ question: { id: 900, question_text: 'Q1' }, answerText: 'my answer' });
    expect(config.headers['x-api-key']).toBe(KEY);
    expect(config.timeout).toBeGreaterThanOrEqual(60_000);
    expect(out).toEqual({ score: 4, feedback: 'Good.' });
  });

  it('throws when the bot cannot mark — a teacher never gets a made-up score', async () => {
    axiosPost.mockRejectedValueOnce(new Error('timeout of 60000ms exceeded'));
    await expect(client.scoreCapstoneAnswer({ question_text: 'Q' }, 'a')).rejects.toThrow();

    axiosPost.mockResolvedValueOnce({ data: { success: false } });
    await expect(client.scoreCapstoneAnswer({ question_text: 'Q' }, 'a')).rejects.toThrow();

    axiosPost.mockResolvedValueOnce({ data: { success: true, feedback: 'no score field' } });
    await expect(client.scoreCapstoneAnswer({ question_text: 'Q' }, 'a')).rejects.toThrow();
  });
});
