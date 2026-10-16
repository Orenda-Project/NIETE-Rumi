/**
 * After a feature is delivered, an unregistered adult is offered the registration Flow —
 * through the one invite sender, and only if no door has offered it already.
 *
 * Before: checkAndTriggerRegistration fired only on feature #1 and called sendNameQuestion,
 * which sent a third, hand-rolled copy of the Flow (bare user id as token, English only).
 * Its first-reply sibling (text-message.handler.js) now offers the form after her very first
 * message, so this trigger must not send it a second time a minute later when the lesson
 * plan lands: the once-only rule (users.registration_started_at) decides.
 */

function load({ flowId = 'flow_reg_test', row } = {}) {
  jest.resetModules();
  if (flowId) process.env.REGISTRATION_FLOW_ID = flowId; else delete process.env.REGISTRATION_FLOW_ID;
  jest.doMock('uuid', () => ({ v4: () => 'test-uuid' }), { virtual: true });
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  const wa = { sendFlow: jest.fn().mockResolvedValue(true), sendMessage: jest.fn().mockResolvedValue(true) };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => wa);
  const invite = {
    offerRegistrationOnce: jest.fn().mockResolvedValue(true),
    sendRegistrationInvite: jest.fn().mockResolvedValue(true),
  };
  jest.doMock('../../bot/shared/services/registration-invite.service', () => invite);
  const single = jest.fn().mockResolvedValue({ data: row, error: null });
  const chain = {};
  ['from', 'select', 'eq', 'update'].forEach((m) => { chain[m] = jest.fn(() => chain); });
  chain.single = single;
  chain.then = (resolve) => Promise.resolve({ count: 1, error: null }).then(resolve);
  jest.doMock('../../bot/shared/config/supabase', () => chain);
  jest.doMock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp' }));
  jest.doMock('../../bot/shared/services/tts', () => ({ synthesize: jest.fn() }));
  const Svc = require('../../bot/shared/services/feature-registration.service');
  return { Svc, wa, invite };
}

const ORIG = process.env.REGISTRATION_FLOW_ID;
afterAll(() => {
  if (ORIG === undefined) delete process.env.REGISTRATION_FLOW_ID; else process.env.REGISTRATION_FLOW_ID = ORIG;
});

const UNREGISTERED = { name: null, registration_completed: false, registration_pending_name: false };

test('an unregistered adult after a lesson plan: the Flow, through the once-only offer — not the name question', async () => {
  const { Svc, wa, invite } = load({ row: UNREGISTERED });
  const triggered = await Svc.checkAndTriggerRegistration('u1', 'lesson_plan', '923001234567', 'ur', 'text');

  expect(triggered).toBe(true);
  expect(invite.offerRegistrationOnce).toHaveBeenCalledWith(expect.objectContaining({
    user: expect.objectContaining({ id: 'u1' }), phone: '923001234567', language: 'ur', reason: 'after_first_feature',
  }));
  expect(wa.sendMessage).not.toHaveBeenCalled(); // no "By the way, what should I call you?"
  expect(wa.sendFlow).not.toHaveBeenCalled();    // no hand-rolled Flow either
});

test('the second, third … feature: still offered if no door has offered it yet (the once-only rule decides, not the count)', async () => {
  const { Svc, invite } = load({ row: UNREGISTERED });
  await Svc.checkAndTriggerRegistration('u1', 'video', '923001234567', 'en', 'text');
  expect(invite.offerRegistrationOnce).toHaveBeenCalledTimes(1);
});

test('a registered teacher is not offered anything', async () => {
  const { Svc, invite, wa } = load({ row: { ...UNREGISTERED, name: 'Ayesha' } });
  expect(await Svc.checkAndTriggerRegistration('u1', 'lesson_plan', 'p', 'en', 'text')).toBe(false);
  expect(invite.offerRegistrationOnce).not.toHaveBeenCalled();
  expect(wa.sendMessage).not.toHaveBeenCalled();
});

test('sendNameQuestion with a Flow configured goes through the one sender (no third hand-rolled copy)', async () => {
  const { Svc, wa, invite } = load({ row: UNREGISTERED });
  await Svc.sendNameQuestion('u1', '923001234567', 'ur', 'text');
  expect(invite.sendRegistrationInvite).toHaveBeenCalledWith(expect.objectContaining({
    user: expect.objectContaining({ id: 'u1' }), phone: '923001234567', language: 'ur',
  }));
  expect(wa.sendFlow).not.toHaveBeenCalled();
  expect(wa.sendMessage).not.toHaveBeenCalled();
});
