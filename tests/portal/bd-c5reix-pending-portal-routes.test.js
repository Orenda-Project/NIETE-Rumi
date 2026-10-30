'use strict';
/**
 * bd-c5reix — the portal routes for a classroom recording kept from WhatsApp (D5, D8).
 *
 *   GET  /coaching-upload/pending           her saved WhatsApp recordings still waiting, from the bot
 *   POST /coaching-upload/check-duplicate   { sha256 } — has she sent these bytes before? (asked before an upload)
 *
 * As every coaching-upload route: the user is ALWAYS the session's (never the body's), the bot client is mocked, and
 * the routes are dark behind app_settings.portal_self_observation. The funnel (Axiom, the portal's own sink) gets a
 * row when waiting recordings are shown, when one is sent, and when a repeat is caught — joined on the journey id.
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

let tableRows;
let client;
let events;

function makeChain(table) {
  const tests = [];
  const run = () => (tableRows[table] || []).filter((r) => tests.every((t) => t(r)));
  const chain = {
    select: () => chain,
    eq: (c, v) => { tests.push((r) => r[c] === v); return chain; },
    in: (c, vs) => { tests.push((r) => vs.includes(r[c])); return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: run()[0] || null, error: null }),
    then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
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

async function invoke(method, path, { userId = 'teacher-1', body = {}, journey = null } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  const session = userId ? { portalUserId: userId, id: 'sess-1', ...(journey ? { appJourney: journey } : {}) } : null;
  const req = {
    session, params: {}, body, query: {}, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
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

const SAVED = 'classroom_audio/teacher-1/2026-10/portal_wa-0123456789abcdef-b2c3.ogg';
const JOURNEY = { id: 'j_0123456789abcdef', at: Date.now(), feature: 'ai_coaching' };

beforeEach(() => {
  jest.resetModules();
  tableRows = { app_settings: [{ key: 'portal_self_observation', value: true }] };
  events = [];
  client = {
    presignUpload: jest.fn(),
    startSession: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', coachingSessionId: 'cs-1' } }),
    pendingRecordings: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', recordings: [
      { key: SAVED, id: 'portal_wa-0123456789abcdef-b2c3', seconds: 1812, receivedAt: '2026-10-22T09:00:00Z', listenUrl: 'https://r2/get', duplicateOf: null },
    ] } }),
    checkDuplicate: jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', duplicateOf: null } }),
  };
  jest.doMock('../../dashboard/services/portal-coaching.client', () => client);
  jest.doMock('../../dashboard/services/telemetry.service', () => ({
    logEvent: (event, props) => events.push({ event, ...props }), flush: jest.fn(), isEnabled: () => true,
  }));
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

describe('GET /coaching-upload/pending', () => {
  it('relays her waiting recordings from the bot, for the SESSION user', async () => {
    const { statusCode, payload } = await invoke('get', '/coaching-upload/pending');
    expect(statusCode).toBe(200);
    expect(payload).toMatchObject({ success: true, recordings: [{ key: SAVED, seconds: 1812 }] });
    expect(client.pendingRecordings).toHaveBeenCalledWith({ userId: 'teacher-1' });
  });

  it('is dark while the feature is off for her', async () => {
    tableRows.app_settings = [];
    const { statusCode } = await invoke('get', '/coaching-upload/pending');
    expect(statusCode).toBe(404);
    expect(client.pendingRecordings).not.toHaveBeenCalled();
  });

  it('D8 — a funnel row when waiting recordings are shown, joined on the journey; none when there are none', async () => {
    await invoke('get', '/coaching-upload/pending', { journey: JOURNEY });
    expect(events).toEqual([expect.objectContaining({
      event: 'app_funnel.action', action: 'coaching.pending_shown', feature: 'ai_coaching',
      userId: 'teacher-1', journeyId: JOURNEY.id, count: 1, repeats: 0,
    })]);
    events = [];
    client.pendingRecordings.mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', recordings: [] } });
    await invoke('get', '/coaching-upload/pending');
    expect(events).toEqual([]);
  });

  it('a bot that cannot be reached is a 502, never an empty list', async () => {
    client.pendingRecordings.mockRejectedValue(new Error('ECONNREFUSED'));
    const { statusCode, payload } = await invoke('get', '/coaching-upload/pending');
    expect(statusCode).toBe(502);
    expect(payload.success).toBe(false);
  });
});

describe('POST /coaching-upload/check-duplicate', () => {
  it('asks the bot for the SESSION user, with the hash and nothing else', async () => {
    const sha = 'a'.repeat(64);
    const { statusCode } = await invoke('post', '/coaching-upload/check-duplicate', { body: { sha256: sha, userId: 'someone-else' } });
    expect(statusCode).toBe(200);
    expect(client.checkDuplicate).toHaveBeenCalledWith({ userId: 'teacher-1', sha256: sha });
  });

  it('D8 — a funnel row when a repeat is caught before an upload', async () => {
    client.checkDuplicate.mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', duplicateOf: { sessionId: 'cs-0', date: '2026-10-01' } } });
    const { payload } = await invoke('post', '/coaching-upload/check-duplicate', { body: { sha256: 'a'.repeat(64) }, journey: JOURNEY });
    expect(payload.duplicateOf).toEqual({ sessionId: 'cs-0', date: '2026-10-01' });
    expect(events).toEqual([expect.objectContaining({ action: 'coaching.duplicate_shown', where: 'upload', journeyId: JOURNEY.id })]);
  });

  it('is dark while the feature is off for her', async () => {
    tableRows.app_settings = [];
    expect((await invoke('post', '/coaching-upload/check-duplicate', { body: { sha256: 'a'.repeat(64) } })).statusCode).toBe(404);
    expect(client.checkDuplicate).not.toHaveBeenCalled();
  });
});

describe('POST /coaching-upload/start — a recording kept from WhatsApp', () => {
  it('D8 — sending a saved WhatsApp recording is its own funnel row; an upload is not', async () => {
    await invoke('post', '/coaching-upload/start', { body: { key: SAVED, photoKeys: [] }, journey: JOURNEY });
    expect(events).toEqual([expect.objectContaining({ action: 'coaching.pending_sent', feature: 'ai_coaching', journeyId: JOURNEY.id })]);
    events = [];
    await invoke('post', '/coaching-upload/start', { body: { key: 'classroom_audio/teacher-1/2026-10/portal_9f1e.webm', photoKeys: [] } });
    expect(events).toEqual([]);
  });

  it('a 409 already_sent is relayed as the bot answered it', async () => {
    client.startSession.mockResolvedValue({ httpStatus: 409, body: { success: false, status: 'already_sent', coachingSessionId: 'cs-first' } });
    const { statusCode, payload } = await invoke('post', '/coaching-upload/start', { body: { key: SAVED } });
    expect(statusCode).toBe(409);
    expect(payload).toMatchObject({ status: 'already_sent', coachingSessionId: 'cs-first' });
    expect(events).toEqual([]);
  });
});
