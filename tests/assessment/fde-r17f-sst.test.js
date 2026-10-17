/**
 * Social Studies layout: a marking point made only of names states a fact, so a Q6 that asks about
 * those names is held against the Q5 that lists them. Two neighbouring shapes stay printed.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const SST = Patterns.get('fde_g5_2027').subjects.social_studies;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === slot);
const Q1 = 'social_studies.A.Q1';
const C5 = 'social_studies.C.Q5';
const D6 = 'social_studies.D.Q6';
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const lay = (exam) => applyLayout(clone(exam), SST, scopeOf(exam), { reasked: true });
const listOf = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).find((l) => Array.isArray(l) && l.some((q) => q && q.slot === slot));

describe('a Q5 whose points are one-word names states facts', () => {
  test('the Q6 that asks one use of each of the three media the Q5 names is held', () => {
    const e = clone(fixture('r17e-sst-local-chapters_4'));
    const q5 = listOf(e, C5).filter((q) => q.slot === C5)[0];
    Object.assign(q5, { question: 'ذرائع ابلاغ کی تین اقسام کے نام لکھیں۔', answer: 'اخبار، ریڈیو، ٹیلی وژن',
      scheme: { points: [{ text: 'اخبار', marks: 1, kind: 'K' }, { text: 'ریڈیو', marks: 1, kind: 'K' }, { text: 'ٹیلی وژن', marks: 1, kind: 'K' }] } });
    const q6 = listOf(e, D6).filter((q) => q.slot === D6)[0];
    Object.assign(q6, { question: 'زینب کے گاؤں میں ایک میلہ ہے۔ وہ اس کی خبر اخبار، ریڈیو اور ٹیلی وژن سے کیسے پہنچائے؟ ہر ایک کا فائدہ بتائیں۔',
      answer: 'اخبار میں تفصیلی خبر چھپتی ہے۔ ریڈیو دور دراز علاقوں تک پہنچتا ہے۔ ٹیلی وژن تصویر کے ساتھ خبر دکھاتا ہے۔',
      scheme: { points: [{ text: 'اخبار میں تفصیلی خبر چھپتی ہے', marks: 2, kind: 'K' }, { text: 'ریڈیو دور دراز علاقوں تک پہنچتا ہے', marks: 2, kind: 'K' }, { text: 'ٹیلی وژن تصویر کے ساتھ خبر دکھاتا ہے', marks: 2, kind: 'K' }] } });
    const laid = lay(e);
    expect(items(laid.examJson, C5).map((q) => q.question)).toContain(q5.question);
    expect(items(laid.examJson, D6).map((q) => q.question)).not.toContain(q6.question);
  });
});

describe('two tier MCQs on short stems that ask different jobs are two questions', () => {
  test('police and hospitals, both keyed the provincial government, both print', () => {
    const e = clone(fixture('r17e-sst-local-chapters_4'));
    const mcqs = listOf(e, Q1).filter((q) => q.slot === Q1);
    const [a, b] = [mcqs[2], mcqs[3]];
    const opts = ['مقامی حکومت', 'صوبائی حکومت', 'وفاقی حکومت', 'عدالت'];
    Object.assign(a, { question: 'پولیس کا نظام کون سی حکومت چلاتی ہے؟', options: opts, answer: 'صوبائی حکومت' });
    Object.assign(b, { question: 'سرکاری ہسپتال کون سی حکومت چلاتی ہے؟', options: opts, answer: 'صوبائی حکومت' });
    const printed = items(lay(e).examJson, Q1).map((q) => q.question);
    expect(printed).toContain(a.question);
    expect(printed).toContain(b.question);
  });
});

describe('a two-idea situation Q6 that names a body once prints', () => {
  test('garbage in the street: whom to tell, and two reasons that explain', () => {
    const e = clone(fixture('r17e-sst-local-chapters_6'));
    const q6 = listOf(e, D6).filter((q) => q.slot === D6)[5];
    Object.assign(q6, { question: 'علی کی گلی میں کئی دن سے کچرا جمع ہے۔ وہ کس ادارے کو اطلاع دے اور خود کیا کرے؟ دو باتوں سے وضاحت کریں۔',
      answer: 'بلدیہ یعنی مقامی حکومت کو شکایت کرے۔ کچرا کوڑے دان میں ڈالے اور محلے والوں کو بھی بتائے۔ گندگی سے بیماریاں پھیلتی ہیں۔',
      scheme: { points: [{ text: 'مقامی حکومت کو شکایت کرنا', marks: 1, kind: 'K' }, { text: 'کچرا کوڑے دان میں ڈالنا اور محلے والوں کو بتانا', marks: 2, kind: 'K' }, { text: 'گندگی سے بیماریاں پھیلتی ہیں', marks: 2, kind: 'K' }] } });
    const laid = lay(e);
    expect(laid.held.filter((h) => h.q.question === q6.question).map((h) => h.rule)).toEqual([]);
  });
});

describe('the three organs of government, named one word per point', () => {
  test('a Q6 that explains the duties of the legislature, executive and judiciary is held against the Q5 that names them', () => {
    const e = clone(fixture('r17-sst-local-chapters_1'));
    const q5 = listOf(e, C5).filter((q) => q.slot === C5)[0];
    Object.assign(q5, { question: 'حکومت کے تین اعضا کے نام لکھیں۔', answer: 'مقننہ، انتظامیہ، عدلیہ',
      scheme: { points: [{ text: 'مقننہ', marks: 1, kind: 'K' }, { text: 'انتظامیہ', marks: 1, kind: 'K' }, { text: 'عدلیہ', marks: 1, kind: 'K' }] } });
    const q6 = listOf(e, D6).filter((q) => q.slot === D6)[0];
    Object.assign(q6, { question: 'حکومت کے تین اہم اعضاء (مقننہ، انتظامیہ، عدلیہ) کے فرائض تفصیل سے بیان کریں۔',
      answer: 'مقننہ قانون بناتی ہے۔ انتظامیہ قانون نافذ کرتی ہے۔ عدلیہ انصاف فراہم کرتی ہے۔',
      scheme: { points: [{ text: 'مقننہ قانون بناتی ہے', marks: 2, kind: 'K' }, { text: 'انتظامیہ قانون نافذ کرتی ہے', marks: 2, kind: 'K' }, { text: 'عدلیہ انصاف فراہم کرتی ہے', marks: 2, kind: 'K' }] } });
    const laid = lay(e);
    expect(items(laid.examJson, C5).map((q) => q.question)).toContain(q5.question);
    expect(items(laid.examJson, D6).map((q) => q.question)).not.toContain(q6.question);
  });

  test('a point of placeholder words only still states no fact', () => {
    const e = clone(fixture('r17-sst-local-chapters_1'));
    const q5 = listOf(e, C5).filter((q) => q.slot === C5)[0];
    Object.assign(q5, { question: 'حکومت کے تین اعضا کے نام لکھیں۔', answer: 'مقننہ، انتظامیہ، عدلیہ',
      scheme: { points: [{ text: 'پہلی وجہ درست بتانا', marks: 1, kind: 'K' }, { text: 'درست وضاحت', marks: 1, kind: 'K' }, { text: 'مثال', marks: 1, kind: 'K' }] } });
    const q6 = listOf(e, D6).filter((q) => q.slot === D6)[0];
    Object.assign(q6, { question: 'ایک گاؤں میں سڑک ٹوٹ گئی ہے۔ لوگ کیا کریں؟',
      answer: 'مقامی حکومت کو درخواست دیں۔ مل کر عارضی مرمت کریں۔',
      scheme: { points: [{ text: 'درخواست دینا', marks: 2, kind: 'K' }, { text: 'مل کر عارضی مرمت', marks: 2, kind: 'K' }] } });
    const laid = lay(e);
    expect(items(laid.examJson, D6).map((q) => q.question)).toContain(q6.question);
  });
});
