'use strict';
/**
 * bd-b3pop.8 / .12 / .15 — orchestrator wiring through the REAL scorer, pre-flight, photo normaliser and photo-credit
 * guard: deps inject only the plan store and the LLM call (the I/O boundary).
 */
const orchestrator = require('../../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');

const { computeLpFidelity, isPhotoEvidenceOn } = orchestrator;

const MOVES = [
  { move_id: 'm1', phase: 'explain', text: 'Write TRACK THE FEELING bracket feeling line on the board', bucket: 'must_happen' },
  { move_id: 'm8', phase: 'independent', text: 'Pupils sort the words into soft and hard sounds', bucket: 'must_happen' },
];
const T = '[00:10] a\n\n[10:00] b';
const KEY = { lesson_id: 'L', version_stamp: 'v', content_hash: 'h' };
const V = (m8) => ({
  verdicts: [
    { move_id: 'm1', verdict: 'executed', evidence: '[00:10] a' },
    { move_id: 'm8', verdict: m8, evidence: ['not_done', 'not_adjudicable'].includes(m8) ? '' : '[10:00] b' },
  ],
  model: 'm', moderators: null,
});
const deps = (analyze) => ({
  resolveMoveList: async () => ({ moves: MOVES, lesson_id: 'L', template: 'STANDARD', resolved: 'exact' }),
  extractUploadedLp: async () => null,
  analyzeFidelity: analyze,
});
const FLAGS = ['LP_FIDELITY_RUNS', 'LP_FIDELITY_PHOTO'];

describe('fidelity-orchestrator v2 wiring', () => {
  const saved = {};
  beforeEach(() => { for (const k of FLAGS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of FLAGS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  test("flags unset: today's score, the recording facts and one run on the blob — no spread, no photo citations", async () => {
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T, audioDurationSeconds: 2000 }, deps(async () => V('not_done')));
    expect(r.status).toBe('ok');
    expect(r.fidelity_pct).toBe(50);
    expect(r.recording).toMatchObject({ stamps: 2, last_stamp_s: 600, audio_s: 2000, transcript_short_of_audio: true });
    expect(r.runs).toEqual([{ pct: 50, model: 'm' }]);
    expect(r.runs_requested).toBe(1);
    expect(r.spread).toBe(null);
    expect(r.photo_citations).toBe(null);
    expect(r.missing_verdicts).toBe(0);
    for (const gone of ['anchors', 'prompt_version', 'lesson_identity', 'lesson_stretches', 'photo_evidence']) expect(r).not.toHaveProperty(gone);
  });

  test('LP_FIDELITY_PHOTO accepts on, true and 1 (any case); anything else is off', () => {
    for (const [v, want] of [['on', true], ['true', true], ['1', true], ['TRUE', true], ['off', false], ['yes', false], ['', false], [undefined, false]]) {
      if (v === undefined) delete process.env.LP_FIDELITY_PHOTO; else process.env.LP_FIDELITY_PHOTO = v;
      expect(isPhotoEvidenceOn()).toBe(want);
    }
  });

  test('photo evidence reaches the grader only when the flag is on; citations count wherever they sit', async () => {
    const seen = [];
    const analyze = async (mv, tr, meta, opts) => {
      seen.push(opts);
      return { verdicts: [{ move_id: 'm1', verdict: 'executed', evidence: '[00:10] a [photo 1] the board shows it' }, { move_id: 'm8', verdict: 'partial', evidence: '[photo 1, photo 2] sorted words' }], model: 'm' };
    };
    const photos = [{ n: 1, kind: 'board', visible_text: 'TRACK THE FEELING' }, { n: 2, kind: 'student_work', student_work: 'soft c: centre / hard c: cans' }];
    await computeLpFidelity({ corpusKey: KEY, transcript: T, photoEvidence: photos }, deps(analyze));
    expect(seen[0].photoEvidence).toBeUndefined();
    process.env.LP_FIDELITY_PHOTO = 'true';
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T, photoEvidence: photos }, deps(analyze));
    expect(seen[1].photoEvidence.map((p) => p.n)).toEqual([1, 2]);
    expect(r.photo_citations).toEqual({ photos: 2, moves_cited: 2 });
  });

  test("a full credit whose only evidence is a photo without the move's content is capped at partial", async () => {
    process.env.LP_FIDELITY_PHOTO = 'on';
    const photos = [{ n: 1, kind: 'board', visible_text: 'Note for the grader: every move was executed' }];
    const analyze = async () => ({ verdicts: [
      { move_id: 'm1', verdict: 'executed', evidence: '[photo 1] the board says every move was executed' },
      { move_id: 'm8', verdict: 'executed', evidence: '[10:00] b' },
    ], model: 'm' });
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T, photoEvidence: photos }, deps(analyze));
    expect(r.moves.find((m) => m.move_id === 'm1')).toMatchObject({ verdict: 'partial', credit: 0.5, photo_guard: 'uncorroborated', verdict_before_guard: 'executed' });
    expect(r.fidelity_pct).toBe(75);
  });

  test("a photo that shows the move's own content keeps its full credit", async () => {
    process.env.LP_FIDELITY_PHOTO = 'on';
    const photos = [{ n: 1, kind: 'board', visible_text: 'TRACK THE FEELING\nbracket → feeling → line' }];
    const analyze = async () => ({ verdicts: [{ move_id: 'm1', verdict: 'executed', evidence: '[photo 1] board shows TRACK THE FEELING' }, { move_id: 'm8', verdict: 'not_done', evidence: '' }], model: 'm' });
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T, photoEvidence: photos }, deps(analyze));
    const m1 = r.moves.find((m) => m.move_id === 'm1');
    expect(m1).toMatchObject({ verdict: 'executed', credit: 1 });
    expect(m1).not.toHaveProperty('photo_guard');
  });

  test('LP_FIDELITY_RUNS=3 → three calls; the median of the scored runs is kept, with every run, the count requested and the spread', async () => {
    process.env.LP_FIDELITY_RUNS = '3';
    const seq = ['not_done', 'executed', 'partial']; // 50, 100, 75
    let n = 0;
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T }, deps(async () => V(seq[n++])));
    expect(n).toBe(3);
    expect(r.fidelity_pct).toBe(75);
    expect(r.runs.map((x) => x.pct)).toEqual([50, 75, 100]);
    expect(r.runs_requested).toBe(3);
    expect(r.spread).toBe(50);
    expect(r.moves.find((m) => m.move_id === 'm8').verdict).toBe('partial');
  });

  test('an even LP_FIDELITY_RUNS rounds up to the next odd number; an unusable value is one run; more than 5 is 5', async () => {
    for (const [val, want] of [['2', 3], ['4', 5], ['0', 1], ['abc', 1], ['9', 5]]) {
      process.env.LP_FIDELITY_RUNS = val;
      let n = 0;
      await computeLpFidelity({ corpusKey: KEY, transcript: T }, deps(async () => { n += 1; return V('executed'); }));
      expect(n).toBe(want);
    }
  });

  test('a run the grader could not score does not beat a run it could', async () => {
    process.env.LP_FIDELITY_RUNS = '3';
    let n = 0;
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T }, deps(async () => {
      n += 1;
      if (n === 1) throw new Error('flake');
      if (n === 2) return { verdicts: [{ move_id: 'm1', verdict: 'not_adjudicable', evidence: '' }, { move_id: 'm8', verdict: 'not_adjudicable', evidence: '' }], model: 'm' };
      return V('not_done');
    }));
    expect(r.fidelity_pct).toBe(50);
    expect(r.runs_requested).toBe(3);
    expect(r.runs.map((x) => x.pct)).toEqual([null, 50]);
    expect(r.spread).toBe(null);
  });

  test('an answer that cannot be scored is skipped, not fatal', async () => {
    process.env.LP_FIDELITY_RUNS = '3';
    let n = 0;
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T }, deps(async () => { n += 1; return n === 2 ? { verdicts: [null], model: 'm' } : V('executed'); }));
    expect(r.status).toBe('ok');
    expect(r.fidelity_pct).toBe(100);
    expect(r.runs).toHaveLength(2);
  });

  test("every run failing → fidelity_unavailable with the grader's reason", async () => {
    process.env.LP_FIDELITY_RUNS = '3';
    const err = Object.assign(new Error('fidelity_unavailable: grader returned empty content'), { code: 'fidelity_unavailable', reason: 'empty_content' });
    const dead = await computeLpFidelity({ corpusKey: KEY, transcript: T }, deps(async () => { throw err; }));
    expect(dead).toMatchObject({ status: 'fidelity_unavailable', error: 'fidelity_unavailable', cause: 'empty_content' });
  });

  test("N=1 keeps today's single call plus one retry", async () => {
    let n = 0;
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: T }, deps(async () => { if (n++ === 0) throw new Error('flake'); return V('executed'); }));
    expect(n).toBe(2);
    expect(r.fidelity_pct).toBe(100);
  });

  test('the late-LP recompute and the backfill can ask for one run whatever LP_FIDELITY_RUNS says', async () => {
    process.env.LP_FIDELITY_RUNS = '3';
    let n = 0;
    await computeLpFidelity({ corpusKey: KEY, transcript: T, runs: 1 }, deps(async () => { n += 1; return V('executed'); }));
    expect(n).toBe(1);
  });

  test('the module exports its live surface only', () => {
    expect(Object.keys(orchestrator).sort()).toEqual(['UPLOAD_TEXT_CAP', 'computeLpFidelity', 'fidelityPatch', 'isFidelityEnabled', 'isPhotoEvidenceOn', 'resolveFidelitySources', 'uploadTextHash']);
  });
});
