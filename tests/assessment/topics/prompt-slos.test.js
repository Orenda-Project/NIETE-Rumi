/**
 * Task 6 — buildUserPrompt with `slos` (a topic paper) and without (every other paper, byte-for-byte as before).
 * The fixture was taken from the function before the edit.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const { buildUserPrompt } = require('../../../bot/shared/services/assessment/assessment-generation.service');

const ARGS = {
  grade: 3, subject: 'english', pageContent: 'PAGE TEXT', pageReference: 'Pages 58-63',
  contentSource: 'unseen', questionCount: 6, totalMarks: 10,
  questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }, { id: 'Fill in the Blanks', count: 2, category: 'objective' }],
};
const SLOS = [
  { code: 'E-03-G-01', description: 'Use simple past tense', topicId: 't1', topicName: 'Past tense' },
  { code: 'E-03-G-02', description: 'Use plural nouns', topicId: 't2', topicName: 'Plurals' },
];

describe('buildUserPrompt', () => {
  test('without slos it is the same string as before', () => {
    const before = fs.readFileSync(path.join(__dirname, 'fixtures', 'user-prompt-no-slos.txt'), 'utf8');
    expect(buildUserPrompt(ARGS)).toBe(before);
    expect(buildUserPrompt({ ...ARGS, slos: [] })).toBe(before);
    expect(buildUserPrompt({ ...ARGS, slos: null })).toBe(before);
  });

  test('with slos it lists each as "code — description"', () => {
    const p = buildUserPrompt({ ...ARGS, slos: SLOS });
    expect(p).toContain('E-03-G-01 — Use simple past tense');
    expect(p).toContain('E-03-G-02 — Use plural nouns');
  });

  test('with slos every question must test one and carry "slo": "<code>"', () => {
    const p = buildUserPrompt({ ...ARGS, slos: SLOS });
    expect(p).toMatch(/every question must test one of these/i);
    expect(p).toContain('"slo": "<code>"');
  });

  test('with slos the counts in this message override the instructions', () => {
    const p = buildUserPrompt({ ...ARGS, slos: SLOS });
    expect(p).toMatch(/counts in this message override any counts in the instructions/i);
  });

  test('with slos the head and the notes of the prompt are untouched', () => {
    const before = fs.readFileSync(path.join(__dirname, 'fixtures', 'user-prompt-no-slos.txt'), 'utf8');
    const p = buildUserPrompt({ ...ARGS, slos: SLOS });
    const head = before.split('no more')[0];
    const notes = before.slice(before.indexOf('**IMPORTANT NOTES:**'));
    expect(p.startsWith(head)).toBe(true);
    expect(p.endsWith(notes)).toBe(true);
  });
});
