/**
 * bd-5tn5d — a teacher with more than one capstone open loses every answer she types.
 *
 * WHAT HAPPENS
 * ------------
 * routeTextAnswer reads the in-progress capstone with:
 *
 *     .eq('user_id', …).eq('quiz_kind', 'capstone').eq('status', 'in_progress')
 *     .maybeSingle()
 *
 * `.maybeSingle()` is a PostgREST single-row read: two or more matching rows come
 * back as an ERROR (PGRST116), not as a list. The error is not destructured, so
 * `attempt` is null, the function returns false, and the handler passes the message
 * on to ordinary chat handling — the teacher gets a reply about lesson plans instead
 * of a score, and the answer is never stored.
 *
 * WHY A TEACHER HAS TWO OPEN AT ONCE
 * ----------------------------------
 * `ux_taa_one_active_per_quiz` is UNIQUE (user_id, grand_quiz_id) WHERE
 * status='in_progress' — scoped PER QUIZ. Beacon House has four capstones, one per
 * subject, so the guard permits four concurrent open attempts by design. On
 * production, 11 teachers hold 2+ and the maximum observed is 4.
 *
 * `cancel` is dead for the same reason: it is handled AFTER `if (!attempt) return
 * false`, so the teacher the bot tells to type "cancel" cannot cancel either.
 *
 * WHAT IS DELIBERATELY NOT CHANGED HERE
 * -------------------------------------
 * Whether a teacher SHOULD be able to open a second capstone. The 2026-08-02
 * migration flagged that and deferred it as "a behaviour change rather than an
 * unblock, [which] belongs in its own review". This test pins the answer-routing
 * repair only: whatever is open, an answer must land somewhere and cancel must work.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(),
  getCurrentCorrelationId: () => null,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
jest.mock('pdfkit', () => jest.fn(), { virtual: true });

const PHONE = '923001234567';
const USER = { id: 'u-1', first_name: 'Ayesha' };

// The two attempts a Beacon House teacher ends up holding: English opened first,
// Mathematics touched most recently. An answer she types now is for Mathematics.
const OLDER = {
  id: 'att-english', user_id: USER.id, level_id: 18, grand_quiz_id: 29, program_id: 'p-1',
  current_question_index: 1, total_questions: 8, total_score: 40, status: 'in_progress',
  last_activity_at: '2026-09-01T10:00:00Z',
};
const NEWER = {
  id: 'att-maths', user_id: USER.id, level_id: 19, grand_quiz_id: 30, program_id: 'p-1',
  current_question_index: 2, total_questions: 8, total_score: 40, status: 'in_progress',
  last_activity_at: '2026-09-08T18:00:00Z',
};

/**
 * A supabase stand-in that behaves like PostgREST on the one axis that matters:
 * `.maybeSingle()` over multiple rows is an ERROR, not a truncation. Getting this
 * wrong is what let the bug ship — a mock that quietly returns the first row makes
 * the broken code look correct.
 */
function makeSupabase({ openAttempts }) {
  const writes = { answers: [], attemptUpdates: [] };

  const build = (table) => {
    const state = { table, filters: {}, ordered: false, limited: null, payload: null, op: null };
    const chain = {
      select() { return chain; },
      insert(p) { state.op = 'insert'; state.payload = p; return chain; },
      upsert(p) { state.op = 'upsert'; state.payload = p; return chain; },
      update(p) { state.op = 'update'; state.payload = p; return chain; },
      eq(col, val) { state.filters[col] = val; return chain; },
      order(col) { state.ordered = col; return chain; },
      limit(n) { state.limited = n; return chain; },
      then(resolve) { return resolve(settle()); },
      maybeSingle: async () => settleSingle(),
      single: async () => settleSingle(),
    };

    function rows() {
      if (state.table === 'users') return [USER];
      if (state.table === 'training_questions') {
        return [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({
          id: `q-${i}`, question_text: `Question ${i}`, order_index: i,
        }));
      }
      if (state.table === 'training_assessment_attempts') {
        if (state.op) return [{ id: state.filters.id }];
        let r = openAttempts.filter(a =>
          (state.filters.user_id === undefined || a.user_id === state.filters.user_id) &&
          (state.filters.status === undefined || a.status === state.filters.status) &&
          (state.filters.quiz_kind === undefined || state.filters.quiz_kind === 'capstone'));
        if (state.ordered === 'last_activity_at') {
          r = [...r].sort((a, b) => String(b.last_activity_at).localeCompare(String(a.last_activity_at)));
        }
        if (state.limited) r = r.slice(0, state.limited);
        return r;
      }
      return [];
    }

    function settle() {
      if (state.op === 'upsert' || state.op === 'insert') {
        writes.answers.push(state.payload);
        return { data: null, error: null };
      }
      if (state.op === 'update') {
        writes.attemptUpdates.push({ id: state.filters.id, patch: state.payload });
        return { data: null, error: null };
      }
      return { data: rows(), error: null };
    }

    function settleSingle() {
      if (state.op) return settle();
      const r = rows();
      if (r.length > 1) {
        // PostgREST: JSON object requested, multiple (or no) rows returned.
        return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple rows returned' } };
      }
      return { data: r[0] || null, error: null };
    }

    return chain;
  };

  return { client: { from: (t) => build(t), rpc: jest.fn() }, writes };
}

function load({ openAttempts }) {
  jest.resetModules();
  const { client, writes } = makeSupabase({ openAttempts });
  const sent = [];
  jest.doMock('../../bot/shared/config/supabase', () => client);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn(async (_to, body) => { sent.push(body); return true; }),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: () => ({
      chat: { completions: { create: async () => ({
        choices: [{ message: { content: '{"score": 4, "feedback": "Good, specific answer."}' } }],
      }) } },
    }),
    getDefaultModel: () => 'test-model',
  }));
  const svc = require('../../bot/shared/services/training/capstone-delivery.service');
  return { svc, writes, sent };
}

describe('bd-5tn5d — an answer must land even when several capstones are open', () => {
  test('TWO open: the answer is consumed, not dropped into ordinary chat', async () => {
    const { svc } = load({ openAttempts: [OLDER, NEWER] });
    const consumed = await svc.routeTextAnswer(PHONE, 'x'.repeat(450));
    // false means the handler passes it on and the teacher gets a lesson-plan reply.
    expect(consumed).toBe(true);
  });

  test('TWO open: the answer is written against the most recently active attempt', async () => {
    const { svc, writes } = load({ openAttempts: [OLDER, NEWER] });
    await svc.routeTextAnswer(PHONE, 'x'.repeat(450));
    expect(writes.answers.length).toBeGreaterThan(0);
    const attemptIds = writes.answers.map(a => (Array.isArray(a) ? a[0] : a).attempt_id);
    expect(attemptIds).toContain(NEWER.id);
    expect(attemptIds).not.toContain(OLDER.id);
  });

  test('TWO open: "cancel" still cancels — the bot tells her to type it', async () => {
    const { svc, writes, sent } = load({ openAttempts: [OLDER, NEWER] });
    const consumed = await svc.routeTextAnswer(PHONE, 'cancel');
    expect(consumed).toBe(true);
    expect(writes.attemptUpdates.some(u => u.patch.status === 'abandoned')).toBe(true);
    expect(sent.join(' ')).toMatch(/paused/i);
  });

  test('ONE open: unchanged — still routed (regression guard)', async () => {
    const { svc, writes } = load({ openAttempts: [NEWER] });
    const consumed = await svc.routeTextAnswer(PHONE, 'x'.repeat(450));
    expect(consumed).toBe(true);
    expect(writes.answers.length).toBeGreaterThan(0);
  });

  test('NONE open: the message flows on to ordinary handling (regression guard)', async () => {
    const { svc } = load({ openAttempts: [] });
    expect(await svc.routeTextAnswer(PHONE, 'hello')).toBe(false);
  });

  test('slash commands are never consumed, however many are open (regression guard)', async () => {
    const { svc } = load({ openAttempts: [OLDER, NEWER] });
    expect(await svc.routeTextAnswer(PHONE, '/training')).toBe(false);
  });
});
