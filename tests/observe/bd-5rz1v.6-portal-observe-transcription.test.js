'use strict';
/**
 * bd-5rz1v.6 — after transcription, a PORTAL-started observation goes straight
 * on: the coach attached the teacher's plan and the board photos in the portal,
 * so the coach photo / lesson-plan gates (WhatsApp prompts) are not sent. It
 * queues exactly what a teacher's portal upload queues (afterTranscription).
 * A WhatsApp observation is unchanged, gates on or off.
 */
const Processor = require('../../bot/shared/services/coaching/transcription-processor.service');

const SID = '0b5e11e0-1111-2222-3333-555555555555';
const PORTAL_URL = 'https://r2.example/bucket/classroom_audio/coach-id/2026-10/portal_abc.webm';
const WA_URL = 'https://r2.example/bucket/classroom_audio/coach-id/2026-10/683335f3_1790852380454.ogg';
const obs = (over = {}) => ({ observation_type: 'leader_observation', user_id: 'teacher-id', observer_user_id: 'coach-id', ...over });

function deps(env) {
  const calls = { queued: [], sent: [], status: [], portal: [] };
  return {
    calls,
    env,
    observe2: { runForSession: async () => null },
    portal: {
      isPortalSession: require('../../bot/shared/services/coaching/portal-coaching.service').isPortalSession,
      afterTranscription: async (session, sid, from) => { calls.portal.push({ sid, from, plan: !!session.has_lesson_plan }); return { action: 'analysis' }; },
    },
    queueAnalysis: async (sid, p) => calls.queued.push({ sid, p }),
    sendButtons: async (to, prompt) => calls.sent.push({ to, prompt }),
    buildPhotoPrompt: (sid, lang) => ({ body: `photo? [${lang}]`, buttons: [] }),
    getLanguage: async () => 'en',
    updateConversationState: async () => {},
    updateStatus: async (sid, st) => calls.status.push(st),
  };
}

describe('observePostTranscription — a portal observation', () => {
  test.each([[{}], [{ OBSERVE_CAPTURE_GATES_ENABLED: 'true' }]])('skips the WhatsApp gates and queues what afterTranscription queues (env %j)', async (env) => {
    const d = deps(env);
    const r = await Processor.observePostTranscription(SID, obs({ audio_url: PORTAL_URL, has_lesson_plan: true }), '92coach', d);
    expect(r).toEqual({ action: 'portal', result: { action: 'analysis' } });
    expect(d.calls.portal).toEqual([{ sid: SID, from: '92coach', plan: true }]);
    expect(d.calls.sent).toEqual([]);
    expect(d.calls.status).toEqual([]);
    expect(d.calls.queued).toEqual([]);
  });
});

describe('observePostTranscription — a WhatsApp observation is unchanged', () => {
  test('gates off: analysis queued directly', async () => {
    const d = deps({});
    const r = await Processor.observePostTranscription(SID, obs({ audio_url: WA_URL }), '92coach', d);
    expect(r.action).toBe('queued_analysis');
    expect(d.calls.portal).toEqual([]);
  });
  test('gates on: the coach photo gate', async () => {
    const d = deps({ OBSERVE_CAPTURE_GATES_ENABLED: 'true' });
    const r = await Processor.observePostTranscription(SID, obs({ audio_url: WA_URL }), '92coach', d);
    expect(r.action).toBe('photo_gate');
    expect(d.calls.sent).toHaveLength(1);
    expect(d.calls.portal).toEqual([]);
  });
});

describe('coachNotice — the duplicate-recording notice', () => {
  test('a WhatsApp observation is told on WhatsApp', async () => {
    const send = jest.fn().mockResolvedValue(true);
    await Processor.coachNotice(obs({ audio_url: WA_URL }), send)('92coach', 'already analysed');
    expect(send).toHaveBeenCalledWith('92coach', 'already analysed');
  });
  test('a portal observation sends nothing — the portal shows the stop', async () => {
    const send = jest.fn().mockResolvedValue(true);
    expect(await Processor.coachNotice(obs({ audio_url: PORTAL_URL }), send)('92coach', 'already analysed')).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});
