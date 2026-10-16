'use strict';
/**
 * makerCta (FIRST_QUIZ §10.1, the call the door makes): the ledger FIRST with trigger maker_reply. Today the ledger's
 * frozen trigger list has no maker_reply, so record() refuses → nothing is sent, {sent:false, capped:true}. When the
 * ledger allows (an injected list), ONE cta_url with an https /m/ link whose token verifies with the six fields.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const Ledger = require('../../shared/services/quiz/message-ledger');
const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');
const MakerToken = require('../../shared/services/first-touch/maker.token');
const Cta = require('../../shared/services/first-touch/maker.cta');
const { str } = require('../../shared/services/first-touch/maker.strings');
const { seedMaker, TEACHER, PHONE } = require('./maker-fixture');

const SAVED = { ...process.env };
const BASE = 'https://portal.example.test';

beforeEach(() => {
  process.env = { ...SAVED, WEB_QUIZ_BASE_URL: BASE, WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret' };
  jest.clearAllMocks();
  jest.restoreAllMocks();
  seedMaker(supabase);
  Ledger._resetCap();
});
afterAll(() => { process.env = SAVED; });

test('today: the ledger refuses maker_reply → nothing sent, { sent:false, capped:true }, web_quiz.reply_capped logged', async () => {
  expect(Ledger.TRIGGERS).not.toContain('maker_reply');
  const out = await Cta.makerCta({ uid: TEACHER.id, lang: 'ur', who: 'unknown', via: 'door', phone: PHONE });
  expect(out).toEqual({ sent: false, capped: true });
  expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
  expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  expect(logEvent).toHaveBeenCalledWith('web_quiz.reply_capped', expect.objectContaining({ trigger: 'maker_reply' }));
});

test('ledger allows → ONE sendCtaUrl, after the ledger, with an https /m/ URL whose token carries the six fields', async () => {
  const order = [];
  jest.spyOn(Ledger, 'record').mockImplementation(async (args) => { order.push(['record', args.trigger, args.phone]); return true; });
  WhatsAppService.sendCtaUrl.mockImplementation(async () => { order.push(['send']); return true; });
  const out = await Cta.makerCta({ uid: TEACHER.id, lang: 'bi', who: 'unknown', via: 'door', phone: PHONE });
  expect(out).toEqual({ sent: true });
  expect(order).toEqual([['record', 'maker_reply', PHONE], ['send']]);
  expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
  const [to, msg] = WhatsAppService.sendCtaUrl.mock.calls[0];
  expect(to).toBe(PHONE);
  expect(msg.body).toBe(str('maker.body.bi', 'en'));
  expect(msg.buttonText).toBe(str('maker.btn.bi', 'en'));
  expect([...msg.buttonText].length).toBeLessThanOrEqual(20);
  const m = new RegExp(`^${BASE}/m/([A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{22})$`).exec(msg.url);
  expect(m).not.toBeNull();
  const v = MakerToken.verifyMaker(m[1]);
  expect(v.ok).toMatchObject({ uid: TEACHER.id, lang: 'bi', tour: 0, via: 'door', uk: BindRepo.ukeyOf(PHONE) });
  expect(Object.keys(v.ok).sort()).toEqual(['exp', 'k', 'lang', 'tour', 'uid', 'uk', 'via']);
});

test('English and Urdu bodies and buttons; a failed send → { sent:false }', async () => {
  jest.spyOn(Ledger, 'record').mockResolvedValue(true);
  await Cta.makerCta({ uid: TEACHER.id, lang: 'en', who: 'unknown', via: 'menu', phone: PHONE });
  expect(WhatsAppService.sendCtaUrl.mock.calls[0][1]).toMatchObject({ body: str('maker.body', 'en'), buttonText: str('maker.btn', 'en') });
  WhatsAppService.sendCtaUrl.mockResolvedValueOnce(false);
  const out = await Cta.makerCta({ uid: TEACHER.id, lang: 'ur', who: 'unknown', via: 'menu', phone: PHONE });
  expect(WhatsAppService.sendCtaUrl.mock.calls[1][1]).toMatchObject({ body: str('maker.body', 'ur'), buttonText: str('maker.btn', 'ur') });
  expect(out).toEqual({ sent: false });
});

// One owner for a refused cta: the door on door and menu paths; this module only on the empty line.
test.each(['door', 'menu'])('via %s: a refused send returns { sent:false } and sends NO buttons (the door owns that fallback)', async (via) => {
  jest.spyOn(Ledger, 'record').mockResolvedValue(true);
  WhatsAppService.sendCtaUrl.mockResolvedValueOnce(false);
  const out = await Cta.makerCta({ uid: TEACHER.id, lang: 'en', who: 'unknown', via, phone: PHONE });
  expect(out).toEqual({ sent: false });
  expect(WhatsAppService.sendInteractiveButtons || jest.fn()).not.toHaveBeenCalled();
  expect(Ledger.record).toHaveBeenCalledTimes(1);
});

test('via empty: a refused send → the 3 reply buttons in the same turn, still ONE ledger row', async () => {
  jest.spyOn(Ledger, 'record').mockResolvedValue(true);
  WhatsAppService.sendCtaUrl.mockResolvedValueOnce(false);
  const out = await Cta.makerCta({ uid: TEACHER.id, lang: 'en', who: 'known', via: 'empty', phone: PHONE,
    body: 'maker.empty.body', button: 'maker.empty.btn' });
  expect(out).toEqual({ sent: true, fallback: true });
  expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  expect(Ledger.record).toHaveBeenCalledTimes(1);
});

test('makerUrl: the public base + /m/ + a maker token; no base → null', () => {
  const u = Cta.makerUrl({ uid: TEACHER.id, lang: 'en', tour: 1, via: 'empty', pf: 'grade_4|maths' });
  expect(u.startsWith(`${BASE}/m/`)).toBe(true);
  expect(MakerToken.verifyMaker(u.slice(`${BASE}/m/`.length)).ok).toMatchObject({ tour: 1, via: 'empty', pf: 'grade_4|maths' });
  delete process.env.WEB_QUIZ_BASE_URL; delete process.env.PORTAL_URL;
  expect(Cta.makerUrl({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'menu' })).toBeNull();
});
