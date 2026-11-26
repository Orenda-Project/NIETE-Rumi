'use strict';
/**
 * Queue #293 — the Digital Coach answered C2 ("what the teacher does when an answer is wrong") N/A on a transcript in
 * which the students could not be heard: the recording's speakers were merged into one 18-minute teacher turn, with 3
 * "student" lines (2 of them the observer). FICO-S v1.2 lets the Digital Coach answer N/A on C2 only when "every
 * student answer in the transcript can be heard and none is wrong or incomplete". The observer kept the N/A, so her
 * form counted 22 indicators (88) while a second observer of the same lesson, whose recording kept 31 student lines and
 * a wrong answer, counted 23 (92). On production, every FICO-S form whose transcript had fewer than 15 student lines got
 * an N/A on C2; every C2 the Digital Coach scored had 26 or more.
 *
 * The validator (which runs on the transcript before the reply pre-fills the form) now reads a C2 N/A as "Couldn't
 * tell" when the transcript has fewer than MIN_STUDENT_LINES_FOR_C2_NA student lines: the observer, who was in the
 * room, sets C2 herself.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn(), logEvent: jest.fn() }));

const S = require('../../bot/shared/services/coaching/frameworks/fico-s');
const fw = require('../../bot/shared/services/coaching/frameworks/fico-s-framework');
const Dc = require('../../bot/shared/services/observe/obs612/fico-s-dc');

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
/** A lesson transcript with `students` student lines, one every 30 s after a teacher line. */
function transcript(students) {
  const out = ['[00:05] Teacher (UR): Today we solve linear equations. 3x + 5 = 0: which is the variable?'];
  for (let i = 0; i < students; i += 1) {
    out.push(`[${mmss(30 + i * 30)}] Student (UR): ${i % 2 ? 'x' : '3'}`);
    out.push(`[${mmss(45 + i * 30)}] Teacher (UR): Good. Next one.`);
  }
  return out.join('\n');
}
/** The shape of the merged recording: three short "student" lines around one long teacher turn. */
const MERGED = [
  '[00:14] Teacher (EN): Give me a second. Take your seat.',
  '[00:32] Student (EN): ukam.',
  '[01:02] Student (UR): Try to wind up the lecture in 25 minutes.',
  `[01:11] Teacher (UR): ${'Which is the coefficient? 3. Okay, and the constant? '.repeat(200)}`,
  '[19:23] Student (UR): It is already written in the lesson plan.',
].join('\n');

function reply(over = {}) {
  const levels = {};
  for (const c of S.DC_CODES) levels[c] = { result: 2, because: `Heard ${c}`, evidence: [] };
  return { rubric: 'fico_s_v1_2', levels: { ...levels, ...over } };
}
const NA_C2 = { C2: { result: 'NA', because: 'No student answers in the transcript are clearly wrong or incomplete.', evidence: [] } };

describe('C2 N/A needs the students heard', () => {
  test('the threshold is a named number', () => {
    expect(fw.MIN_STUDENT_LINES_FOR_C2_NA).toBe(20);
  });

  test('a merged recording (3 student lines): the N/A becomes Couldn\'t tell, with a reason and a warning', () => {
    const r = reply(NA_C2);
    const v = fw.validate(r, MERGED);
    expect(v.ok).toBe(true);
    expect(r.levels.C2.result).toBe('IE');
    expect(r.levels.C2.evidence).toEqual([]);
    expect(r.levels.C2.because).toMatch(/students/i);
    expect(v.warnings.join('\n')).toMatch(/C2: N\/A read as Couldn't tell \(3 student lines/);
  });

  test('a transcript with no speaker labels at all: no student line, so no N/A on C2', () => {
    const r = reply(NA_C2);
    fw.validate(r, '[00:10] Teacher (UR): one long block with everyone in it');
    expect(r.levels.C2.result).toBe('IE');
  });

  test('19 student lines: still Couldn\'t tell; 20: the N/A stands', () => {
    const few = reply(NA_C2);
    fw.validate(few, transcript(19));
    expect(few.levels.C2.result).toBe('IE');
    const enough = reply(NA_C2);
    fw.validate(enough, transcript(20));
    expect(enough.levels.C2.result).toBe('NA');
  });

  test('only C2\'s N/A is touched: a C2 level, and C3\'s N/A (about the teacher\'s questions), stay as the reply gave them', () => {
    const r = reply({ C2: { result: 2, because: 'corrected briefly', evidence: [] }, C3: { result: 'NA', because: 'no question asked', evidence: [] } });
    fw.validate(r, MERGED);
    expect(r.levels.C2.result).toBe(2);
    expect(r.levels.C3.result).toBe('NA');
  });

  test('on the form: the observer gets no C2 pre-filled and sets it herself; the score counts C2 once she does', () => {
    const r = reply(NA_C2);
    fw.validate(r, MERGED);
    fw.computeScores(r);
    const { draft } = Dc.prefillDraft({}, r, { rubric: 'fico_s_v1_2' });
    expect(draft.C2).toBeUndefined();
    expect(Dc.rumiLevelOf({ levels: r.levels }, 'C2', 'fico_s_v1_2')).toBeNull();
  });
});
