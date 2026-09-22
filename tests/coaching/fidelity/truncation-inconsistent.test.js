'use strict';
/**
 * When the fidelity grader says the recording ended early and then counts the later
 * moves as misses anyway, say so — and change no score.
 *
 * WHY THIS SHAPE AND NOT A SCORING RULE
 * -------------------------------------
 * Two deterministic truncation rules were measured against production and both were
 * discarded:
 *
 *   · "audio is shorter than the plan's prescribed minutes" — the plan's total is
 *     effectively a constant (30 min on 2,563 of 3,352 corpus-linked sessions) while we
 *     ASK for 15, so the rule fires on 85% of all recordings. The shortfall is the
 *     design, not a defect.
 *   · "re-map any not_done move whose prescribed window starts after the last
 *     transcript timestamp" — implemented offline and run against both populations, it
 *     fired on 16.2% of a random control and only 13.2% of the grader-flagged set. It
 *     fires MORE on sessions nobody flagged. It has no discriminative power.
 *
 * What does discriminate is the grader contradicting itself: it writes "later-phase
 * moves should not be treated as misses" and then marks them not_done and counts them.
 * It applies the not_adjudicable verdict — which already exists for exactly this — on
 * some of those sessions and not others. So this asserts the contract in code and makes
 * the inconsistency visible, rather than inventing a timing heuristic (Rule 24c).
 *
 * The scores are byte-identical. Both halves of that matter: the flag must appear, and
 * nothing may move.
 */
const { scoreFidelity, claimsTruncation } = require('../../../bot/shared/services/coaching/fidelity/fidelity-scorer');
const { computeLpFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');

// ── the grader's real prose, verbatim from three production sessions ───────────
const NOTE_READABLE_BUT_INCOMPLETE =
  'The recording is readable but incomplete: it ends at [15:54] during the page 75 '
  + 'particle explanation. Later-phase moves should not be treated as misses without a '
  + 'complete recording.';
const NOTE_ENDS_BEFORE_LATER_PHASES =
  'The recording is readable but ends at [17:37], before the announced student practice '
  + 'and all later phases. Absence verdicts reflect no evidence in the supplied '
  + 'recording, not a claim that these moves could not have occurred afterward.';
const NOTE_ENDS_WHILE_WORKING =
  'The recording ends at approximately 20:42 while students are still working, so the '
  + 'absence of the exit ticket and homework may reflect an incomplete recording. The '
  + 'lesson itself is readable and corresponds to the division topic, so this is not a '
  + 'lesson mismatch or recording-unusable case.';

describe('claimsTruncation — reading the grader\'s own note', () => {
  test('the three real prose notes are recognised', () => {
    expect(claimsTruncation(NOTE_READABLE_BUT_INCOMPLETE)).toBe(true);
    expect(claimsTruncation(NOTE_ENDS_BEFORE_LATER_PHASES)).toBe(true);
    expect(claimsTruncation(NOTE_ENDS_WHILE_WORKING)).toBe(true);
  });

  test('the tokens the grader minted for a state we never named are recognised', () => {
    // It invents one because the prompt gives it no word for this: seen on prod as
    // recording_ends_mid_lesson ×4, recording_ends_during_group_work ×1,
    // transcript_incomplete ×1.
    for (const token of [
      'recording_truncated', 'recording_ends_mid_lesson',
      'recording_ends_during_group_work', 'transcript_incomplete',
    ]) {
      expect(claimsTruncation(token)).toBe(true);
    }
  });

  test('the two DOCUMENTED tokens are not truncation claims', () => {
    // 796 notes are exactly lesson_mismatch and 522 exactly recording_unusable. Neither
    // says the recording stopped early, and treating either as truncation would drown
    // the flag in 1,318 sessions of noise.
    expect(claimsTruncation('lesson_mismatch')).toBe(false);
    expect(claimsTruncation('recording_unusable')).toBe(false);
    expect(claimsTruncation('recording_readable')).toBe(false);
  });

  test('prose that denies truncation is not a claim of it', () => {
    expect(claimsTruncation(
      'The recording covers the full lesson through the exit ticket and closure.',
    )).toBe(false);
    expect(claimsTruncation(
      'The transcript is complete; the plan simply was not followed after the starter.',
    )).toBe(false);
  });

  test('total — junk and non-strings are false, never a throw', () => {
    for (const junk of [null, undefined, '', '   ', 42, {}, []]) {
      expect(claimsTruncation(junk)).toBe(false);
    }
  });
});

// ── the two real session shapes ───────────────────────────────────────────────
// Verdict MIX is what these fixtures reproduce, not the exact prod arithmetic: the
// discriminator is whether the grader used not_adjudicable for the moves its own note
// says it could not judge.
const must = (id) => ({ move_id: id, phase: 'body', bucket: 'must_happen', text: `move ${id}` });
const opt = (id) => ({ move_id: id, phase: 'close', bucket: 'optional_extension', text: `opt ${id}` });

// cd7c50c9… — note says "later-phase moves should not be treated as misses", and the
// grader DID hold back: the later moves are not_adjudicable, so they left the
// denominator. Self-consistent. coverage 0.71, fidelity 50%.
const CONSISTENT = {
  moves: [...['m1', 'm2', 'm3', 'm4', 'm5'].map(must), must('m6'), must('m7'), opt('o1'), opt('o2'), opt('o3')],
  verdicts: [
    { move_id: 'm1', verdict: 'partial' }, { move_id: 'm2', verdict: 'partial' },
    { move_id: 'm3', verdict: 'partial' }, { move_id: 'm4', verdict: 'partial' },
    { move_id: 'm5', verdict: 'partial' },
    { move_id: 'm6', verdict: 'not_adjudicable' }, { move_id: 'm7', verdict: 'not_adjudicable' },
    { move_id: 'o1', verdict: 'not_adjudicable' }, { move_id: 'o2', verdict: 'not_adjudicable' },
    { move_id: 'o3', verdict: 'not_adjudicable' },
  ],
  note: NOTE_READABLE_BUT_INCOMPLETE,
};

// eca9e181… — same shape of note ("before … all later phases") and then twelve of
// sixteen moves marked not_done and COUNTED. coverage 1.00, fidelity 20%.
const INCONSISTENT = {
  moves: Array.from({ length: 16 }, (_, i) => must(`m${i + 1}`)),
  verdicts: Array.from({ length: 16 }, (_, i) => ({
    move_id: `m${i + 1}`,
    verdict: i < 12 ? 'not_done' : (i < 14 ? 'partial' : 'executed'),
  })),
  note: NOTE_ENDS_BEFORE_LATER_PHASES,
};

describe('scoreFidelity — the flag, and nothing else', () => {
  test('the grader held back its verdicts → no flag', () => {
    const r = scoreFidelity(CONSISTENT.moves, CONSISTENT.verdicts, {
      moderators: { note: CONSISTENT.note },
    });
    expect(r.truncation_inconsistent).toBe(false);
    expect(r.moderators.truncation_inconsistent).toBe(false);
    expect(r.fidelity_pct).toBe(50);
    expect(r.coverage).toBe(0.71);
    expect(r.low_confidence).toBe(false);
  });

  test('the grader counted the misses it said not to → flag + low confidence', () => {
    const r = scoreFidelity(INCONSISTENT.moves, INCONSISTENT.verdicts, {
      moderators: { note: INCONSISTENT.note },
    });
    expect(r.truncation_inconsistent).toBe(true);
    expect(r.moderators.truncation_inconsistent).toBe(true);
    expect(r.low_confidence).toBe(true);
  });

  test('NO SCORE MOVES — the flagged blob is arithmetically identical', () => {
    const withNote = scoreFidelity(INCONSISTENT.moves, INCONSISTENT.verdicts, {
      moderators: { note: INCONSISTENT.note },
    });
    const without = scoreFidelity(INCONSISTENT.moves, INCONSISTENT.verdicts);
    for (const key of [
      'fidelity_pct', 'band', 'executed_credit', 'prescribed_count',
      'intended_scorable', 'coverage', 'recording_unusable',
    ]) {
      expect(withNote[key]).toEqual(without[key]);
    }
    expect(withNote.moves).toEqual(without.moves);
    expect(withNote.not_assessed).toEqual(without.not_assessed);
  });

  test('the note alone is not enough — it needs a counted not_done to contradict', () => {
    const allExecuted = Array.from({ length: 4 }, (_, i) => ({ move_id: `m${i + 1}`, verdict: 'executed' }));
    const r = scoreFidelity(
      Array.from({ length: 4 }, (_, i) => must(`m${i + 1}`)),
      allExecuted,
      { moderators: { note: NOTE_ENDS_WHILE_WORKING } },
    );
    expect(r.truncation_inconsistent).toBe(false);
    expect(r.fidelity_pct).toBe(100);
  });

  test('a counted not_done alone is not enough — it needs the note', () => {
    const r = scoreFidelity(
      Array.from({ length: 4 }, (_, i) => must(`m${i + 1}`)),
      Array.from({ length: 4 }, (_, i) => ({ move_id: `m${i + 1}`, verdict: 'not_done' })),
      { moderators: { note: 'lesson_mismatch' } },
    );
    expect(r.truncation_inconsistent).toBe(false);
  });

  test('no moderators at all → the blob is byte-identical to today\'s', () => {
    const before = scoreFidelity(INCONSISTENT.moves, INCONSISTENT.verdicts);
    expect(before.moderators).toBeNull();
    expect(before.truncation_inconsistent).toBe(false);
    expect(before.low_confidence).toBe(false);
  });

  test('an already-low-confidence session stays low confidence', () => {
    const r = scoreFidelity(CONSISTENT.moves, CONSISTENT.verdicts, { moderators: null });
    expect(r.low_confidence).toBe(false);
    const unusable = scoreFidelity([must('m1')], [{ move_id: 'm1', verdict: 'not_adjudicable' }]);
    expect(unusable.low_confidence).toBe(true);
    expect(unusable.recording_unusable).toBe(true);
  });
});

describe('computeLpFidelity — the flag survives to the persisted blob', () => {
  const deps = (verdicts, moderators) => ({
    resolveMoveList: async () => ({ moves: INCONSISTENT.moves, lesson_id: 'grade_4_urdu_ch8_seg3', template: 'T1' }),
    extractUploadedLp: async () => null,
    analyzeFidelity: async () => ({ verdicts, moderators, narrative: 'n', model: 'm' }),
    scoreFidelity: require('../../../bot/shared/services/coaching/fidelity/fidelity-scorer').scoreFidelity,
  });

  test('the contradiction is persisted under moderators, with low_confidence', async () => {
    const res = await computeLpFidelity(
      { corpusKey: { lesson_id: 'grade_4_urdu_ch8_seg3' }, transcript: '[00:10] t' },
      deps(INCONSISTENT.verdicts, { note: INCONSISTENT.note, plan_navigability: 'clear' }),
    );
    expect(res.status).toBe('ok');
    expect(res.moderators.truncation_inconsistent).toBe(true);
    expect(res.moderators.note).toBe(INCONSISTENT.note);
    expect(res.moderators.plan_navigability).toBe('clear');  // the grader's own keys survive
    expect(res.low_confidence).toBe(true);
  });

  test('and the score is the same number it would have been', async () => {
    const flagged = await computeLpFidelity(
      { corpusKey: { lesson_id: 'x' }, transcript: '[00:10] t' },
      deps(INCONSISTENT.verdicts, { note: INCONSISTENT.note }),
    );
    const plain = await computeLpFidelity(
      { corpusKey: { lesson_id: 'x' }, transcript: '[00:10] t' },
      deps(INCONSISTENT.verdicts, { note: 'lesson_mismatch' }),
    );
    expect(flagged.fidelity_pct).toBe(plain.fidelity_pct);
    expect(flagged.band).toBe(plain.band);
    expect(flagged.executed_credit).toBe(plain.executed_credit);
    expect(flagged.prescribed_count).toBe(plain.prescribed_count);
  });

  test('a grader that gave no note leaves moderators null and no flag', async () => {
    const res = await computeLpFidelity(
      { corpusKey: { lesson_id: 'x' }, transcript: '[00:10] t' },
      deps(INCONSISTENT.verdicts, null),
    );
    expect(res.moderators).toBeNull();
    expect(res.low_confidence).toBe(false);
  });
});
