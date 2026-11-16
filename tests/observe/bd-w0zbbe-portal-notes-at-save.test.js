'use strict';
/**
 * bd-w0zbbe — a coach's debrief notes (the talk guide) on the PORTAL are written when she saves her review, not when
 * she first opens Debrief.
 *
 * Production, 16 Nov (visit df9d3f17, a FICO v6 test visit): she saved the review, opened Debrief, saw "Writing your
 * guide" beside the Record and Upload buttons, and left 4 s later. The guide's model call took 20.4 s; it finished and
 * was kept on the row, but she had gone and read it as "I did not receive the debrief notes". Every coach opening
 * Debrief for a FICO (v3/v6) visit waits that long the first time.
 *
 * Now: a successful save starts writing the notes in the background (the save does not wait for them); an ask that
 * arrives while they are being written shares that one model call; a later save before the talk writes them again from
 * the newer review; once the talk is recorded a save leaves the notes alone. A failure while writing them is logged and
 * never fails the save — Debrief still writes them on open, as before.
 */

const SVC = '../../bot/shared/services/observe/portal-observe.service';

const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const TEACHER_UID = '7eac0000-0000-4000-8000-000000000003';
const KEY = `classroom_audio/${COACH}/2026-11/portal_abc123.webm`;
const SID = 'cs-obs-notes';

function fakeSupabase(answer) {
  const from = (table) => {
    const q = { table, filters: {} };
    const self = new Proxy(q, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'eq') return (c, v) => { target.filters[c] = v; return self; };
        if (prop === 'single' || prop === 'maybeSingle') {
          return async () => {
            const fn = answer[table];
            const data = typeof fn === 'function' ? fn(target.filters) : (fn ?? null);
            return { data: Array.isArray(data) ? (data[0] || null) : data, error: null };
          };
        }
        if (prop === 'then') {
          return (res, rej) => {
            const fn = answer[table];
            const data = typeof fn === 'function' ? fn(target.filters) : (fn ?? null);
            return Promise.resolve({ data, error: null }).then(res, rej);
          };
        }
        return () => self;
      },
    });
    return self;
  };
  return { from };
}

const coachRow = () => ({ id: COACH, phone_number: '923330000000', role: 'coach', name: 'Test Coach', preferred_language: 'en' });

function obsRow(over = {}) {
  return {
    id: SID,
    user_id: TEACHER_UID,
    observer_user_id: COACH,
    observation_type: 'leader_observation',
    audio_url: `https://r2.example/bucket/${KEY}`,
    status: 'observer_review_complete',
    debrief_status: 'pending',
    created_at: '2026-11-16T07:12:00Z',
    analysis_data: { framework: 'fico' },
    users: { name: 'Test Teacher', phone_number: '923990000001' },
    ...over,
  };
}

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const GUIDE = { intro: 'Open with what worked.', sections: { strengths: { title: 'S', body: 'b' } }, reflection_question: 'q', outro: '' };

/** rows: what each read of coaching_sessions returns, in turn (the last one repeats). */
function deps({ rows, build } = {}) {
  const queue = [...(rows || [obsRow({ status: 'awaiting_observer_review' }), obsRow()])];
  const nextRow = () => (queue.length > 1 ? queue.shift() : queue[0]);
  return {
    supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => nextRow() }),
    draft: { applyObserverEdits: jest.fn().mockResolvedValue({ indicators_rescored: 1, text_fields_changed: 0 }) },
    debrief: {
      buildDebriefGuide: build || jest.fn().mockResolvedValue(GUIDE),
      mergeObserverDebrief: jest.fn().mockResolvedValue({}),
      freshRecordingPatch: jest.fn(() => ({})),
    },
    state: { getState: jest.fn().mockResolvedValue(null), clearState: jest.fn().mockResolvedValue(true) },
    languageFor: jest.fn().mockResolvedValue('en'),
    log: jest.fn(),
    now: () => new Date('2026-11-16T07:25:14Z'),
    newId: () => 'nonce-1',
  };
}

const flush = () => new Promise((r) => setImmediate(r));

let Svc;
beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

describe('the debrief notes are written when the review is saved', () => {
  test('a save starts writing the notes from the saved review, and keeps them on the row', async () => {
    const saved = obsRow({ analysis_data: { framework: 'fico', edited: true } });
    const d = deps({ rows: [obsRow({ status: 'awaiting_observer_review' }), saved] });
    expect(await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: { r_C1: '2' } }, d)).toMatchObject({ status: 'ok' });
    await flush();
    expect(d.debrief.buildDebriefGuide).toHaveBeenCalledTimes(1);
    expect(d.debrief.buildDebriefGuide).toHaveBeenCalledWith(expect.objectContaining({ id: SID, analysis_data: saved.analysis_data }), 'en');
    expect(d.debrief.mergeObserverDebrief).toHaveBeenCalledWith(SID, { guide_snapshot: GUIDE });
  });

  test('the save answers at once; it does not wait for the notes', async () => {
    const slow = deferred();
    const d = deps({ build: jest.fn(() => slow.promise) });
    const answer = await Promise.race([
      Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: {} }, d),
      new Promise((r) => setTimeout(() => r('waited'), 200)),
    ]);
    expect(answer).toMatchObject({ status: 'ok' });
    slow.resolve(GUIDE);
  });

  test('Debrief opened while the notes are being written shares that one model call', async () => {
    const slow = deferred();
    const build = jest.fn(() => slow.promise);
    const d = deps({ build });
    await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: {} }, d);
    await flush();
    expect(build).toHaveBeenCalledTimes(1); // the save started it
    const asked = Svc.talkGuide({ userId: COACH, coachingSessionId: SID }, d);
    await flush();
    slow.resolve(GUIDE);
    expect(await asked).toEqual({ status: 'ok', guide: GUIDE });
    expect(build).toHaveBeenCalledTimes(1);
  });

  test('a later save, before the talk, writes the notes again from the newer review', async () => {
    const d = deps({
      rows: [
        obsRow({ analysis_data: { framework: 'fico', observer_debrief: { guide_snapshot: { intro: 'old' } } } }),
        obsRow({ analysis_data: { framework: 'fico', v: 2, observer_debrief: { guide_snapshot: { intro: 'old' } } } }),
      ],
    });
    await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: {} }, d);
    await flush();
    expect(d.debrief.buildDebriefGuide).toHaveBeenCalledTimes(1);
    expect(d.debrief.mergeObserverDebrief).toHaveBeenCalledWith(SID, { guide_snapshot: GUIDE });
  });

  test.each([
    ['the talk is recorded', { observer_debrief: { guide_snapshot: { intro: 'kept' }, audio_r2_key: 'k/talk.webm' } }, 'pending'],
    ['the talk is coached', { observer_debrief: { guide_snapshot: { intro: 'kept' } } }, 'done'],
  ])('once %s, a save leaves the notes alone', async (_name, analysis, debriefStatus) => {
    const row = obsRow({ debrief_status: debriefStatus, analysis_data: { framework: 'fico', ...analysis } });
    const d = deps({ rows: [row, row] });
    await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: {} }, d);
    await flush();
    expect(d.debrief.buildDebriefGuide).not.toHaveBeenCalled();
  });

  test('notes that fail to write are logged and never fail the save; Debrief writes them on open', async () => {
    const build = jest.fn().mockRejectedValueOnce(new Error('model down')).mockResolvedValueOnce(GUIDE);
    const d = deps({ build });
    expect(await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: {} }, d)).toMatchObject({ status: 'ok' });
    await flush();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('debrief notes'), expect.objectContaining({ coachingSessionId: SID }), 'error');
    expect(await Svc.talkGuide({ userId: COACH, coachingSessionId: SID }, d)).toEqual({ status: 'ok', guide: GUIDE });
    expect(build).toHaveBeenCalledTimes(2);
  });

  test('a refused save (the visit was cancelled mid-save) writes no notes', async () => {
    const d = deps();
    d.draft.applyObserverEdits.mockResolvedValue({ refused: 'terminal' });
    expect(await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: {} }, d)).toEqual({ status: 'not_ready', reason: 'terminal' });
    await flush();
    expect(d.debrief.buildDebriefGuide).not.toHaveBeenCalled();
  });
});
