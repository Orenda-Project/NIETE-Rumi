/** bd-5jmnfj.4.58.2: a who-said MCQ whose names are not in the book text the generator held. */
const { whoSaidShortfall, namesNotInText } = require('../../bot/shared/services/assessment/fde-who-said-check');

// Names as the v26 REVIEW quotes the book dialogue (oral script of the same paper).
const BOOK = `غصیلا بھنورا: میں تم سے لڑائی کروں گا۔ تتلیا: میں تتلیا ہوں، میں لڑائی نہیں کرتی۔ ٹڈی: آؤ سب دوست بن جائیں۔ `.repeat(6);
const item = (options, answer) => ({
  slot: 'g2.urdu.A.Q1', answer, options,
  question: '"کیا آپ بھی لڑائی کرنی ہے؟" کے بجائے لڑائی کے بعد کس نے سب کو دوست بننے کو کہا؟',
});
const exam = (q) => ({ unseen: { objective: { MCQs: [q] } } });
const P = { sections: [{ slots: [{ slot: 'g2.urdu.A.Q1', type: 'MCQs' }] }] };

describe('whoSaidShortfall', () => {
  test('v26 Q1 iv: names the book does not hold are flagged with the item and the reason', () => {
    const q = item(['الف) غصیلے کیڑے نے', 'ب) ٹڈی نے', 'ج) تگیا نے'], 'الف) غصیلے کیڑے نے');
    const out = whoSaidShortfall(exam(q), BOOK, P);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slot: 'g2.urdu.A.Q1', reason: 'answer' });
    expect(out[0].items[0]).toMatch(/تگیا/);
  });

  test('names found in the book text pass', () => {
    const q = item(['الف) غصیلا بھنورا نے', 'ب) ٹڈی نے', 'ج) تتلیا نے'], 'ج) تتلیا نے');
    expect(whoSaidShortfall(exam(q), BOOK, P)).toEqual([]);
  });

  test('no book text, or a question that is not a who-said, is left alone', () => {
    const q = item(['الف) تگیا نے', 'ب) ٹڈی نے', 'ج) x نے'], 'الف) تگیا نے');
    expect(whoSaidShortfall(exam(q), '', P)).toEqual([]);
    expect(whoSaidShortfall(exam({ ...q, question: 'صحیح املا کون سا ہے؟' }), BOOK, P)).toEqual([]);
  });
});

describe('namesNotInText', () => {
  test('lists the options with a word absent from the text, ignoring diacritics and the نے ending', () => {
    expect(namesNotInText(['الف) تَتلیا نے', 'ب) تگیا نے'], BOOK)).toEqual(['تگیا']);
  });
});
