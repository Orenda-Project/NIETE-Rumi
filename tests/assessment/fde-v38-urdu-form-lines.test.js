'use strict';
const { mendUrduForm } = require('../../bot/shared/services/assessment/fde-urdu-form-lines');

const paper = (type, question, answer) => ({ unseen: { subjective: { [type]: [{ slot: 'urdu.C.Q10', question, answer }] } } });
const ans = (r, type) => r.examJson.unseen.subjective[type][0].answer;
const LETTER = 'پیاری امی جان!\nالسلام علیکم!\nامید ہے آپ خیریت سے ہوں گی۔\nآپ کا بیٹا\nعلی';
const APP = 'بخدمت جناب ہیڈ مسٹریس صاحبہ،\nگورنمنٹ گرلز پرائمری اسکول۔\nمحترمہ!\nالسلام علیکم! گزارش ہے کہ میں بیمار ہوں۔\nآپ کی فرماں بردار شاگرد\nفاطمہ';

describe('mendUrduForm: the model answer carries every form item the rubric pays', () => {
  test('a letter without a date gets a date line first', () => {
    const r = mendUrduForm(paper('Letter Writing', 'والدہ کے نام خط لکھیں۔', LETTER));
    expect(ans(r, 'Letter Writing').split('\n')[0]).toMatch(/^تاریخ:\s*\S+.*2026|۲۰۲۶/);
    expect(ans(r, 'Letter Writing')).toContain('پیاری امی جان!');
  });
  test('a letter with a date line is unchanged', () => {
    const p = paper('Letter Writing', 'خط لکھیں۔', `تاریخ: ۱۰ مارچ ۲۰۲۶ء\n${LETTER}`);
    expect(mendUrduForm(p).examJson).toEqual(p);
  });
  test('a leave application gets عنوان, جناب عالی and a date', () => {
    const r = mendUrduForm(paper('Letter Writing', 'ہیڈ مسٹریس صاحبہ کے نام بیماری کی وجہ سے رخصت کی درخواست لکھیں۔', APP));
    const a = ans(r, 'Letter Writing');
    expect(a).toContain('عنوان: رخصت کی درخواست');
    expect(a).toContain('جناب عالی!');
    expect(a).not.toContain('محترمہ!');
    expect(a).toMatch(/تاریخ:/);
    expect(a.indexOf('عنوان')).toBeGreaterThan(a.indexOf('بخدمت'));
    expect(a.indexOf('عنوان')).toBeLessThan(a.indexOf('جناب عالی!'));
  });
  test('an application whose subject cannot be named safely gets no invented عنوان and is noted', () => {
    const r = mendUrduForm(paper('Letter Writing', 'پرنسپل کے نام فیس معافی کی درخواست لکھیں۔', APP));
    expect(ans(r, 'Letter Writing')).toContain('جناب عالی!');
    expect(r.notes.join(' ')).toMatch(/عنوان/);
  });
  test('other slots are untouched', () => {
    const p = { unseen: { subjective: { Essay: [{ slot: 'urdu.C.Q9', question: 'x', answer: LETTER }] } } };
    expect(mendUrduForm(p).examJson).toEqual(p);
  });
});
