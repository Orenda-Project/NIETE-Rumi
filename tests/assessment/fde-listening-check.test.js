/**
 * bd-5jmnfj.4.55 — fde-listening-check: a listening answer must use the story's words.
 */
const { unsaidWords } = require('../../bot/shared/services/assessment/fde-listening-check');

const SCRIPT = 'Pinky saw that Aisha was drawing a mango. Aisha said, "I love mangoes! I miss my home in Multan."';
const item = (answer) => ({ ask: 'q', answer });
const APPLY = item('Play cricket with them.');

describe('unsaidWords', () => {
  test('names the answer words the story never says', () => {
    expect(unsaidWords(SCRIPT, [item('She missed her home and her old friends.'), APPLY])).toEqual(['old', 'friends']);
  });

  test('matches by light stem and a shared 4-letter start, ignoring stopwords and case', () => {
    expect(unsaidWords(SCRIPT, [item('Mangoes.'), item('She was Drawing a mango.'), item('Pinky.'), APPLY])).toEqual([]);
  });

  test('the last (apply) item is never checked', () => {
    expect(unsaidWords(SCRIPT, [item('A mango.'), APPLY])).toEqual([]);
  });

  test('an Urdu script is not checked', () => {
    expect(unsaidWords('شاخ پہ کھلتے پھول', [item('شاخ پر'), item('x')])).toEqual([]);
  });

  test('no script or no items gives []', () => {
    expect(unsaidWords('', [item('anything'), APPLY])).toEqual([]);
    expect(unsaidWords(SCRIPT, null)).toEqual([]);
  });
});

describe('oralContent / oralPrompt gate (a topic paper is unchanged)', () => {
  const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
  const oral = { tasks: [{ id: 'listening', kind: 'listening', marks: 5, ask: 'A story and five questions.', n: 2 }] };
  const reply = { oral: [{ id: 'listening', script: SCRIPT, items: [item('Old friends.'), APPLY] }] };

  test('the FDE default re-asks an unsaid answer; saidCheck false keeps it', () => {
    expect(Prompt.oralContent(reply, oral).missing).toEqual(['listening']);
    expect(Prompt.oralContent(reply, oral, { saidCheck: false }).missing).toEqual([]);
  });

  test('saidCheck false leaves the listening rule out of the prompt', () => {
    const args = { oral, grade: 3, P: { medium: 'en', name_en: 'English' }, pageContent: 'BOOK' };
    expect(Prompt.oralPrompt(args)).toMatch(/said in the story/);
    expect(Prompt.oralPrompt({ ...args, saidCheck: false })).not.toMatch(/said in the story/);
  });
});
