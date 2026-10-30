/**
 * bd-5jmnfj.33.3 — prompt rules added after the v31 review of the Class 3 and 4 papers.
 * Each rule is pinned by its text; the writer reads it from the pattern or the mid rules block.
 * (G3 Urdu: مدرسہ took a feminine adjective, ہنر keyed تجربہ, a "heavy sound" item named no sound;
 * G4 Science: a ship floated by "spreading its weight", a vacuum was asked twice, waterfalls needed
 * out-of-school knowledge; G4 Maths: checks paid unasked, "first three digits" for 63; G4 Urdu: آجرام,
 * the equator as a path in space; G3 GK: one idea tested four times, a definition split into three points.)
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
const NO_STORY = /No story or word problem: bare numbers and figures-free wording only\.$/;

describe('G3', () => {
  test('English Q4 words are never Section A words', () => {
    expect(rule(G3.subjects.english, 'g3.english.B.sentences')).toContain('The words are never words a Section A item tests or defines.');
  });
  test('Urdu: a sound item names its sound; K points never pay for the stem; meanings are true synonyms; target words stay unique; اسکول not مدرسہ', () => {
    const U = G3.subjects.urdu;
    expect(rule(U, 'g3.urdu.A.mcq')).toContain('A sound item names the sound it tests.');
    expect(rule(U, 'g3.urdu.B.short')).toContain('A K point never pays for repeating the stem\'s words.');
    expect(rule(U, 'g3.urdu.B.meanings')).toContain('The key is a true synonym in the chapter\'s sense.');
    expect(rule(U, 'g3.urdu.B.grammar')).toContain('The target word appears in no other item on the paper.');
    expect(rule(U, 'g3.urdu.C.sentences')).toContain('Never a word Q4 already asks about.');
    expect(rule(U, 'g3.urdu.C.letter')).toContain('Stems say اسکول, never مدرسہ.');
  });
  test('Maths: a check is a different method; equal alternatives; no own label; errors name the slip figure; Maths items still end with the no-story rule', () => {
    const M = G3.subjects.maths;
    expect(rule(M, 'g3.maths.C.extended')).toContain('A check is a different method, never the commuted product; the three alternatives are equal in demand; a part never carries its own question label.');
    ['g3.maths.A.directed', 'g3.maths.B.short', 'g3.maths.C.extended'].forEach((id) => {
      expect(rule(M, id)).toContain('A common error names the figure its slip gives.');
      expect(rule(M, id)).toMatch(NO_STORY);
    });
  });
  test('General Knowledge: one idea once; box words are not later points; marks match the ask', () => {
    const K = G3.subjects.general_knowledge;
    expect(rule(K, 'g3.general_knowledge.A.mcq')).toContain('One idea is tested once across the MCQ, blank, short and long items.');
    expect(rule(K, 'g3.general_knowledge.A.fill')).toContain('A box word is never a Q4 or Q5 answer point.');
    expect(rule(K, 'g3.general_knowledge.B.short')).toContain('Marks match the ask: one definition is one point, never three.');
  });
});

describe('G4', () => {
  test('English: a fact once; a meaning item prints its word; collective nouns accept the plain form; no stem prints a key', () => {
    const E = G4.subjects.english;
    expect(rule(E, 'g4.english.A.mcq')).toContain('A fact is asked once on the paper; a meaning item prints the word it asks about.');
    expect(rule(E, 'g4.english.A.grammar')).toContain('A collective-noun answer accepts the plain form.');
    expect(rule(E, 'g4.english.B.short')).toContain('No stem prints another item\'s key.');
  });
  test('Urdu: chapter spelling; keys true to the text; no stem prints another item\'s pair; grammatical models', () => {
    const U = G4.subjects.urdu;
    expect(rule(U, 'g4.urdu.A.mcq')).toContain('Spelling as the chapter prints it (اجرام, never آجرام).');
    expect(rule(U, 'g4.urdu.B.short')).toContain('A key states only what the chapter text states.');
    expect(rule(U, 'g4.urdu.B.grammar')).toContain('No stem prints another item\'s antonym pair or target word.');
    expect(rule(U, 'g4.urdu.C.letter')).toContain('The model answer is grammatical Urdu.');
    expect(rule(U, 'g4.urdu.C.essay')).toContain('The model answer is grammatical Urdu.');
  });
  test('Maths: the 5-mark scheme pays a check only when asked; division points name the digits used; no shared multiplier or shape', () => {
    const M = G4.subjects.maths;
    ['g4.maths.B.short', 'g4.maths.B.word_problem', 'g4.maths.C.extended'].forEach((id) => {
      expect(rule(M, id)).toContain('a check is paid only where the stem asks for one.'); // v38: the unit/statement mark is gone (bd-5jmnfj.33.7.2)
      expect(rule(M, id)).not.toContain('or a check.');
    });
    expect(rule(M, 'g4.maths.B.short')).toContain('A division method point names the digits actually used first.');
    expect(rule(M, 'g4.maths.B.short')).toContain('No two items share a multiplier or the same shape.');
    expect(rule(M, 'g4.maths.C.extended')).toContain('No two items share a multiplier or the same shape.');
    expect(rule(M, 'g4.maths.B.short')).toMatch(NO_STORY);
  });
  test('Science: floating is density or upthrust; nothing out of school; a concept in at most two items; no stem as MCQ and short answer', () => {
    const S = G4.subjects.science;
    expect(rule(S, 'g4.science.A.mcq')).toContain('An option never states a long answer\'s steps; a concept appears in at most two items; never the same stem as an MCQ and a short answer.');
    ['g4.science.B.short', 'g4.science.B.reasons', 'g4.science.C.extended'].forEach((id) => {
      expect(rule(S, id)).toContain('Floating is explained by density or the upthrust, never by spreading weight.');
    });
    ['g4.science.A.mcq', 'g4.science.A.fill', 'g4.science.B.short'].forEach((id) => {
      expect(rule(S, id)).toContain('Nothing a child needs out-of-school knowledge for.');
    });
  });
});

describe('the Grade 3-4 shared rules', () => {
  const ONCE = 'No two items ask the same question or test the same fact; a stem never prints another item\'s answer or target word.';
  const TRUE = 'A model answer states only what the chapter text states; a check is paid only where the stem asks for one and uses a different method; an item never carries its own question number or label.';
  const TOS = { Remember: 20, Understand: 30, Apply: 50 };
  const mid = (grade, key) => C.makeSubject({
    grade, key, medium: 'en', name_en: key, name_ur: key, tos: TOS,
    sections: [{ id: 'A', label_en: 'A', levels: { Remember: 5 }, slots: [{ slot: `${key}.A.Q1`, label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 5, marks_each: 1, prompt_rule: 'r' }] }],
  });
  const promptFor = (P, scope) => {
    const section = P.sections[0];
    return Gen.buildPatternUserPrompt({
      grade: P.grade || 5, subject: P.key, pageContent: 'page text', pageReference: '40-48', section, slots: section.slots, lang: P.medium, P, scope,
    });
  };

  test('are in a Grade 3 or 4 prompt and not in a Grade 5 prompt', () => {
    const g3 = promptFor(mid(3, 'maths'), { kind: 'chapters', chapters: [3], pages: '40-48' });
    const g4 = promptFor(mid(4, 'english'), { kind: 'chapters', chapters: [5], pages: '40-48' });
    const g5 = promptFor(Patterns.subjectOf('fde_g5_2027', 'maths'), { kind: 'fde', chapters: null, pages: null });
    [ONCE, TRUE].forEach((r) => {
      expect(g3).toContain(r);
      expect(g4).toContain(r);
      expect(g5).not.toContain(r);
    });
  });
});
