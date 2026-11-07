'use strict';
/**
 * bd-5jmnfj.37 — four FDE files over the 300-line limit are split by concern into a folder of parts behind
 * the same exports. Each index and part stays under 300 lines and loads on its own; each index keeps every
 * name it had. What they do is pinned by the rest of tests/assessment (goldens and r9 hashes among them).
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../bot/shared/services/assessment');
const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').length - 1;

const SPLITS = [
  ['assessment-generation.service.js', 'assessment-generation', [
    'MODELS', '_askReader', '_authoredReligiousOf', '_blankWordsStems', '_dropProseVerses', '_versesReference',
    'answerCoverage', 'buildPatternUserPrompt', 'buildSystemPrompt', 'buildUserPrompt', 'countQuestions',
    'enforceMarksBudget', 'generateExam', 'generatePatternExam', 'generateTopicOral', 'normaliseAnswers',
    'patternPoemFor', 'planCounts', 'religiousFilter', 'sectionMaxTokens', 'sstStemLevel', 'stripImageKeys',
    'totalMarksOf', 'trimSeen']],
  ['assessment-paper-fde.renderer.js', 'fde-renderer', null],
  ['marking-scheme.js', 'marking-scheme', null],
  ['patterns/fde-g5-2027.js', 'patterns/fde-g5-2027', null],
];

describe.each(SPLITS)('%s (bd-5jmnfj.37)', (file, folder, names) => {
  const parts = fs.existsSync(path.join(DIR, folder))
    ? fs.readdirSync(path.join(DIR, folder)).filter((f) => f.endsWith('.js')) : [];

  it('the index is under 300 lines', () => {
    expect(lines(path.join(DIR, file))).toBeLessThanOrEqual(300);
  });
  it('has its parts, each under 300 lines and loading on its own', () => {
    expect(parts.length).toBeGreaterThan(0);
    parts.forEach((name) => {
      const part = path.join(DIR, folder, name);
      expect([name, lines(part) <= 300]).toEqual([name, true]);
      expect(typeof require(part)).toBe('object');
    });
  });
  if (names) {
    it('keeps every export', () => {
      expect(Object.keys(require(path.join(DIR, file))).sort()).toEqual([...names].sort());
    });
  }
});
