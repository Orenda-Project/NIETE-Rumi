'use strict';
// bd-8sr958 — the transcription job's side: repair first, one message and one alert when it cannot, never "try again".
const syn = require('./synthetic');
const Damaged = require('../../shared/services/coaching/recording-repair/damaged-audio');
const { getCoachingMessage } = require('../../shared/config/coaching-messages');

// a chainable PostgREST fake: every filter returns the builder; await gives { data }
function fakeDb({ selectData = [], single = null } = {}) {
  const calls = [];
  const builder = (table) => {
    const b = {
      _t: table,
      select() { return b; }, eq() { return b; }, neq() { return b; }, not() { return b; }, is() { return b; },
      order() { return b; }, limit() { return b; },
      update(patch) { calls.push({ table, patch }); return b; },
      single: async () => ({ data: single, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res) => res({ data: selectData, error: null }),
    };
    return b;
  };
  return { from: builder, calls };
}

const session = (over = {}) => ({
  id: 's1', user_id: 'u1', audio_url: null, observation_type: null,
  users: { phone_number: '923001234567', name: 'Ayesha', school_name: 'IMSG Test School', preferred_language: 'ur' },
  ...over,
});

describe('copy', () => {
  test('the damaged-recording message exists in en and ur and never says try again / record again', () => {
    for (const lang of ['en', 'ur']) {
      const t = getCoachingMessage('damagedRecording', lang);
      expect(t.length).toBeGreaterThan(20);
      expect(t).not.toMatch(/try again|record again|send again|دوبارہ/i);
    }
    expect(getCoachingMessage('damagedRecording', 'ur')).toMatch(/[؀-ۿ]/);
  });
});

describe('repairBeforeTranscription', () => {
  const good = syn.make({ seconds: 10 });

  test('a finished file passes through untouched and the repair engine is not called', async () => {
    const repair = jest.fn();
    const r = await Damaged.repairBeforeTranscription({ session: session(), coachingSessionId: 's1', audioData: good, deps: { supabase: fakeDb(), repair } });
    expect(r.repaired).toBe(false);
    expect(r.audioData).toBe(good);
    expect(repair).not.toHaveBeenCalled();
  });

  test('a damaged file that repairs carries on with the repaired bytes, and says nothing to her', async () => {
    const repaired = Buffer.from('repaired-bytes');
    const repair = jest.fn().mockResolvedValue({ outcome: 'repaired', method: 'template', buffer: repaired, frames: 700, seconds: 10 });
    const db = fakeDb();
    const upload = jest.fn().mockResolvedValue('https://r2/x/repaired.m4a');
    const r = await Damaged.repairBeforeTranscription({
      session: session({ audio_url: 'https://r2/x/original.m4a' }), coachingSessionId: 's1', audioData: syn.noMoov(good),
      deps: { supabase: db, repair, r2: () => ({ uploadClassroomAudio: upload, uploadAudioBuffer: upload }) },
    });
    expect(r.repaired).toBe(true);
    expect(r.audioData).toBe(repaired);
    expect(upload).toHaveBeenCalledTimes(1);
    // a portal upload's audio_url now points at the repaired copy; the original key is not deleted
    expect(db.calls.find((c) => c.patch.audio_url)).toBeTruthy();
  });

  test('a hopeless file throws a permanent DamagedAudioError', async () => {
    const repair = jest.fn().mockResolvedValue({ outcome: 'unrecoverable', reason: 'no_frames_found' });
    await expect(Damaged.repairBeforeTranscription({
      session: session(), coachingSessionId: 's1', audioData: syn.noMoov(good), deps: { supabase: fakeDb(), repair },
    })).rejects.toMatchObject({ name: 'DamagedAudioError', permanent: true, permanentReason: 'damaged_audio', damaged: true });
  });

  test('the same damaged bytes sent again are marked as a repeat before the ladder runs', async () => {
    const repair = jest.fn();
    await expect(Damaged.repairBeforeTranscription({
      session: session(), coachingSessionId: 's2', audioData: syn.noMoov(good),
      deps: { supabase: fakeDb({ selectData: [{ id: 's1' }] }), repair },
    })).rejects.toMatchObject({ damaged: true, details: expect.objectContaining({ repeat: true }) });
    expect(repair).not.toHaveBeenCalled();
  });

  test('RECORDING_REPAIR_OFF turns the step into a pass-through', async () => {
    process.env.RECORDING_REPAIR_OFF = '1';
    try {
      const bad = syn.noMoov(good);
      const r = await Damaged.repairBeforeTranscription({ session: session(), coachingSessionId: 's1', audioData: bad, deps: { supabase: fakeDb(), repair: jest.fn() } });
      expect(r.audioData).toBe(bad);
    } finally { delete process.env.RECORDING_REPAIR_OFF; }
  });
});

describe('handleDamagedFailure', () => {
  const env = { PROD_ALERTS_SLACK_TOKEN: 'xoxb-test', PROD_ALERTS_SLACK_CHANNEL: 'C123' };
  const mk = (sess) => {
    const sendMessage = jest.fn().mockResolvedValue(true);
    const postToSlack = jest.fn().mockResolvedValue('1.2');
    const markAsFailed = jest.fn().mockResolvedValue({});
    const sendReaction = jest.fn().mockResolvedValue(true);
    const db = fakeDb({ single: sess });
    const deps = {
      supabase: db, sendMessage, postToSlack, markAsFailed, sendReaction,
      r2: () => ({ getPresignedUrl: async () => 'https://r2/signed?7d', uploadClassroomAudio: async () => 'https://r2/damaged.m4a' }),
    };
    return { deps, sendMessage, postToSlack, markAsFailed, sendReaction, db };
  };
  const error = (extra = {}) => new Damaged.DamagedAudioError('damaged audio: no_moov', { kind: 'no_moov', signature: 'M4A mp42 free=3248', source: 'whatsapp', bytes: 16000000, audioHash: 'ab'.repeat(32), original: Buffer.from('x'), ...extra });

  beforeEach(() => { Object.assign(process.env, env); });
  afterEach(() => { delete process.env.PROD_ALERTS_SLACK_TOKEN; delete process.env.PROD_ALERTS_SLACK_CHANNEL; });

  test('WhatsApp teacher: failed_step damaged_audio, ONE catalog message, ONE Slack post without her phone', async () => {
    const m = mk(session());
    await Damaged.handleDamagedFailure({ coachingSessionId: 's1', error: error(), deps: m.deps });
    expect(m.markAsFailed).toHaveBeenCalledWith('s1', 'damaged_audio', expect.any(String));
    expect(m.sendMessage).toHaveBeenCalledTimes(1);
    expect(m.sendMessage.mock.calls[0][1]).toBe(getCoachingMessage('damagedRecording', 'ur'));
    expect(m.postToSlack).toHaveBeenCalledTimes(1);
    const text = m.postToSlack.mock.calls[0][0];
    expect(text).toMatch(/Ayesha/);
    expect(text).toMatch(/IMSG Test School/);
    expect(text).not.toMatch(/923001234567|\+?92300/);
    expect(text).toMatch(/7 days/);
    expect(m.db.calls.find((c) => c.patch.audio_hash)).toBeTruthy();
  });

  test("her own portal recording still gets the ONE message (the page may be off the flag), and the team is told once", async () => {
    const m = mk(session({ audio_url: 'https://r2.example/b/classroom_audio/u1/2026-11/portal_abc-123.m4a' }));
    await Damaged.handleDamagedFailure({ coachingSessionId: 's1', error: error({ source: 'portal' }), deps: m.deps });
    expect(m.sendMessage).toHaveBeenCalledTimes(1);
    expect(m.postToSlack).toHaveBeenCalledTimes(1);
  });

  test('a coach\'s portal observation: the portal shows it, nothing goes to her WhatsApp, the team is still told once', async () => {
    const m = mk(session({ observation_type: 'leader_observation', audio_url: 'https://r2.example/b/classroom_audio/u1/2026-11/portal_abc-123.m4a', observer_user_id: 'coach-1' }));
    const portalSvc = require('../../shared/services/coaching/portal-coaching.service');
    const spy = jest.spyOn(portalSvc, 'isPortalObservation').mockReturnValue(true);
    try {
      await Damaged.handleDamagedFailure({ coachingSessionId: 's1', error: error({ source: 'portal' }), deps: m.deps });
    } finally { spy.mockRestore(); }
    expect(m.sendMessage).not.toHaveBeenCalled();
    expect(m.postToSlack).toHaveBeenCalledTimes(1);
  });

  test('the same bytes again: no message, no second alert, a ⏳ reaction when the wamid is known', async () => {
    const m = mk(session());
    await Damaged.handleDamagedFailure({ coachingSessionId: 's2', error: error({ repeat: true, wamid: 'wamid.X' }), deps: m.deps });
    expect(m.sendMessage).not.toHaveBeenCalled();
    expect(m.postToSlack).not.toHaveBeenCalled();
    expect(m.sendReaction).toHaveBeenCalledWith('923001234567', 'wamid.X', '⏳');
  });

  test("#6112's all-three-refused error is handled as damaged too", () => {
    const e = new Error('All transcription methods failed');
    e.permanent = true; e.permanentReason = 'unreadable_audio';
    expect(Damaged.asDamaged(e)).toBe(true);
    expect(Damaged.asDamaged(new Error('timeout'))).toBe(false);
  });
});
