'use strict';
/**
 * bd-r2uzg1.18.2 — a coach's edit on the /observe review must not drop the grader's
 * lesson_mismatch flag.
 *
 * The grader marks a recording of a different lesson from the selected plan with
 * `lp_fidelity.moderators.note = 'lesson_mismatch'`, and every report reader keys on
 * that note (fico-adapter's Section B row, the narrative prompt, the voice-note rule,
 * subject resolution). rescoreFidelityFromEdits re-runs the scorer on the coach's
 * verdicts; since the scorer started returning its own `moderators` (null when none is
 * passed in), the re-scored blob overwrote the grader's block with null, so ANY edit,
 * even an evidence-only one, silently turned a flagged report into an unflagged one.
 *
 * What must hold: the score is still the coach's (same scorer, her verdicts), and the
 * grader's moderators ride through unchanged, so an edited report is labelled exactly
 * as the unedited one would be. The truncation finding stays as it is today after an
 * edit (false): it is the grader contradicting its own verdicts, and after an edit the
 * verdicts are the coach's.
 */

process.env.OBSERVE_FRAMEWORK = 'fico';

const mockUpdates = [];
let mockSession = null;
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {};
  ['select', 'eq', 'not'].forEach((m) => { chain[m] = jest.fn(() => chain); });
  chain.single = jest.fn(async () => ({ data: mockSession, error: null }));
  chain.update = jest.fn((payload) => { mockUpdates.push(payload); return chain; });
  chain.then = (resolve) => resolve({ data: [{ id: mockSession && mockSession.id }], error: null });
  return { from: jest.fn(() => chain) };
});
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => {}), sendFlow: jest.fn(async () => {}) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({ getState: jest.fn(async () => null), setState: jest.fn(async () => {}) }));

const draft = require('../../bot/shared/services/observe/observe-draft.service');
const { rescoreFidelityFromEdits, composeEditableFidelity } = draft;
const { scoreFidelity } = require('../../bot/shared/services/coaching/fidelity/fidelity-scorer');
const { applyLpFidelity } = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const { isLessonMismatch } = require('../../bot/shared/services/coaching/report-v2/score-adapters/fico-adapter');
const { lessonMismatchNote } = require('../../bot/shared/services/coaching/report-v2/lesson-mismatch-note');
const { resolveLessonSubject } = require('../../bot/shared/services/coaching/subject-resolution');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

const PLAN_MOVES = [
  { move_id: 'm1', phase: 'warm_up', bucket: 'must_happen', text: 'Count to twenty in a chain' },
  { move_id: 'm2', phase: 'guided_practice', bucket: 'must_happen', text: 'Pairs sort the number cards' },
  { move_id: 'm3', phase: 'assessment', bucket: 'must_happen', text: 'Exit check: two counting questions' },
];

// The blob the orchestrator persists: the scorer's output, graded with the grader's moderators.
function gradedBlob(verdicts, moderators) {
  return {
    status: 'ok', source: 'corpus', lesson_id: 'made-up-lesson-1', meta: {},
    ...scoreFidelity(PLAN_MOVES, verdicts, moderators ? { moderators } : {}),
    narrative: 'The recording is a different lesson.', model: 'test-model',
  };
}

const MISMATCH_VERDICTS = PLAN_MOVES.map((m) => ({
  move_id: m.move_id, verdict: 'not_done', evidence: '', rationale: 'Content mismatch: the recording is a fractions lesson.',
}));
const MISMATCH_MODS = { note: 'lesson_mismatch', plan_navigability: 'The plan is a counting lesson; the class did fractions.' };

const flagged = () => gradedBlob(MISMATCH_VERDICTS, MISMATCH_MODS);

describe('rescoreFidelityFromEdits keeps the grader\'s lesson_mismatch flag', () => {
  test('the unedited blob carries the flag at 0% (the starting point)', () => {
    const lp = flagged();
    expect(lp.fidelity_pct).toBe(0);
    expect(lp.moderators.note).toBe('lesson_mismatch');
  });

  test('a verdict edit re-scores from the coach\'s verdicts AND keeps the note and the grader\'s other moderators', () => {
    const r = rescoreFidelityFromEdits(flagged(), { fid_r_2: 'partial' });
    expect(r.verdictsChanged).toBe(1);
    expect(r.lp.observer_edited).toBe(true);
    // The score is the coach's: one half credit out of three counted moves.
    expect(r.lp.fidelity_pct).toBe(16.7);
    expect(r.lp.moderators).toEqual(expect.objectContaining(MISMATCH_MODS));
  });

  test('an evidence-only edit keeps the note and the 0%', () => {
    const r = rescoreFidelityFromEdits(flagged(), { fid_e_1: '[03:10] The class was doing fractions, not counting.' });
    expect(r.evidenceChanged).toBe(1);
    expect(r.lp.fidelity_pct).toBe(0);
    expect(r.lp.moderators && r.lp.moderators.note).toBe('lesson_mismatch');
  });

  test('the truncation finding after an edit is as today (false), and its note still rides through', () => {
    const mods = { note: 'recording_ends_mid_lesson', plan_navigability: 'Linear plan.' };
    const lp = gradedBlob(MISMATCH_VERDICTS, mods);
    expect(lp.truncation_inconsistent).toBe(true);
    const r = rescoreFidelityFromEdits(lp, { fid_r_1: 'executed' });
    expect(r.lp.truncation_inconsistent).toBe(false);
    expect(r.lp.moderators).toEqual({ ...mods, truncation_inconsistent: false });
    // So the coach's re-opened Section B screen does not re-ask her to check the later steps.
    expect(composeEditableFidelity(r.lp, 'en').header).not.toContain(observeStrings('en').fid_truncation_recheck);
  });

  test('an unflagged blob re-scores exactly as before (moderators stay null)', () => {
    const verdicts = PLAN_MOVES.map((m) => ({ move_id: m.move_id, verdict: 'executed', evidence: '[01:00] e' }));
    for (const lp of [gradedBlob(verdicts, null), (() => { const b = gradedBlob(verdicts, null); delete b.moderators; return b; })()]) {
      const r = rescoreFidelityFromEdits(lp, { fid_r_3: 'not_done' });
      const rows = lp.moves.map((m) => ({ ...m }));
      rows[2].verdict = 'not_done';
      expect(r.lp).toEqual({ ...lp, ...scoreFidelity(rows, rows), observer_edited: true });
      expect(r.lp.moderators).toBeNull();
    }
  });

  test('no edit leaves the blob as it was', () => {
    const lp = flagged();
    expect(rescoreFidelityFromEdits(lp, {}).lp).toBe(lp);
  });
});

describe('applyObserverEdits: the edited coach report is labelled like the unedited one', () => {
  const ok = (id, score) => ({ id, name: id, score, applicable: true, evidence: 'e', evidence_summary: 'es' });
  const v1 = () => {
    const a = {
      framework: 'fico',
      domains: {
        lesson_plan_fidelity: { indicators: [ok('B1', 2)] },
        high_leverage_practices: { indicators: [ok('C1', 2), ok('C3', 1)] },
        student_engagement: { indicators: [ok('D1', 1), ok('D2', 2)] },
        teacher_subject_knowledge: { indicators: [ok('F1', 2)] },
      },
      lp_fidelity: flagged(),
    };
    require('../../bot/shared/services/observe/observe-framework').getObservePack().computeScores(a);
    return applyLpFidelity(a, a.lp_fidelity);
  };
  const session = (analysis) => ({
    id: 'obs-made-up-1', user_id: 'teacher-made-up', observer_user_id: 'coach-made-up',
    observation_type: 'leader_observation', status: 'awaiting_form',
    analysis_data: JSON.parse(JSON.stringify(analysis)),
    autofill_analysis_data: JSON.parse(JSON.stringify(analysis)),
    lesson_plan_structured: { subject: 'Mathematics', grade_level: '3' },
    users: { phone_number: '0', name: 'T', preferred_language: 'en' },
  });

  beforeEach(() => { mockUpdates.length = 0; });

  test.each([
    ['an evidence-only edit', { fid_e_2: '[05:40] Pairs worked on fraction strips instead.' }],
    ['a verdict edit', { fid_r_1: 'partial' }],
  ])('%s keeps every mismatch reader where the unedited report had it', async (_label, edits) => {
    const unedited = v1();
    mockSession = session(unedited);
    await draft.applyObserverEdits('obs-made-up-1', edits);
    const final = mockUpdates.find((u) => u.status === 'observer_review_complete');
    expect(final).toBeDefined();
    const v2 = final.analysis_data;
    expect(v2.lp_fidelity.observer_edited).toBe(true);
    expect(v2.lp_fidelity.moderators && v2.lp_fidelity.moderators.note).toBe('lesson_mismatch');

    const before = session(unedited);
    const after = { ...before, analysis_data: v2 };
    // Section B row (0 stays a mismatch row when the score stayed 0; a coach-credited score is not, as on an
    // unedited flagged grading that kept credit).
    expect(isLessonMismatch(v2)).toBe(v2.domains.lesson_plan_fidelity.domain_score === 0);
    // Subject resolution: the plan's subject is still not trusted.
    expect(resolveLessonSubject(after)).toEqual(resolveLessonSubject(before));
    expect(resolveLessonSubject(after).source).toBe('lesson_mismatch');
    // The teacher-only soft line stays off a coach visit, as before the edit.
    expect(lessonMismatchNote(v2, after, 'en')).toBeNull();
    expect(lessonMismatchNote(v2, { observation_type: null }, 'en')).toBe(lessonMismatchNote(unedited, { observation_type: null }, 'en'));
  });

  test('an evidence-only edit leaves Section B at 0 with the mismatch row, exactly as unedited', async () => {
    const unedited = v1();
    expect(isLessonMismatch(unedited)).toBe(true);
    mockSession = session(unedited);
    await draft.applyObserverEdits('obs-made-up-1', { fid_e_3: '[09:00] No counting check at the end.' });
    const v2 = mockUpdates.find((u) => u.status === 'observer_review_complete').analysis_data;
    expect(v2.domains.lesson_plan_fidelity.domain_score).toBe(0);
    expect(isLessonMismatch(v2)).toBe(true);
  });
});
