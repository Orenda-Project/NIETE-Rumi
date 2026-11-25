/**
 * bd-ja1r3g — the 26 quizzes the 25 Nov 2026 OpenRouter key cap lost (bd-t74k6s, bd-6pakkv).
 * 18 recording offers were skipped `model_failed` before the teacher saw them: they go back through the
 * normal offer job. 8 quizzes failed `model_failed` after the teacher said yes: they are made again and sent.
 * A teacher whose 24 h window is closed is not messaged. Nothing here talks to a service.
 */
const S = require('../../scripts/reoffer-lost-quizzes');

const NOW = '2026-11-25T09:00:00.000Z';
const KEY_ERR = 'digest: 403 Key limit exceeded (total limit).';
const offerRow = (id, over = {}) => ({
  id, teacher_id: `t-${id}`, quiz_source: 'transcript', status: 'skipped', coaching_session_id: `cs-${id}`,
  meta: { step: 'skipped', skip_reason: 'model_failed', error: KEY_ERR }, ...over,
});
const failedRow = (id, source, over = {}) => ({
  id, teacher_id: `t-${id}`, quiz_source: source, status: 'failed', coaching_session_id: source === 'transcript' ? `cs-${id}` : null,
  meta: { step: 'failed', error: 'model_failed', error_detail: KEY_ERR, source: 'home', lessons: [{ lesson_id: 'l1' }] }, ...over,
});

describe('actionFor', () => {
  test('a recording offer skipped model_failed is offered again', () => {
    expect(S.actionFor(offerRow('a'))).toEqual({ action: 'offer' });
  });
  test('a plan quiz that failed model_failed is made again through the plan remake', () => {
    expect(S.actionFor(failedRow('b', 'lp_v8'))).toEqual({ action: 'remake_plan' });
    expect(S.actionFor(failedRow('c', 'lp612'))).toEqual({ action: 'remake_plan' });
  });
  test('a recording quiz that failed model_failed after the yes is made again', () => {
    expect(S.actionFor(failedRow('d', 'transcript'))).toEqual({ action: 'remake_recording' });
  });
  test('a row that moved on since the outage is left alone', () => {
    expect(S.actionFor(offerRow('e', { status: 'offered' }))).toEqual({ skip: 'now_offered' });
    expect(S.actionFor(failedRow('f', 'lp_v8', { status: 'sent' }))).toEqual({ skip: 'now_sent' });
    expect(S.actionFor(offerRow('g', { meta: { skip_reason: 'low_confidence' } }))).toEqual({ skip: 'now_skipped' });
    expect(S.actionFor(failedRow('h', 'lp_v8', { meta: { error: 'source_missing' } }))).toEqual({ skip: 'now_failed' });
    expect(S.actionFor(null)).toEqual({ skip: 'missing' });
  });
});

describe('planReoffer', () => {
  const rows = [offerRow('a'), offerRow('b'), failedRow('c', 'lp_v8'), failedRow('d', 'transcript'), offerRow('e', { status: 'sent' })];
  test('sorts each quiz to its step, the first offer is the AI test', () => {
    const p = S.planReoffer(rows, () => true);
    expect(p.offer.map((r) => r.id)).toEqual(['a', 'b']);
    expect(p.canary.id).toBe('a');
    expect(p.remakePlan.map((r) => r.id)).toEqual(['c']);
    expect(p.remakeRecording.map((r) => r.id)).toEqual(['d']);
    expect(p.skipped).toEqual([{ id: 'e', reason: 'now_sent' }]);
  });
  test('a teacher whose window is closed is not messaged', () => {
    const p = S.planReoffer(rows, (r) => r.id !== 'a' && r.id !== 'c');
    expect(p.offer.map((r) => r.id)).toEqual(['b']);
    expect(p.canary.id).toBe('b');
    expect(p.remakePlan).toEqual([]);
    expect(p.skipped).toEqual(expect.arrayContaining([
      { id: 'a', reason: 'window_closed' }, { id: 'c', reason: 'window_closed' },
    ]));
  });
  test('no offer left means no AI test', () => {
    expect(S.planReoffer([failedRow('c', 'lp_v8')], () => true).canary).toBeNull();
  });
});

describe('heldMeta', () => {
  test('turns the skip into the held state the offer job revives, keeping the old reason', () => {
    const m = S.heldMeta(offerRow('a').meta, NOW);
    expect(m.skip_reason).toBe('window_closed');
    expect(m.held_path).toBe('none');
    expect(m.reoffer_of).toBe('model_failed');
    expect(m.reoffered_at).toBe(NOW);
    expect(m.error).toBe(KEY_ERR);
  });
});

describe('recordingRemakeMeta', () => {
  test('clears the error, counts the remake and restarts at the digest', () => {
    const m = S.recordingRemakeMeta(failedRow('d', 'transcript').meta, NOW);
    expect(m.error).toBeUndefined();
    expect(m.error_detail).toBeUndefined();
    expect(m).toMatchObject({ step: 'digest', remakes: 1, previous_error: 'model_failed', remade_at: NOW,
      accepted_at: NOW, remake_source: 'reoffer' });
  });
  test('a quiz that already has its digest goes straight to the author', () => {
    const m = S.recordingRemakeMeta({ error: 'model_failed', digest: { slos: [] }, remakes: 1 }, NOW);
    expect(m.step).toBe('author');
    expect(m.remakes).toBe(2);
  });
});

describe('outcomeOf / tally', () => {
  test('offer outcomes', () => {
    expect(S.outcomeOf('offer', { status: 'offered', meta: {} })).toBe('sent');
    expect(S.outcomeOf('offer', { status: 'declined', meta: {} })).toBe('sent');
    expect(S.outcomeOf('offer', { status: 'sent', meta: {} })).toBe('sent');
    expect(S.outcomeOf('offer', { status: 'skipped', meta: { skip_reason: 'model_failed' } })).toBe('failed');
    expect(S.outcomeOf('offer', { status: 'skipped', meta: { skip_reason: 'window_closed', reoffer_of: 'model_failed' } })).toBe('pending');
    expect(S.outcomeOf('offer', { status: 'skipped', meta: { skip_reason: 'window_closed' } })).toBe('not_sent_window');
    expect(S.outcomeOf('offer', { status: 'skipped', meta: { skip_reason: 'low_confidence' } })).toBe('not_sent_other');
    expect(S.outcomeOf('offer', { status: 'generating', meta: {} })).toBe('pending');
  });
  test('remake outcomes', () => {
    expect(S.outcomeOf('remake', { status: 'sent', meta: {} })).toBe('sent');
    expect(S.outcomeOf('remake', { status: 'report_sent', meta: {} })).toBe('sent');
    expect(S.outcomeOf('remake', { status: 'failed', meta: {} })).toBe('failed');
    expect(S.outcomeOf('remake', { status: 'generating', meta: {} })).toBe('pending');
    expect(S.outcomeOf('remake', { status: 'ready', meta: {} })).toBe('pending');
  });
  test('tally counts outcomes', () => {
    expect(S.tally(['sent', 'sent', 'failed'])).toEqual({ sent: 2, failed: 1 });
  });
});

describe('costOf', () => {
  test('sums every cost_usd in a quiz meta, nested too', () => {
    expect(S.costOf({ cost_usd: 0.01, key_verify: { cost_usd: 0.02 }, x: { y: { cost_usd: 0.03 } }, n: 'a' }))
      .toBeCloseTo(0.06);
    expect(S.costOf(null)).toBe(0);
  });
});
