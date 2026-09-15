/**
 * The recording acknowledgement offers a Cancel.
 *
 * The teacher path has had a confirm since it shipped — two buttons, "Yes,
 * Analyze" / "No". The coach path deliberately did not: /observe was itself the
 * declaration of intent, so a second confirm looked redundant. That held while
 * /observe was the only door. It stopped holding once a recording could arrive
 * through the binding picker and through the menu, which is what the coach who
 * filed this had no way out of.
 *
 * What this is NOT: a gate on the work. Transcription is queued twenty lines
 * before the ack, so the button saves the wrong report reaching a teacher, not
 * the compute. That is deliberate and is why the revival guard ships with it.
 *
 * Every id, route and string already existed — observe_ok_<id> and
 * observe_cancel_<id> both route in whatsapp-bot.js, and btn_ok_wait /
 * btn_cancel_obs are present in all three languages inside the 20-code-point
 * button cap.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OBSERVE_MEWAKA_FLOW_ID = process.env.OBSERVE_MEWAKA_FLOW_ID || 'test-observe-flow-id';

jest.mock('../../shared/config/supabase', () => {
  const row = { id: 'obs-1', status: 'confirmed', observation_type: 'leader_observation' };
  const api = {
    from: () => api,
    insert: () => api,
    update: () => api,
    select: () => api,
    eq: () => api,
    in: () => api,
    not: () => api,
    limit: () => Promise.resolve({ data: [], error: null }),
    single: () => Promise.resolve({ data: row, error: null }),
    then: (ok, bad) => Promise.resolve({ data: [row], error: null }).then(ok, bad),
  };
  return api;
});
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  getState: jest.fn(async () => null),
  setState: jest.fn(async () => true),
  clearState: jest.fn(async () => true),
}));
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueTranscription: jest.fn(async () => true),
}));
jest.mock('../../shared/services/observe/observe-who.service', () => ({
  maybeAskObservedTeacher: jest.fn(async () => true),
}));

const WA = require('../../shared/services/whatsapp.service');
const Capture = require('../../shared/services/observe/observe-capture.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const COACH = { id: 'u-coach', role: 'coach', preferred_language: 'ur' };
const FROM = '923260000001';

beforeEach(() => jest.clearAllMocks());

it('RED: the ack carries a Cancel button bound to the observation just created', async () => {
  const session = await Capture.startFromAudio(COACH, FROM, 'a-1', 'chat-1', 1200);
  expect(session).toBeTruthy();
  expect(WA.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  const [to, payload] = WA.sendInteractiveButtons.mock.calls[0];
  expect(to).toBe(FROM);
  const ids = payload.buttons.map((b) => b.id);
  expect(ids).toContain(`observe_cancel_${session.id}`);
  expect(ids).toContain(`observe_ok_${session.id}`);
  expect(payload.body).toBeTruthy();
});

it('RED: the ack is no longer a plain text message', async () => {
  await Capture.startFromAudio(COACH, FROM, 'a-1', 'chat-1', 1200);
  expect(WA.sendMessage).not.toHaveBeenCalled();
});

it('both button titles fit the 20-code-point cap in every language served', () => {
  for (const lang of ['en', 'ur', 'sw']) {
    const S = observeStrings(lang);
    expect([...S.btn_ok_wait].length).toBeLessThanOrEqual(20);
    expect([...S.btn_cancel_obs].length).toBeLessThanOrEqual(20);
    expect([...S.btn_ok_wait].length).toBeGreaterThan(0);
    expect([...S.btn_cancel_obs].length).toBeGreaterThan(0);
  }
  expect(/[؀-ۿ]/.test(observeStrings('ur').btn_cancel_obs)).toBe(true);
});

it('the work is still queued before the ack — the button saves the report, not the compute', async () => {
  const Q = require('../../shared/services/coaching/coaching-job-queue.service');
  await Capture.startFromAudio(COACH, FROM, 'a-1', 'chat-1', 1200);
  expect(Q.queueTranscription).toHaveBeenCalledTimes(1);
});
