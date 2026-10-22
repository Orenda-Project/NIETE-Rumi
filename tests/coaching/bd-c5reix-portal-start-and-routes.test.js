'use strict';
/**
 * bd-c5reix — the app's side of a recording kept from WhatsApp.
 *
 *   AC6  Submit with a saved recording's key starts a portal session exactly as an upload does; the SAME key a second
 *        time is 409 already_sent with that session, and no second row
 *   D5   the bot's internal API: /coaching/pending and /coaching/check-duplicate, the user always the caller's,
 *        already_sent mapped to 409
 */

const PORTAL = '../../bot/shared/services/coaching/portal-coaching.service';
const WA = '../../bot/shared/services/coaching/whatsapp-recording.service';

const USER = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const SAVED = `classroom_audio/${USER}/2026-10/portal_wa-0123456789abcdef-b2c3d4e5-0000-4000-8000-000000000001.ogg`;
const url = (key) => `https://r2.example/bucket/${key}`;

/** Records inserts; `rows` answers awaited selects (filtered) and maybeSingle/single (first row of the table). */
function fakeSupabase(rows = {}) {
  const writes = { inserts: [] };
  const from = (table) => {
    const tests = [];
    const q = {};
    q.select = () => q;
    q.eq = (c, v) => { tests.push((r) => r[c] === v); return q; };
    q.or = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.insert = (row) => { writes.inserts.push({ table, row }); q._inserted = row; return q; };
    q.update = () => q;
    q.single = async () => {
      if (q._inserted) return { data: { id: 'cs-new', ...q._inserted }, error: null };
      const r = rows[table];
      return { data: Array.isArray(r) ? (r[0] || null) : (r ?? null), error: null };
    };
    q.maybeSingle = async () => {
      const r = rows[table];
      return { data: Array.isArray(r) ? null : (r ?? null), error: null };
    };
    q.then = (res, rej) => {
      const r = rows[table];
      const data = Array.isArray(r) ? r.filter((row) => tests.every((t) => t(row))) : null;
      return Promise.resolve({ data, error: null }).then(res, rej);
    };
    return q;
  };
  return { from, writes };
}

function deps(rows) {
  return {
    supabase: fakeSupabase({ users: { id: USER, phone_number: '+92300FIXTURE2' }, ...rows }),
    r2: {
      headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 9_000_000 }),
      buildR2PublicUrl: url,
    },
    queue: { queueTranscription: jest.fn().mockResolvedValue('msg-1') },
    now: () => new Date('2026-10-22T10:00:00Z'),
    newId: () => 'abc123',
    log: jest.fn(),
  };
}

describe('AC6 — Submit with a recording kept from WhatsApp', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(PORTAL); });

  test('starts a portal session with that key, exactly as an upload: confirmed, the R2 url, transcription queued', async () => {
    const d = deps({ coaching_sessions: [] });
    const out = await Svc.startPortalSession({ userId: USER, key: SAVED, teacherClass: { grade: 4, subject: 'General Science' } }, d);
    expect(out).toEqual({ status: 'ok', coachingSessionId: 'cs-new' });
    const ins = d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions');
    expect(ins.row).toMatchObject({ user_id: USER, audio_url: url(SAVED), audio_id: null, status: 'confirmed' });
    expect(Svc.isPortalTeacherSession({ ...ins.row, observation_type: null })).toBe(true);
    expect(d.queue.queueTranscription).toHaveBeenCalledWith('cs-new', { from: '+92300FIXTURE2' });
  });

  test('the same key again: 409 already_sent with the session that holds it, and no second row', async () => {
    const d = deps({ coaching_sessions: [{ id: 'cs-first', user_id: USER, audio_url: url(SAVED), status: 'analyzing' }] });
    const out = await Svc.startPortalSession({ userId: USER, key: SAVED }, d);
    expect(out).toEqual({ status: 'already_sent', coachingSessionId: 'cs-first' });
    expect(d.supabase.writes.inserts).toEqual([]);
    expect(d.queue.queueTranscription).not.toHaveBeenCalled();
  });

  test('another teacher\'s session with the same url does not count; the key itself must still be hers', async () => {
    const d = deps({ coaching_sessions: [{ id: 'cs-x', user_id: 'someone-else', audio_url: url(SAVED), status: 'completed' }] });
    expect((await Svc.startPortalSession({ userId: USER, key: SAVED }, d)).status).toBe('ok');
    expect(await Svc.startPortalSession({ userId: 'someone-else', key: SAVED }, deps({ coaching_sessions: [] })))
      .toEqual({ status: 'invalid', reason: 'not_your_upload' });
  });
});

describe('D5 — the bot\'s internal API for the waiting recordings', () => {
  function invoke(router, path, body) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
    if (!layer) throw new Error(`no POST ${path}`);
    const handlers = layer.route.stack.map((s) => s.handle);
    const req = { body, headers: { 'x-api-key': 'secret' }, path, ip: '127.0.0.1' };
    return new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      };
      const run = (i) => (i >= handlers.length ? resolve({ status: 404 }) : handlers[i](req, res, () => run(i + 1)));
      run(0);
    });
  }

  let router; let wa; let portal;
  const OLD = process.env.INTERNAL_API_KEY;
  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    wa = {
      pendingRecordings: jest.fn().mockResolvedValue({ status: 'ok', recordings: [{ key: SAVED }] }),
      checkDuplicate: jest.fn().mockResolvedValue({ status: 'ok', duplicateOf: null }),
    };
    portal = { startPortalSession: jest.fn().mockResolvedValue({ status: 'already_sent', coachingSessionId: 'cs-first' }) };
    jest.doMock(WA, () => wa);
    jest.doMock(PORTAL, () => portal);
    router = require('../../bot/shared/routes/internal-api.routes');
  });
  afterAll(() => { process.env.INTERNAL_API_KEY = OLD; });

  test('/coaching/pending answers the waiting list for the caller\'s user', async () => {
    const out = await invoke(router, '/coaching/pending', { userId: USER, extra: 'x' });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ success: true, recordings: [{ key: SAVED }] });
    expect(wa.pendingRecordings).toHaveBeenCalledWith({ userId: USER });
  });

  test('/coaching/check-duplicate passes the hash and the user, nothing else', async () => {
    const out = await invoke(router, '/coaching/check-duplicate', { userId: USER, sha256: 'a'.repeat(64), other: 1 });
    expect(out.status).toBe(200);
    expect(wa.checkDuplicate).toHaveBeenCalledWith({ userId: USER, sha256: 'a'.repeat(64) });
  });

  test('a start that was already sent is a 409 the portal can read', async () => {
    const out = await invoke(router, '/coaching/start', { userId: USER, key: SAVED });
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ success: false, status: 'already_sent', coachingSessionId: 'cs-first' });
  });
});
