/**
 * bd-i3618q — the retry plan, now in its own file (observe-resume-retry.js), still picks the
 * phase to re-enter from what the row holds, and stops after MAX_RETRIES.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendInteractiveButtons: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { _retryPlan, MAX_RETRIES } = require('../../shared/services/observe/observe-resume-retry');
const Resume = require('../../shared/services/observe/observe-resume.service');

const row = (over) => ({ status: 'failed', analysis_data: null, transcript_text: null, audio_id: null, ...over });

describe('bd-i3618q — _retryPlan after the split', () => {
  test('a transcribing row with audio re-enters at transcription', () => {
    expect(_retryPlan(row({ status: 'transcribing', audio_id: 'a' }))).toEqual({ ok: true, queue: 'transcription', count: 0 });
  });
  test('an analysing row with no transcript falls back to transcription', () => {
    expect(_retryPlan(row({ status: 'analyzing', audio_id: 'a' })).queue).toBe('transcription');
  });
  test('a failed row with a transcript goes to analysis', () => {
    expect(_retryPlan(row({ transcript_text: 't' })).queue).toBe('analysis');
  });
  test('a row with neither audio nor transcript is refused', () => {
    expect(_retryPlan(row({}))).toEqual({ ok: false, reason: 'nothing_to_retry_from', count: 0 });
  });
  test('the bound stops the retry at MAX_RETRIES', () => {
    const plan = _retryPlan(row({ audio_id: 'a', analysis_data: { observe_retry_count: MAX_RETRIES } }));
    expect(plan).toEqual({ ok: false, reason: 'retry_bound_reached', count: MAX_RETRIES });
  });
  test('observe-resume.service still exports the same runRetry', () => {
    expect(Resume.runRetry).toBe(require('../../shared/services/observe/observe-resume-retry').runRetry);
  });
});
