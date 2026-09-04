'use strict';
/**
 * P3.3 — the orchestrator that a coaching job calls. Resolves the move-list (corpus via the store OR
 * uploaded via the extractor) → grader → scorer → the persist blob. MUST be non-blocking: any failure
 * returns a status object, never throws (a fidelity error must never fail the coaching job). All deps
 * injected so this is a pure unit test.
 */
const { computeLpFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');

const MOVES = [
  { move_id: 'm1', bucket: 'must_happen', adjudicable: true },
  { move_id: 'm2', bucket: 'must_happen', adjudicable: true },
];
const goodVerdicts = { verdicts: [{ move_id: 'm1', verdict: 'executed' }, { move_id: 'm2', verdict: 'not_done' }], narrative: 'n', language_note: 'Urdu' };

function deps(over = {}) {
  return {
    resolveMoveList: async () => ({ lesson_id: 'L', template: 'STANDARD', moves: MOVES }),
    extractUploadedLp: async () => ({ template: 'UPLOADED', goal: 'g', moves: MOVES }),
    analyzeFidelity: async () => goodVerdicts,
    scoreFidelity: (m, v) => ({ fidelity_pct: 50, band: 'partial', prescribed_count: 2, moves: [] }),
    ...over,
  };
}

describe('fidelity-orchestrator · computeLpFidelity (deps injected)', () => {
  test('corpus path: resolves move-list by key → grades → scores → status ok', async () => {
    const r = await computeLpFidelity({ corpusKey: { lesson_id: 'L', version_stamp: 'v', content_hash: 'h' }, transcript: 't' }, deps());
    expect(r.status).toBe('ok');
    expect(r.source).toBe('corpus');
    expect(r.fidelity_pct).toBe(50);
    expect(r.narrative).toBe('n');
  });

  test('uploaded path: no corpus key, has LP text → extracts → grades → scores', async () => {
    const r = await computeLpFidelity({ uploadedText: 'a long uploaded lesson plan text', transcript: 't' }, deps());
    expect(r.status).toBe('ok');
    expect(r.source).toBe('uploaded');
  });

  test('corpus is preferred when both a corpus key and uploaded text are present', async () => {
    let extracted = false;
    const r = await computeLpFidelity(
      { corpusKey: { lesson_id: 'L', version_stamp: 'v', content_hash: 'h' }, uploadedText: 'x', transcript: 't' },
      deps({ extractUploadedLp: async () => { extracted = true; return { moves: MOVES }; } })
    );
    expect(r.source).toBe('corpus');
    expect(extracted).toBe(false);
  });

  test('no LP at all (no key, no text) → lp_absent, no grader call', async () => {
    let graded = false;
    const r = await computeLpFidelity({ transcript: 't' }, deps({ analyzeFidelity: async () => { graded = true; return goodVerdicts; } }));
    expect(r.status).toBe('lp_absent');
    expect(graded).toBe(false);
  });

  test('corpus key that resolves to nothing, with no upload → lp_absent', async () => {
    const r = await computeLpFidelity({ corpusKey: { lesson_id: 'Z' }, transcript: 't' }, deps({ resolveMoveList: async () => null }));
    expect(r.status).toBe('lp_absent');
  });

  test('NON-BLOCKING: a grader throw becomes fidelity_unavailable, never throws', async () => {
    const r = await computeLpFidelity(
      { corpusKey: { lesson_id: 'L', version_stamp: 'v', content_hash: 'h' }, transcript: 't' },
      deps({ analyzeFidelity: async () => { const e = new Error('boom'); e.code = 'fidelity_unavailable'; throw e; } })
    );
    expect(r.status).toBe('fidelity_unavailable'); // returned, not thrown
  });

  test('NON-BLOCKING: an extractor throw becomes fidelity_unavailable', async () => {
    const r = await computeLpFidelity(
      { uploadedText: 'scanned image lp', transcript: 't' },
      deps({ extractUploadedLp: async () => { const e = new Error('lp_unparseable'); e.code = 'lp_unparseable'; throw e; } })
    );
    expect(r.status).toBe('fidelity_unavailable');
    expect(r.error).toBe('lp_unparseable');
  });

  test('no transcript → null (nothing to grade against)', async () => {
    expect(await computeLpFidelity({ corpusKey: { lesson_id: 'L' } }, deps())).toBeNull();
  });
});

/**
 * bd-2kxxa.4 — the recompute gate needs to know WHICH upload a blob was graded
 * from, so a re-upload of a different document re-grades and the same document
 * does not. The corpus path already names its lesson_id; the upload path now
 * stamps a content hash. Top-level on the result, NOT in meta — meta is the
 * grader's prompt input and must not change.
 */
describe('fidelity-orchestrator · upload_hash (bd-2kxxa.4)', () => {
  const { uploadTextHash, UPLOAD_TEXT_CAP } = require('../../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');

  test('uploaded path stamps upload_hash = hash of the (capped) text it graded, and keeps it out of meta', async () => {
    let promptMeta = null;
    const r = await computeLpFidelity(
      { uploadedText: 'a long uploaded lesson plan text', transcript: 't' },
      deps({ analyzeFidelity: async (m, t, meta) => { promptMeta = meta; return goodVerdicts; } }),
    );
    expect(r.status).toBe('ok');
    expect(r.upload_hash).toBe(uploadTextHash('a long uploaded lesson plan text'));
    expect(r.upload_hash).toMatch(/^[0-9a-f]{40}$/);
    expect(promptMeta).not.toHaveProperty('upload_hash');
  });

  test('uploadTextHash caps the same way the extractor input is capped', () => {
    const big = 'x'.repeat(UPLOAD_TEXT_CAP + 500);
    expect(uploadTextHash(big)).toBe(uploadTextHash(big.slice(0, UPLOAD_TEXT_CAP)));
    expect(uploadTextHash(null)).toBeNull();
  });

  test('corpus path has no upload_hash', async () => {
    const r = await computeLpFidelity({ corpusKey: { lesson_id: 'L', version_stamp: 'v', content_hash: 'h' }, transcript: 't' }, deps());
    expect(r.upload_hash).toBeNull();
  });
});
