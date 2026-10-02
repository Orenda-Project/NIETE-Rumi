/**
 * bd-5rz1v — the portal routes behind the redesigned Coaching pages.
 *
 *   POST /coaching-upload/start           now also carries a LIBRARY lesson-plan pick
 *   GET  /coaching-upload/recent-plans    her recent plans (the WhatsApp list's source)
 *   GET  /coaching-sessions               each row gains topic + subject, for the list
 *   GET  /coaching-sessions/active        what is still in flight, and what needs her answer
 *
 * As in portal-coaching-upload.test.js: the user is ALWAYS the session's, the
 * bot client is mocked, and the new teacher-facing routes stay dark behind
 * app_settings.portal_self_observation.
 */

let tableRows;
let client;
let selects;

/**
 * PostgREST's JSON-slice select: `alias:col->>key` (text) / `alias:col->key`
 * (json) put that one key on the row under `alias`. The real API sends only the
 * slice, so a route that reads a slice must find it here too.
 */
function applySlices(row, cols) {
  const out = { ...row };
  for (const part of String(cols || '').split(',')) {
    const m = part.trim().match(/^(\w+):(\w+)->(>?)(\w+)$/);
    if (!m) continue;
    const [, alias, col, text, key] = m;
    const v = row[col] && row[col][key];
    out[alias] = v === undefined ? null : (text && v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  }
  return out;
}

/** A chain that filters `tableRows[table]` the way PostgREST would for the calls these routes make. */
function makeChain(table) {
  const tests = [];
  let order = null;
  let cap = Infinity;
  let cols = '';
  const run = () => {
    let rows = (tableRows[table] || []).filter((r) => tests.every((t) => t(r)));
    if (order) rows = [...rows].sort((a, b) => (a[order.col] < b[order.col] ? -1 : 1) * (order.asc ? 1 : -1));
    return rows.slice(0, cap).map((r) => applySlices(r, cols));
  };
  const chain = {
    select: (c) => { cols = c || ''; (selects[table] = selects[table] || []).push(cols); return chain; },
    eq: (c, v) => { tests.push((r) => r[c] === v); return chain; },
    in: (c, vs) => { tests.push((r) => vs.includes(r[c])); return chain; },
    not: (c, op, v) => {
      if (op === 'is') tests.push((r) => r[c] !== v && r[c] !== undefined);
      if (op === 'in') {
        const vs = String(v).replace(/[()]/g, '').split(',');
        tests.push((r) => !vs.includes(r[c]));
      }
      return chain;
    },
    gte: (c, v) => { tests.push((r) => r[c] >= v); return chain; },
    order: (col, opts = {}) => { order = { col, asc: opts.ascending !== false }; return chain; },
    limit: (n) => { cap = n; return chain; },
    range: (a, b) => { cap = b - a + 1; return chain; },
    maybeSingle: async () => ({ data: run()[0] || null, error: null }),
    then: (res, rej) => Promise.resolve({ data: run(), error: null, count: run().length }).then(res, rej),
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

async function invoke(method, path, { userId = 'teacher-1', params = {}, body = {}, query = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
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

const PORTAL = (id) => `https://r2.example/digital-coach-audio/classroom_audio/teacher-1/2026-10/portal_${id}.webm`;
const WHATSAPP = 'https://r2.example/digital-coach-audio/classroom_audio/teacher-1/2026-10/683335f3_1790852380454.ogg';
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

beforeEach(() => {
  jest.resetModules();
  tableRows = { app_settings: [{ key: 'portal_self_observation', value: true }] };
  selects = {};
  client = {
    presignUpload: jest.fn(),
    startSession: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', coachingSessionId: 'cs-1' } }),
    submitReflection: jest.fn(),
    recentPlans: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', plans: [{ assetId: 'a1' }] } }),
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

describe('POST /coaching-upload/start — a library lesson plan', () => {
  it('passes a library pick through for the SESSION user, keeping only the fields the bot reads', async () => {
    const { statusCode } = await invoke('post', '/coaching-upload/start', {
      body: {
        key: 'k', photoKeys: [], userId: 'someone-else',
        lessonPlan: { lessonId: 'g4-sst-ch3-seg2', extra: 'x', userId: 'someone-else' },
      },
    });
    expect(statusCode).toBe(200);
    expect(client.startSession).toHaveBeenCalledWith({
      userId: 'teacher-1', key: 'k', lessonPlanKey: undefined, photoKeys: [], lessonPlan: { lessonId: 'g4-sst-ch3-seg2' },
    });
  });

  it('carries a 6-12 pick with its language', async () => {
    await invoke('post', '/coaching-upload/start', { body: { key: 'k', lessonPlan: { segmentId: 's1', lang: 'ur' } } });
    expect(client.startSession.mock.calls[0][0].lessonPlan).toEqual({ segmentId: 's1', lang: 'ur' });
  });

  it('sends no lessonPlan when none was picked', async () => {
    await invoke('post', '/coaching-upload/start', { body: { key: 'k', lessonPlanKey: 'lp' } });
    expect(client.startSession.mock.calls[0][0].lessonPlan).toBeUndefined();
  });
});

describe('GET /coaching-upload/recent-plans', () => {
  it('returns her recent plans from the bot, for the SESSION user', async () => {
    const { statusCode, payload } = await invoke('get', '/coaching-upload/recent-plans');
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ success: true, plans: [{ assetId: 'a1' }] });
    expect(client.recentPlans).toHaveBeenCalledWith({ userId: 'teacher-1' });
  });

  it('is dark while the feature is off for her', async () => {
    tableRows.app_settings = [];
    const { statusCode } = await invoke('get', '/coaching-upload/recent-plans');
    expect(statusCode).toBe(404);
    expect(client.recentPlans).not.toHaveBeenCalled();
  });
});

describe('GET /coaching-sessions — topic and subject for the list', () => {
  it('names each lesson by the topic and subject its analysis found', async () => {
    tableRows.coaching_sessions = [{
      id: 'cs-1', user_id: 'teacher-1', status: 'completed', created_at: hoursAgo(30), audio_duration_seconds: 1700,
      audio_url: PORTAL('a'),
      analysis_data: { topic: 'Provinces of Pakistan', subject: 'Social Studies', framework: 'fico' },
    }];
    const { payload } = await invoke('get', '/coaching-sessions', { query: { limit: '100' } });
    expect(payload.sessions[0]).toMatchObject({ id: 'cs-1', topic: 'Provinces of Pakistan', subject: 'Social Studies' });
  });

  it('leaves them null rather than inventing a name', async () => {
    tableRows.coaching_sessions = [{
      id: 'cs-1', user_id: 'teacher-1', status: 'completed', created_at: hoursAgo(30), analysis_data: { framework: 'fico' },
    }];
    const { payload } = await invoke('get', '/coaching-sessions');
    expect(payload.sessions[0]).toMatchObject({ topic: null, subject: null });
  });

  it('reads slices of analysis_data, never the whole ~30 KB column per row (list of up to 100)', async () => {
    tableRows.coaching_sessions = [{
      id: 'cs-1', user_id: 'teacher-1', status: 'completed', created_at: hoursAgo(30),
      analysis_data: { topic: 'T', subject: 'S', framework: 'fico', scores: { overall_marks: 30, overall_max_marks: 44, overall_percentage: 68.2 } },
    }];
    const { payload } = await invoke('get', '/coaching-sessions', { query: { limit: '100' } });
    const cols = selects.coaching_sessions.join(' | ');
    expect(cols).not.toMatch(/(^|[,\s])analysis_data(\s*,|\s*$)/);
    // The score still reads the framework's own shape (getOverall over the scores slice).
    expect(payload.sessions[0]).toMatchObject({ percentage: 68.2, maxScore: 44, overallScore: 30, framework: 'fico', topic: 'T', subject: 'S' });
  });
});

describe('GET /coaching-session/:id — the lesson page names the lesson', () => {
  beforeEach(() => {
    jest.doMock('../../dashboard/services/coaching-breakdown.service', () => ({ breakdown: jest.fn().mockResolvedValue(null) }));
  });

  it('carries the topic and subject its analysis found', async () => {
    tableRows.coaching_sessions = [{
      id: 'cs-1', user_id: 'teacher-1', status: 'completed', created_at: hoursAgo(3), audio_url: PORTAL('a'),
      analysis_data: { topic: 'Provinces of Pakistan', subject: 'Social Studies', framework: 'fico' },
    }];
    const { statusCode, payload } = await invoke('get', '/coaching-session/:id', { params: { id: 'cs-1' } });
    expect(statusCode).toBe(200);
    expect(payload.session).toMatchObject({ id: 'cs-1', topic: 'Provinces of Pakistan', subject: 'Social Studies' });
  });

  it('leaves them null when the analysis named neither', async () => {
    tableRows.coaching_sessions = [{
      id: 'cs-1', user_id: 'teacher-1', status: 'completed', created_at: hoursAgo(3), analysis_data: null,
    }];
    const { payload } = await invoke('get', '/coaching-session/:id', { params: { id: 'cs-1' } });
    expect(payload.session).toMatchObject({ topic: null, subject: null });
  });
});

describe('GET /coaching-sessions/active', () => {
  const asked = { questions: [{ question_number: 1, question: 'What did you do next?', answer: null }] };

  beforeEach(() => {
    tableRows.coaching_sessions = [
      { id: 'newest-analysing', user_id: 'teacher-1', status: 'analyzing', audio_url: PORTAL('n'), created_at: hoursAgo(1) },
      { id: 'older-needs-answer', user_id: 'teacher-1', status: 'conducting_conversation', audio_url: PORTAL('o'), conversation_state: asked, created_at: hoursAgo(20), analysis_data: { topic: 'Fractions' } },
      { id: 'oldest-needs-answer', user_id: 'teacher-1', status: 'conducting_conversation', audio_url: PORTAL('p'), conversation_state: asked, created_at: hoursAgo(40) },
      { id: 'whatsapp-debrief', user_id: 'teacher-1', status: 'conducting_conversation', audio_url: WHATSAPP, conversation_state: asked, created_at: hoursAgo(5) },
      { id: 'done', user_id: 'teacher-1', status: 'completed', audio_url: PORTAL('d'), created_at: hoursAgo(2) },
      { id: 'failed', user_id: 'teacher-1', status: 'failed', audio_url: PORTAL('f'), created_at: hoursAgo(2) },
      { id: 'stale', user_id: 'teacher-1', status: 'analyzing', audio_url: PORTAL('s'), created_at: hoursAgo(24 * 5) },
      { id: 'not-hers', user_id: 'teacher-2', status: 'analyzing', audio_url: PORTAL('x'), created_at: hoursAgo(1) },
    ];
  });

  it('lists her lessons still in flight, oldest first, and marks the ones waiting for her answer here', async () => {
    const { statusCode, payload } = await invoke('get', '/coaching-sessions/active');
    expect(statusCode).toBe(200);
    expect(payload.sessions.map((s) => s.id)).toEqual([
      'oldest-needs-answer', 'older-needs-answer', 'whatsapp-debrief', 'newest-analysing',
    ]);
    const byId = Object.fromEntries(payload.sessions.map((s) => [s.id, s]));
    expect(byId['oldest-needs-answer']).toMatchObject({ stage: 'reflection', source: 'portal', needsAnswer: true });
    expect(byId['older-needs-answer']).toMatchObject({ needsAnswer: true, topic: 'Fractions' });
    // A WhatsApp debrief is answered in her chat, never here.
    expect(byId['whatsapp-debrief']).toMatchObject({ source: 'whatsapp', needsAnswer: false });
    expect(byId['newest-analysing']).toMatchObject({ stage: 'analysing', needsAnswer: false });
  });

  it('is dark while the feature is off for her', async () => {
    tableRows.app_settings = [];
    const { statusCode } = await invoke('get', '/coaching-sessions/active');
    expect(statusCode).toBe(404);
  });

  it('requires a portal session', async () => {
    const { statusCode } = await invoke('get', '/coaching-sessions/active', { userId: null });
    expect(statusCode).toBe(401);
  });
});
