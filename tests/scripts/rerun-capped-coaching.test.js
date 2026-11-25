/**
 * bd-t74k6s — the NIETE prod OpenRouter key hit its $2,000 total cap on 25 Nov 2026 (05:05-05:44Z).
 * SQS's three receives recovered most analyses; the rows that spent all three are left at status=failed.
 * The re-run puts each such recording back at 'analyzing' with an old updated_at, so the bd-h9gnk mid-flight
 * watchdog retries it once from analysis. One row per recording: a second upload of the same audio is skipped.
 */
const { planRerun, rerun } = require('../../bot/scripts/rerun-capped-coaching');

const NOW = Date.parse('2026-11-25T07:00:00Z');
const row = (id, over = {}) => ({
  id, user_id: 'u1', status: 'failed', failed_step: 'analysis', audio_hash: `h-${id}`,
  error_message: '403 Key limit exceeded (total limit).', transcript_text: 'x',
  created_at: '2026-11-25T05:10:00Z', watchdog: null, ...over,
});

describe('planRerun', () => {
  test('a failed analysis with a transcript and the cap error is re-run', () => {
    const out = planRerun([row('a')], []);
    expect(out.rerun.map((r) => r.id)).toEqual(['a']);
  });

  test('the same recording uploaded twice is re-run once (the earliest)', () => {
    const out = planRerun([
      row('late', { audio_hash: 'same', created_at: '2026-11-25T05:07:00Z' }),
      row('early', { audio_hash: 'same', created_at: '2026-11-25T05:05:00Z' }),
    ], []);
    expect(out.rerun.map((r) => r.id)).toEqual(['early']);
    expect(out.skipped).toEqual([{ id: 'late', reason: 'duplicate_upload' }]);
  });

  test('a recording the teacher already sent again and that is going is not re-run', () => {
    const out = planRerun([row('a', { audio_hash: 'h' })],
      [{ id: 'b', user_id: 'u1', audio_hash: 'h', status: 'completed' }]);
    expect(out.rerun).toHaveLength(0);
    expect(out.skipped).toEqual([{ id: 'a', reason: 'resent_and_going' }]);
  });

  test('anything else is set aside with its reason, never guessed', () => {
    const out = planRerun([
      row('s', { status: 'completed' }),
      row('e', { error_message: 'All transcription methods failed' }),
      row('t', { transcript_text: null }),
      row('w', { watchdog: { retried_at: '2026-11-25T06:00:00Z' } }),
    ], []);
    expect(out.rerun).toHaveLength(0);
    expect(out.skipped.map((s) => s.reason)).toEqual(
      ['not_failed', 'not_the_cap_error', 'no_transcript', 'watchdog_retry_spent']);
  });
});

describe('rerun', () => {
  const plan = { rerun: [row('a')], skipped: [] };

  test('dry run writes nothing', async () => {
    const patch = jest.fn();
    const out = await rerun(plan, { apply: false, patch, now: NOW });
    expect(patch).not.toHaveBeenCalled();
    expect(out).toEqual({ planned: 1, written: 0 });
  });

  test('apply puts the row back at analyzing, only while it is still failed, aged past the 45-min watchdog line', async () => {
    const patch = jest.fn().mockResolvedValue(1);
    const out = await rerun(plan, { apply: true, patch, now: NOW });
    expect(patch).toHaveBeenCalledWith('a', 'failed', {
      status: 'analyzing',
      updated_at: new Date(NOW - 46 * 60 * 1000).toISOString(),
    });
    expect(out).toEqual({ planned: 1, written: 1 });
  });

  test('a row that changed under us (0 rows matched) is not counted', async () => {
    const patch = jest.fn().mockResolvedValue(0);
    const out = await rerun(plan, { apply: true, patch, now: NOW });
    expect(out.written).toBe(0);
  });
});
