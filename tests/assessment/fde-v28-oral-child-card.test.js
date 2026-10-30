/**
 * v27 G1 Urdu (bd-5jmnfj.4.58.3): the reading words a child must read aloud sat only on the teacher sheet,
 * beside their answers, and reused words printed on the written paper («بلی» and «چڑیا» in Q1 stems,
 * «طوطا» as a Q1 key, «روٹی» as a Q9 stem). Two fixes:
 *   1. a child card — a page in large type with only what the child reads, no answers, for every read-aloud task;
 *   2. the give-away detector compares each read-aloud word with every printed word and key of the written
 *      paper, not only with the keys, so the early writer re-asks the oral task.
 */

const { oralSheet, childCard } = require('../../bot/shared/services/assessment/fde-oral-sheet');
const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');

const text = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const oral = () => ({
  title_en: 'Oral assessment', title_ur: 'زبانی جائزہ', note_en: 'One child at a time.', note_ur: 'ایک ایک بچہ', marks: 30,
  tasks: [
    { id: 'read_words', kind: 'read_aloud', label_en: 'Reading words', label_ur: 'الفاظ پڑھنا', marks: 10, instruction_en: 'Point to each word.', instruction_ur: 'ہر لفظ کی طرف اشارہ کریں۔', scoring: 'each', rubric: [{ marks: 1, en: 'Each word read', ur: 'ہر لفظ' }] },
    { id: 'likes', kind: 'speaking', label_en: 'What I like', label_ur: 'مجھے پسند ہے', marks: 5, instruction_en: 'Ask the child.', instruction_ur: 'بچے سے پوچھیں۔', scoring: 'criteria', rubric: [{ marks: 5, en: 'Five sentences', ur: 'پانچ جملے' }] },
    { id: 'poem', kind: 'listening', label_en: 'Poem', label_ur: 'نظم', marks: 5, instruction_en: 'Read the poem once.', instruction_ur: 'نظم ایک بار پڑھیں۔', scoring: 'each', rubric: [{ marks: 1, en: 'Each answer', ur: 'ہر جواب' }] },
  ],
  content: [
    { id: 'read_words', items: [{ ask: 'چاند' }, { ask: 'تارے' }, { ask: 'بلی' }] },
    { id: 'likes', items: [{ ask: 'آپ کو کیا پسند ہے؟', answer: 'پانچ جملے' }] },
    { id: 'poem', script: 'چڑیا چوں چوں کرتی ہے', items: [{ ask: 'چڑیا کیا کرتی ہے؟', answer: 'چوں چوں' }] },
  ],
});

describe('the child card', () => {
  test('prints every read-aloud word in its own section and nothing a child must not see', () => {
    const html = childCard(oral(), { medium: 'ur', text });
    expect(html).toMatch(/<section class="oral-card"/);
    const seen = visible(html);
    expect(seen).toMatch(/چاند/);
    expect(seen).toMatch(/تارے/);
    expect(seen).toMatch(/بلی/);
    expect(seen).toMatch(/الفاظ پڑھنا/);
    expect(seen).not.toMatch(/پانچ جملے|آپ کو کیا پسند ہے|چوں چوں|چڑیا/);
  });

  test('a read-aloud task with a script prints the script once, not its questions or answers', () => {
    const o = oral();
    o.tasks[0] = { ...o.tasks[0], id: 'read_story', label_en: 'Reading' };
    o.content[0] = { id: 'read_story', script: 'Ali has a red ball.', items: [{ ask: 'What colour is the ball?', answer: 'Red' }] };
    const seen = visible(childCard(o, { medium: 'en', text }));
    expect(seen.match(/Ali has a red ball\./g)).toHaveLength(1);
    expect(seen).not.toMatch(/What colour|Red\b/);
  });

  test('nothing when there is no oral part or no read-aloud task; the teacher sheet is as before', () => {
    expect(childCard(null, { medium: 'en', text })).toBe('');
    const o = oral();
    o.tasks = o.tasks.filter((t) => t.kind !== 'read_aloud');
    o.content = o.content.filter((c) => c.id !== 'read_words');
    expect(childCard(o, { medium: 'ur', text })).toBe('');
    expect(oralSheet(oral(), { medium: 'ur', text })).not.toMatch(/oral-card/);
  });
});

describe('a read-aloud word printed anywhere on the written paper', () => {
  const item = (slot, question, answer, extra = {}) => ({ slot, question, answer, ...extra });
  const paper = () => ({
    unseen: { subjective: {
      MCQs: [
        item('g1.urdu.A.Q1', 'بلی کیا پیتی ہے؟', 'الف) دودھ', { options: ['الف) دودھ', 'ب) پانی', 'ج) گھاس'] }),
        item('g1.urdu.A.Q1', 'کون سا پرندہ بولتا ہے؟', 'ج) طوطا', { options: ['الف) کوا', 'ب) مرغی', 'ج) طوطا'] }),
      ],
      'Make Sentences': [item('g1.urdu.B.Q9', 'روٹی', 'ہم روٹی کھاتے ہیں۔')],
    } },
    _layout: {
      sections: [{ id: 'A', slots: [{ slot: 'g1.urdu.A.Q1', type: 'MCQs' }, { slot: 'g1.urdu.B.Q9', type: 'Make Sentences' }] }],
      oral: { tasks: [{ id: 'read_words', kind: 'read_aloud' }, { id: 'likes', kind: 'speaking' }],
        content: [{ id: 'read_words', items: [{ ask: 'بلی' }, { ask: 'طوطا' }, { ask: 'روٹی' }, { ask: 'گھر' }] }, { id: 'likes', items: [{ ask: 'گھر میں کون ہے؟' }] }] },
    },
  });
  const oralFlags = (ex) => answerRepeats(ex).filter((f) => f.with.includes('oral'));

  test('in a stem, as a labelled key and as a sentence word: each is flagged against the oral sheet', () => {
    const words = oralFlags(paper()).flatMap((f) => f.words);
    expect(words).toEqual(expect.arrayContaining(['بلی', 'طوطا', 'روٹی']));
    expect(oralFlags(paper()).map((f) => f.slot).sort()).toEqual(['g1.urdu.A.Q1', 'g1.urdu.B.Q9']);
  });

  test('a word on neither paper is not flagged', () => {
    expect(oralFlags(paper()).flatMap((f) => f.words)).not.toContain('گھر');
  });
});
