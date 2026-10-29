/**
 * v28 G1 Urdu oral poem (bd-5jmnfj.4.58.4): question 4 asked which two things are in the "first line" after one
 * hearing (memory of line position, not comprehension) and question 5 «ہر ایک کیا کرتا ہے؟» named no subject.
 * badListeningAsks finds both kinds; oralContent then counts the listening task as not whole, so the writer asks
 * the oral part again the way it does for an unsaid answer.
 */

const { badListeningAsks } = require('../../bot/shared/services/assessment/fde-listening-asks');
const { oralContent, oralPrompt } = require('../../bot/shared/services/assessment/fde-early-prompt');
const g1 = require('../../bot/shared/services/assessment/patterns/early/g1-urdu');

const item = (ask) => ({ ask, answer: 'جواب۔' });

describe('G1 Urdu oral poem questions', () => {
  test.each([
    ['کون سے دو درخت جیسی چیزیں نظم کے پہلے مصرعے میں ہیں؟'],
    ['پہلی سطر میں کیا ہے؟'],
    ['دوسری سطر میں کون سے پھول ہیں؟'],
    ['کس سطر میں خدا کا ذکر ہے؟'],
    ['ہر ایک کیا کرتا ہے؟'],
    ['  ہر ایک کیا مانتا ہے؟'],
  ])('flags %s', (ask) => {
    expect(badListeningAsks([item('شاخوں پر کیا ہے؟'), item(ask)])).toEqual([ask]);
  });

  test('questions that name their subject are clean', () => {
    expect(badListeningAsks([item('شاخوں پر کیا ہے؟'), item('سب کو کس نے بنایا؟'), item('پھول اور خوشبو کہاں پھیلتی ہے؟'), item('نظم میں کون سے دو پیڑ جیسی چیزیں ہیں؟')])).toEqual([]);
  });

  test('English line-position questions are flagged too', () => {
    expect(badListeningAsks([item('What is in the first line of the poem?')])).toHaveLength(1);
    expect(badListeningAsks([item('What grows on the branches?')])).toEqual([]);
  });

  test('oralContent returns a listening task with such a question as missing', () => {
    const tasks = g1.oral;
    const reply = (asks) => ({ oral: tasks.tasks.map((t) => ({
      id: t.id,
      script: t.kind === 'listening' ? 'پیڑ اور پودے، شاخوں پہ پتے' : '',
      items: t.id === 'poem' ? asks.map(item) : Array.from({ length: t.n }, () => item('ایک؟')),
    })) });
    const bad = oralContent(reply(['ا؟', 'ب؟', 'پ؟', 'کون سی چیز پہلے مصرعے میں ہے؟', 'ٹ؟']), tasks, { saidCheck: false });
    expect(bad.missing).toEqual(['poem']);
    const ok = oralContent(reply(['ا؟', 'ب؟', 'پ؟', 'ت؟', 'ٹ؟']), tasks, { saidCheck: false });
    expect(ok.missing).toEqual([]);
  });

  test('the oral prompt tells the writer never to ask a line, and to name every subject', () => {
    const text = oralPrompt({ oral: g1.oral, grade: 1, P: g1, pageContent: 'book' });
    expect(text).toMatch(/never asks which line/i);
    expect(text).toMatch(/names its subject/);
    expect(text).toMatch(/ہر ایک/);
  });
});
