'use strict';
/**
 * bd-c5zs1 — the coach EDITS the measurement (v4 review Flow).
 *
 * Legacy B1-B10 indicator ratings are retired from the form (parity with the
 * teacher flow, D27). Per move the coach sees the prescribed action
 * (read-only) and can change the VERDICT and the EVIDENCE; the endpoint
 * re-runs the SAME fidelity scorer on the corrected verdicts, so Section B is
 * the coach-corrected measurement — not a hand-typed number.
 */

process.env.OBSERVE_FRAMEWORK = 'fico';

const {
  composeEditableFidelity, rescoreFidelityFromEdits, buildScreenPrefill,
  FIDELITY_VERDICT_OPTIONS, MAX_MOVE_SLOTS,
} = require('../../bot/shared/services/observe/observe-draft.service');

const LP = {
  status: 'ok', fidelity_pct: 33.3, band: 'low', prescribed_count: 3,
  moves: [
    { move_id: 'm1', phase: 'warm_up', bucket: 'must_happen', text: 'Read the word problem aloud',
      verdict: 'executed', counted: true, credit: 1, evidence: '[02:10] Teacher reads it twice.' },
    { move_id: 'm2', phase: 'guided_practice', bucket: 'must_happen', text: 'Pair task: LCM of 6 and 8',
      verdict: 'not_done', counted: true, credit: 0, rationale: 'No pair work in the recording.' },
    { move_id: 'm3', phase: 'assessment', bucket: 'must_happen', text: 'Exit slip: LCM of 3 and 5',
      verdict: 'not_done', counted: true, credit: 0, rationale: 'Lesson ends without any exit check.' },
    { move_id: 'm4', phase: 'warm_up', bucket: 'must_happen', text: 'Clap syllables of known words',
      verdict: 'not_adjudicable', counted: false, credit: null, rationale: 'First minutes inaudible.' },
  ],
};

describe('composeEditableFidelity — prefill for the editable form', () => {
  test('slots carry read-only plan + AI verdict + AI evidence', () => {
    const ed = composeEditableFidelity(LP);
    expect(ed.header).toMatch(/33\.3%/);
    expect(ed.header).toMatch(/YOUR ratings/);
    expect(ed.slots).toHaveLength(4);
    expect(ed.slots[0].plan).toMatch(/1\/4 · Warm-up — Read the word problem aloud/);
    expect(ed.slots[0].verdict).toBe('executed');
    expect(ed.slots[1].evidence).toMatch(/No pair work/); // rationale stands in
    expect(ed.slots[3].verdict).toBe('not_adjudicable');
  });

  test('unusable fidelity → null', () => {
    expect(composeEditableFidelity(null)).toBeNull();
    expect(composeEditableFidelity({ status: 'ok', fidelity_pct: null, moves: [] })).toBeNull();
  });
});

describe('rescoreFidelityFromEdits — coach corrections re-run the scorer', () => {
  test("flipping a not_done to executed raises the pct through the real scorer", () => {
    // AI: 1 of 3 counted executed = 33.3%. Coach says m2 WAS done → 2/3 = 66.7%.
    const r = rescoreFidelityFromEdits(LP, { fid_r_2: 'executed' });
    expect(r.verdictsChanged).toBe(1);
    expect(r.lp.fidelity_pct).toBe(66.7);
    expect(r.lp.band).toBe('partial');
    expect(r.lp.observer_edited).toBe(true);
    expect(LP.moves[1].verdict).toBe('not_done'); // input not mutated
  });

  test('not_adjudicable → executed enters the denominator (coach heard what the AI could not)', () => {
    const r = rescoreFidelityFromEdits(LP, { fid_r_4: 'executed' });
    // counted becomes 4: executed m1 + m4 = 2/4 = 50%
    expect(r.lp.fidelity_pct).toBe(50);
    expect(r.lp.prescribed_count).toBe(4);
  });

  test('evidence-only edit changes no score but is recorded', () => {
    const r = rescoreFidelityFromEdits(LP, { fid_e_1: 'Teacher read it three times, class repeated.' });
    expect(r.evidenceChanged).toBe(1);
    expect(r.verdictsChanged).toBe(0);
    expect(r.lp.fidelity_pct).toBe(LP.fidelity_pct);
    expect(r.lp.moves[0].evidence).toMatch(/three times/);
  });

  test('invalid verdict values are ignored; untouched form is a no-op', () => {
    const r1 = rescoreFidelityFromEdits(LP, { fid_r_2: 'amazing' });
    expect(r1.verdictsChanged).toBe(0);
    expect(r1.lp).toBe(LP); // unchanged object returned untouched
    // the form echoes back the init values — must not count as edits
    const echo = { fid_r_1: 'executed', fid_r_2: 'not_done', fid_e_2: 'No pair work in the recording.' };
    const r2 = rescoreFidelityFromEdits(LP, echo);
    expect(r2.verdictsChanged).toBe(0);
    expect(r2.evidenceChanged).toBe(0);
  });
});

describe("buildScreenPrefill 'editable' — v4 keys, legacy B keys retired", () => {
  const analysis = { framework: 'fico', lp_fidelity: LP, domains: {} };
  const prev = process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
  afterAll(() => {
    if (prev === undefined) delete process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
    else process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = prev;
  });

  test('serves the verdict scale + per-slot plan/verdict/evidence, and NO legacy indicator keys', () => {
    process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'editable';
    const d = buildScreenPrefill(analysis, 'lesson_plan_fidelity');
    expect(d.has_fidelity).toBe(true);
    expect(d.no_fidelity).toBe(false);
    expect(d.fid_scale).toEqual(FIDELITY_VERDICT_OPTIONS);
    expect(d.mv_1).toMatch(/Read the word problem/);
    expect(d.fr_1).toBe('executed');
    expect(d.fe_2).toMatch(/No pair work/);
    for (let k = 1; k <= MAX_MOVE_SLOTS; k++) {
      expect(d[`fr_${k}`]).toBeDefined();
      expect(d[`fe_${k}`]).toBeDefined();
    }
    // retirement: the v4 asset declares no s_/e_/i_ B-indicator fields
    expect(Object.keys(d).filter(k => /^(s|e|i)_B/.test(k))).toHaveLength(0);
    expect(d.fidelity_summary).toBeUndefined();
  });

  test('no usable fidelity → fallback text, slots empty, still schema-complete', () => {
    process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'editable';
    const d = buildScreenPrefill({ framework: 'fico', lp_fidelity: { status: 'lp_absent' }, domains: {} }, 'lesson_plan_fidelity');
    expect(d.has_fidelity).toBe(false);
    expect(d.no_fidelity).toBe(true);
    expect(d.fid_fallback).toMatch(/AI assessment/);
    expect(d.fr_1).toBe('not_adjudicable');
    expect(d.mv_1_v).toBe(false);
  });

  test("other domains still serve their indicator prefill in 'editable' mode", () => {
    process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'editable';
    const d = buildScreenPrefill({ framework: 'fico', domains: {} }, 'high_leverage_practices');
    expect(Object.keys(d).some(k => k.startsWith('s_'))).toBe(true);
  });
});

describe('v4 flow asset shape', () => {
  const fs = require('fs');
  const path = require('path');
  const FLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '../../bot/docs/flows/observe-fico-flow.json'), 'utf8'));
  const B = FLOW.screens.find(s => s.id === 'DOMAIN_B');
  const form = B.layout.children[0];

  test('Section B: legacy indicator groups GONE, 12 editable verdict radios + evidence boxes present', () => {
    const names = form.children.map(c => c.name).filter(Boolean);
    expect(names.filter(n => /^r_/.test(n))).toHaveLength(0);
    expect(names.filter(n => /^fid_r_/.test(n))).toHaveLength(MAX_MOVE_SLOTS);
    expect(names.filter(n => /^fid_e_/.test(n))).toHaveLength(MAX_MOVE_SLOTS);
  });

  test('other sections keep their indicator groups', () => {
    const C = FLOW.screens.find(s => s.id === 'DOMAIN_C');
    const cNames = C.layout.children[0].children.map(c => c.name).filter(Boolean);
    expect(cNames.filter(n => /^r_/.test(n)).length).toBeGreaterThan(0);
  });

  test('every fid field is init-bound and returned in the submit payload', () => {
    const foot = form.children.find(c => c.type === 'Footer');
    for (let k = 1; k <= MAX_MOVE_SLOTS; k++) {
      expect(form['init-values'][`fid_r_${k}`]).toBe(`\${data.fr_${k}}`);
      expect(foot['on-click-action'].payload[`fid_r_${k}`]).toBe(`\${form.fid_r_${k}}`);
      expect(foot['on-click-action'].payload[`fid_e_${k}`]).toBe(`\${form.fid_e_${k}}`);
    }
  });

  test('every screen under the 50-component cap', () => {
    const count = (nodes) => (nodes || []).reduce((n, c) => n + 1 + count(c.children), 0);
    for (const s of FLOW.screens) expect(count(s.layout.children)).toBeLessThanOrEqual(50);
  });
});
