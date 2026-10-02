/**
 * bd-5rz1v.6.4 — a coach's observation of a teacher, as the TEACHER's portal
 * shows it.
 *
 * The row is the teacher's (user_id = her, observation_type
 * 'leader_observation', observer_user_id = the coach), so every teacher route
 * that reads her coaching_sessions reached it — including while it was still a
 * DRAFT the coach had not sent. The rule now, on every one of them: an
 * observation is hers to see only once the coach has sent her the report
 * (analysis_data.teacher_delivery.status = 'sent', what processTeacherReport
 * writes on delivery). Never the draft, the review, or the debrief.
 *
 * Once sent, the list says who observed her and when, and the lesson page
 * carries the report as WhatsApp delivered it: the image, its caption, the
 * companion text.
 */

let tableRows;

function pathValue(row, col) {
  const parts = String(col).split(/->>?/);
  let v = row[parts[0]];
  for (const p of parts.slice(1)) v = v && typeof v === 'object' ? v[p] : undefined;
  return v;
}

/** PostgREST slices: `alias:col->a->>b` puts that one value on the row under `alias`. */
function applySlices(row, cols) {
  const out = { ...row };
  for (const part of String(cols || '').split(',')) {
    const m = part.trim().match(/^(\w+):(\w+(?:->>?\w+)+)$/);
    if (!m) continue;
    const v = pathValue(row, m[2]);
    out[m[1]] = v === undefined ? null : v;
  }
  return out;
}

/** One `col.op.value` term of a PostgREST or=(…) filter. */
function term(t) {
  const m = t.match(/^(.+?)\.(is|eq|neq)\.(.+)$/);
  if (!m) throw new Error(`unsupported or-term ${t}`);
  const [, col, op, raw] = m;
  return (r) => {
    const v = pathValue(r, col);
    if (op === 'is') return raw === 'null' ? v === null || v === undefined : String(v) === raw;
    if (op === 'eq') return v !== null && v !== undefined && String(v) === raw;
    return v !== null && v !== undefined && String(v) !== raw; // SQL: NULL <> x is not true
  };
}

function makeChain(table) {
  const tests = [];
  let cols = '';
  let order = null;
  let cap = Infinity;
  const run = () => {
    let rows = (tableRows[table] || []).filter((r) => tests.every((t) => t(r)));
    if (order) rows = [...rows].sort((a, b) => (a[order.col] < b[order.col] ? -1 : 1) * (order.asc ? 1 : -1));
    return rows.slice(0, cap).map((r) => applySlices(r, cols));
  };
  const chain = {
    select: (c) => { cols = c || ''; return chain; },
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
    or: (expr) => { const ts = String(expr).split(',').map(term); tests.push((r) => ts.some((t) => t(r))); return chain; },
    gte: (c, v) => { tests.push((r) => r[c] >= v); return chain; },
    order: (col, opts = {}) => { order = { col, asc: opts.ascending !== false }; return chain; },
    limit: (n) => { cap = n; return chain; },
    range: (a, b) => { cap = b - a + 1; return chain; },
    maybeSingle: async () => ({ data: run()[0] || null, error: null }),
    single: async () => {
      const r = run()[0] || null;
      return { data: r, error: r ? null : { code: 'PGRST116', message: 'no rows' } };
    },
    then: (res, rej) => Promise.resolve({ data: run(), error: null, count: run().length }).then(res, rej),
  };
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method.toUpperCase()} ${path}`);
}

async function invoke(method, path, { userId = 'teacher-1', params = {}, query = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  const req = { session: { portalUserId: userId, id: 's' }, params, body: {}, query, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined };
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

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const SCORES = { overall_percentage: 61 };

function own(id, over = {}) {
  return {
    id, user_id: 'teacher-1', observation_type: null, observer_user_id: null, status: 'completed',
    created_at: hoursAgo(50), audio_duration_seconds: 1800,
    audio_url: 'https://r2.example/b/classroom_audio/teacher-1/2026-10/abc_1.ogg',
    analysis_data: { scores: SCORES, framework: 'fico', topic: 'Her own lesson' }, conversation_state: null,
    ...over,
  };
}

function observation(id, delivery, over = {}) {
  return own(id, {
    observation_type: 'leader_observation', observer_user_id: 'coach-1', created_at: hoursAgo(30),
    audio_url: `https://r2.example/b/classroom_audio/coach-1/2026-10/portal_${id}.webm`,
    analysis_data: {
      scores: SCORES, framework: 'fico', topic: 'Fractions',
      autofill_note: 'the v1 draft lives in autofill_analysis_data, never served',
      observer_debrief: { transcript: 'the coach and the teacher talking', feedback: { praise_line: 'for the coach only' } },
      ...(delivery ? { teacher_delivery: delivery } : {}),
    },
    ...over,
  });
}

const SENT = {
  status: 'sent', sent_at: hoursAgo(20), report_key: 'observe-reports/obs-sent.png',
  caption: 'Your lesson report 🌱 Prepared from Sana’s visit', companion_text: '📝 From Sana\n\nWe talked about pair work.',
  teacher_name: 'Ayesha Bibi', teacher_phone: '923120004471',
};

beforeEach(() => {
  jest.resetModules();
  process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
  process.env.R2_BUCKET_NAME = 'digital-coach-audio';
  tableRows = {
    app_settings: [{ key: 'portal_self_observation', value: true }],
    users: [{ id: 'coach-1', name: 'Sana Malik', phone_number: '923333232533' }, { id: 'teacher-1', name: 'Ayesha Bibi' }],
    coaching_sessions: [
      own('own-1'),
      observation('obs-sent', SENT),
      observation('obs-draft', null, { status: 'awaiting_observer_review' }),
      observation('obs-reviewed', null, { status: 'observer_review_complete' }),
      observation('obs-previewing', { status: 'awaiting_confirm', report_key: 'observe-reports/x.png' }, { status: 'observer_review_complete' }),
      observation('obs-tap', { status: 'awaiting_teacher_tap', template_sent_at: hoursAgo(5) }, { status: 'observer_review_complete' }),
      observation('obs-done-unsent', null, { status: 'completed' }),
    ],
  };
  jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(async (u) => `${u}?signed=1`),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn((u) => /r2\.cloudflarestorage\.com|r2\.example/.test(String(u || ''))),
  }));
  jest.doMock('../../dashboard/services/coaching-breakdown.service', () => ({ breakdown: jest.fn().mockResolvedValue(null) }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => jest.resetModules());

describe('GET /coaching-sessions — her list', () => {
  it('shows her own lessons and an observation the coach SENT her — nothing the coach has not', async () => {
    const { payload } = await invoke('get', '/coaching-sessions', { query: { limit: '100' } });
    expect(payload.sessions.map((s) => s.id).sort()).toEqual(['obs-sent', 'own-1']);
  });

  it('an observation row says who observed her, and when', async () => {
    const { payload } = await invoke('get', '/coaching-sessions', { query: { limit: '100' } });
    const obs = payload.sessions.find((s) => s.id === 'obs-sent');
    expect(obs.observation).toEqual({ observerName: 'Sana Malik', observedAt: expect.any(String), sentAt: SENT.sent_at });
    expect(payload.sessions.find((s) => s.id === 'own-1').observation).toBeNull();
  });
});

describe('GET /coaching-session/:id — the lesson page', () => {
  it.each(['obs-draft', 'obs-reviewed', 'obs-previewing', 'obs-tap', 'obs-done-unsent'])(
    'an observation not yet sent to her is not found (%s)', async (id) => {
      const { statusCode, payload } = await invoke('get', '/coaching-session/:id', { params: { id } });
      expect(statusCode).toBe(404);
      expect(JSON.stringify(payload)).not.toMatch(/for the coach only|coach and the teacher talking/);
    },
  );

  it('a sent observation carries the report as WhatsApp delivered it: image, caption, companion, who and when', async () => {
    const { statusCode, payload } = await invoke('get', '/coaching-session/:id', { params: { id: 'obs-sent' } });
    expect(statusCode).toBe(200);
    expect(payload.session.observation).toEqual({
      observerName: 'Sana Malik',
      observedAt: expect.any(String),
      sentAt: SENT.sent_at,
      reportImageUrl: 'https://acct.r2.cloudflarestorage.com/digital-coach-audio/observe-reports/obs-sent.png?signed=1',
      caption: SENT.caption,
      companionText: SENT.companion_text,
    });
    // Never the debrief: the coach's talk and her own feedback stay hers.
    expect(JSON.stringify(payload)).not.toMatch(/for the coach only|coach and the teacher talking/);
  });

  it('her own lesson has no observation block', async () => {
    const { payload } = await invoke('get', '/coaching-session/:id', { params: { id: 'own-1' } });
    expect(payload.session.observation).toBeNull();
  });
});

describe('GET /coaching-sessions/active and /coaching-session/:id/progress', () => {
  it('an observation in flight is never in her active list', async () => {
    tableRows.coaching_sessions.push(own('own-active', { status: 'transcribing', created_at: hoursAgo(1) }));
    const { payload } = await invoke('get', '/coaching-sessions/active');
    expect(payload.sessions.map((s) => s.id)).toEqual(['own-active']);
  });

  it('progress of an unsent observation is not found; a sent one is done', async () => {
    expect((await invoke('get', '/coaching-session/:id/progress', { params: { id: 'obs-reviewed' } })).statusCode).toBe(404);
    const sent = await invoke('get', '/coaching-session/:id/progress', { params: { id: 'obs-sent' } });
    expect(sent.statusCode).toBe(200);
    expect(sent.payload.stage).toBe('done');
  });

  it('a sent observation whose debrief is still open (not completed) is done for her too', async () => {
    tableRows.coaching_sessions.push(observation('obs-sent-open', SENT, { status: 'observer_review_complete' }));
    const p = await invoke('get', '/coaching-session/:id/progress', { params: { id: 'obs-sent-open' } });
    expect(p.payload.stage).toBe('done');
    expect((await invoke('get', '/coaching-session/:id', { params: { id: 'obs-sent-open' } })).statusCode).toBe(200);
  });
});
