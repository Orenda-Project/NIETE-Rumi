'use strict';
/**
 * P4.2 — the report fidelity block. extractFidelity(analysis) prefers the MEASURED lp_fidelity blob
 * (executed÷prescribed, D20) and maps it to the report section: %, band, phase bar, per-action verdicts,
 * strengths, gaps. Falls back to the legacy fidelity_analysis field, and degrades on partial/unusable
 * recordings. bd-wmfsp.10.
 */
const { extractFidelity } = require('../../../bot/shared/services/coaching/report-transformers/_shared');

const okBlob = {
  status: 'ok', source: 'corpus', fidelity_pct: 60, band: 'partial', coverage: 1.0, low_confidence: false,
  prescribed_count: 5, executed_credit: 3,
  narrative: 'She modelled the method and ran independent practice; skipped the exit check.',
  moves: [
    { move_id: 'm1', phase: 'warm_up', text: 'Activate prior knowledge', verdict: 'executed', counted: true, evidence: '[01:00] …' },
    { move_id: 'm2', phase: 'explain', text: 'Model on the board', verdict: 'executed', counted: true, evidence: '[05:00] …' },
    { move_id: 'm3', phase: 'guided', text: 'Guided practice', verdict: 'partial', counted: true, evidence: '[10:00] …' },
    { move_id: 'm4', phase: 'independent', text: 'Independent work', verdict: 'substituted_better', counted: true, evidence: '[15:00] …' },
    { move_id: 'm5', phase: 'exit', text: 'Exit ticket', verdict: 'not_done', counted: true, evidence: '' },
  ],
  strengths: [{ move_id: 'm4', text: 'Independent work', evidence: '[15:00] …' }],
  not_assessed: [],
  moderators: { plan_navigability: 'clear', note: '' },
};

describe('extractFidelity → report block (P4.2)', () => {
  test('maps the measured lp_fidelity blob: score, band, commentary', () => {
    const f = extractFidelity({ lp_fidelity: okBlob });
    expect(f.score).toBe(60);
    expect(f.maxScore).toBe(100);
    expect(f.band).toBe('partial');
    expect(f.commentary).toMatch(/exit check/);
  });

  test('phase bar: one status per phase in teaching order (done/partial/missed)', () => {
    const f = extractFidelity({ lp_fidelity: okBlob });
    const bar = Object.fromEntries(f.phaseBar.map((p) => [p.phase, p.status]));
    expect(bar.warm_up).toBe('done');
    expect(bar.explain).toBe('done');
    expect(bar.guided).toBe('partial');
    expect(bar.independent).toBe('done'); // substituted_better = done
    expect(bar.exit).toBe('missed');
    // order preserved
    expect(f.phaseBar.map((p) => p.phase)).toEqual(['warm_up', 'explain', 'guided', 'independent', 'exit']);
  });

  test('per-action list + strengths (substituted_better) + gaps (not_done)', () => {
    const f = extractFidelity({ lp_fidelity: okBlob });
    expect(f.perAction).toHaveLength(5);
    expect(f.strengths).toContain('Independent work');
    expect(f.gaps).toContain('Exit ticket');
  });

  test('recording unusable → an informational note, no score (never a false 0%)', () => {
    const f = extractFidelity({ lp_fidelity: { status: 'ok', recording_unusable: true, fidelity_pct: null, moves: [] } });
    expect(f.score).toBeNull();
    expect(f.note).toMatch(/not assessed/i);
  });

  test('lp_absent / fidelity_unavailable → no block (null)', () => {
    expect(extractFidelity({ lp_fidelity: { status: 'lp_absent' } })).toBeNull();
    const un = extractFidelity({ lp_fidelity: { status: 'fidelity_unavailable' } });
    expect(un && un.score).toBeFalsy();
  });

  test('legacy fidelity_analysis still works when lp_fidelity is absent (back-compat)', () => {
    const f = extractFidelity({ fidelity_analysis: { score: 42, note: 'legacy', strengths: ['x'] } });
    expect(f.score).toBe(42);
    expect(f.note).toBe('legacy');
  });

  test('no fidelity data at all → null', () => {
    expect(extractFidelity({})).toBeNull();
  });
});
