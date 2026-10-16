'use strict';
/**
 * bd-fgj73x.7 — a portal Digital Coaching recording under 15 minutes starts no flow and no report.
 *
 * Teacher Sehrish tapped Start recording by accident; a few seconds of audio went through the whole
 * pipeline and she got a full report (operator, 16 Oct). WhatsApp has always refused that: audio under
 * CLASSROOM_AUDIO_THRESHOLD (900 s) never becomes a classroom session. The portal now holds back a short
 * recording before Submit — but only when the BROWSER can read the length. This is the server's half,
 * for an upload whose length the browser could not read:
 *
 * the transcription job measures a teacher's portal DC upload right after the download and BEFORE the
 * Step 1/5 message, the transcription (paid) and the analysis. Under 900 s: the row is closed `cancelled`
 * (failed_step too_short, its duration stored) and she gets a short generic message on WhatsApp; the
 * portal shows the same. 900 s and over, an unknown length, a coach's observation and every WhatsApp
 * row are untouched — the WhatsApp row is not even measured.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const { CLASSROOM_AUDIO_THRESHOLD } = require('../../bot/shared/config/classroom-audio.config');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const Gate = require('../../bot/shared/services/coaching/portal-short-recording');

const SID = '0b5e11e0-1111-2222-3333-777777777777';
const PORTAL_URL = 'https://r2.example/bucket/classroom_audio/u/2026-10/portal_abc123.webm';
const WA_URL = 'https://r2.example/bucket/classroom_audio/u/2026-10/683335f3_1790852380454.ogg';
const dc = (over = {}) => ({ id: SID, user_id: 'teacher-1', audio_url: PORTAL_URL, observation_type: null, ...over });

function deps(seconds, over = {}) {
  const calls = { updates: [], sent: [], logs: [] };
  return {
    calls,
    probe: jest.fn(async () => { if (seconds instanceof Error) throw seconds; return seconds; }),
    updateIfNotTerminal: async (id, fields) => { calls.updates.push({ id, fields }); return { applied: true }; },
    getLanguage: async () => 'en',
    sendMessage: async (to, body) => { calls.sent.push({ to, body }); return true; },
    log: (...a) => calls.logs.push(a),
    ...over,
  };
}
const run = (session, d) => Gate.refuseShortPortalRecording({ session, coachingSessionId: SID, from: '923001234567', audioData: Buffer.from('a') }, d);

describe('a teacher\'s portal DC upload under 15 minutes', () => {
  test('a few seconds: closed before anything runs, its duration kept, a short message sent', async () => {
    const d = deps(7.4);
    const r = await run(dc(), d);
    expect(r).toEqual({ refused: true, seconds: 7 });
    expect(d.calls.updates).toEqual([{ id: SID, fields: expect.objectContaining({
      status: 'cancelled', failed_step: 'too_short', audio_duration_seconds: 7,
    }) }]);
    expect(d.calls.sent).toEqual([{ to: '923001234567', body: resolveUx('coachingPortalRecordingTooShort', { language: 'en', params: { min: 15 } }) }]);
  });

  test('just under the line (899 s) is refused; the line itself (900 s) is a lesson', async () => {
    expect((await run(dc(), deps(CLASSROOM_AUDIO_THRESHOLD - 1))).refused).toBe(true);
    const d = deps(CLASSROOM_AUDIO_THRESHOLD);
    expect(await run(dc(), d)).toEqual({ refused: false, seconds: CLASSROOM_AUDIO_THRESHOLD });
    expect(d.calls.updates).toEqual([]);
    expect(d.calls.sent).toEqual([]);
  });

  test('the message is 1-2 lines, in her language, and says the minimum', () => {
    for (const language of ['en', 'ur']) {
      const body = resolveUx('coachingPortalRecordingTooShort', { language, params: { min: 15 } });
      expect(body).toMatch(/15/);
      expect(body.split(/[.۔]\s*/).filter(Boolean).length).toBeLessThanOrEqual(2);
      expect([...body].length).toBeLessThan(1024);
    }
    expect(resolveUx('coachingPortalRecordingTooShort', { language: 'ur', params: { min: 15 } }))
      .not.toBe(resolveUx('coachingPortalRecordingTooShort', { language: 'en', params: { min: 15 } }));
  });

  test('already over (she cancelled, a sweep closed it): no message', async () => {
    const d = deps(30, { updateIfNotTerminal: async () => ({ applied: false }) });
    expect((await run(dc(), d)).refused).toBe(true);
    expect(d.calls.sent).toEqual([]);
  });

  test('a WhatsApp send that fails does not reopen the session (the portal shows it)', async () => {
    const d = deps(30, { sendMessage: async () => { throw new Error('outside 24h'); } });
    expect((await run(dc(), d)).refused).toBe(true);
    expect(d.calls.updates).toHaveLength(1);
  });
});

describe('left alone, exactly as before', () => {
  test('length unknown (probe failed or returned nothing): analysed as before', async () => {
    for (const s of [new Error('ffprobe'), 0, null, NaN]) {
      const d = deps(s);
      expect((await run(dc(), d)).refused).toBe(false);
      expect(d.calls.updates).toEqual([]);
      expect(d.calls.sent).toEqual([]);
    }
  });

  test('a WhatsApp recording and a coach\'s observation are not measured at all', async () => {
    for (const session of [dc({ audio_url: WA_URL }), dc({ audio_url: null }), dc({ observation_type: 'leader_observation' })]) {
      const d = deps(10);
      expect((await run(session, d)).refused).toBe(false);
      expect(d.probe).not.toHaveBeenCalled();
      expect(d.calls.updates).toEqual([]);
      expect(d.calls.sent).toEqual([]);
    }
  });
});

describe('wiring', () => {
  const code = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  test('the transcription job runs the gate before the Step 1 message, and before transcribing', () => {
    const src = code('bot/shared/services/coaching/transcription-processor.service.js');
    const gate = src.indexOf('refuseShortPortalRecording(');
    const step1 = src.indexOf('await this.sendProgressUpdate(');
    const transcribe = src.indexOf('this.transcribeWithDiarization(tempAudioPath)');
    expect(gate).toBeGreaterThan(-1);
    expect(step1).toBeGreaterThan(-1);
    expect(transcribe).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(step1);
    expect(gate).toBeLessThan(transcribe);
  });

  test('the portal\'s "short recording" is the same 15 minutes, not the old 10', () => {
    const { SHORT_RECORDING_SECONDS } = require('../../bot/shared/services/coaching/portal-coaching.service');
    expect(SHORT_RECORDING_SECONDS).toBe(CLASSROOM_AUDIO_THRESHOLD);
  });

  test('the portal screen\'s minimum is the same number (it cannot import the bot config)', () => {
    const src = fs.readFileSync(path.join(REPO, 'portal/src/portal/lib/coachingUpload.ts'), 'utf8');
    const m = src.match(/export const DC_MIN_SECONDS = (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBe(CLASSROOM_AUDIO_THRESHOLD);
  });
});
