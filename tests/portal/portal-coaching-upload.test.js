/**
 * bd-lfzoz — the portal routes a teacher uses to self-observe from the browser.
 *
 *   POST /coaching-upload/presign           sign a direct-to-R2 upload
 *   POST /coaching-upload/start             start the analysis
 *   GET  /coaching-session/:id/progress     where it is, and her question when it is ready
 *   POST /coaching-session/:id/reflection   answer the question
 *
 * The routes hold no coaching logic: the writes go to the bot over the
 * internal API (dashboard/services/portal-coaching.client.js, mocked here), and
 * the one read is a plain row read. What is pinned is IDENTITY — the user is
 * always the session's, never a body field — and the progress read's shape.
 */

let tableRows;
let client;

function makeChain(table) {
  const filters = {};
  const chain = {
    select: () => chain,
    eq: (c, v) => { filters[c] = v; return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      const rows = (tableRows[table] || []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      return { data: rows[0] || null, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  throw new Error(`no ${method.toUpperCase()} ${path}`);
}

async function invoke(method, path, { userId = 'teacher-1', params = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query: {}, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const handler of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const PORTAL_URL = 'https://r2.example/digital-coach-audio/classroom_audio/teacher-1/2026-10/portal_abc.m4a';
const WA_URL = 'https://r2.example/digital-coach-audio/classroom_audio/teacher-1/2026-10/683335f3_1790852380454.ogg';

beforeEach(() => {
  jest.resetModules();
  // These tests cover the routes with the feature ON (bd-3bvfj gates them;
  // the OFF behaviour is pinned in portal-self-observation-flag.test.js).
  tableRows = { app_settings: [{ key: 'portal_self_observation', value: true }] };
  client = {
    presignUpload: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', key: 'k', uploadUrl: 'u' } }),
    startSession: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', coachingSessionId: 'cs-1' } }),
    submitReflection: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', done: true, acknowledgement: 'Thank you.' } }),
  };
  jest.doMock('../../dashboard/services/portal-coaching.client', () => client);
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => jest.resetModules());

describe('POST /coaching-upload/presign', () => {
  it('requires a portal session', async () => {
    const { statusCode } = await invoke('post', '/coaching-upload/presign', { userId: null, body: { filename: 'a.m4a' } });
    expect(statusCode).toBe(401);
    expect(client.presignUpload).not.toHaveBeenCalled();
  });

  it('signs for the SESSION user, ignoring any userId in the body', async () => {
    const { statusCode, payload } = await invoke('post', '/coaching-upload/presign', {
      body: { filename: 'a.m4a', sizeBytes: 9, kind: 'audio', userId: 'someone-else' },
    });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ key: 'k', uploadUrl: 'u' });
    expect(client.presignUpload).toHaveBeenCalledWith({ userId: 'teacher-1', filename: 'a.m4a', sizeBytes: 9, kind: 'audio' });
  });

  it('relays the bot\'s refusal', async () => {
    client.presignUpload.mockResolvedValue({ httpStatus: 400, body: { success: false, status: 'invalid', reason: 'not_audio' } });
    const { statusCode, payload } = await invoke('post', '/coaching-upload/presign', { body: { filename: 'a.pdf' } });
    expect(statusCode).toBe(400);
    expect(payload.reason).toBe('not_audio');
  });
});

describe('POST /coaching-upload/start', () => {
  it('starts for the SESSION user with the keys the browser uploaded', async () => {
    const { statusCode, payload } = await invoke('post', '/coaching-upload/start', {
      body: { key: 'k', lessonPlanKey: 'lp', photoKeys: ['p1'], userId: 'someone-else' },
    });
    expect(statusCode).toBe(200);
    expect(payload.coachingSessionId).toBe('cs-1');
    expect(client.startSession).toHaveBeenCalledWith({ userId: 'teacher-1', key: 'k', lessonPlanKey: 'lp', photoKeys: ['p1'] });
  });

  it('bd-fmf24g.9 — forwards the class she picked, only its named fields', async () => {
    await invoke('post', '/coaching-upload/start', {
      body: { key: 'k', teacherClass: { grade: 4, subject: 'Mathematics', subjectKey: 'maths', userId: 'x', junk: 1 } },
    });
    expect(client.startSession).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'teacher-1', key: 'k', teacherClass: { grade: 4, subject: 'Mathematics', subjectKey: 'maths' },
    }));
  });

  it('bd-fmf24g.9 — a malformed teacherClass is not forwarded (the recording still starts)', async () => {
    for (const bad of ['maths', [4], 7, null]) {
      client.startSession.mockClear();
      const { statusCode } = await invoke('post', '/coaching-upload/start', { body: { key: 'k', teacherClass: bad } });
      expect(statusCode).toBe(200);
      expect(client.startSession.mock.calls[0][0].teacherClass).toBeUndefined();
    }
  });

  it('relays "already analysing one" as 409', async () => {
    client.startSession.mockResolvedValue({ httpStatus: 409, body: { success: false, status: 'in_progress', coachingSessionId: 'cs-old' } });
    const { statusCode, payload } = await invoke('post', '/coaching-upload/start', { body: { key: 'k' } });
    expect(statusCode).toBe(409);
    expect(payload.coachingSessionId).toBe('cs-old');
  });

  it('answers 502 — never success — when the bot cannot be reached', async () => {
    client.startSession.mockRejectedValue(new Error('ECONNREFUSED'));
    const { statusCode, payload } = await invoke('post', '/coaching-upload/start', { body: { key: 'k' } });
    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
  });
});

describe('GET /coaching-session/:id/progress', () => {
  const row = (over = {}) => ({
    id: 'cs-1', user_id: 'teacher-1', status: 'transcribing', audio_url: PORTAL_URL,
    audio_duration_seconds: null, has_lesson_plan: true, classroom_photos: [{ url: 'x' }],
    conversation_state: {}, created_at: '2026-10-01T10:00:00Z', ...over,
  });

  it('404s for another teacher\'s session — the same answer as a missing one', async () => {
    tableRows.coaching_sessions = [row({ user_id: 'teacher-2' })];
    const { statusCode } = await invoke('get', '/coaching-session/:id/progress', { params: { id: 'cs-1' } });
    expect(statusCode).toBe(404);
  });

  it.each([
    ['confirmed', 'queued'], ['transcribing', 'transcribing'], ['analysis_started', 'analysing'],
    ['conducting_conversation', 'reflection'], ['generating_report', 'report'], ['completed', 'done'],
    ['failed', 'stopped'],
  ])('status %s reads as stage %s', async (status, stage) => {
    tableRows.coaching_sessions = [row({ status })];
    const { statusCode, payload } = await invoke('get', '/coaching-session/:id/progress', { params: { id: 'cs-1' } });
    expect(statusCode).toBe(200);
    expect(payload.stage).toBe(stage);
  });

  it('shows the stored question once it is ready — and only the unanswered one', async () => {
    tableRows.coaching_sessions = [row({
      status: 'conducting_conversation',
      conversation_state: { current_state: 'REFLECTIVE_QUESTION_1', questions: [
        { question_number: 1, question: 'What did you notice when the room went quiet?', answer: null },
      ] },
    })];
    const { payload } = await invoke('get', '/coaching-session/:id/progress', { params: { id: 'cs-1' } });
    expect(payload.reflection).toEqual({ questionNumber: 1, question: 'What did you notice when the room went quiet?' });
  });

  it('never surfaces the question of a WhatsApp session — that debrief belongs to her chat', async () => {
    tableRows.coaching_sessions = [row({
      status: 'conducting_conversation', audio_url: WA_URL,
      conversation_state: { questions: [{ question_number: 1, question: 'Q', answer: null }] },
    })];
    const { payload } = await invoke('get', '/coaching-session/:id/progress', { params: { id: 'cs-1' } });
    expect(payload.reflection).toBeNull();
    expect(payload.source).toBe('whatsapp');
  });

  it('flags a short recording once transcription has measured it', async () => {
    tableRows.coaching_sessions = [row({ audio_duration_seconds: 240 })];
    const { payload } = await invoke('get', '/coaching-session/:id/progress', { params: { id: 'cs-1' } });
    expect(payload.shortRecording).toBe(true);
    tableRows.coaching_sessions = [row({ audio_duration_seconds: 1800 })];
    expect((await invoke('get', '/coaching-session/:id/progress', { params: { id: 'cs-1' } })).payload.shortRecording).toBe(false);
  });
});

describe('POST /coaching-session/:id/reflection', () => {
  it('answers for the SESSION user and returns the acknowledgement', async () => {
    const { statusCode, payload } = await invoke('post', '/coaching-session/:id/reflection', {
      params: { id: 'cs-1' }, body: { answer: 'I waited.', userId: 'someone-else' },
    });
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ done: true, acknowledgement: 'Thank you.' });
    expect(client.submitReflection).toHaveBeenCalledWith({ userId: 'teacher-1', coachingSessionId: 'cs-1', answer: 'I waited.' });
  });

  it('requires a portal session', async () => {
    const { statusCode } = await invoke('post', '/coaching-session/:id/reflection', { userId: null, params: { id: 'cs-1' }, body: { answer: 'x' } });
    expect(statusCode).toBe(401);
  });
});
