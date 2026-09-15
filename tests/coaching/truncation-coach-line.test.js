'use strict';
/**
 * Tell the coach, because the coach is the instrument.
 *
 * She was in the room. She can re-rate five moves in ten seconds, and her ratings
 * already feed straight back through the same scorer (rescoreFidelityFromEdits). A
 * timing heuristic cannot do that; a human who saw the lesson can.
 *
 * So the only behavioural change this ships is one line on the Section B review screen
 * when the grader contradicted itself, in the coach's own language.
 */
const draft = require('../../bot/shared/services/observe/observe-draft.service');
const { composeEditableFidelity, buildScreenPrefill } = draft;
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

const move = (id, verdict) => ({
  move_id: id, phase: 'body', bucket: 'must_happen', text: `Prescribed move ${id}`,
  verdict, counted: true, credit: verdict === 'not_done' ? 0 : 1, evidence: 'e',
});

const lp = (extra = {}) => ({
  status: 'ok', fidelity_pct: 20, band: 'low', prescribed_count: 5,
  moves: ['m1', 'm2', 'm3'].map((id) => move(id, 'not_done'))
    .concat([move('m4', 'executed'), move('m5', 'executed')]),
  ...extra,
});

const analysis = (lpBlob) => ({
  framework: 'fico', lp_fidelity: lpBlob,
  domains: { lesson_plan_fidelity: { domain_score: 8, domain_max: 40, indicators: [] } },
});

describe('the string exists in both languages the coach form serves', () => {
  test('en and ur both carry it, and the ur one is in Urdu script', () => {
    const en = observeStrings('en').fid_truncation_recheck;
    const ur = observeStrings('ur').fid_truncation_recheck;
    expect(typeof en).toBe('string');
    expect(en.length).toBeGreaterThan(0);
    expect(ur).not.toBe(en);
    expect(/[؀-ۿ]/.test(ur)).toBe(true);
  });

  test('it names what happened and what to do, and asks nothing of the AI', () => {
    const en = observeStrings('en').fid_truncation_recheck;
    expect(en).toMatch(/recording/i);
    expect(en).toMatch(/re-?check|check/i);
  });

  test('both fit the Flow TextBody the header is bound to (1,024 code points, header included)', () => {
    // Measured in CODE POINTS, not UTF-16 length — an off-by-a-surrogate count is how
    // something passes locally and is rejected at the Graph API boundary.
    for (const language of ['en', 'ur']) {
      expect([...observeStrings(language).fid_truncation_recheck].length).toBeLessThanOrEqual(240);
    }
  });
});

describe('composeEditableFidelity — the line rides on the Section B header', () => {
  test('flag set → the line is appended, in the coach\'s language', () => {
    for (const language of ['en', 'ur']) {
      const ed = composeEditableFidelity(
        lp({ moderators: { truncation_inconsistent: true } }), language,
      );
      expect(ed.header).toContain(observeStrings(language).fid_truncation_recheck);
      expect(ed.header).toContain('20%');          // the measured number still leads
      expect(ed.slots).toHaveLength(5);            // the per-move radios are untouched
    }
  });

  test('flag absent → the header is byte-identical to today\'s', () => {
    const base = composeEditableFidelity(lp(), 'en');
    expect(base.header).not.toContain(observeStrings('en').fid_truncation_recheck);
    expect(composeEditableFidelity(lp({ moderators: { note: 'lesson_mismatch' } }), 'en').header)
      .toBe(base.header);
    expect(composeEditableFidelity(lp({ moderators: null }), 'en').header).toBe(base.header);
  });

  test('no language argument behaves exactly as before — English', () => {
    expect(composeEditableFidelity(lp()).header).toBe(composeEditableFidelity(lp(), 'en').header);
  });

  test('an unusable blob still returns null — the flag changes no gate', () => {
    expect(composeEditableFidelity({ status: 'lp_absent' }, 'ur')).toBeNull();
    expect(composeEditableFidelity(null, 'ur')).toBeNull();
  });
});

describe('buildScreenPrefill — the served payload carries it', () => {
  const OLD = process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
  beforeAll(() => { process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'editable'; });
  afterAll(() => {
    if (OLD === undefined) delete process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
    else process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = OLD;
  });

  test('fid_header carries the line when the flag is set', () => {
    const d = buildScreenPrefill(
      analysis(lp({ moderators: { truncation_inconsistent: true } })),
      'lesson_plan_fidelity',
      'ur',
    );
    expect(d.has_fidelity).toBe(true);
    expect(d.fid_header).toContain(observeStrings('ur').fid_truncation_recheck);
  });

  test('and does not when it is not', () => {
    const d = buildScreenPrefill(analysis(lp()), 'lesson_plan_fidelity', 'ur');
    expect(d.fid_header).not.toContain(observeStrings('ur').fid_truncation_recheck);
  });

  test('the existing two-argument call site is unchanged', () => {
    const d = buildScreenPrefill(analysis(lp()), 'lesson_plan_fidelity');
    expect(d.has_fidelity).toBe(true);
    expect(d.fid_header).toContain('20%');
    expect(d.fr_1).toBe('not_done');
  });
});
