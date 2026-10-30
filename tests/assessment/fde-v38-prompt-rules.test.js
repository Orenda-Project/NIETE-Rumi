/**
 * bd-5jmnfj.33.7.2 (round 6, v38) — prompt rules after the v36 review of the Grade 3 and 4 papers.
 * v36: word boxes held no spare word (G3 GK Q3, G4 Science Q2); G3 GK Q2 rows iii and iv were near-synonyms
 * that both Column B phrases fit (blocker); keys paid the stem's own words, one fact twice, or past the asked
 * end point; one chapter word was tested four times (G4 Urdu «معزول»); G4 Maths paid method, unit and statement
 * marks that no stem or instruction asked for; G4 Science paid a "science word" mark already paid; G4 Urdu Q4
 * paid 2 marks for one changed word. Each rule is pinned by its text.
 */

jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const C = require('../../bot/shared/services/assessment/patterns/mid/chrome');
const G3 = require('../../bot/shared/services/assessment/patterns/fde-g3-2026');
const G4 = require('../../bot/shared/services/assessment/patterns/fde-g4-2026');

const slotOf = (subject, id) => subject.sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const rule = (subject, id) => slotOf(subject, id).prompt_rule;

describe('word boxes and match rows', () => {
  test('a word box holds the answers plus one spare word', () => {
    expect(rule(G3.subjects.general_knowledge, 'g3.general_knowledge.A.fill')).toContain('the ten answers plus ONE spare word');
    expect(rule(G4.subjects.science, 'g4.science.A.fill')).toContain('the five answers plus ONE spare word');
  });
  test('G3 GK match: no two Column A entries near in meaning; one that two Column B entries fit is replaced', () => {
    const r = rule(G3.subjects.general_knowledge, 'g3.general_knowledge.A.match');
    expect(r).toContain('No two column-A entries are near in meaning');
    expect(r).toContain('a column-A entry two column-B entries fit is replaced.');
  });
});

describe('G4 marking', () => {
  test('Maths: working is asked where it is paid; Q2 pays the result only; no unasked statement mark', () => {
    const M = G4.subjects.maths;
    expect(slotOf(M, 'g4.maths.B.short').instruction_en).toBe('Answer any three questions. Show your working.');
    expect(slotOf(M, 'g4.maths.B.word_problem').instruction_en).toBe('Solve any one problem. Show your working and write the answer with its unit.');
    expect(slotOf(M, 'g4.maths.C.extended').instruction_en).toBe('Answer any two questions. Show your working.');
    expect(rule(M, 'g4.maths.A.directed')).toContain('Scheme: A 2 for the correct answer');
    expect(rule(M, 'g4.maths.A.directed')).not.toContain('M 1 for the method');
    ['g4.maths.B.short', 'g4.maths.B.word_problem', 'g4.maths.C.extended'].forEach((id) => {
      expect(rule(M, id)).toContain('no mark for a statement or a number sentence the stem does not ask for');
      expect(rule(M, id)).toContain('a common_error that states a figure gives the figure that slip really produces');
    });
  });
  test('Science: no mark for a word another point already paid', () => {
    const S = G4.subjects.science;
    expect(rule(S, 'g4.science.B.reasons')).toContain('no mark for using a word, and no point pays a word another point already paid');
    expect(rule(S, 'g4.science.C.extended')).toContain('no mark for using a term another point already paid');
    expect(rule(S, 'g4.science.C.extended')).not.toContain('L 1 for correct science terms used');
  });
  test('Urdu Q4: a rewritten sentence, one mark for the change and one for the sentence agreeing with it', () => {
    const r = rule(G4.subjects.urdu, 'g4.urdu.B.grammar');
    expect(r).toContain('Answer: the rewritten sentence. Scheme: K 1 for the changed word, K 1 for the rest of the sentence agreeing with it.');
  });
});

describe('the Grade 3-4 shared rules (v38)', () => {
  const PAID = 'Each marking point pays a different idea the stem asks for: never the stem\'s own words, never one idea twice';
  const ONE = 'A chapter word is tested in one item only';
  const mid = (grade, key) => C.makeSubject({
    grade, key, medium: 'en', name_en: key, name_ur: key, tos: { Remember: 20, Understand: 30, Apply: 50 },
    sections: [{ id: 'A', label_en: 'A', levels: { Remember: 5 }, slots: [{ slot: `${key}.A.Q1`, label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 5, marks_each: 1, prompt_rule: 'r' }] }],
  });
  const promptFor = (P, scope) => {
    const section = P.sections[0];
    return Gen.buildPatternUserPrompt({
      grade: P.grade || 5, subject: P.key, pageContent: 'page text', pageReference: '40-48', section, slots: section.slots, lang: P.medium, P, scope,
    });
  };
  test('are in a Grade 3 or 4 prompt and not in a Grade 5 prompt', () => {
    const g3 = promptFor(mid(3, 'urdu'), { kind: 'chapters', chapters: [3], pages: '40-48' });
    const g4 = promptFor(mid(4, 'science'), { kind: 'chapters', chapters: [4], pages: '40-48' });
    const g5 = promptFor(Patterns.subjectOf('fde_g5_2027', 'maths'), { kind: 'fde', chapters: null, pages: null });
    [PAID, ONE].forEach((r) => {
      expect(g3).toContain(r);
      expect(g4).toContain(r);
      expect(g5).not.toContain(r);
    });
  });
});
