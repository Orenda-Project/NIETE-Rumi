/**
 * bd-5jmnfj.4.58.2: v26 G2 Urdu «مکالمہ پڑھنا» printed six script lines for the five dialogue
 * items in exam.json: the model padded its script to the pattern's «six short turns» by repeating
 * line 4 as line 6. The oral sheet prints a read-aloud script once per line, and the pattern asks
 * five turns, none repeated.
 */

const { oralSheet } = require('../../bot/shared/services/assessment/fde-oral-sheet');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const text = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
const oralP = Patterns.get('fde_g2_2026').subjects.urdu.oral;

const LINES = [
  'غصیلا بھنورا: آداب۔۔۔ آپ کون؟',
  'تتلیا: میں۔۔۔ میں تتلیا۔',
  'غصیلا بھنورا: ہاں جی، لڑائی کرنی ہے تم نے؟',
  'تتلیا: ٹھیک ہے، کرلیتے ہیں آپ سے لڑائی۔',
  'غصیلا بھنورا: اونہہ! رہنے دو مجھے تمھارا رنگ پسند نہیں آیا۔',
];
const sheetFor = (scriptLines) => {
  const content = oralP.tasks.map((t) => (t.id === 'dialogue'
    ? { id: 'dialogue', script: scriptLines.join('\n'), items: LINES.map((l) => ({ ask: l.split(': ')[1], answer: '' })) }
    : { id: t.id, script: 'متن', items: [{ ask: 'سوال؟', answer: 'جواب' }] }));
  return oralSheet({ ...oralP, content }, { medium: 'ur', text });
};
const dialogueBlock = (html) => /data-task="dialogue"[^]*?<\/div><\/div>/.exec(html)[0];

describe('the printed dialogue script', () => {
  test('v26: the padded sixth line (a repeat of line 4) is not printed', () => {
    const block = dialogueBlock(sheetFor([...LINES, LINES[3]]));
    expect(block.split(LINES[3]).length - 1).toBe(1);
    expect(block.split('<br>').length).toBe(5);
  });

  test('a clean five-line dialogue prints all five lines', () => {
    const block = dialogueBlock(sheetFor(LINES));
    LINES.forEach((l) => expect(block).toContain(l));
    expect(block.split('<br>').length).toBe(5);
  });

  test('the pattern asks five turns, none repeated', () => {
    const t = oralP.tasks.find((x) => x.id === 'dialogue');
    expect(t.ask).toMatch(/five short turns/);
    expect(t.ask).toMatch(/none repeated/);
  });
});
