'use strict';
/**
 * bd-b3pop.8 / .12 / .15 — orchestrator wiring through the REAL scorer, pre-flight and photo normaliser: deps inject only
 * the plan store and the LLM call (the I/O boundary).
 */
const { computeLpFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');

const MOVES = [{ move_id: 'm1', phase: 'explain', text: 'a', bucket: 'must_happen' }, { move_id: 'm8', phase: 'independent', text: 'b', bucket: 'must_happen' }];
const T = '[00:10] a\n\n[10:00] b';
const KEY = { lesson_id: 'L', version_stamp: 'v', content_hash: 'h' };
const V = (m8) => ({
  verdicts: [{ move_id: 'm1', verdict: 'executed', evidence: '[00:10] a' }, { move_id: 'm8', verdict: m8, evidence: m8 === 'not_done' ? '' : '[10:00] b' }],
  model: 'm', prompt_version: 'v1', moderators: null,
});
const deps = (analyze) => ({
  resolveMoveList: async () => ({ moves: MOVES, lesson_id: 'L', template: 'STANDARD', resolved: 'exact' }),
  extractUploadedLp: async () => null,
  analyzeFidelity: analyze,
});
const FLAGS = ['LP_FIDELITY_RECONCILE', 'LP_FIDELITY_RUNS', 'LP_FIDELITY_PHOTO'];

describe('fidelity-orchestrator v2 wiring', () => {
  const saved = {};
  beforeEach(() => { for (const k of FLAGS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of FLAGS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  test("flags unset: today's score, plus recording facts, anchors, one run and the prompt version on the blob", async () => {
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T, audioDurationSeconds: 2000 }, deps(async () => V('not_done')));
    expect(r.status).toBe('ok');
    expect(r.fidelity_pct).toBe(50);
    expect(r.recording).toMatchObject({ stamps: 2, last_stamp_s: 600, audio_s: 2000, transcript_short_of_audio: true });
    expect(r.anchors).toEqual({ total: 0, found: [], missing: [] });
    expect(r.runs).toEqual([{ pct: 50, model: 'm' }]);
    expect(r.spread).toBe(0);
    expect(r.prompt_version).toBe('v1');
    expect(r.photo_evidence).toBe(null);
  });

  test('the facts reach the grader as opts.facts; photo evidence only when LP_FIDELITY_PHOTO=on', async () => {
    const seen = [];
    const analyze = async (mv, tr, meta, opts) => { seen.push(opts); return V('executed'); };
    const photos = [{ n: 1, kind: 'board', visible_text: 'a' }];
    await computeLpFidelity({ corpusKey: KEY, transcript: T, audioDurationSeconds: 700, photoEvidence: photos }, deps(analyze));
    expect(seen[0].facts.recording.stamps).toBe(2);
    expect(seen[0].photoEvidence).toBeUndefined();
    process.env.LP_FIDELITY_PHOTO = 'on';
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T, audioDurationSeconds: 700, photoEvidence: photos }, deps(analyze));
    expect(seen[1].photoEvidence).toEqual([{ n: 1, kind: 'board', visible_text: 'a', drawings: '', students: '', learning_materials: [], student_work: '' }]);
    expect(r.photo_evidence).toEqual({ count: 1, moves_cited: 0 });
  });

  test('photo-cited verdicts are counted on the blob', async () => {
    process.env.LP_FIDELITY_PHOTO = 'on';
    const analyze = async () => ({ verdicts: [{ move_id: 'm1', verdict: 'executed', evidence: '[photo 1] the three words on the board' }, { move_id: 'm8', verdict: 'not_done', evidence: '' }], model: 'm' });
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T, photoEvidence: [{ n: 1, kind: 'board', visible_text: 'x' }] }, deps(analyze));
    expect(r.photo_evidence).toEqual({ count: 1, moves_cited: 1 });
  });

  test('LP_FIDELITY_RUNS=3 → three grader calls; the median run is kept, with every run and the spread', async () => {
    process.env.LP_FIDELITY_RUNS = '3';
    const seq = ['not_done', 'executed', 'partial']; // 50, 100, 75
    let n = 0;
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T }, deps(async () => V(seq[n++])));
    expect(n).toBe(3);
    expect(r.fidelity_pct).toBe(75);
    expect(r.runs.map((x) => x.pct)).toEqual([50, 75, 100]);
    expect(r.spread).toBe(50);
    expect(r.moves.find((m) => m.move_id === 'm8').verdict).toBe('partial');
  });

  test('LP_FIDELITY_RUNS=3 with one failed call → the lower median of the two that answered; all failed → fidelity_unavailable', async () => {
    process.env.LP_FIDELITY_RUNS = '3';
    let n = 0;
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T }, deps(async () => { n += 1; if (n === 2) throw new Error('flake'); return V(n === 1 ? 'not_done' : 'executed'); }));
    expect(r.status).toBe('ok');
    expect(r.runs).toHaveLength(2);
    expect(r.fidelity_pct).toBe(50);
    const dead = await computeLpFidelity({ corpusKey: KEY, transcript: T }, deps(async () => { throw new Error('down'); }));
    expect(dead.status).toBe('fidelity_unavailable');
  });

  test("N=1 keeps today's single call plus one retry", async () => {
    let n = 0;
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T }, deps(async () => { if (n++ === 0) throw new Error('flake'); return V('executed'); }));
    expect(n).toBe(2);
    expect(r.fidelity_pct).toBe(100);
  });

  test('an unusable LP_FIDELITY_RUNS value is one run; more than 5 is capped at 5', async () => {
    for (const [val, want] of [['0', 1], ['abc', 1], ['9', 5]]) {
      process.env.LP_FIDELITY_RUNS = val;
      let n = 0;
      await computeLpFidelity({ corpusKey: KEY, transcript: T }, deps(async () => { n += 1; return V('executed'); }));
      expect(n).toBe(want);
    }
  });
});
