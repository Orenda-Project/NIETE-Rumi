/**
 * bd-zrdvmi.50.7 (q182) — FDE's thinking-level mix for a Grade 1-5 build-your-own paper.
 * Grades 1-4: FDE Assessment Scheme / Tables of Specification 2023-24; Grade 5: GRADE V MODEL PAPERS CAE 2026.
 * The bot's table must equal the one the exam editor shows (portal fdeLevelGuide.ts), so a paper is written
 * toward the same target the teacher sees.
 */
const fs = require('fs');
const path = require('path');
const T = require('../../bot/shared/services/assessment/fde-level-target');

describe('fdeTarget', () => {
  test('Grade 5 Maths is the model papers\' table', () => {
    expect(T.fdeTarget(5, 'Maths')).toEqual({ Remember: 10, Understand: 50, Apply: 40, source: 'FDE Grade V model papers, CAE 2026' });
  });
  test('Grade 1 English comes from FDE\'s Grade 1-4 criteria, not the Grade 5 mix', () => {
    expect(T.fdeTarget(1, 'english')).toMatchObject({ Remember: 40, Understand: 40, Apply: 20 });
  });
  test.each([
    ['eng', 3, [30, 30, 40]], ['sst', 4, [35, 30, 35]], ['sst_en', 5, [30, 40, 30]],
    ['genk', 3, [41, 41, 18]], ['genk_en', 1, [40, 40, 20]], ['mathematics', 4, [10, 60, 30]], ['islamiat', 2, [40, 40, 20]],
  ])('bot subject key %s, grade %i', (subject, grade, [r, u, a]) => {
    expect(T.fdeTarget(grade, subject)).toMatchObject({ Remember: r, Understand: u, Apply: a });
  });
  test('a numeric-string grade works', () => {
    expect(T.fdeTarget('4', 'science')).toMatchObject({ Remember: 30, Understand: 30, Apply: 40 });
  });
  test.each([[6, 'maths'], [2, 'science'], [5, 'general_knowledge'], [null, 'maths'], [3, ''], [3, 'computer']])(
    'no target where FDE gave none: grade %p %p', (grade, subject) => {
      expect(T.fdeTarget(grade, subject)).toBeNull();
    });
  test('every row sums to 100', () => {
    for (const [grade, row] of Object.entries(T.TABLE)) {
      for (const [subject, [mix]] of Object.entries(row)) {
        expect([grade, subject, mix.reduce((n, x) => n + x, 0)]).toEqual([grade, subject, 100]);
      }
    }
  });
});

describe('targetLine (what the writer is told)', () => {
  test('states the marks split, its source and how to tag', () => {
    const line = T.targetLine(5, 'urdu');
    expect(line).toContain('Remember 30%, Understand 30%, Apply 40%');
    expect(line).toContain('FDE Grade V model papers, CAE 2026');
    expect(line).toMatch(/by marks/i);
    expect(line).toMatch(/blooms/);
  });
  test('empty where there is no target', () => {
    expect(T.targetLine(7, 'maths')).toBe('');
  });
});

describe('paperMix (what the paper carries, by marks)', () => {
  const paper = {
    unseen: {
      objective: { MCQs: [{ question: 'a', marks: 1, blooms: 'Remember' }, { question: 'b', marks: 1, blooms: 'Remember' }] },
      subjective: {
        'Short Questions': [{ question: 'c', marks: 2, blooms: 'Understand' }, { question: 'gone', marks: 9, blooms: 'Apply', removed: true }],
        'Long Questions': [{ question: 'd', marks: 4, blooms: 'Evaluate' }, { question: 'e', marks: 2, blooms: 'Create' }],
      },
    },
    seen: { subjective: { Exercise: [{ question: 'f', marks: 0, blooms: 'Apply' }, { question: 'g', blooms: 'Remember' }] } },
  };
  test('Analyse and above count as Apply; removed and unmarked items count nowhere', () => {
    expect(T.paperMix(paper)).toEqual({ Remember: 20, Understand: 20, Apply: 60, marks: 10 });
  });
  test('null with no tagged marks', () => {
    expect(T.paperMix({ unseen: { objective: { MCQs: [{ question: 'x', marks: 1 }] } } })).toBeNull();
  });
});

test('the bot table matches the exam editor\'s FDE target (portal fdeLevelGuide.ts)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../portal/src/portal/teacher/assessment/fdeLevelGuide.ts'), 'utf8');
  const portal = {};
  let grade = null;
  for (const line of src.split('\n')) {
    const g = line.match(/^\s{2}(\d):\s*\{/);
    if (g) grade = Number(g[1]);
    if (grade === null) continue;
    for (const m of line.matchAll(/(\w+):\s*\[\[(\d+),\s*(\d+),\s*(\d+)\]/g)) {
      (portal[grade] ||= {})[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
    }
    if (/^\};/.test(line)) break;
  }
  const bot = {};
  for (const [g, row] of Object.entries(T.TABLE)) for (const [s, [mix]] of Object.entries(row)) (bot[g] ||= {})[s] = mix;
  expect(Object.keys(portal)).toHaveLength(5);
  expect(bot).toEqual(portal);
});
