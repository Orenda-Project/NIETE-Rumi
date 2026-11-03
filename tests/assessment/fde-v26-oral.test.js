/**
 * bd-5jmnfj.4.57 (v25 review, oral part).
 * 1. The oral note allowed the oral part "before or after the written paper": G1 English read
 *    aloud "sun" (the Q4 i key), G1 Maths said 9 cats (Q3 iii), G1 Urdu showed چڑیا/بلی/پھول and
 *    G2 Urdu said باغ میں (Q1 vii). The oral part is now taken after the written paper.
 * 2. G2 Urdu's poem stopped mid-line at «پیڑ پہ بیٹھی گیت سہانے» and keyed «سہانے گیت گا رہی ہیں»:
 *    the prompt asks for whole lines and answers only in words the script says.
 * 3. G2 Urdu's dialogue printed «پوچھیں» over six bare words with no question or answer. A
 *    read-aloud task with a script and answerless items prints no ask list.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { oralSheet } = require('../../bot/shared/services/assessment/fde-oral-sheet');

const text = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

describe('the oral note: after the written paper', () => {
  const subjects = [['fde_g1_2026', 'english'], ['fde_g1_2026', 'maths'], ['fde_g1_2026', 'urdu'], ['fde_g2_2026', 'urdu'], ['fde_g2_2026', 'english']];
  test.each(subjects)('%s %s says after, never before', (id, subject) => {
    const oral = Patterns.get(id).subjects[subject].oral;
    expect(oral.note_en).toMatch(/after the written paper/);
    expect(oral.note_en).not.toMatch(/before/);
    expect(oral.note_ur).toMatch(/تحریری پرچے کے بعد/);
    expect(oral.note_ur).not.toMatch(/پہلے/);
  });
});

describe('the oral prompt: whole lines, answers in the script\'s words', () => {
  test.each([['fde_g2_2026', 'urdu'], ['fde_g2_2026', 'english'], ['fde_g1_2026', 'english']])('%s %s', (id, subject) => {
    const P = Patterns.get(id).subjects[subject];
    const t = Prompt.oralPrompt({ oral: P.oral, grade: 2, P, pageContent: 'BOOK' });
    expect(t).toMatch(/whole lines/i);
    expect(t).toMatch(/never stop (a quote )?mid-line/i);
    expect(t).toMatch(/only words the script says/i);
  });
});

describe('the oral sheet: no bare ask list under a read-aloud script', () => {
  const V25_DIALOGUE = {
    id: 'dialogue',
    script: 'آداب۔۔۔ آپ کون؟\nمیں۔۔۔ میں تتیا۔',
    items: ['آداب', 'تتیا', 'لڑائی', 'رنگ', 'دوستی', 'بہار کے موسم کا لطف اٹھاتے ہیں'].map((ask) => ({ ask, answer: '' })),
  };
  const sheet = (content) => {
    const oral = Patterns.get('fde_g2_2026').subjects.urdu.oral;
    const rest = oral.tasks.filter((t) => t.id !== 'dialogue')
      .map((t) => ({ id: t.id, script: 'متن', items: [{ ask: 'سوال؟', answer: 'جواب' }] }));
    return oralSheet({ ...oral, content: [...rest, content] }, { medium: 'ur', text });
  };
  const dialogueBlock = (html) => html.split('data-task="dialogue"')[1].split('class="oral-task"')[0];

  test('v25 G2 Urdu dialogue prints its script and no پوچھیں list', () => {
    const block = dialogueBlock(sheet(V25_DIALOGUE));
    expect(block).toContain('میں تتیا');
    expect(block).not.toContain('پوچھیں');
    expect(block).not.toContain('<li>آداب</li>');
  });

  test('a read-aloud word list with no script still prints its words', () => {
    const block = dialogueBlock(sheet({ id: 'dialogue', items: [{ ask: 'بلی' }, { ask: 'پھول' }] }));
    expect(block).toContain('<li>بلی</li>');
  });

  test('a task whose items carry answers keeps its ask list', () => {
    const block = dialogueBlock(sheet({ ...V25_DIALOGUE, items: [{ ask: 'تتیا نے کیا کہا؟', answer: 'لڑائی' }] }));
    expect(block).toContain('پوچھیں');
  });
});
