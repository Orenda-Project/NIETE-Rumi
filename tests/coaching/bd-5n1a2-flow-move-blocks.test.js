'use strict';
/**
 * bd-5n1a2 — the review Flow must present MEASURED fidelity the way the
 * teacher-flow scorer computes it (operator, 2026-08-21 01:48): per prescribed
 * move — what the plan said, what the teacher did, and the exact credit the
 * scorer gave — using the scorer's own credit model
 * (executed/substituted → 1.0 · partial → 0.5 · not_done → 0 · not_adjudicable
 * excluded from the denominator). The old single fidelity_summary blob cut
 * every move at 70 code points.
 *
 * Env-gate is VALUE-aware so deploys can't race the immutable published Flow:
 *   OBSERVE_FICO_FLOW_HAS_FIDELITY='true'  → legacy summary keys (v2 asset)
 *   OBSERVE_FICO_FLOW_HAS_FIDELITY='moves' → per-move keys (v3 asset)
 */

process.env.OBSERVE_FRAMEWORK = 'fico';

const {
  composeMoveBlocks, buildScreenPrefill, MAX_MOVE_SLOTS,
} = require('../../bot/shared/services/observe/observe-draft.service');

const LP = {
  status: 'ok', fidelity_pct: 46, band: 'low', prescribed_count: 3,
  moves: [
    { move_id: 'm1', phase: 'warm_up', text: 'Read the word problem aloud', verdict: 'executed', counted: true, credit: 1,
      evidence: '[02:10] Teacher reads the problem twice, students repeat.' },
    { move_id: 'm2', phase: 'guided_practice', text: 'Pair task: LCM of 6 and 8', verdict: 'not_done', counted: true, credit: 0,
      rationale: 'No pair work occurs anywhere in the recording.' },
    { move_id: 'm3', phase: 'assessment', text: 'Exit slip: LCM of 3 and 5', verdict: 'partial', counted: true, credit: 0.5,
      evidence: '[39:02] Oral exit question asked but no written slip.' },
    { move_id: 'm4', phase: 'warm_up', text: 'Clap syllables of known words', verdict: 'not_adjudicable', counted: false, credit: null,
      rationale: 'Recording inaudible for the first 3 minutes.' },
  ],
};

describe('composeMoveBlocks — per-move fidelity, scorer-faithful (bd-5n1a2)', () => {
  test('header carries pct, band, and the scorer credit legend', () => {
    const b = composeMoveBlocks(LP);
    expect(b.header).toMatch(/46%/);
    expect(b.header).toMatch(/low/i);
    expect(b.header).toMatch(/full credit/i);
    expect(b.header).toMatch(/half/i);
    // The observer must know the B1-B10 ratings below don't move the Section B score.
    expect(b.header).toMatch(/do not change/i);
  });

  test('each move: plan text + what was seen + the exact scorer verdict', () => {
    const b = composeMoveBlocks(LP);
    expect(b.moves).toHaveLength(4);
    expect(b.moves[0]).toMatch(/✓ Executed — full credit/);
    expect(b.moves[0]).toMatch(/Plan: Read the word problem aloud/);
    expect(b.moves[0]).toMatch(/Seen: \[02:10\] Teacher reads/);
    expect(b.moves[1]).toMatch(/✗ Not done — no credit/);
    expect(b.moves[1]).toMatch(/Seen: No pair work occurs/); // rationale stands in when no evidence
    expect(b.moves[2]).toMatch(/◐ Partially done — half credit/);
    expect(b.moves[3]).toMatch(/– Not assessable — not counted/);
  });

  test('never truncates mid-word; blocks stay within the slot cap', () => {
    const long = { ...LP, moves: [{ ...LP.moves[0], text: 'word '.repeat(200), evidence: 'proof '.repeat(200) }] };
    const b = composeMoveBlocks(long);
    expect([...b.moves[0]].length).toBeLessThanOrEqual(450);
    // A word-boundary clip ends with the ellipsis right after a whole token.
    expect(b.moves[0]).not.toMatch(/\bwor…/);
  });

  test('overflow beyond the slot count collapses into a final note', () => {
    const many = { ...LP, moves: Array.from({ length: MAX_MOVE_SLOTS + 4 }, (_, i) => ({ ...LP.moves[0], move_id: `m${i}`, text: `Move number ${i}` })) };
    const b = composeMoveBlocks(many);
    expect(b.moves).toHaveLength(MAX_MOVE_SLOTS);
    expect(b.moves[MAX_MOVE_SLOTS - 1]).toMatch(/more move/i);
  });

  test('unusable fidelity → null', () => {
    expect(composeMoveBlocks(null)).toBeNull();
    expect(composeMoveBlocks({ status: 'lp_absent' })).toBeNull();
    expect(composeMoveBlocks({ status: 'ok', fidelity_pct: null, moves: [] })).toBeNull();
  });
});

describe('buildScreenPrefill — value-aware flow gate (bd-5n1a2)', () => {
  const analysis = { framework: 'fico', lp_fidelity: LP, domains: {} };
  const prev = process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
  afterAll(() => {
    if (prev === undefined) delete process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
    else process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = prev;
  });

  test("'moves' → per-move keys, all slots declared, no legacy summary key", () => {
    process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'moves';
    const d = buildScreenPrefill(analysis, 'lesson_plan_fidelity');
    expect(d.has_fidelity).toBe(true);
    expect(d.fid_header).toMatch(/46%/);
    expect(d.mv_1).toMatch(/Read the word problem/);
    expect(d.mv_1_v).toBe(true);
    // every slot key is served (Meta: declared keys must always be present)
    for (let k = 1; k <= MAX_MOVE_SLOTS; k++) {
      expect(d[`mv_${k}`]).toBeDefined();
      expect(typeof d[`mv_${k}_v`]).toBe('boolean');
    }
    expect(d.mv_5).toBe('');           // only 4 moves → slot 5 empty + hidden
    expect(d.mv_5_v).toBe(false);
    expect(d.fidelity_summary).toBeUndefined();
  });

  test("'true' → legacy v2 summary keys only (deploy-order safety)", () => {
    process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'true';
    const d = buildScreenPrefill(analysis, 'lesson_plan_fidelity');
    expect(d.has_fidelity).toBe(true);
    expect(d.fidelity_summary).toMatch(/46%/);
    expect(d.mv_1).toBeUndefined();
  });

  test('unset → neither key family (old published asset stays valid)', () => {
    delete process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
    const d = buildScreenPrefill(analysis, 'lesson_plan_fidelity');
    expect(d.has_fidelity).toBeUndefined();
    expect(d.mv_1).toBeUndefined();
    expect(d.fidelity_summary).toBeUndefined();
  });

  test("'moves' with unusable fidelity → slots served empty, has_fidelity false", () => {
    process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'moves';
    const d = buildScreenPrefill({ framework: 'fico', lp_fidelity: { status: 'lp_absent' }, domains: {} }, 'lesson_plan_fidelity');
    expect(d.has_fidelity).toBe(false);
    expect(d.fid_header).toBe('');
    expect(d.mv_1).toBe('');
    expect(d.mv_1_v).toBe(false);
  });
});
