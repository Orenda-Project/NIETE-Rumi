'use strict';
/**
 * bd-2kxxa.5 — Section B backfill: re-transcribe the Aug 28 – Sep 3 stranded
 * observations from their R2 audio and recompute lesson-plan fidelity.
 *
 * 331 coach observations carry analysis_data.lp_fidelity = {status:'ok',
 * fidelity_pct:null}: their transcripts came out of the bd-s192t bug window
 * with no diarization and no [MM:SS] timestamps, so the grader marked every
 * move not_adjudicable, and fidelity-recompute refuses their (submitted)
 * statuses. This job re-transcribes from audio_url with the fixed path,
 * overwrites the transcript columns in the pipeline's shape, recomputes
 * Section B, and persists under a CAS guard — for these rows only, and
 * without ever touching WhatsApp.
 *
 * Every boundary is injected (same style as fidelity-recompute.service.js);
 * the tests below EXECUTE the service lines, not a text grep of them.
 */

const fs = require('fs');
const path = require('path');

const SERVICE_REL = '../../shared/services/coaching/fidelity/section-b-backfill.service';
const SCRIPT_REL = '../../scripts/backfill-section-b-retranscribe';
const WHATSAPP_REL = '../../shared/services/whatsapp.service';
const AUDIO_REL = '../../shared/services/audio.service';

const TIMESTAMPED =
  '[00:01] Teacher (UR): آج ہم جمع سیکھیں گے\n\n' +
  '[00:20] Student (UR): جی\n\n' +
  '[01:05] Teacher (UR): اب ہم مشق کریں گے';
const UNTIMESTAMPED = 'Teacher: آج ہم جمع سیکھیں گے Student: جی Teacher: اب ہم مشق کریں گے';

const TOKENS = [
  { text: 'آج', start_ms: 1000, end_ms: 1100, speaker: '1', language: 'ur' },
  { text: ' ہم', start_ms: 1100, end_ms: 1200, speaker: '1', language: 'ur' },
  { text: ' جی', start_ms: 20000, end_ms: 20100, speaker: '2', language: 'ur' },
  { text: ' اب', start_ms: 65000, end_ms: 65100, speaker: '1', language: 'ur' },
  { text: ' ہم', start_ms: 65100, end_ms: 65200, speaker: '1', language: 'ur' },
];

const DIARIZATION = {
  speakers: [
    { id: '1', label: 'Teacher', tokenCount: 4, segments: [] },
    { id: '2', label: 'Student', tokenCount: 1, segments: [] },
  ],
  segments: [
    { speaker: '1', label: 'Teacher', text: 'آج ہم', start_ms: 1000, end_ms: 1200 },
    { speaker: '2', label: 'Student', text: 'جی', start_ms: 20000, end_ms: 20100 },
    { speaker: '1', label: 'Teacher', text: 'اب ہم', start_ms: 65000, end_ms: 65200 },
  ],
  totalSegments: 3,
  confidence: 85,
};

function makeRow(over = {}) {
  return {
    id: 'sess-1',
    status: 'completed',
    audio_url: 'https://acct.r2.cloudflarestorage.com/niete-bucket/classroom/u-1/sess-1.ogg',
    audio_duration_seconds: null,
    observation_type: 'leader_observation',
    lesson_plan_structured: { _fidelity_ref: { lesson_id: 'lp-1', version_stamp: 'v1', content_hash: 'h1' } },
    lesson_plan_text: null,
    transcript_text: 'Teacher: old flat transcript with no timestamps',
    analysis_data: {
      framework: 'fico',
      domains: { lesson_plan_fidelity: { domain_score: 0, domain_max: 14 } },
      lp_fidelity: { status: 'ok', fidelity_pct: null, meta: { lesson_id: 'lp-1' } },
    },
    ...over,
  };
}

function makeTranscription(over = {}) {
  return {
    transcript: TIMESTAMPED,
    language: 'ur',
    diarization: DIARIZATION,
    tokens: TOKENS,
    silences: [{ start_ms: 1200, end_ms: 20000, duration_ms: 18800 }],
    cost: 0.10,
    ...over,
  };
}

const OK_RESULT = {
  status: 'ok',
  source: 'corpus',
  lesson_id: 'lp-1',
  fidelity_pct: 55,
  band: 'partial',
  meta: { lesson_id: 'lp-1', template: 'T1' },
  graded_at: null,
};

function makeDeps(over = {}) {
  const cleanup = jest.fn();
  return {
    loadSession: jest.fn().mockResolvedValue(makeRow()),
    downloadAudio: jest.fn().mockResolvedValue({ path: '/tmp/fake-backfill.ogg', bytes: 12345, buffer: Buffer.from('x'), cleanup }),
    transcribe: jest.fn().mockResolvedValue(makeTranscription()),
    computeLpFidelity: jest.fn().mockResolvedValue({ ...OK_RESULT }),
    applyLpFidelity: jest.fn((analysis) => { analysis.applied = true; return analysis; }),
    persist: jest.fn().mockResolvedValue({ ok: true }),
    probeDuration: jest.fn().mockResolvedValue(1800),
    log: jest.fn(),
    now: () => new Date('2026-09-03T10:00:00.000Z'),
    _cleanup: cleanup,
    ...over,
  };
}

describe('bd-2kxxa.5 — Section B backfill service', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('T1: completed row → ONE persist with the pipeline transcript columns, pct 55, backfilled_at, status guard incl. completed', async () => {
    const svc = require(SERVICE_REL);
    const deps = makeDeps();

    const res = await svc.backfillSession('sess-1', deps);

    expect(res.ok).toBe(true);
    expect(res.sessionId).toBe('sess-1');
    expect(res.before.pct).toBeNull();
    expect(res.after.pct).toBe(55);
    expect(res.after.status).toBe('ok');

    // the grader ran against the NEW transcript, from the row's corpus ref
    expect(deps.computeLpFidelity).toHaveBeenCalledTimes(1);
    const computeArg = deps.computeLpFidelity.mock.calls[0][0];
    expect(computeArg.transcript).toBe(TIMESTAMPED);
    expect(computeArg.corpusKey).toEqual({ lesson_id: 'lp-1', version_stamp: 'v1', content_hash: 'h1' });

    // fico applyLpFidelity was given the merged analysis + the result
    expect(deps.applyLpFidelity).toHaveBeenCalledTimes(1);
    expect(deps.applyLpFidelity.mock.calls[0][1].fidelity_pct).toBe(55);

    // exactly one persist, in the transcription-processor's column shape
    expect(deps.persist).toHaveBeenCalledTimes(1);
    const [sid, patch, guard] = deps.persist.mock.calls[0];
    expect(sid).toBe('sess-1');
    expect(patch.transcript_text).toBe(TIMESTAMPED);
    expect(patch.transcript_language).toBe('ur');
    expect(patch.diarization_data).toEqual(DIARIZATION);
    expect(patch.diarization_confidence).toBe(85);
    expect(patch.tokens_raw).toEqual(TOKENS);
    expect(patch.silence_markers).toHaveLength(1);
    expect(patch.audio_duration_seconds).toBe(1800); // was null → probed
    expect(patch.analysis_data.framework).toBe('fico');
    expect(patch.analysis_data.applied).toBe(true);
    expect(patch.analysis_data.lp_fidelity.status).toBe('ok');
    expect(patch.analysis_data.lp_fidelity.fidelity_pct).toBe(55);
    expect(patch.analysis_data.lp_fidelity.graded_at).toBe('2026-09-03T10:00:00.000Z');
    expect(patch.analysis_data.lp_fidelity.meta.lesson_id).toBe('lp-1');
    expect(patch.analysis_data.lp_fidelity.meta.template).toBe('T1');
    expect(patch.analysis_data.lp_fidelity.meta.backfilled_at).toBe('2026-09-03T10:00:00.000Z');
    expect(patch.analysis_data.lp_fidelity.meta.backfill_source).toBe('retranscribe');
    // the job never touches the rest of the row
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('audio_url');

    // status guard (CAS part 1) — the submitted statuses the recompute refuses
    expect(guard.allowedStatuses).toEqual(expect.arrayContaining(['completed', 'observer_review_complete', 'awaiting_observer_review', 'cancelled']));
    expect(guard.allowedStatuses).toContain('completed');
    // pct-still-null guard (CAS part 2)
    expect(guard.requirePctNull).toBe(true);

    // temp audio is cleaned up
    expect(deps._cleanup).toHaveBeenCalledTimes(1);
  });

  test('T1b: audio_duration_seconds already set → not rewritten, no probe', async () => {
    const svc = require(SERVICE_REL);
    const deps = makeDeps({ loadSession: jest.fn().mockResolvedValue(makeRow({ audio_duration_seconds: 2400 })) });
    const res = await svc.backfillSession('sess-1', deps);
    expect(res.ok).toBe(true);
    expect(deps.probeDuration).not.toHaveBeenCalled();
    expect(deps.persist.mock.calls[0][1]).not.toHaveProperty('audio_duration_seconds');
  });

  test('T2: dryRun → persist NOT called, after.pct = 55, reports what would be written', async () => {
    const svc = require(SERVICE_REL);
    const deps = makeDeps({ dryRun: true });
    const res = await svc.backfillSession('sess-1', deps);

    expect(deps.persist).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(true);
    expect(res.persisted).toBe(false);
    expect(res.after.pct).toBe(55);
    expect(res.wouldWrite.pct).toBe(55);
    expect(res.wouldWrite.transcriptLength).toBe(TIMESTAMPED.length);
    expect(res.wouldWrite.timestampCount).toBe(3);
    expect(res.wouldWrite.diarizationSegments).toBe(3);
    // the transcription DID run (dry-run measures the real re-transcript)
    expect(deps.transcribe).toHaveBeenCalledTimes(1);
    expect(deps._cleanup).toHaveBeenCalledTimes(1);
  });

  test('T3: re-transcript still has no [MM:SS] timestamps → persist NOT called, reason still_untimestamped, grader not run', async () => {
    const svc = require(SERVICE_REL);
    const deps = makeDeps({
      transcribe: jest.fn().mockResolvedValue(makeTranscription({
        transcript: UNTIMESTAMPED,
        diarization: { speakers: [], segments: [], totalSegments: 0, confidence: 50 },
        tokens: [],
      })),
    });
    const res = await svc.backfillSession('sess-1', deps);

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('still_untimestamped');
    expect(deps.computeLpFidelity).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps._cleanup).toHaveBeenCalledTimes(1);
  });

  test('T4: row already has fidelity_pct → skipped, no download, no transcription, no persist', async () => {
    const svc = require(SERVICE_REL);
    const row = makeRow();
    row.analysis_data.lp_fidelity.fidelity_pct = 40;
    const deps = makeDeps({ loadSession: jest.fn().mockResolvedValue(row) });
    const res = await svc.backfillSession('sess-1', deps);

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('skipped_not_null');
    expect(res.before.pct).toBe(40);
    expect(deps.downloadAudio).not.toHaveBeenCalled();
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.computeLpFidelity).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  test('T4b: status outside BACKFILL_STATUSES (a live analysis) → refused before any I/O', async () => {
    const svc = require(SERVICE_REL);
    const deps = makeDeps({ loadSession: jest.fn().mockResolvedValue(makeRow({ status: 'analysis_started' })) });
    const res = await svc.backfillSession('sess-1', deps);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('status_not_backfillable');
    expect(deps.downloadAudio).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
    expect(svc.BACKFILL_STATUSES).toEqual(['completed', 'observer_review_complete', 'awaiting_observer_review', 'cancelled']);
  });

  test('T4c: CAS lost (persist matched 0 rows because pct was filled concurrently) → ok:false, reason cas_lost', async () => {
    const svc = require(SERVICE_REL);
    const deps = makeDeps({ persist: jest.fn().mockResolvedValue({ ok: false }) });
    const res = await svc.backfillSession('sess-1', deps);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('cas_lost');
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  test('T4d: grader returns ok but pct still null (all moves not_adjudicable) → no persist, reason still_unscorable', async () => {
    const svc = require(SERVICE_REL);
    const deps = makeDeps({ computeLpFidelity: jest.fn().mockResolvedValue({ ...OK_RESULT, fidelity_pct: null }) });
    const res = await svc.backfillSession('sess-1', deps);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('still_unscorable');
    expect(deps.persist).not.toHaveBeenCalled();
  });

  test('T5: WhatsApp is never required — default transcribe wiring runs with whatsapp.service mocked to throw on load', async () => {
    jest.doMock(WHATSAPP_REL, () => {
      throw new Error('whatsapp.service must never be loaded by the Section B backfill');
    });
    const audioTranscribe = jest.fn().mockResolvedValue({ text: TIMESTAMPED, language: 'ur', tokens: TOKENS });
    jest.doMock(AUDIO_REL, () => ({
      transcribe: audioTranscribe,
      getAudioDuration: jest.fn().mockResolvedValue(1800),
    }));

    // the CLI must be loadable without WhatsApp either (it only runs under require.main)
    const cli = require(SCRIPT_REL);
    expect(typeof cli.parseArgs).toBe('function');

    const svc = require(SERVICE_REL);
    const deps = makeDeps();
    delete deps.transcribe;      // exercise the DEFAULT transcribe (AudioService + diarization builder)
    delete deps.probeDuration;   // exercise the DEFAULT probe (AudioService.getAudioDuration)

    const res = await svc.backfillSession('sess-1', deps);

    expect(res.ok).toBe(true);
    // the same call a live classroom observation makes: diarization on, auto language, classroom roles
    expect(audioTranscribe).toHaveBeenCalledTimes(1);
    expect(audioTranscribe).toHaveBeenCalledWith('/tmp/fake-backfill.ogg', true, null, null);

    // diarization_data built from tokens in the pipeline's shape
    const patch = deps.persist.mock.calls[0][1];
    expect(patch.transcript_text).toBe(TIMESTAMPED);
    expect(patch.tokens_raw).toEqual(TOKENS);
    expect(patch.diarization_data.totalSegments).toBe(3);
    expect(patch.diarization_data.confidence).toBe(85);
    expect(patch.diarization_data.speakers.map((s) => s.label)).toEqual(['Teacher', 'Student']);
    expect(patch.diarization_data.segments[0]).toMatchObject({ speaker: '1', label: 'Teacher', start_ms: 1000, end_ms: 1200 });
    expect(patch.silence_markers).toHaveLength(2); // 1200→20000 and 20100→65000 gaps
    expect(patch.audio_duration_seconds).toBe(1800);

    // and statically: neither file mentions WhatsApp at all
    const svcSrc = fs.readFileSync(path.resolve(__dirname, `${SERVICE_REL}.js`), 'utf8');
    const cliSrc = fs.readFileSync(path.resolve(__dirname, `${SCRIPT_REL}.js`), 'utf8');
    expect(svcSrc.toLowerCase()).not.toMatch(/whatsapp/);
    expect(cliSrc.toLowerCase()).not.toMatch(/whatsapp/);
  });

  test('T6: CLI parseArgs — defaults, flags, and the confirm gate', () => {
    const cli = require(SCRIPT_REL);
    const a = cli.parseArgs(['--since', '2026-08-28', '--until', '2026-09-04', '--limit', '5', '--concurrency', '2', '--dry-run', '--out', 'r.jsonl']);
    expect(a).toMatchObject({ since: '2026-08-28', until: '2026-09-04', limit: 5, concurrency: 2, dryRun: true, out: 'r.jsonl' });
    const b = cli.parseArgs(['--ids', 'a,b,c']);
    expect(b.ids).toEqual(['a', 'b', 'c']);
    expect(b.dryRun).toBe(false);
    expect(b.concurrency).toBe(2);
    // without --dry-run the job needs BACKFILL_CONFIRM=SECTION_B
    expect(cli.confirmGate({ dryRun: false }, {})).toMatch(/BACKFILL_CONFIRM=SECTION_B/);
    expect(cli.confirmGate({ dryRun: false }, { BACKFILL_CONFIRM: 'SECTION_B' })).toBeNull();
    expect(cli.confirmGate({ dryRun: true }, {})).toBeNull();
  });
});
