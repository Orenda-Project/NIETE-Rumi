/**
 * v37r6 G1 Urdu (bd-5jmnfj.4.58.9.3): the key printed «عام غلطی: choosing ریل» and «writing بندرنی» — English process
 * words on an Urdu teacher key. Urdu common-error lines are rewritten in Urdu; a line the rules cannot place is noted.
 */
const { urduCommonErrors } = require('../../bot/shared/services/assessment/fde-urdu-common-error-lang');
const { earlyUrduFixes } = require('../../bot/shared/services/assessment/fde-early-urdu-fixes');

const item = (slot, ce) => ({ slot, question: 'سوال', answer: 'جواب', scheme: { points: [], accept: [], common_error: ce } });
const exam = (list) => ({ _layout: { sections: [] }, unseen: { subjective: { Words: list } } });
const ce = (ex, i = 0) => ex.unseen.subjective.Words[i].scheme.common_error;

describe('Urdu common-error lines carry no English process words', () => {
  test.each([
    ['choosing ریل', '«ریل» چن لینا'],
    ['writing بندرنی', '«بندرنی» لکھ دینا'],
    ['writing جھولا instead of جھولے', '«جھولے» کی جگہ «جھولا» لکھ دینا'],
    ['writing جوٹ without ھ', '«ھ» کے بغیر «جوٹ» لکھ دینا'],
    ['writing a similar word such as موٹا', 'ملتا جلتا لفظ لکھ دینا، جیسے «موٹا»'],
    ['choosing a masculine word such as مرغا', 'مذکر لفظ چن لینا، جیسے «مرغا»'],
    ['writing the same word again', 'وہی لفظ دوبارہ لکھ دینا'],
    ['leaving the word unchanged as کتا', 'لفظ نہ بدلنا اور «کتا» ہی لکھ دینا'],
    ["Writing the sentences without the speaker's name before each turn", 'ہر بار بولنے والے کا نام لکھے بغیر جملے لکھ دینا'],
    ['writing words about things not in the picture', 'ان چیزوں کے بارے میں لکھ دینا جو تصویر میں نہیں ہیں'],
  ])('%s', (from, to) => {
    expect(ce(urduCommonErrors(exam([item('g1.urdu.B.Q7', from)])).examJson)).toBe(to);
  });
  test('an English line the rules cannot place is kept and noted', () => {
    const { examJson, notes } = urduCommonErrors(exam([item('g1.urdu.B.Q5', 'choosing a word that does not fit the picture')]));
    expect(ce(examJson)).toBe('choosing a word that does not fit the picture');
    expect(notes.some((n) => /English/.test(n))).toBe(true);
  });
  test('an Urdu line and a non-Urdu slot are left alone', () => {
    const ex = urduCommonErrors(exam([item('g1.urdu.B.Q7', 'غلط لفظ لکھ دینا'), item('g1.english.B.Q7', 'writing cat')])).examJson;
    expect(ce(ex, 0)).toBe('غلط لفظ لکھ دینا');
    expect(ce(ex, 1)).toBe('writing cat');
  });
  test('sub-questions are walked too', () => {
    const ex = exam([{ slot: 'g2.urdu.A.Q1', questions: [item('g2.urdu.A.Q1', 'choosing بستہ')] }]);
    expect(urduCommonErrors(ex).examJson.unseen.subjective.Words[0].questions[0].scheme.common_error).toBe('«بستہ» چن لینا');
  });
  test('earlyUrduFixes runs it', () => {
    expect(ce(earlyUrduFixes(exam([item('g1.urdu.B.Q7', 'writing ریچھی')]), '').examJson)).toBe('«ریچھی» لکھ دینا');
  });
});
