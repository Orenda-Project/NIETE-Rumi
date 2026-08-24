/**
 * bd-h9gnk — a mid-flight analysis that dies stays dead, silently.
 *
 * Farzana 923465743675, session 589ddfb3: activity until minute 28, then
 * nothing (deploy-kill / unretried LLM error) — stuck at analysis_started for
 * 4+ hours while she waited. The recovery worker only watched the 'initiated'
 * confirmation gate (bd-2417), the photo gate (bd-j3j4b) and observe stages
 * (bd-tju8f). Nothing watched transcribing → generating_report.
 *
 * The watchdog: in-flight and untouched for >45 min → ONE retry from the phase
 * it died in; if the retry was already spent → fail LOUDLY (status='failed' +
 * an honest message to the teacher asking her to resend).
 */

const {
  classifyStuckMidFlightSession,
  MIDFLIGHT_STUCK_AGE_MS,
  WATCHDOG_STATUSES,
} = require('../../bot/shared/services/coaching/coaching-stale-recovery');

const fs = require('fs');
const path = require('path');

const NOW = 1_700_000_000_000;
const agoMin = (m) => new Date(NOW - m * 60_000).toISOString();
const base = (over = {}) => ({
  status: 'analysis_started',
  updated_at: agoMin(60),
  audio_id: 'audio-1',
  analysis_data: {},
  ...over,
});

describe('bd-h9gnk — classifyStuckMidFlightSession', () => {
  it('covers every processing status between transcription and report', () => {
    expect([...WATCHDOG_STATUSES].sort()).toEqual([
      'analysis_complete', 'analysis_started', 'analyzing',
      'generating_report', 'transcribing', 'transcription_complete',
    ].sort());
  });

  it('skips a session still inside the 45-minute grace window', () => {
    expect(MIDFLIGHT_STUCK_AGE_MS).toBe(45 * 60 * 1000);
    const d = classifyStuckMidFlightSession(base({ updated_at: agoMin(20) }), NOW);
    expect(d.action).toBe('skip');
  });

  it('skips statuses other sweeps already own (initiated, awaiting_*, terminal)', () => {
    for (const status of ['initiated', 'awaiting_photo', 'awaiting_lesson_plan',
      'conducting_conversation', 'completed', 'failed', 'abandoned']) {
      expect(classifyStuckMidFlightSession(base({ status }), NOW).action).toBe('skip');
    }
  });

  it("skips observe sessions — the bd-tju8f sweep owns those, coach-addressed", () => {
    const d = classifyStuckMidFlightSession(
      base({ observation_type: 'leader_observation' }), NOW);
    expect(d.action).toBe('skip');
  });

  it('first strike: retries from the phase the session died in', () => {
    expect(classifyStuckMidFlightSession(base({ status: 'transcribing' }), NOW))
      .toMatchObject({ action: 'retry', queue: 'transcription' });
    for (const status of ['transcription_complete', 'analyzing', 'analysis_started']) {
      expect(classifyStuckMidFlightSession(base({ status }), NOW))
        .toMatchObject({ action: 'retry', queue: 'analysis' });
    }
    for (const status of ['analysis_complete', 'generating_report']) {
      expect(classifyStuckMidFlightSession(base({ status }), NOW))
        .toMatchObject({ action: 'retry', queue: 'report' });
    }
  });

  it('a transcription retry with no audio id fails instead (nothing to transcribe)', () => {
    const d = classifyStuckMidFlightSession(
      base({ status: 'transcribing', audio_id: null }), NOW);
    expect(d.action).toBe('fail');
  });

  it('second strike: a spent retry fails LOUDLY, never loops', () => {
    const d = classifyStuckMidFlightSession(
      base({ analysis_data: { watchdog: { retried_at: agoMin(50) } } }), NOW);
    expect(d.action).toBe('fail');
  });

  it('falls back to created_at when updated_at is absent', () => {
    const d = classifyStuckMidFlightSession(
      base({ updated_at: undefined, created_at: agoMin(90) }), NOW);
    expect(d.action).toBe('retry');
  });
});

describe('bd-h9gnk — worker wiring', () => {
  const src = () => fs.readFileSync(
    path.join(__dirname, '../../bot/workers/stale-session.worker.js'), 'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('runRecovery runs the mid-flight sweep (non-blocking like its siblings)', () => {
    const body = src().match(/async function runRecovery\(\)[\s\S]*?\n}/);
    expect(body).toBeTruthy();
    expect(body[0]).toContain('processStuckMidFlightSessions');
  });

  it('the sweep query excludes observe rows and orders by staleness', () => {
    const sweep = src().match(/async function processStuckMidFlightSessions\(\)[\s\S]*?\n}/);
    expect(sweep).toBeTruthy();
    expect(sweep[0]).toContain("observation_type.is.null,observation_type.neq.leader_observation");
    expect(sweep[0]).toContain('updated_at');
  });
});

describe('bd-h9gnk — the failure message is honest and translated', () => {
  const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

  it('tells her it failed and to resend, in English and real Urdu', () => {
    const en = getCoachingMessage('coaching_analysisStalledFail', 'en');
    expect(en.toLowerCase()).toContain('again');
    const ur = getCoachingMessage('coaching_analysisStalledFail', 'ur');
    expect(ur).not.toEqual(en);
    expect(ur).toMatch(/[؀-ۿ]/);
  });
});
