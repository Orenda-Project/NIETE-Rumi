'use strict';
/**
 * "Send on WhatsApp" of a lesson plan from the app, with lp_whatsapp_pdf_off: when her programme is listed the
 * portal refuses the send itself — { status: 'unavailable', reason: 'whatsapp_off' } — and never asks the bot to
 * send the template. Not listed (no row, a malformed value, the other programme): the bot is asked, as today. Other
 * kinds (a paper, a DC or observation report) never read the switch.
 */
const Fake = require('../fixtures/lp-whatsapp-off-fake');

const ICT = Fake.ICT_TEACHER;
let post;

beforeEach(() => {
  jest.resetModules();
  Fake.reset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  post = jest.fn().mockResolvedValue({ status: 200, data: { success: true, status: 'sent', at: '2026-11-19T09:00:00.000Z' } });
  jest.doMock('axios', () => ({ post }));
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({ PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2', isFlagEnabledForUser: async () => true }));
  jest.doMock('../../dashboard/lib/lp-app-switches', () => ({
    isLpWhatsappPdfOffFor: (_supabase, userId) => Fake.module.isLpWhatsappPdfOffFor(userId),
  }));
  process.env.MAIN_BOT_URL = 'http://bot.test'; process.env.INTERNAL_API_KEY = 'k';
});
afterEach(() => jest.restoreAllMocks());

async function send(userId, body = { kind: 'lesson', id: 'k5:grade_1_english_ch4_seg2' }) {
  const router = require('../../dashboard/routes/portal-share.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === '/share/whatsapp' && l.route.methods.post);
  const req = { session: { portalUserId: userId }, body };
  let status = 200; let payload = null;
  const res = { status(c) { status = c; return this; }, json(b) { payload = b; return this; } };
  for (const s of layer.route.stack) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await s.handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return { status, payload };
}

describe.each(Fake.PER_TEACHER)('lp_whatsapp_pdf_off %s (%j), %s teacher', (_label, value, _who, userId, off) => {
  test(off ? 'a lesson send is refused: unavailable, the bot is not asked' : 'today: the bot sends it', async () => {
    Fake.setPdfOff(value);
    const out = await send(userId);
    if (off) {
      expect(out).toEqual({ status: 200, payload: { success: true, status: 'unavailable', reason: 'whatsapp_off' } });
      expect(post).not.toHaveBeenCalled();
    } else {
      expect(out.payload).toEqual({ success: true, status: 'sent', at: '2026-11-19T09:00:00.000Z' });
      expect(post).toHaveBeenCalledTimes(1);
    }
  });
});

test.each(['paper', 'dc', 'observation'])('a %s send never reads the switch', async (kind) => {
  Fake.setPdfOff(['ict', 'gb']);
  const out = await send(ICT, { kind, id: 'r1' });
  expect(out.payload.status).toBe('sent');
  expect(Fake.state.calls).toEqual([]);
});

test('the switch is read for the SESSION user, never one in the body', async () => {
  Fake.setPdfOff(['gb']);
  await send(ICT, { kind: 'lesson', id: 'k5:x', userId: Fake.GB_TEACHER });
  expect(Fake.state.calls).toEqual([{ key: 'lp_whatsapp_pdf_off', userId: ICT }]);
  expect(post).toHaveBeenCalledTimes(1);
});
