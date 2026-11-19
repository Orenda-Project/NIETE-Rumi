/**
 * GET /api/portal/config carries the three portal switches of the lesson plan in the app and the activity Home, for
 * the signed-in user (lib/lp-app-switches.js):
 *   features.lpFeedbackBar        portal_lp_feedback_bar, riding with the teacher app (portal_teacher_v2)
 *   features.teacherHomeActivity  portal_teacher_home_activity, riding with the Home card (portal_teacher_home_card,
 *                                 the guard of GET /me/home that carries the numbers)
 *   features.teacherJourney       portal_teacher_journey as it reads for her (the teacher page, and the team view for
 *                                 an analytics account, which is not on the teacher app)
 * Absent, any other value, logged out, or the error fallback → false.
 */
process.env.FLAG_CACHE_TTL_MS = '0';

let settings = {};
let roles = {};

function makeChain(table) {
  let key = null;
  const chain = {
    select: () => chain,
    eq: (_col, val) => { key = val; return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      if (table === 'app_settings') {
        return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
      }
      if (table === 'users' && Object.prototype.hasOwnProperty.call(roles, key)) return { data: { role: roles[key] }, error: null };
      return { data: null, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method} ${path}`);
}

async function getConfig({ userId = 'teacher-1', sessionThrows = false } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'get', '/config');
  const req = {
    params: {}, body: {}, query: {}, method: 'GET', path: '/config', ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  if (sessionThrows) {
    Object.defineProperty(req, 'session', { get() { throw new Error('session store down'); } });
  } else {
    req.session = userId ? { portalUserId: userId, id: 's' } : {};
  }
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const h of stack) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await h(req, res, () => { next = true; });
      if (!next) break;
    }
  } finally {
    errors.mockRestore();
  }
  return { statusCode, payload };
}



describe('GET /config — the lesson-plan-in-app and activity Home switches', () => {
  beforeEach(() => {
    jest.resetModules();
    settings = {};
    roles = {};
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
    }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  });
  afterEach(() => jest.resetModules());

  const feats = async (opts) => (await getConfig(opts)).payload.features;

  test('all three absent → real false', async () => {
    settings.portal_teacher_v2 = true;
    settings.portal_teacher_home_card = true;
    expect(await feats()).toMatchObject({ lpFeedbackBar: false, teacherHomeActivity: false, teacherJourney: false });
  });

  test('true or a list naming her → on (with their hosts on); a list without her → off', async () => {
    settings.portal_teacher_v2 = true;
    settings.portal_teacher_home_card = true;
    settings.portal_lp_feedback_bar = ['teacher-1'];
    settings.portal_teacher_home_activity = true;
    settings.portal_teacher_journey = ['teacher-1'];
    expect(await feats()).toMatchObject({ lpFeedbackBar: true, teacherHomeActivity: true, teacherJourney: true });
    expect(await feats({ userId: 'teacher-2' })).toMatchObject({ lpFeedbackBar: false, teacherJourney: false });
  });

  test('any other value is off', async () => {
    settings.portal_teacher_v2 = true;
    settings.portal_teacher_home_card = true;
    for (const v of [false, 'yes', 1, { on: true }, null, '[bad']) {
      settings.portal_lp_feedback_bar = v;
      settings.portal_teacher_home_activity = v;
      settings.portal_teacher_journey = v;
      // eslint-disable-next-line no-await-in-loop
      expect(await feats()).toMatchObject({ lpFeedbackBar: false, teacherHomeActivity: false, teacherJourney: false });
    }
  });

  test('the bar rides with the teacher app, the activity block with the Home card', async () => {
    settings.portal_lp_feedback_bar = true;
    settings.portal_teacher_home_activity = true;
    expect(await feats()).toMatchObject({ lpFeedbackBar: false, teacherHomeActivity: false });
    settings.portal_teacher_v2 = true;
    expect(await feats()).toMatchObject({ lpFeedbackBar: true, teacherHomeActivity: false });
  });

  test('the journey switch answers for an account that is not on the teacher app (the team view)', async () => {
    settings.portal_teacher_journey = ['analytics-1'];
    expect((await feats({ userId: 'analytics-1' })).teacherJourney).toBe(true);
  });

  test('logged out → false', async () => {
    settings.portal_teacher_v2 = true;
    settings.portal_teacher_home_card = true;
    settings.portal_lp_feedback_bar = true;
    settings.portal_teacher_home_activity = true;
    settings.portal_teacher_journey = true;
    expect(await feats({ userId: null })).toMatchObject({ lpFeedbackBar: false, teacherHomeActivity: false, teacherJourney: false });
  });

  test('the error fallback says false for all three', async () => {
    settings.portal_teacher_v2 = true;
    settings.portal_lp_feedback_bar = true;
    settings.portal_teacher_home_activity = true;
    settings.portal_teacher_journey = true;
    expect(await feats({ sessionThrows: true })).toMatchObject({ lpFeedbackBar: false, teacherHomeActivity: false, teacherJourney: false });
  });
});
