/**
 * bd-5jmnfj.38.31 — a G6-12 free paper in Urdu prints its headings, student box and instructions in
 * Urdu (A2c on the a4 G8 Urdu paper). The strings are data (rumi Rule 20); every Urdu string is copied
 * from one already in the repo, and one with no existing wording stays design_pending, off the paper.
 */
const fs = require('fs');
const path = require('path');
const Ch = require('../../bot/shared/services/assessment/free-secondary-chrome');
const DATA = require('../../bot/shared/services/assessment/free-secondary-chrome.data.json');
const R = require('../../bot/shared/services/assessment/assessment-paper.renderer');

const ASSESSMENT = path.join(__dirname, '../../bot/shared/services/assessment');
const BASE = ['Read all questions carefully before answering.', 'Answer all questions in the space provided.',
  'Write clearly and legibly.', 'Time allowed: as specified by your teacher.'];
const ur = { _paperLang: 'ur', _timeMinutes: 60 };

describe('the chrome data', () => {
  const entries = [...Object.values(DATA.labels), ...DATA.instructions];
  it('copies every Urdu string from the file it names', () => {
    entries.filter((e) => e.ur).forEach((e) => {
      const source = fs.readFileSync(path.join(ASSESSMENT, e.from), 'utf8');
      const literal = e.ur.split('{t}').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\d+');
      expect(source).toMatch(new RegExp(literal));
    });
  });
  it('marks every string without existing Urdu wording design_pending', () => {
    entries.filter((e) => !e.ur).forEach((e) => expect(e.status).toBe('design_pending'));
    expect(Ch.designPending().length).toBeGreaterThan(0);
  });
});

describe('an English paper', () => {
  it('keeps every string as it was', () => {
    expect(Ch.labelsFor({})).toEqual({ studentName: 'Student Name', rollNo: 'Roll No', date: 'Date',
      totalMarks: 'Total Marks', obtainedMarks: 'Obtained Marks', instructions: 'Instructions' });
    expect(Ch.headingFor({}, 'Short Answer Questions')).toBe('Short Answer Questions');
    expect(Ch.instructionsFor({ _timeMinutes: 45 }, BASE)[3]).toBe('Time allowed: 45 minutes.');
    expect(Ch.marksWord({})).toBeUndefined();
    expect(Ch.css({})).toBe('');
  });
});

describe('an Urdu paper', () => {
  it('prints the type headings from the question-type titles', () => {
    expect(Ch.headingFor(ur, 'MCQs')).toBe('کثیرالانتخابی سوالات');
    expect(Ch.headingFor(ur, 'Short Answer Questions')).toBe('مختصر جواب');
    expect(Ch.headingFor(ur, 'Grammar')).toBe('قواعد');
  });
  it('prints the time in Urdu and leaves the design_pending lines off', () => {
    expect(Ch.instructionsFor(ur, BASE)).toEqual(['وقت: 60 منٹ']);
  });
  it('labels the student box and the marks in Urdu', () => {
    expect(Ch.labelsFor(ur)).toMatchObject({ studentName: 'نام طالب علم', rollNo: 'رول نمبر', totalMarks: 'کل نمبر' });
    expect(Ch.marksWord(ur)).toBe('نمبر');
  });
});

describe('the renderer', () => {
  const exam = (extra) => ({ ...extra, unseen: {
    objective: { MCQs: [{ question: 'سوال؟', options: ['الف) ایک', 'ب) دو', 'ج) تین', 'د) چار'], answer: 'الف', marks: 1 }] },
    subjective: { 'Short Answer Questions': [{ question: 'کیوں؟', answer: 'اس لیے', marks: 3, lines: 3 }] } } });
  const meta = { grade: 8, subject: 'urdu' };

  it('prints an Urdu paper with Urdu chrome and no English labels', () => {
    const html = R.renderPaper({ examJson: exam(ur), ...meta });
    ['کثیرالانتخابی سوالات', 'مختصر جواب', 'نام طالب علم', 'ہدایات', 'وقت: 60 منٹ', '[3 نمبر]'].forEach((s) => expect(html).toContain(s));
    ['Student Name', '>Instructions<', 'Short Answer Questions', 'marks]', 'Time allowed'].forEach((s) => expect(html).not.toContain(s));
  });
  it('prints a paper without the language flag exactly as before', () => {
    const plain = R.renderPaper({ examJson: exam({ _timeMinutes: 60 }), ...meta });
    expect(R.renderPaper({ examJson: exam({ _timeMinutes: 60, _paperLang: 'en' }), ...meta })).toBe(plain);
    expect(plain).toContain('Student Name');
    expect(plain).toContain('[3 marks]');
  });
});
