'use strict';
/**
 * bd-b3pop.31 (Eval 12 §4 / §8) — a transcript with NO [MM:SS] stamps is decided in code, before any model call.
 *
 * Why: every verdict above not_done must quote a `[MM:SS]` span, so a stamp-less transcript cannot be adjudicated move by
 * move under the grader's own rules. Luna returns `recording_unusable` (no score) on the D19 fixture; Gemini 3.8 Flash
 * returns 0% + `lesson_mismatch` in 9 of 12 runs — a teacher with a bad recording would get 0/40 and a mismatch line.
 * On prod (2,685 graded sessions, 15–22 Sep) 2 transcripts carry no stamps and both were already unscored, so the guard
 * changes nothing today and removes the model from the decision.
 */
const { computeLpFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');

const MOVES = [
  { move_id: 'm1', phase: 'explain', text: 'Model the subtraction on the board', bucket: 'must_happen' },
  { move_id: 'm2', phase: 'guided', text: 'Pairs solve two problems', bucket: 'must_happen' },
  { move_id: 'm3', phase: 'homework', text: 'Assign page 12', bucket: 'optional_extension' },
];
const KEY = { lesson_id: 'L', version_stamp: 'v', content_hash: 'h' };
const NO_STAMPS = 'बच्चों आज हम गुणा करेंगे। मौल्टी प्रीकेंट मौल्टी प्रीकेंट मौल्टी प्रीकेंट टाइम्स शीट्स कलर '.repeat(40);
const STAMPED = '[00:10] Teacher: آج ہم تفریق کریں گے۔\n\n[10:00] Teacher: دو دو بچے مل کے حل کریں۔';

const deps = (analyze) => ({
  resolveMoveList: async () => ({ moves: MOVES, lesson_id: 'L', template: 'STANDARD', resolved: 'exact' }),
  extractUploadedLp: async () => null,
  analyzeFidelity: analyze,
});

describe('unusable-recording guard (no timestamps)', () => {
  const saved = process.env.LP_FIDELITY_RUNS;
  beforeEach(() => { delete process.env.LP_FIDELITY_RUNS; });
  afterEach(() => { if (saved === undefined) delete process.env.LP_FIDELITY_RUNS; else process.env.LP_FIDELITY_RUNS = saved; });

  test('a transcript with no [MM:SS] stamps is "not scored": every move not_adjudicable, no model call, recording_unusable', async () => {
    let calls = 0;
    const analyze = async () => { calls += 1; return { verdicts: MOVES.map((m) => ({ move_id: m.move_id, verdict: 'not_done', evidence: '' })), model: 'g', moderators: { note: 'lesson_mismatch' } }; };
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: NO_STAMPS, audioDurationSeconds: 1800 }, deps(analyze));
    expect(calls).toBe(0);
    expect(r.status).toBe('ok');
    expect(r.fidelity_pct).toBe(null);
    expect(r.recording_unusable).toBe(true);
    expect(r.recording).toMatchObject({ stamps: 0, no_timestamps: true });
    expect(r.moderators).toMatchObject({ note: 'recording_unusable' });
    expect(r.moves.map((m) => m.verdict)).toEqual(['not_adjudicable', 'not_adjudicable', 'not_adjudicable']);
    expect(r.moves.every((m) => m.counted === false)).toBe(true);
    expect(r.not_assessed).toEqual(['m1', 'm2', 'm3']);
    expect(r.model).toBe(null);
    expect(r.runs).toEqual([]);
    expect(r.unusable_guard).toBe('no_timestamps');
    expect(r.source).toBe('corpus');
    expect(r.lesson_id).toBe('L');
  });

  test('the guard does not fire on a stamped transcript — the grader is called as before', async () => {
    let calls = 0;
    const analyze = async () => { calls += 1; return { verdicts: [{ move_id: 'm1', verdict: 'executed', evidence: '[00:10] x' }, { move_id: 'm2', verdict: 'not_done', evidence: '' }, { move_id: 'm3', verdict: 'not_done', evidence: '' }], model: 'g' }; };
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: STAMPED, audioDurationSeconds: 1800 }, deps(analyze));
    expect(calls).toBe(1);
    expect(r.fidelity_pct).toBe(50);
    expect(r.recording.no_timestamps).toBe(false);
    expect(r).not.toHaveProperty('unusable_guard');
  });
});
