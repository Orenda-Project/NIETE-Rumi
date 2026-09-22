'use strict';
/**
 * The coach's editable Section B form must tell the coach WHY the grader rated each move — for every verdict.
 *
 * Found on the 22 Sep staging E2E of the v2 grader: the grader writes a one-sentence `rationale` for every move
 * ("checked what the first etiquette was, but did not ask why we do it"), but the form's only text per move is
 * the evidence box, prefilled with `evidence || rationale`. So a coach sees the WHY only on a move with NO
 * evidence (not_done); on an executed or partial move the box holds a raw timestamped quote and the reason
 * for the credit — or the missing half-credit — is never shown. The read-only move line (`mv_k`, a Flow
 * TextBody) is where the reason belongs: it stays visible above the editable box and never enters the
 * coach's edit, so `rescoreFidelityFromEdits`' untouched-box detection is unchanged. RED FIRST.
 */
process.env.OBSERVE_FRAMEWORK = 'fico';
process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'editable';

const draft = require('../../bot/shared/services/observe/observe-draft.service');

const LP = {
  status: 'ok', fidelity_pct: 45.8, band: 'low', prescribed_count: 3,
  moves: [
    { move_id: 'm1', phase: 'warm_up', bucket: 'must_happen', counted: true, verdict: 'not_done', credit: 0,
      text: 'Recalls greeting etiquette: lead students in choral practice and partner greeting.',
      evidence: '', rationale: 'The teacher opened with a routine greeting exchange but did not lead choral practice or partner greetings.' },
    { move_id: 'm2', phase: 'guided', bucket: 'must_happen', counted: true, verdict: 'partial', credit: 0.5,
      text: 'Check for understanding: ask what the first etiquette is and why we do it.',
      evidence: '[03:36] اب دیکھو، پہلا اصول کون سا ہے؟ ہاتھ کھڑا کرو ذرا۔', evidence_translation: 'Now look, which is the first rule?',
      rationale: 'The teacher checked what the first etiquette was, but did not ask students why we do it.' },
    { move_id: 'm3', phase: 'explain', bucket: 'must_happen', counted: true, verdict: 'executed', credit: 1,
      text: 'Display the five etiquettes on the board.',
      evidence: '[photo 1] Board shows the 5 etiquettes; [02:22] یہاں میں نے لکھ دیا', rationale: 'Written on the board, visible in photo 1 and narrated.' },
  ],
};

describe('the coach sees why the grader rated each move, on the read-only move line', () => {
  test('a partial move carries the reason for the half credit above its evidence box', () => {
    const data = draft.buildScreenPrefill({ lp_fidelity: LP }, 'lesson_plan_fidelity', 'en');
    expect(data.mv_2).toContain('Check for understanding');
    expect(data.mv_2).toContain('did not ask students why we do it');
    expect(data.fe_2).toContain('[03:36]');                       // the editable box is still the quote
    expect(data.fe_2).not.toContain('did not ask students why');  // the reason is not pushed into the editable text
  });

  test('an executed move carries its reason too — not only the not_done ones', () => {
    const data = draft.buildScreenPrefill({ lp_fidelity: LP }, 'lesson_plan_fidelity', 'en');
    expect(data.mv_3).toContain('visible in photo 1');
    expect(data.fe_3).toContain('[photo 1]');
  });

  test('a not_done move keeps the reason in the box (unchanged) and also shows it on the line', () => {
    const data = draft.buildScreenPrefill({ lp_fidelity: LP }, 'lesson_plan_fidelity', 'en');
    expect(data.fe_1).toContain('did not lead choral practice');
    expect(data.mv_1).toContain('did not lead choral practice');
  });

  test('the move line stays inside the payload cap and never loses the prescribed move', () => {
    const long = { ...LP, moves: LP.moves.map(m => ({ ...m, rationale: 'x'.repeat(900), text: 'y'.repeat(400) })) };
    const data = draft.buildScreenPrefill({ lp_fidelity: long }, 'lesson_plan_fidelity', 'en');
    expect([...data.mv_1].length).toBeLessThanOrEqual(600);
    expect(data.mv_1).toContain('yyyy');
  });

  test('an untouched evidence box is still "unchanged" on submit — the reason never enters the edit', () => {
    const data = draft.buildScreenPrefill({ lp_fidelity: LP }, 'lesson_plan_fidelity', 'en');
    const out = draft.rescoreFidelityFromEdits(LP, { fid_r_2: 'partial', fid_e_2: data.fe_2, fid_r_3: 'executed', fid_e_3: data.fe_3 });
    expect(out.evidenceChanged).toBe(0);
    expect(out.verdictsChanged).toBe(0);
  });

  test('the header tells the coach the reason is shown', () => {
    const data = draft.buildScreenPrefill({ lp_fidelity: LP }, 'lesson_plan_fidelity', 'en');
    expect(data.fid_header).toMatch(/why/i);
  });
});
