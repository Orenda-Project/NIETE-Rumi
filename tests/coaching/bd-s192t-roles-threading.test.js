/**
 * bd-s192t.1 — regression test for the 44fe3ae `roles` ReferenceError.
 *
 * The 44fe3ae suite tested the new helper in isolation and asserted wiring by
 * grepping source text, so the changed line never executed and a guaranteed
 * ReferenceError shipped: `_attemptTranscription` references `roles` (line
 * ~280) but its scope never receives it, killing every diarization-SUCCESS
 * transcription and silently falling back to the no-diarization backup —
 * which is what starved the LP-fidelity grader of [MM:SS] timestamps fleet-wide
 * from Aug 27 onward.
 *
 * These tests execute the REAL chain — transcribe → _transcribeOnce →
 * _attemptTranscription → _formatTranscriptWithSpeakers — mocking only the
 * network (axios). Nothing in audio.service is mocked, and no source text is
 * grepped.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios'); // tests/__mocks__/axios.js — jest.fn per method

const AudioService = require('../../bot/shared/services/audio.service');
const { DEBRIEF_ROLES } = require('../../bot/shared/services/speaker-roles');

jest.setTimeout(20000); // the poll loop sleeps 1s per status check, real timers

// Two speakers so assignSpeakerLabels resolves primary/secondary labels
// (a single speaker may be labelled neutrally). spk1 dominates by word count.
const DIAR_TOKENS = [
  { text: 'Good ', speaker: 'spk1', start_ms: 0, end_ms: 300, language: 'en' },
  { text: 'morning ', speaker: 'spk1', start_ms: 300, end_ms: 700, language: 'en' },
  { text: 'class ', speaker: 'spk1', start_ms: 700, end_ms: 1100, language: 'en' },
  { text: 'open ', speaker: 'spk1', start_ms: 1100, end_ms: 1400, language: 'en' },
  { text: 'your ', speaker: 'spk1', start_ms: 1400, end_ms: 1700, language: 'en' },
  { text: 'books ', speaker: 'spk1', start_ms: 1700, end_ms: 2100, language: 'en' },
  { text: 'Present ', speaker: 'spk2', start_ms: 65000, end_ms: 65400, language: 'en' },
  { text: 'teacher ', speaker: 'spk2', start_ms: 65400, end_ms: 65900, language: 'en' },
];

let audioFile;

/**
 * Faithful Soniox surface at the axios boundary. The transcript honors the
 * job's enable_speaker_diarization flag — diarized jobs return speaker tokens,
 * plain jobs return bare text — exactly the distinction the primary/backup
 * call sites rely on.
 */
function armSonioxMock() {
  const jobs = {};
  let jobCount = 0;

  axios.post.mockImplementation((url, body) => {
    const u = String(url);
    if (u.endsWith('/v1/files')) {
      return Promise.resolve({ data: { id: 'file-1' } });
    }
    if (u.endsWith('/v1/transcriptions')) {
      jobCount += 1;
      const id = `job-${jobCount}`;
      jobs[id] = { diarized: !!(body && body.enable_speaker_diarization) };
      return Promise.resolve({ data: { id } });
    }
    return Promise.resolve({ data: {}, status: 200 });
  });

  axios.get.mockImplementation((url) => {
    const u = String(url);
    const transcript = u.match(/\/v1\/transcriptions\/(job-\d+)\/transcript$/);
    if (transcript) {
      const { diarized } = jobs[transcript[1]];
      if (diarized) {
        return Promise.resolve({
          data: { text: 'Good morning class open your books Present teacher', tokens: DIAR_TOKENS, speakers: [] },
        });
      }
      return Promise.resolve({
        data: { text: 'Good morning class open your books Present teacher', tokens: [], speakers: [] },
      });
    }
    if (/\/v1\/transcriptions\/job-\d+$/.test(u)) {
      return Promise.resolve({ data: { status: 'completed' } });
    }
    return Promise.resolve({ data: {}, status: 200 });
  });

  return {
    transcriptionJobsCreated: () =>
      axios.post.mock.calls.filter((c) => String(c[0]).endsWith('/v1/transcriptions')).length,
  };
}

beforeAll(() => {
  audioFile = path.join(os.tmpdir(), 'bd-s192t-roles-threading.ogg');
  fs.writeFileSync(audioFile, 'fake-ogg-bytes');
});

afterAll(() => {
  try { fs.unlinkSync(audioFile); } catch (e) { /* already gone */ }
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('bd-s192t.1 — roles threading through the real transcription chain', () => {
  test('a diarization-success transcription survives the primary path and keeps its [MM:SS] speaker timestamps', async () => {
    const soniox = armSonioxMock();

    const result = await AudioService.transcribe(audioFile, true);

    // The formatted transcript must carry timestamped speaker segments —
    // this is the property the LP-fidelity grader depends on.
    expect(result.text).toMatch(/\[\d{2}:\d{2}\] Teacher/);
    expect(result.text).toMatch(/\[01:05\] Student/);

    // And it must come from the PRIMARY attempt: with the 44fe3ae bug the
    // primary throws ReferenceError after Soniox completes, and a silent
    // second (backup, no-diarization) job is created instead.
    expect(soniox.transcriptionJobsCreated()).toBe(1);
  });

  test('a roles vocabulary passed by a caller reaches the labeller (the #454 intent, end to end)', async () => {
    armSonioxMock();

    const result = await AudioService.transcribe(audioFile, true, null, DEBRIEF_ROLES);

    // DEBRIEF_ROLES: dominant speaker 'Coach', second 'Teacher' — and never
    // the classroom 'Student' label that #454 set out to eliminate here.
    expect(result.text).toMatch(/\[\d{2}:\d{2}\] Coach/);
    expect(result.text).toMatch(/\[\d{2}:\d{2}\] Teacher/);
    expect(result.text).not.toMatch(/Student/);
  });
});
