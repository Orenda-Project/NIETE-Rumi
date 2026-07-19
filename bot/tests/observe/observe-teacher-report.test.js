/**
 * FEAT-053 bd-32 — combined-report content (pure layer).
 *
 * The teacher receives the OFFICIAL MEWAKA hero report (design unchanged,
 * rendered by the existing generateHeroReport from the FO's edited v2) plus
 * ONE companion text: the FO's presence + what was discussed in the debrief +
 * the teacher's own commitment (D32). This module owns the debrief-notes
 * extraction prompt, its teacher-facing gates, and the companion builder.
 *
 * TRUST RULES: everything here is TEACHER-facing. Never the FO's critique
 * verbatim, never anything accusatory, never a score, never the coach-the-
 * coach material (that is for the officer alone).
 */

const {
  buildDebriefNotesPrompt,
  validateDebriefNotes,
  buildCompanionText,
} = require('../../shared/services/observe/observe-teacher-report');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const S = observeStrings('sw');

const TRANSCRIPT =
  'FO: Asante kwa kunikaribisha. Nilipenda ulivyotumia vijiti. Mwalimu: Asante. ' +
  'FO: Unaonaje somo lilikwendaje? Mwalimu: Wanafunzi wachache walijibu maswali. ' +
  'FO: Vipi kesho ukiuliza "Umejuaje?" Mwalimu: Nitajaribu kesho asubuhi wakati wa hesabu.';

const notes = () => ({
  discussed_sw: 'Mlizungumza kuhusu matumizi ya vijiti darasani na jinsi ya kuwapa wanafunzi nafasi zaidi ya kueleza mawazo yao.',
  commitment_sw: 'Kesho asubuhi wakati wa hesabu, nitauliza "Umejuaje?" baada ya kila jibu.',
});

describe('buildDebriefNotesPrompt', () => {
  const p = buildDebriefNotesPrompt(TRANSCRIPT, { foName: 'Elisha' });

  test('carries the transcript and asks for JSON', () => {
    expect(p).toContain('Umejuaje?');
    expect(p).toMatch(/JSON/);
    expect(p).toContain('discussed_sw');
    expect(p).toContain('commitment_sw');
  });

  test('states the teacher-facing gates: warm, never accusatory, no scores, her own words', () => {
    expect(p).toMatch(/mwalimu ataisoma|teacher will read/i);   // audience named
    expect(p).toMatch(/KAMWE|never/i);                          // hard bans present
    expect(p).toMatch(/alama|score/i);                          // score ban named
    expect(p).toMatch(/maneno yake|her own words/i);            // commitment in her words
  });
});

describe('validateDebriefNotes', () => {
  test('accepts good notes', () => {
    expect(() => validateDebriefNotes(notes())).not.toThrow();
  });

  test('rejects score leakage', () => {
    for (const leak of ['Ulipata 40/75', 'asilimia 53 ya wanafunzi', 'alama 2 kati ya 3']) {
      const n = notes();
      n.discussed_sw = leak;
      expect(() => validateDebriefNotes(n)).toThrow(/score/i);
    }
  });

  test('rejects accusatory verdict phrasing on the teacher', () => {
    const n = notes();
    n.discussed_sw = 'Mwalimu hujui kufundisha na darasa lako ni chafu.';
    expect(() => validateDebriefNotes(n)).toThrow(/accus|verdict|hukumu/i);
  });

  test('rejects empty/missing fields', () => {
    expect(() => validateDebriefNotes({ discussed_sw: '', commitment_sw: 'x' })).toThrow();
    expect(() => validateDebriefNotes(null)).toThrow();
  });
});

describe('buildCompanionText', () => {
  test('carries FO name, what was discussed, and the commitment — one message', () => {
    const msg = buildCompanionText(notes(), { foName: 'Elisha Mushi' }, S);
    expect(msg).toContain('Elisha Mushi');
    expect(msg).toContain('vijiti');
    expect(msg).toContain('Umejuaje?');
    expect(msg.length).toBeLessThanOrEqual(4096);
  });

  test('no notes (debrief skipped/too thin) → returns null, never an empty shell', () => {
    expect(buildCompanionText(null, { foName: 'Elisha' }, S)).toBeNull();
  });

  test('never a numeric score even if upstream slipped one into a field', () => {
    // belt-and-braces: builder re-checks — validation should have caught it,
    // but the companion is teacher-facing so it re-guards
    const bad = notes();
    bad.commitment_sw = 'Nitajaribu kupata 75/75 kesho';
    expect(() => buildCompanionText(bad, { foName: 'Elisha' }, S)).toThrow(/score/i);
  });
});
