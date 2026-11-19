/**
 * The teacher app's lesson-plan survey bar, server side:
 *   GET  /api/portal/lp/feedback?kind=k5|g612&ref=…   → { success, feedback: null | { useful, usedInClass } }
 *   POST /api/portal/lp/feedback  { kind, ref, useful?, usedInClass?, reasonText? } → the bot's answer
 *
 * Guards: signed out 401; the switch portal_lp_feedback_bar (or the teacher app) off → 404 with nothing asked of the
 * bot; a leader → 404; a bad body → 400 before the bot. The user is ALWAYS the session's — a userId in the body is
 * ignored, so nobody can answer for another teacher. A grades 6-12 plan is named by its render id, which is resolved
 * for HER (Lp612.requestStatus with the session user) to its segment and language; not hers → 404.
 */
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const SOMEONE = '7a2d3b8f-1c9e-4d66-8b62-3e8f1f4c0d21';
let post; let flags; let leader; let requestStatus;

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  flags = { portal_lp_feedback_bar: true, portal_teacher_v2: true };
  leader = false;
  post = jest.fn();
  requestStatus = jest.fn(async () => ({ state: 'ready', segmentId: 'g7_science_ch2_s1', lang: 'ur' }));
  jest.doMock('axios', () => ({ post }));
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    readFlagRow: async () => ({ data: null, error: null }),
    isFlagEnabledForUser: async (_s, key) => {
      if (flags[key] instanceof Error) throw flags[key];
      return flags[key] === true;
    },
  }));
  jest.doMock('../../dashboard/services/lp-reader.service', () => ({ readerOf: async () => ({ leader, role: leader ? 'coach' : 'teacher' }) }));
  jest.doMock('../../dashboard/services/lp612.service', () => ({ requestStatus }));
  process.env.MAIN_BOT_URL = 'http://bot.test/'; process.env.INTERNAL_API_KEY = 'k';
});

async function call(method, { userId = TEACHER, body = {}, query = {} } = {}) {
  const router = require('../../dashboard/routes/portal-lp-feedback.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === '/lp/feedback' && l.route.methods[method]);
  const req = { session: userId ? { portalUserId: userId } : null, body, query };
  let status = 200; let payload = null;
  const res = { status(c) { status = c; return this; }, json(b) { payload = b; return this; } };
  for (const s of layer.route.stack) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await s.handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return { status, payload };
}

const k5 = { kind: 'k5', ref: 'grade_1_english_ch1_seg3' };

describe('guards', () => {
  it('signed out is 401; the switch off is 404; the teacher app off is 404; a leader is 404 — and the bot is never asked', async () => {
    expect((await call('post', { userId: null, body: { ...k5, useful: true } })).status).toBe(401);
    flags.portal_lp_feedback_bar = false;
    expect((await call('post', { body: { ...k5, useful: true } })).status).toBe(404);
    expect((await call('get', { query: k5 })).status).toBe(404);
    flags.portal_lp_feedback_bar = new Error('read failed');
    expect((await call('post', { body: { ...k5, useful: true } })).status).toBe(404);
    flags.portal_lp_feedback_bar = true; flags.portal_teacher_v2 = false;
    expect((await call('post', { body: { ...k5, useful: true } })).status).toBe(404);
    flags.portal_teacher_v2 = true; leader = true;
    expect((await call('post', { body: { ...k5, useful: true } })).status).toBe(404);
    expect(post).not.toHaveBeenCalled();
  });

  it('a bad body is 400 before the bot is asked', async () => {
    for (const body of [
      {}, { kind: 'fln', ref: '1', useful: true }, { kind: 'k5', ref: '', useful: true }, { ...k5 },
      { ...k5, useful: 'yes' }, { ...k5, usedInClass: 'maybe' }, { ...k5, reasonText: 'x'.repeat(301) }, { ...k5, ref: 7, useful: true },
    ]) {
      expect((await call('post', { body })).status).toBe(400);
    }
    expect((await call('get', { query: { kind: 'k5' } })).status).toBe(400);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('POST /lp/feedback', () => {
  it('asks the bot for the SESSION user (a userId in the body is ignored) and returns its answer', async () => {
    post.mockResolvedValue({ status: 200, data: { success: true, outcome: 'saved', feedback: { useful: true, usedInClass: null } } });
    const out = await call('post', { body: { ...k5, useful: true, userId: SOMEONE } });
    expect(post.mock.calls[0][0]).toBe('http://bot.test/api/internal/lp/feedback');
    expect(post.mock.calls[0][1]).toEqual({ userId: TEACHER, kind: 'k5', ref: k5.ref, useful: true });
    expect(post.mock.calls[0][2].headers['x-api-key']).toBe('k');
    expect(out).toEqual({ status: 200, payload: { success: true, outcome: 'saved', feedback: { useful: true, usedInClass: null } } });
  });

  it('In class and the reason go through as given (trimmed reason)', async () => {
    post.mockResolvedValue({ status: 200, data: { success: true, outcome: 'saved', feedback: { useful: true, usedInClass: 'taught' } } });
    await call('post', { body: { ...k5, usedInClass: 'taught' } });
    expect(post.mock.calls[0][1]).toEqual({ userId: TEACHER, ...k5, usedInClass: 'taught' });
    await call('post', { body: { ...k5, reasonText: '  too long  ' } });
    expect(post.mock.calls[1][1]).toEqual({ userId: TEACHER, ...k5, reasonText: 'too long' });
  });

  it('already answered comes back as a 200 with her answer, not an error', async () => {
    post.mockResolvedValue({ status: 200, data: { success: true, outcome: 'already_answered', feedback: { useful: false, usedInClass: null } } });
    expect((await call('post', { body: { ...k5, useful: true } })).payload).toEqual({
      success: true, outcome: 'already_answered', feedback: { useful: false, usedInClass: null },
    });
  });

  it('grades 6-12: her render id is resolved for HER to its segment and language; not hers is 404', async () => {
    post.mockResolvedValue({ status: 200, data: { success: true, outcome: 'saved', feedback: { useful: true, usedInClass: null } } });
    await call('post', { body: { kind: 'g612', ref: 'render-1', useful: true } });
    expect(requestStatus).toHaveBeenCalledWith('render-1', TEACHER);
    expect(post.mock.calls[0][1]).toEqual({ userId: TEACHER, kind: 'g612', ref: 'g7_science_ch2_s1', lang: 'ur', useful: true });
    requestStatus.mockResolvedValue({ notFound: true });
    expect((await call('post', { body: { kind: 'g612', ref: 'render-2', useful: true } })).status).toBe(404);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('the bot\'s 404 / 409 pass through; an unreachable or broken bot is 502, never saved', async () => {
    post.mockResolvedValue({ status: 404, data: { success: false, outcome: 'unknown_plan' } });
    expect((await call('post', { body: { ...k5, useful: true } })).status).toBe(404);
    post.mockResolvedValue({ status: 409, data: { success: false, outcome: 'no_answer' } });
    expect((await call('post', { body: { ...k5, usedInClass: 'taught' } })).status).toBe(409);
    post.mockResolvedValue({ status: 500, data: { success: false } });
    expect((await call('post', { body: { ...k5, useful: true } })).status).toBe(502);
    post.mockRejectedValue(new Error('ECONNREFUSED'));
    const down = await call('post', { body: { ...k5, useful: true } });
    expect(down.status).toBe(502);
    expect(down.payload.success).toBe(false);
  });
});

describe('GET /lp/feedback', () => {
  it('asks the bot whether she answered this plan, for the session user', async () => {
    post.mockResolvedValue({ status: 200, data: { success: true, feedback: { useful: true, usedInClass: null } } });
    const out = await call('get', { query: { ...k5, userId: SOMEONE } });
    expect(post.mock.calls[0][0]).toBe('http://bot.test/api/internal/lp/feedback/state');
    expect(post.mock.calls[0][1]).toEqual({ userId: TEACHER, ...k5 });
    expect(out.payload).toEqual({ success: true, feedback: { useful: true, usedInClass: null } });
  });

  it('a bot that cannot answer is 502 (the bar stays hidden)', async () => {
    post.mockRejectedValue(new Error('down'));
    expect((await call('get', { query: k5 })).status).toBe(502);
  });
});
