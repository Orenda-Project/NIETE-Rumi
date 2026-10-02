/**
 * The portal names a person ONCE — "Welcome back, Hataf Atif!", not
 * "Welcome back, Hataf Atif Hataf Atif!".
 *
 * `users.name` is the only name column since V1.4.4 dropped first_name /
 * last_name (bd-60092). The portal payloads were swept mechanically to
 * `firstName: user.name, lastName: user.name`, and the frontend joins the two
 * (PortalDashboard greeting, PortalSetup "Name:" line), so the whole name was
 * printed twice. bd-60105 fixed the same doubled-column shape in the dashboard
 * services; these sites were missed.
 *
 * `firstName` keeps carrying the whole name — the nav chip and the leader
 * greeting read it alone and already show the full name in production — and
 * `lastName` is null, because there is no surname column to fill it from.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  phone_number: '923001234567',
  portal_activated: false,
  name: 'Hataf Atif',
};
const TOKEN = '22222222-2222-4222-8222-222222222222';

// How the portal frontend renders the pair: join the non-empty parts.
const rendered = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ');

function supabaseReturning(row) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: row, error: null }),
  };
  return { from: () => chain, rpc: jest.fn().mockResolvedValue({ error: null }) };
}

const unexpiredRow = () => ({
  ...ROW,
  portal_invite_expires_at: new Date(Date.now() + 86400000).toISOString(),
});

beforeEach(() => jest.resetModules());
afterEach(() => jest.resetModules());

describe('the dashboard payload (greeting on the teacher dashboard)', () => {
  const { publicUserPayload } = require('../../dashboard/lib/leader-role');

  test('renders the name once', () => {
    const dash = publicUserPayload(ROW, { includeContact: true });
    expect(rendered(dash)).toBe('Hataf Atif');
    expect(dash.firstName).toBe('Hataf Atif');
    expect(dash.lastName).toBeNull();
  });
});

describe('POST /validate-token (the portal setup screen)', () => {
  async function validate() {
    jest.doMock('../../dashboard/config/supabase', () => supabaseReturning(unexpiredRow()));
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn().mockResolvedValue(null),
      generatePresignedUrls: jest.fn().mockResolvedValue([]),
      isValidR2Url: jest.fn().mockReturnValue(true),
    }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });

    const router = require('../../dashboard/routes/portal.routes');
    const layer = router.stack.find((l) => l.route && l.route.path === '/validate-token' && l.route.methods.post);
    if (!layer) throw new Error('Route POST /validate-token not found');
    const handlers = layer.route.stack.map((s) => s.handle);

    let statusCode = 200;
    let body = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { body = b; return this; },
    };
    // The last handler is the route body; the ones before it are middleware.
    await handlers[handlers.length - 1]({ body: { token: TOKEN }, headers: {}, get: () => undefined }, res);
    return { statusCode, body };
  }

  test('renders the name once', async () => {
    const { statusCode, body } = await validate();
    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(rendered(body.user)).toBe('Hataf Atif');
    expect(body.user.lastName).toBeNull();
    expect(body.user.phoneNumber).toBe('923001234567');
  });
});

describe('PortalInviteService.validateToken (bot side, same mapper)', () => {
  test('renders the name once', async () => {
    jest.doMock('../../bot/shared/config/supabase', () => supabaseReturning(unexpiredRow()));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({}));
    jest.doMock('uuid', () => ({ v4: () => TOKEN }), { virtual: true });

    const PortalInviteService = require('../../bot/shared/services/portal-invite.service');
    const out = await PortalInviteService.validateToken(TOKEN);

    expect(out.valid).toBe(true);
    expect(rendered(out.user)).toBe('Hataf Atif');
    expect(out.user.lastName).toBeNull();
  });
});

describe('no `${x.name} ${x.name}` left in the dashboard', () => {
  // The transcript-download header, the broadcast user search, and the
  // transcript backfill script built the same doubled string inline.
  const FILES = ['dashboard/index.js', 'dashboard/scripts/backfill-processed-transcripts.js'];

  test.each(FILES)('%s does not interpolate the same name twice', (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(src).not.toMatch(/\$\{[^}]*\.name[^}]*\}\s*\$\{[^}]*\.name/);
  });
});
