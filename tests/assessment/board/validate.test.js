/**
 * board/validate.js: the pattern schema as code (SPEC §4; the contract's pattern.schema.json was never written,
 * so this is the conservative reading). It re-checks a BUILT pattern independently of the builders, so a hand
 * edit to a frozen entry, or a builder bug, is caught. Every registered entry must return [].
 */
const C = require('../../../bot/shared/services/assessment/patterns/board/chrome');
const { validatePattern } = require('../../../bot/shared/services/assessment/patterns/board/validate');

const split = { levels: { R: 30, U: 30, A: 20, AE: 10, C: 10 }, source: 's', status: 'verified' };
const P0 = C.build({
  id: 'fde_v_g7', grade: 7, board: 'FDE', exam_kind: 'term',
  subjects: [C.makeSubject({
    key: 'computer_science', source_id: 'fde-g7-computer_science-model-2023-24', medium: 'en', name_en: 'Computer Science', name_ur: 'کمپیوٹر', status: 'ship',
    variants: [{
      total_marks: 40, total_time_min: null, cognitive_split: split, scheme_style: 'holistic_bands',
      sections: [
        { id: 'A', label_en: 'A', marks: 13, answer_on: 'question_paper', slots: [{ slot: 'A.Q1', label_en: 'Q.1', type: 'mcq', printed: 13, marks_each: 1 }] },
        { id: 'C', label_en: 'C', marks: 17, slots: [
          { slot: 'C.Q3.1', label_en: 'Q.3.1', or: { branches: [{ type: 'erq', marks_each: 5 }, { type: 'erq', marks_each: 5 }] } },
          { slot: 'C.Q3.3', label_en: 'Q.3.3', type: 'erq', marks_each: 7.5 },
          { slot: 'C.Q3.4', label_en: 'Q.3.4', type: 'erq', marks_each: 4.5 },
        ] },
        { id: 'P', label_en: 'P', marks: 10, slots: [{ slot: 'P.Q1', label_en: 'Project', project: { marks: 10, instruction_en: 'Make a poster.' } }] },
      ],
    }],
  })],
  pending: [C.pendingCell({ key: 'urdu', source_id: 'fde-g7-urdu-model-2023-24', medium: 'ur', reason: 'OCR gate' })],
});

/** A mutable deep copy, edited by `fn`. */
function broken(fn) {
  const P = JSON.parse(JSON.stringify(P0));
  fn(P, P.subjects.computer_science, P.subjects.computer_science.variants[0]);
  return validatePattern(P);
}

test('a built pattern is valid', () => {
  expect(validatePattern(P0)).toEqual([]);
});

test.each([
  ['profile', (P) => { P.profile = undefined; }, /profile/],
  ['grade', (P) => { P.grade = 5; }, /grade/],
  ['id', (P) => { P.id = ''; }, /id/],
  ['no subjects', (P) => { P.subjects = {}; }, /subjects/],
  ['key mismatch', (P, S) => { S.key = 'cs'; }, /key/],
  ['medium', (P, S) => { S.medium = 'ar'; }, /medium/],
  ['source id', (P, S) => { S.source_id = null; }, /source_id/],
  ['status', (P, S) => { S.status = 'verified'; }, /status/],
  ['no variants', (P, S) => { S.variants = []; }, /variants/],
  ['mirror total', (P, S) => { S.total_marks = 41; }, /mirror/],
  ['mirror sections', (P, S) => { S.sections = []; }, /mirror/],
  ['variant total', (P, S, V) => { V.total_marks = 41; }, /total/],
  ['generated marks', (P, S, V) => { V.generated_marks = 40; }, /generated/],
  ['section sum', (P, S, V) => { V.sections[0].marks = 14; }, /section A/],
  ['section x4', (P, S, V) => { V.sections[0].marks_x4 = 1; }, /section A/],
  ['slot total', (P, S, V) => { V.sections[0].slots[0].marks = 12; }, /A\.Q1/],
  ['slot x4', (P, S, V) => { V.sections[1].slots[1].total_x4 = 31; }, /C\.Q3\.3/],
  ['quarter marks', (P, S, V) => { V.sections[1].slots[1].marks_each = 7.3; }, /C\.Q3\.3/],
  ['type', (P, S, V) => { V.sections[0].slots[0].type = 'diagram'; }, /type/],
  ['attempt > printed', (P, S, V) => { V.sections[0].slots[0].attempt = 14; }, /attempt/],
  ['generate', (P, S, V) => { V.sections[0].slots[0].generate = 10; }, /generate/],
  ['or generate', (P, S, V) => { V.sections[1].slots[0].generate = 1; }, /generate/],
  ['or branches', (P, S, V) => { V.sections[1].slots[0].or.branches[1].marks_each = 4; }, /branch/],
  ['teacher-marked generates', (P, S, V) => { V.sections[2].slots[0].generate = 1; }, /teacher/],
  ['teacher-marked instruction', (P, S, V) => { V.sections[2].slots[0].project.instruction_en = ''; }, /teacher/],
  ['duplicate slot', (P, S, V) => { V.sections[1].slots[2].slot = 'C.Q3.3'; }, /duplicate/],
  ['duplicate section', (P, S, V) => { V.sections[1].id = 'A'; }, /duplicate/],
  ['answer_on', (P, S, V) => { V.sections[0].answer_on = 'wall'; }, /answer_on/],
  ['split sum', (P, S, V) => { V.cognitive_split.levels.R = 31; }, /100/],
  ['split level', (P, S, V) => { V.cognitive_split.levels = { Q: 100 }; }, /level/],
  ['split status', (P, S, V) => { V.cognitive_split.status = 'x'; }, /status/],
  ['scheme style', (P, S, V) => { V.scheme_style = 'x'; }, /scheme_style/],
  ['time', (P, S, V) => { V.sections[0].time_min = -5; }, /time/],
  ['shared time', (P, S, V) => { V.shared_time_min = 60; V.shared_sections = ['C']; V.sections[1].time_min = 10; }, /shared/],
  ['shared unknown section', (P, S, V) => { V.shared_time_min = 60; V.shared_sections = ['Z']; }, /shared/],
  ['stimulus figure', (P, S, V) => { V.sections[0].slots[0].stimulus = { count: 1, mcqs_per_stimulus: 4, kinds: ['diagram'] }; }, /stimulus/],
  ['pending offered', (P) => { P.pending.computer_science = { key: 'computer_science', status: 'design_pending' }; }, /pending/],
  ['pending status', (P) => { P.pending.urdu.status = 'ship'; }, /pending/],
])('catches %s', (name, fn, re) => {
  const errors = broken(fn);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.join('\n')).toMatch(re);
});

test('refuses a non-object outright', () => {
  expect(validatePattern(null)).toEqual(['pattern: not an object']);
});
