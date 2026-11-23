'use strict';
/**
 * GET /api/portal/config features.lpWhatsappSend — may the plan screen show "Send on WhatsApp" for her? One resolved
 * boolean: false when HER programme (GB when lp-own-gb says so, else ICT) is on lp_whatsapp_pdf_off, true otherwise —
 * no row, a malformed value, the other programme listed, logged out, a failed programme read, and the error fallback
 * are all true, which is today (the button shows when the template is set). POST /share/whatsapp checks again.
 */
process.env.FLAG_CACHE_TTL_MS = '0';

const Fake = require('../fixtures/lp-whatsapp-off-fake');

let settings = {};
let gbFails = false;

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
      return { data: null, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return chain;
}

async function features({ userId = Fake.ICT_TEACHER, sessionThrows = false } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const layer = routes.stack.find((l) => l.route && l.route.path === '/config' && l.route.methods.get);
  const req = { params: {}, body: {}, query: {}, method: 'GET', path: '/config', headers: {}, get: () => undefined };
  if (sessionThrows) Object.defineProperty(req, 'session', { get() { throw new Error('session store down'); } });
  else req.session = userId ? { portalUserId: userId, id: 's' } : {};
  let payload = null;
  const res = { status() { return this; }, json(b) { payload = b; return this; } };
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const s of layer.route.stack) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await s.handle(req, res, () => { next = true; });
      if (!next) break;
    }
  } finally {
    errors.mockRestore();
  }
  return payload.features;
}

beforeEach(() => {
  jest.resetModules();
  settings = { portal_teacher_v2: true };
  gbFails = false;
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../bot/shared/services/lp-own-gb', () => ({
    isGbTeacher: async (_client, userId) => {
      if (gbFails) throw new Error('users read failed');
      return userId === Fake.GB_TEACHER;
    },
  }));
  jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => jest.resetModules());

describe.each(Fake.PER_TEACHER)('lp_whatsapp_pdf_off %s (%j), %s teacher', (_label, value, _who, userId, off) => {
  test(`lpWhatsappSend is ${!off}`, async () => {
    if (value !== undefined) settings.lp_whatsapp_pdf_off = value;
    expect((await features({ userId })).lpWhatsappSend).toBe(!off);
  });
});

test('the survey switch does not hide the button', async () => {
  settings.lp_whatsapp_survey_off = ['ict', 'gb'];
  expect((await features()).lpWhatsappSend).toBe(true);
});

test('her programme cannot be read: today (true)', async () => {
  settings.lp_whatsapp_pdf_off = ['ict', 'gb'];
  gbFails = true;
  expect((await features()).lpWhatsappSend).toBe(true);
});

test('logged out, and the error fallback: true (today; the server still checks a send)', async () => {
  settings.lp_whatsapp_pdf_off = ['ict', 'gb'];
  expect((await features({ userId: null })).lpWhatsappSend).toBe(true);
  expect((await features({ sessionThrows: true })).lpWhatsappSend).toBe(true);
});
