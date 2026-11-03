/**
 * bd-5jmnfj.33.2 — prompt rules added after the v30 review of the Class 3 and 4 papers.
 * G3 Maths Q5 parts re-asked Section A facts; G4 Maths Q1 ix divided 7,842 by 9 with no exact
 * option; G4 Maths Q5 repeated the shape of Q3; G3 GK Q3 had two box words fitting one blank;
 * G3 Maths Q5 accept lists carried the wording the common error called wrong. Each rule is
 * pinned here by its text; the writer reads them from the pattern or from the mid rules block.
 */

jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const C = require('../../bot/shared/services/assessment/patterns/mid/chrome');
const G3 = require('../../bot/shared/services/assessment/patterns/fde-g3-2026');
const G4 = require('../../bot/shared/services/assessment/patterns/fde-g4-2026');

const slotOf = (subject, id) => subject.sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const NO_STORY = /No story or word problem: bare numbers and figures-free wording only\.$/;

test('G3 Maths Q5: every part works on its own numbers and no part re-asks Section A or B', () => {
  const rule = slotOf(G3.subjects.maths, 'g3.maths.C.extended').prompt_rule;
  expect(rule).toContain('Every part works on the task\'s own numbers; no part re-asks a Section A or B item.');
  expect(rule).toMatch(NO_STORY);
});

test('G4 Maths Q1: a division stem divides exactly or asks for the remainder; Q5 is three different skills', () => {
  const mcq = slotOf(G4.subjects.maths, 'g4.maths.A.mcq').prompt_rule;
  expect(mcq).toContain('A division stem divides exactly, or asks for the remainder. No item gives away another\'s answer.');
  expect(mcq).toMatch(NO_STORY);
  const ext = slotOf(G4.subjects.maths, 'g4.maths.C.extended').prompt_rule;
  expect(ext).toContain('three different skills, none the shape of a Q3 item');
  expect(ext).toMatch(NO_STORY);
});

test('G3 General Knowledge Q3: each blank takes exactly one box word', () => {
  expect(slotOf(G3.subjects.general_knowledge, 'g3.general_knowledge.A.fill').prompt_rule)
    .toContain('Each blank takes exactly one of the box words and no other box word fits it.');
});

describe('the Grade 3-4 scheme rule', () => {
  const RULE = '`accept` never lists a wording the same item\'s common_error names as wrong; an item that asks for N things keys N points.';
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

  test('is in a Grade 3 or 4 prompt and not in a Grade 5 prompt', () => {
    expect(promptFor(mid(3, 'maths'), { kind: 'chapters', chapters: [5], pages: '40-48' })).toContain(RULE);
    expect(promptFor(mid(4, 'english'), { kind: 'chapters', chapters: [5], pages: '40-48' })).toContain(RULE);
    expect(promptFor(Patterns.subjectOf('fde_g5_2027', 'maths'), { kind: 'fde', chapters: null, pages: null })).not.toContain(RULE);
  });
});
