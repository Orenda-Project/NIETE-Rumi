/**
 * A portal session whose account has been retired is signed out, on every portal router.
 *
 * REPORTED: a coach changed a teacher's number (Manage teachers). The number moved onto his original account, and a
 * second account that held the new number was retired (users.deleted_at set, phone renamed `merged:<id>`). But his
 * phone was already signed in to the app AS that second account. The sign-in check only asked "is there a
 * portalUserId in the session?", never "is that account still live?", and the session rolls 30 days from the last
 * visit. So the app kept serving the retired, empty account: no certificates, training from scratch, and every class
 * and lesson-plan open he made since landed on a row nobody reads.
 *
 * THE RULE (one check, dashboard/lib/portal-auth.js, used by every portal router):
 *   - no portalUserId in the session          → 401 (as before)
 *   - the session's users row has deleted_at  → the session is destroyed, 401 (the app shows sign-in, and the
 *     or the row is gone                         WhatsApp code on the new number lands on the surviving account)
 *   - the lookup fails (DB blip)              → FAIL OPEN: the request goes on, and the failure is logged. A DB
 *                                               hiccup must not sign every teacher out at once.
 *   - the answer is held for 30 s per user, so this is not one more DB read on every request.
 *
 * Real: the portal router (GET /training/certificates) and the shared check. Faked: the dashboard Supabase client.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LIVE = 'user-live-1';
const RETIRED = 'user-retired-1';
const GONE = 'user-gone-1';

let usersRows;
let usersReads;
let usersFailure;
let listCertificates;
let logSpy;
let errSpy;

function fakeSupabase() {
  return {
    from: jest.fn((table) => {
      if (table !== 'users') return undefined;
      let id = null;
      const chain = {
        select() { return chain; },
        eq(col, v) { if (col === 'id') id = v; return chain; },
        async maybeSingle() {
          usersReads += 1;
          if (usersFailure === 'throw') throw new Error('connection reset');
          if (usersFailure === 'error') return { data: null, error: { message: 'upstream timeout' } };
          const row = usersRows.find((r) => r.id === id);
          return { data: row ? { ...row } : null, error: null };
        },
      };
      return chain;
    }),
    rpc: jest.fn().mockResolvedValue({ error: null }),
  };
}

beforeEach(() => {
  jest.resetModules();
  usersRows = [
    { id: LIVE, deleted_at: null },
    { id: RETIRED, deleted_at: '2026-10-19T08:29:40Z', deleted_reason: 'phone_change_merge' },
  ];
  usersReads = 0;
  usersFailure = null;
  listCertificates = jest.fn().mockResolvedValue([]);
  jest.doMock('../../dashboard/config/supabase', () => fakeSupabase());
  jest.doMock('../../dashboard/services/certificates.service', () => ({ listCertificates, getCertificatePdf: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush: jest.fn(), isEnabled: () => true }));
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  jest.resetModules();
});

function session(userId) {
  return {
    id: 'sess-1',
    portalUserId: userId,
    destroy: jest.fn((cb) => { if (cb) cb(); }),
  };
}

/** Runs a route's handler stack the way Express does: each handler gets `next`, an async one is awaited. */
async function run(stack, req) {
  let statusCode = 200;
  let payload = null;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { payload = b; return this; },
    set() { return this; },
  };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

function certificatesStack() {
  const routes = require('../../dashboard/routes/portal.routes');
  const layer = routes.stack.find((l) => l.route && l.route.path === '/training/certificates' && l.route.methods.get);
  if (!layer) throw new Error('GET /training/certificates not found on the portal router');
  return layer.route.stack.map((s) => s.handle);
}

const request = (sess) => ({
  session: sess, method: 'GET', path: '/training/certificates', ip: '127.0.0.1',
  params: {}, query: {}, body: {}, headers: {}, get: () => undefined,
});

describe('GET /api/portal/training/certificates with a retired account in the session', () => {
  test('a retired account (deleted_at set): 401, the session is destroyed, and no certificate read happens', async () => {
    const sess = session(RETIRED);
    const out = await run(certificatesStack(), request(sess));
    expect(out.statusCode).toBe(401);
    expect(out.payload).toMatchObject({ success: false });
    expect(sess.destroy).toHaveBeenCalledTimes(1);
    expect(listCertificates).not.toHaveBeenCalled();
  });

  test('an account whose row is gone: 401 and the session is destroyed', async () => {
    const sess = session(GONE);
    const out = await run(certificatesStack(), request(sess));
    expect(out.statusCode).toBe(401);
    expect(sess.destroy).toHaveBeenCalledTimes(1);
    expect(listCertificates).not.toHaveBeenCalled();
  });

  test('a live account goes through, reading as the session user', async () => {
    const sess = session(LIVE);
    const out = await run(certificatesStack(), request(sess));
    expect(out.statusCode).toBe(200);
    expect(sess.destroy).not.toHaveBeenCalled();
    expect(listCertificates).toHaveBeenCalledWith(LIVE);
  });

  test('no session user at all: 401, exactly as before, with no users read', async () => {
    const out = await run(certificatesStack(), request({ id: 'sess-2' }));
    expect(out.statusCode).toBe(401);
    expect(usersReads).toBe(0);
  });
});

describe('fail open: a failed lookup never signs anyone out', () => {
  test('the lookup answers an error: the request goes on, and the failure is logged', async () => {
    usersFailure = 'error';
    const sess = session(RETIRED);
    const out = await run(certificatesStack(), request(sess));
    expect(out.statusCode).toBe(200);
    expect(sess.destroy).not.toHaveBeenCalled();
    const logged = [...errSpy.mock.calls, ...logSpy.mock.calls].map((c) => c.map(String).join(' ')).join('\n');
    expect(logged).toMatch(/portal auth/i);
  });

  test('the lookup throws: the request goes on', async () => {
    usersFailure = 'throw';
    const sess = session(LIVE);
    const out = await run(certificatesStack(), request(sess));
    expect(out.statusCode).toBe(200);
    expect(sess.destroy).not.toHaveBeenCalled();
  });
});

describe('the answer is cached per user, so this is not a DB read on every request', () => {
  test('three requests from one live user inside the cache window: one users read', async () => {
    const stack = certificatesStack();
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await run(stack, request(session(LIVE)))).statusCode).toBe(200);
    }
    expect(usersReads).toBe(1);
  });

  test('a failed lookup is not held for the full window: it is asked again once the short failure hold ends', async () => {
    const auth = require('../../dashboard/lib/portal-auth');
    usersFailure = 'error';
    expect(await auth.accountState(LIVE)).toBe('unknown');
    expect(auth.ACCOUNT_FAILURE_TTL_MS).toBeLessThan(auth.ACCOUNT_CACHE_TTL_MS);
    expect(auth.ACCOUNT_CACHE_TTL_MS).toBe(30_000);
  });
});

describe('ONE check, on every portal router', () => {
  test('the FLN gate is the shared check, not a copy', () => {
    const shared = require('../../dashboard/lib/portal-auth').requirePortalAuth;
    expect(require('../../dashboard/lib/fln-access').requirePortalAuth).toBe(shared);
  });

  test('the FLN gate signs out a retired account too', async () => {
    const { requireFln } = require('../../dashboard/lib/fln-access');
    const sess = session(RETIRED);
    const out = await run(requireFln.lessons, request(sess));
    expect(out.statusCode).toBe(401);
    expect(sess.destroy).toHaveBeenCalled();
  });

  test('no portal router or lib defines its own session-only sign-in check', () => {
    const dirs = ['dashboard/routes', 'dashboard/lib'];
    const offenders = [];
    for (const dir of dirs) {
      for (const f of fs.readdirSync(path.join(ROOT, dir))) {
        if (!f.endsWith('.js') || f === 'portal-auth.js') continue;
        const src = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
        if (/function\s+requirePortalAuth\s*\(|(const|let|var)\s+requirePortalAuth\s*=\s*(async\s*)?\(/.test(src)) {
          offenders.push(`${dir}/${f}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test.each([
    'attendance', 'hcp', 'portal-child-test', 'training-library', 'portal-coachip', 'portal-share',
    'portal-teacher-attendance', 'portal-teacher-coaching', 'portal-teacher-home', 'portal-teacher-lessons',
    'portal-teacher-notices', 'portal-teacher-thing-to-try', 'portal',
  ])('%s.routes.js takes requirePortalAuth from lib/portal-auth', (name) => {
    const src = fs.readFileSync(path.join(ROOT, 'dashboard/routes', `${name}.routes.js`), 'utf8');
    expect(src).toMatch(/require\(['"]\.\.\/lib\/portal-auth['"]\)/);
  });
});
