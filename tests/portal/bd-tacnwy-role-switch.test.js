'use strict';
/**
 * bd-tacnwy — internal staff switch their OWN profile type (users.role) from the portal.
 *
 *   POST /api/portal/me/role   { role: 'teacher' | 'coach' | 'principal' }
 *
 * Who: only a users.id named on app_settings.portal_role_switch, a LIST and nothing else. true, "true",
 * "teachers", an object or bad JSON is nobody (fail closed), and so is a failed read. Everyone else gets
 * 404, exactly as if the route did not exist, and /config says roleSwitch: false.
 *
 * What one switch does:
 *   - one users write, through a client that sends x-rumi-actor = her own id, so the record_history
 *     trigger names HER (not 'authenticator') with the old and new role;
 *   - the same write clears conversation_state, so the bot starts her next message clean;
 *   - the bot's per-user Redis waits (menu reply, surveys, reading test, observe questions, …) are
 *     deleted; her parked recordings are NOT (they hold audio she made, and expire on their own);
 *   - one portal_role_switch event with from, to and a correlation id.
 *
 * Only the network is faked: the shared Supabase client (an in-memory PostgREST), the Supabase client
 * constructor (so the actor header it is built with can be read), the Redis client and the Axiom sink.
 * The real route, feature-flags and service code run.
 */
const { createFakePostgrest } = require('./helpers/fake-postgrest');

const ME = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const OTHER = '11111111-1111-4111-8111-111111111111';

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && (layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function run(stack, req) {
  let statusCode = 200; let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (advanced === false) resolve();
    });
  }
  return { statusCode, payload };
}

function request({ userId = ME, body = {} } = {}) {
  return {
    session: userId ? { portalUserId: userId, id: 's' } : null,
    query: {}, params: {}, body, method: 'POST', path: '/me/role', headers: {}, ip: '127.0.0.1', get: () => undefined,
  };
}

async function postRole(opts) {
  const router = require('../../dashboard/routes/portal-role-switch.routes');
  const stack = findRoute(router, 'post', '/me/role');
  if (!stack) throw new Error('POST /me/role not found');
  return run(stack, request(opts));
}

let fake; let listValue; let failListRead; let actorClients; let redis; let events; let writeError;

function usersRow(id, role) {
  return {
    id, role, deleted_at: null,
    conversation_state: { flow: 'lesson_plan', step: 'grade' },
    conversation_state_expires_at: '2026-11-03T12:00:00.000Z',
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.FLAG_CACHE_TTL_MS = '0';

  listValue = [ME];
  failListRead = false;
  writeError = null;
  fake = createFakePostgrest({ tables: { users: [usersRow(ME, 'teacher'), usersRow(OTHER, 'teacher')] } });

  // The shared service-role client: app_settings is answered here; everything else is the fake.
  const shared = {
    from(table) {
      if (table === 'app_settings') {
        const b = {
          select: () => b, eq: () => b,
          maybeSingle: async () => {
            if (failListRead) return { data: null, error: { message: 'connection reset' } };
            if (listValue === undefined) return { data: null, error: null };
            return { data: { value: listValue }, error: null };
          },
        };
        return b;
      }
      return fake.from(table);
    },
  };
  jest.doMock('../../dashboard/config/supabase', () => shared);

  // The per-request client: what it was built with, and every table it touched.
  actorClients = [];
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn((url, key, opts) => {
      const client = {
        url, key, opts, tables: [],
        from(table) {
          client.tables.push(table);
          const b = fake.from(table);
          if (!writeError) return b;
          // PostgREST refuses the statement: every chained call stays on the refusing builder, which resolves to the
          // error and changes nothing.
          const failing = new Proxy(b, {
            get(target, prop) {
              if (prop === 'then') return (resolve) => Promise.resolve({ data: null, error: writeError }).then(resolve);
              const v = target[prop];
              return typeof v === 'function' ? () => failing : v;
            },
          });
          return failing;
        },
      };
      actorClients.push(client);
      return client;
    }),
  }));

  // Redis: the portal's shared client (lib/edge-redis), as node-redis v4 answers DEL.
  const store = new Map([
    [`user:${ME}:awaiting_menu_selection`, '{}'],
    [`reading:user:${ME}:current_assessment`, '{}'],
    [`observe:who:${ME}`, '{}'],
    [`observe:parked:${ME}`, '[{"mediaId":"m1"}]'],
    [`media:parked:${ME}`, '{"mediaId":"m2"}'],
    [`user:${OTHER}:awaiting_menu_selection`, '{}'],
  ]);
  redis = {
    isReady: true,
    store,
    del: jest.fn(async (key) => (store.delete(key) ? 1 : 0)),
  };
  require('../../dashboard/lib/edge-redis').setClient(redis);

  events = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({
    logEvent: (event, data) => events.push({ event, ...data }), flush: () => {}, isEnabled: () => true,
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.FLAG_CACHE_TTL_MS;
});

const userRow = (id) => fake.db.users.find((u) => u.id === id);
const wrote = () => fake.queries.some((q) => q.op === 'update');

// ── who may switch: the list, fail closed ─────────────────────────────────────────────────────

describe('isRoleSwitchUser (app_settings.portal_role_switch, list-only)', () => {
  const flags = () => require('../../dashboard/lib/feature-flags');
  const shared = () => require('../../dashboard/config/supabase');

  test('a users.id on the list is in; one that is not, or no user, is out', async () => {
    const { isRoleSwitchUser, PORTAL_ROLE_SWITCH_KEY } = flags();
    expect(PORTAL_ROLE_SWITCH_KEY).toBe('portal_role_switch');
    expect(await isRoleSwitchUser(shared(), ME)).toBe(true);
    expect(await isRoleSwitchUser(shared(), OTHER)).toBe(false);
    expect(await isRoleSwitchUser(shared(), null)).toBe(false);
  });

  test.each([
    ['true', true],
    ['"true"', 'true'],
    ['"teachers"', 'teachers'],
    ['an object', { [ME]: true }],
    ['bad JSON text', '[not json'],
    ['a number', 1],
    ['an empty list', []],
  ])('%s is nobody: a broadcast or malformed row never opens it', async (_label, value) => {
    listValue = value;
    expect(await flags().isRoleSwitchUser(shared(), ME)).toBe(false);
  });

  test('the list written as JSON text still works', async () => {
    listValue = JSON.stringify([ME]);
    expect(await flags().isRoleSwitchUser(shared(), ME)).toBe(true);
  });

  test('no row, or a failed read, is nobody', async () => {
    listValue = undefined;
    expect(await flags().isRoleSwitchUser(shared(), ME)).toBe(false);
    listValue = [ME];
    failListRead = true;
    expect(await flags().isRoleSwitchUser(shared(), ME)).toBe(false);
  });

  test('the three roles on offer are the ones users.role allows, minus unregistered', () => {
    expect(flags().ROLE_SWITCH_ROLES).toEqual(['teacher', 'coach', 'principal']);
  });
});

// ── the route ─────────────────────────────────────────────────────────────────────────────────

describe('POST /me/role — who reaches it', () => {
  test('signed out: 401, nothing written', async () => {
    const r = await postRole({ userId: null, body: { role: 'coach' } });
    expect(r.statusCode).toBe(401);
    expect(wrote()).toBe(false);
    expect(redis.del).not.toHaveBeenCalled();
  });

  test('a real teacher (not on the list): 404 as if there were no route, nothing written', async () => {
    const r = await postRole({ userId: OTHER, body: { role: 'coach' } });
    expect(r.statusCode).toBe(404);
    expect(r.payload).toEqual({ success: false, error: 'Not found' });
    expect(wrote()).toBe(false);
    expect(actorClients).toHaveLength(0);
    expect(redis.del).not.toHaveBeenCalled();
    expect(userRow(OTHER).role).toBe('teacher');
  });

  test.each([['true', true], ['"teachers"', 'teachers'], ['malformed', '{oops']])(
    'list row %s: 404 for everyone, nothing written', async (_l, value) => {
      listValue = value;
      const r = await postRole({ body: { role: 'coach' } });
      expect(r.statusCode).toBe(404);
      expect(wrote()).toBe(false);
    },
  );

  test('the list cannot be read: 404, nothing written', async () => {
    failListRead = true;
    const r = await postRole({ body: { role: 'coach' } });
    expect(r.statusCode).toBe(404);
    expect(wrote()).toBe(false);
  });
});

describe('POST /me/role — what it accepts', () => {
  test.each([['aeo'], ['supervisor'], ['unregistered'], [''], [null], [42], ['Coach; drop table users']])(
    'role %p: 400, nothing written', async (role) => {
      const r = await postRole({ body: { role } });
      expect(r.statusCode).toBe(400);
      expect(r.payload).toEqual({ success: false, error: 'That profile type is not available.', roles: ['teacher', 'coach', 'principal'] });
      expect(wrote()).toBe(false);
      expect(redis.del).not.toHaveBeenCalled();
    },
  );

  test('no body: 400', async () => {
    const r = await postRole({ body: undefined });
    expect(r.statusCode).toBe(400);
    expect(wrote()).toBe(false);
  });

  test('case and spaces are forgiven: " Coach " is coach', async () => {
    const r = await postRole({ body: { role: ' Coach ' } });
    expect(r.statusCode).toBe(200);
    expect(userRow(ME).role).toBe('coach');
  });

  test('the same role again: 200, changed false, nothing written, nothing cleared', async () => {
    const r = await postRole({ body: { role: 'teacher' } });
    expect(r.statusCode).toBe(200);
    expect(r.payload).toEqual({ success: true, changed: false, role: 'teacher' });
    expect(wrote()).toBe(false);
    expect(redis.del).not.toHaveBeenCalled();
    expect(userRow(ME).conversation_state).not.toBeNull();
  });

  test('always her own row: a userId in the body is ignored', async () => {
    const r = await postRole({ body: { role: 'coach', userId: OTHER } });
    expect(r.statusCode).toBe(200);
    expect(userRow(ME).role).toBe('coach');
    expect(userRow(OTHER).role).toBe('teacher');
  });
});

describe('POST /me/role — one switch', () => {
  test('teacher → coach: role written, conversation state cleared, as HER (x-rumi-actor)', async () => {
    const r = await postRole({ body: { role: 'coach' } });
    expect(r.statusCode).toBe(200);
    expect(r.payload).toEqual(expect.objectContaining({ success: true, changed: true, from: 'teacher', to: 'coach' }));

    const row = userRow(ME);
    expect(row.role).toBe('coach');
    expect(row.conversation_state).toBeNull();
    expect(row.conversation_state_expires_at).toBeNull();

    // ONE write, on her row only, with exactly these three columns…
    const updates = fake.queries.filter((q) => q.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('users');
    expect(updates[0].patch).toEqual({ role: 'coach', conversation_state: null, conversation_state_expires_at: null });
    expect(updates[0].filters).toEqual([{ kind: 'eq', col: 'id', val: ME }]);

    // …made through a client that carries her id as the actor, so record_history names her.
    expect(actorClients).toHaveLength(1);
    expect(actorClients[0].opts.global.headers['x-rumi-actor']).toBe(ME);
    expect(actorClients[0].tables).toEqual(['users']);
    expect(actorClients[0].url).toBe('https://example.supabase.co');
    expect(actorClients[0].opts.auth).toEqual(expect.objectContaining({ persistSession: false, autoRefreshToken: false }));
  });

  test('the bot\'s Redis waits for her are deleted; her parked recordings and other users\' keys are not', async () => {
    const r = await postRole({ body: { role: 'coach' } });
    expect(r.statusCode).toBe(200);
    const asked = redis.del.mock.calls.map((c) => c[0]);
    for (const k of [
      `user:${ME}:awaiting_menu_selection`, `user:${ME}:expecting:recovery`, `user:${ME}:stuck:reminder`,
      `reading:user:${ME}:current_assessment`, `reading:user:${ME}:student_count`,
      `lp_feedback_pending:${ME}`, `lp612_feedback_pending:${ME}`, `coaching_feedback_pending:${ME}`,
      `student_video_feedback_pending:${ME}`, `quiz_intent_pending:${ME}`, `pending_quiz_resume:${ME}`,
      `quiz:awaiting_next_topic:${ME}`, `observe:state:${ME}`, `observe:who:${ME}`, `observe:who-typed:${ME}`,
      `media:target:${ME}`, `ctst:state:${ME}`,
    ]) expect(asked).toContain(k);
    expect(asked.every((k) => k.includes(ME))).toBe(true);
    expect(asked).not.toContain(`observe:parked:${ME}`);
    expect(asked).not.toContain(`media:parked:${ME}`);
    expect(redis.store.has(`observe:parked:${ME}`)).toBe(true);
    expect(redis.store.has(`media:parked:${ME}`)).toBe(true);
    expect(redis.store.has(`user:${OTHER}:awaiting_menu_selection`)).toBe(true);
    // the answer names the ones that were there
    expect(r.payload.cleared.sort()).toEqual([
      `observe:who:${ME}`, `reading:user:${ME}:current_assessment`, `user:${ME}:awaiting_menu_selection`,
    ].sort());
  });

  test('one portal_role_switch event: from, to, her id and a correlation id', async () => {
    const r = await postRole({ body: { role: 'principal' } });
    expect(r.statusCode).toBe(200);
    const ev = events.filter((e) => e.event === 'portal_role_switch');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toEqual(expect.objectContaining({ userId: ME, from: 'teacher', to: 'principal', redisCleared: 3 }));
    expect(ev[0].correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.payload.correlationId).toBe(ev[0].correlationId);
  });

  test('with Redis down the switch still lands (the bot state in the database is the one that matters)', async () => {
    require('../../dashboard/lib/edge-redis').setClient(null);
    const r = await postRole({ body: { role: 'coach' } });
    expect(r.statusCode).toBe(200);
    expect(userRow(ME).role).toBe('coach');
    expect(r.payload.cleared).toEqual([]);
    expect(r.payload.redis).toBe(false);
  });

  test('a failed write: 502, success false, Redis untouched, no switch event', async () => {
    writeError = { message: 'new row violates check constraint' };
    const r = await postRole({ body: { role: 'coach' } });
    expect(r.statusCode).toBe(502);
    expect(r.payload).toEqual({ success: false, error: 'Could not switch your profile. Please try again.' });
    expect(redis.del).not.toHaveBeenCalled();
    expect(events.filter((e) => e.event === 'portal_role_switch')).toHaveLength(0);
  });

  test('her users row is gone: the sign-in check ends the session (401), nothing written', async () => {
    fake.db.users = fake.db.users.filter((u) => u.id !== ME);
    const r = await postRole({ body: { role: 'coach' } });
    expect(r.statusCode).toBe(401); // portal-auth: no row is a retired account
    expect(wrote()).toBe(false);
  });
});

describe('the route file is mounted once at /api/portal', () => {
  test('dashboard/index.js mounts portal-role-switch.routes exactly once', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../dashboard/index.js'), 'utf8');
    const lines = src.split('\n').filter((l) => l.includes('portal-role-switch.routes'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/app\.use\('\/api\/portal',/);
  });
});

// ── /config tells the portal whether to draw the control ──────────────────────────────────────

describe('GET /config → features.roleSwitch', () => {
  async function getConfig(userId) {
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
    }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
    const router = require('../../dashboard/routes/portal.routes');
    const stack = findRoute(router, 'get', '/config');
    const req = { ...request({ userId }), method: 'GET', path: '/config', session: userId ? { portalUserId: userId, id: 's' } : {} };
    return run(stack, req);
  }

  test('listed: roleSwitch true and the three roles', async () => {
    const r = await getConfig(ME);
    expect(r.payload.features.roleSwitch).toBe(true);
    expect(r.payload.roleSwitchRoles).toEqual(['teacher', 'coach', 'principal']);
  });

  test('not listed, or signed out: roleSwitch false and no roles', async () => {
    for (const who of [OTHER, null]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await getConfig(who);
      expect(r.payload.features.roleSwitch).toBe(false);
      expect(r.payload.roleSwitchRoles).toEqual([]);
    }
  });
});
