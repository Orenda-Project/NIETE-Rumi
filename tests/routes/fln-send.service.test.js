'use strict';
/**
 * PR-E (m-links) — sendPlanToTeachers: one bot message per recipient, each carrying the recipient's OWN /go token.
 * The real default wiring runs (signAppLink, portalUrl, the keyed ids, the strings); only the boundary is mocked:
 * WhatsAppService (the Graph API), QuizDeliveryService._hasOpenMessageWindow (the DB-backed window check) and
 * the supabase client (the niete_fln_events insert).
 */
const ENV = { ...process.env };
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const SENDER = '99999999-9999-4999-8999-999999999999';
const PHONE = { [T1]: '920000000001', [T2]: '920000000002', [T3]: '920000000003' };

let WA; let windowOpen; let inserted; let logs;
beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...ENV, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: 'https://envone.supabase.co',
    PORTAL_URL: 'https://portal.example.test',
  };
  delete process.env.FLN_SEND_TEMPLATE;
  windowOpen = new Set(); inserted = []; logs = [];
  WA = { sendCtaUrl: jest.fn(async () => true), sendTemplate: jest.fn(async () => true) };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => WA);
  jest.doMock('../../bot/shared/services/quiz/quiz-delivery.service', () => ({
    _hasOpenMessageWindow: jest.fn(async (phone) => windowOpen.has(phone)),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (table) => ({ insert: async (row) => { inserted.push({ table, row }); return { error: null }; } }),
  }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: (msg, fields, level) => logs.push({ msg, fields, level }) }));
});
afterAll(() => { process.env = ENV; });

const svc = () => require('../../bot/shared/services/fln-send.service');
const verify = (t) => require('../../bot/shared/services/app-login-link').verifyAppLink(t);
const teacher = (id, lang = 'en') => ({ id, key: `k-${id.slice(0, 4)}`, phone_number: PHONE[id], preferred_language: lang });
const PLAN = { id: 11156, title: "Sounds of 'c/k, e, h, r, m, d'\n(Fluency)", lang: 'en' };
const sender = () => ({ id: SENDER, role: 'coach', keyedId: 'sender-key-0001' });

test('inside the 24 h window: an interactive cta_url whose button is the recipient\'s OWN /go to the plan', async () => {
  windowOpen.add(PHONE[T1]);
  const out = await svc().sendPlanToTeachers({ sender: sender(), plan: PLAN, teachers: [teacher(T1)] });
  expect(out).toEqual({ queued: 1, failed: [] });
  expect(WA.sendTemplate).not.toHaveBeenCalled();
  expect(WA.sendCtaUrl).toHaveBeenCalledTimes(1);
  const [to, msg] = WA.sendCtaUrl.mock.calls[0];
  expect(to).toBe(PHONE[T1]);
  expect(msg.buttonText).toBe('Open the lesson');
  expect(msg.body).toBe("Your coach has sent you a lesson plan: *Sounds of 'c/k, e, h, r, m, d' (Fluency)*. Tap the button to open it in the teacher app. The button works for 24 hours.");
  const m = /^https:\/\/portal\.example\.test\/go\/([A-Za-z0-9_-]+)$/.exec(msg.url);
  expect(m).not.toBeNull();
  expect(verify(m[1])).toEqual(expect.objectContaining({ u: T1, f: 'fln:11156' }));
});

test('outside the window: template fln_plan_open_v1 in the recipient\'s language code (en / ur, never en_US)', async () => {
  const out = await svc().sendPlanToTeachers({ sender: sender(), plan: PLAN, teachers: [teacher(T1, 'en'), teacher(T2, 'ur')] });
  expect(out).toEqual({ queued: 2, failed: [] });
  expect(WA.sendCtaUrl).not.toHaveBeenCalled();
  expect(WA.sendTemplate).toHaveBeenCalledTimes(2);
  const [to1, name1, lang1, comps1] = WA.sendTemplate.mock.calls[0];
  const [to2, name2, lang2, comps2] = WA.sendTemplate.mock.calls[1];
  expect([to1, name1, lang1]).toEqual([PHONE[T1], 'fln_plan_open_v1', 'en']);
  expect([to2, name2, lang2]).toEqual([PHONE[T2], 'fln_plan_open_v1', 'ur']);
  expect(comps1[0]).toEqual({ type: 'body', parameters: [{ type: 'text', text: 'coach' }, { type: 'text', text: "Sounds of 'c/k, e, h, r, m, d' (Fluency)" }] });
  expect(comps2[0].parameters[0]).toEqual({ type: 'text', text: 'کوچ' });
  for (const [comps, id] of [[comps1, T1], [comps2, T2]]) {
    expect(comps[1]).toEqual(expect.objectContaining({ type: 'button', sub_type: 'url', index: '0' }));
    const token = comps[1].parameters[0].text;
    expect(verify(token)).toEqual(expect.objectContaining({ u: id, f: 'fln:11156' }));
  }
  // one token per recipient: the two never match
  expect(comps1[1].parameters[0].text).not.toBe(comps2[1].parameters[0].text);
});

test('FLN_SEND_TEMPLATE names the template per environment', async () => {
  process.env.FLN_SEND_TEMPLATE = 'fln_plan_open_stg_v1';
  await svc().sendPlanToTeachers({ sender: sender(), plan: PLAN, teachers: [teacher(T1)] });
  expect(WA.sendTemplate.mock.calls[0][1]).toBe('fln_plan_open_stg_v1');
});

test('a token is minted only for recipients — never for the sender or anyone else', async () => {
  const link = require('../../bot/shared/services/app-login-link');
  const spy = jest.spyOn(link, 'signAppLink');
  await svc().sendPlanToTeachers({ sender: sender(), plan: PLAN, teachers: [teacher(T1), teacher(T3)] });
  expect(spy.mock.calls.map((c) => c[0])).toEqual([T1, T3]);
  expect(spy.mock.calls.every((c) => c[1] === 'fln:11156')).toBe(true);
});

test('a send that returns false (or throws) is failed, by key; the others still go', async () => {
  WA.sendTemplate
    .mockImplementationOnce(async () => false)
    .mockImplementationOnce(async () => { throw new Error('boom'); })
    .mockImplementationOnce(async () => true);
  const out = await svc().sendPlanToTeachers({ sender: sender(), plan: PLAN, teachers: [teacher(T1), teacher(T2), teacher(T3)] });
  expect(out).toEqual({ queued: 1, failed: [teacher(T1).key, teacher(T2).key] });
});

test('no signing key on this deployment → every recipient failed, nothing sent', async () => {
  delete process.env.INTERNAL_API_KEY;
  const out = await svc().sendPlanToTeachers({ sender: sender(), plan: PLAN, teachers: [teacher(T1)] });
  expect(out).toEqual({ queued: 0, failed: [teacher(T1).key] });
  expect(WA.sendTemplate).not.toHaveBeenCalled();
  expect(WA.sendCtaUrl).not.toHaveBeenCalled();
});

test('a recipient with no phone number is failed without a token', async () => {
  const link = require('../../bot/shared/services/app-login-link');
  const spy = jest.spyOn(link, 'signAppLink');
  const out = await svc().sendPlanToTeachers({ sender: sender(), plan: PLAN, teachers: [{ ...teacher(T1), phone_number: null }] });
  expect(out).toEqual({ queued: 0, failed: [teacher(T1).key] });
  expect(spy).not.toHaveBeenCalled();
});

test('one niete_fln_events send row per recipient: sender keyed id, plan ref, recipient keyed id, result', async () => {
  WA.sendTemplate.mockImplementationOnce(async () => true).mockImplementationOnce(async () => false);
  await svc().sendPlanToTeachers({ sender: sender(), plan: PLAN, teachers: [teacher(T1), teacher(T2)] });
  expect(inserted).toEqual([
    { table: 'niete_fln_events', row: { user_key: 'sender-key-0001', kind: 'send', plan_ref: '11156', clip: teacher(T1).key, result: 'sent' } },
    { table: 'niete_fln_events', row: { user_key: 'sender-key-0001', kind: 'send', plan_ref: '11156', clip: teacher(T2).key, result: 'failed' } },
  ]);
});

test('a failing event write never fails the send', async () => {
  const out = await svc().sendPlanToTeachers({
    sender: sender(), plan: PLAN, teachers: [teacher(T1)],
    deps: { recordEvent: async () => { throw new Error('table missing'); } },
  });
  expect(out).toEqual({ queued: 1, failed: [] });
});

test('logs carry keyed ids only — never a phone, a raw user id, a name or the token', async () => {
  windowOpen.add(PHONE[T2]);
  await svc().sendPlanToTeachers({ sender: sender(), plan: PLAN, teachers: [teacher(T1), teacher(T2)] });
  const tokens = [
    ...WA.sendTemplate.mock.calls.map((c) => c[3][1].parameters[0].text),
    ...WA.sendCtaUrl.mock.calls.map((c) => c[1].url.split('/go/')[1]),
  ];
  const all = JSON.stringify(logs);
  expect(logs.length).toBeGreaterThan(0);
  for (const bad of [PHONE[T1], PHONE[T2], T1, T2, SENDER, ...tokens]) expect(all).not.toContain(bad);
});

test('the title is flattened and capped at 120 code points; the button labels fit 20', () => {
  const S = require('../../bot/shared/services/fln-send.strings');
  const long = 'ب'.repeat(130);
  const flat = svc().flattenTitle(`a\tb\n\nc    d ${long}`);
  expect(flat.startsWith('a b c d ')).toBe(true);
  expect([...flat].length).toBe(120);
  expect([...S.FLN_SEND_STRINGS.en.button].length).toBeLessThanOrEqual(20);
  expect([...S.FLN_SEND_STRINGS.ur.button].length).toBeLessThanOrEqual(20);
});

test('every leader role has a role word in both languages', () => {
  const S = require('../../bot/shared/services/fln-send.strings');
  for (const role of ['coach', 'principal', 'aeo', 'school_leader', 'supervisor']) {
    expect(S.FLN_SEND_STRINGS.en.roles[role]).toBeTruthy();
    expect(S.FLN_SEND_STRINGS.ur.roles[role]).toBeTruthy();
  }
});

test('a title holding $& or $1 is sent as written', async () => {
  windowOpen.add(PHONE[T1]);
  await svc().sendPlanToTeachers({ sender: sender(), plan: { id: 7, title: 'Cost $& and $1', lang: 'en' }, teachers: [teacher(T1)] });
  expect(WA.sendCtaUrl.mock.calls[0][1].body).toContain('*Cost $& and $1*');
});
