/**
 * FEAT-053 bd-37 — NEVER put words in the teacher's mouth.
 *
 * Rida (2026-07-14): "there was no such conversation on our commitment for
 * next class, how come you are adding this?" Her debrief transcript contained
 * NO commitment; the teacher-facing notes attributed a first-person pledge to
 * her anyway. Same design flaw as the forced-2-wins bug: the commitment field
 * was effectively mandatory, so the model invented one.
 *
 * Rules pinned here:
 *  1. commitment is OPTIONAL — null when the teacher didn't voice one.
 *  2. The prompt forbids invention and the old "write a step they agreed on"
 *     fallback is gone.
 *  3. The companion renders cleanly without a commitment block.
 *  4. A HARMFUL debrief (harm-gate rubric) produces NO teacher notes at all —
 *     sanitized fiction about an abusive conversation is worse than silence.
 */

const {
  buildDebriefNotesPrompt,
  validateDebriefNotes,
  buildCompanionText,
} = require('../../shared/services/observe/observe-teacher-report');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const S = observeStrings('sw');

describe('commitment is optional — never invented (bd-37)', () => {
  test('notes WITHOUT a commitment validate', () => {
    expect(() => validateDebriefNotes({ discussed_sw: 'Mlizungumza kuhusu somo.', commitment_sw: null })).not.toThrow();
    expect(() => validateDebriefNotes({ discussed_sw: 'Mlizungumza kuhusu somo.' })).not.toThrow();
  });

  test('discussed_sw is still required', () => {
    expect(() => validateDebriefNotes({ commitment_sw: 'Nitajaribu.' })).toThrow();
  });

  test('companion without a commitment has no Ahadi block', () => {
    const msg = buildCompanionText({ discussed_sw: 'Mlizungumza kuhusu maswali.' }, { foName: 'Elisha' }, S);
    expect(msg).toContain('maswali');
    expect(msg).not.toContain(S.companion_commitment_label);
  });

  test('the prompt forbids invention and drops the old invented-fallback instruction', () => {
    const p = buildDebriefNotesPrompt('nakala', { foName: 'Elisha' });
    expect(p).toMatch(/usibuni|KAMWE.*(kubuni|kutunga)|never invent/i);   // invention banned
    expect(p).toMatch(/null/);                                            // null named as the honest answer
    expect(p).not.toMatch(/andika hatua moja waliyokubaliana/);           // the fabrication invitation is GONE
  });
});
