/**
 * Answer words the paper gives away elsewhere (bd-5jmnfj.4.50.8, v22 review item 5, 27 Oct 2026).
 * v22 G1 Urdu keyed «بلی» in Q3 iv and Q7 iii and printed it in Q1 i's stem; «چڑیا» (Q7 iv) was
 * in Q1 iii and Q5 i; Q3's «باغ» and «گڑیا» were Q1's letter sums again; «گاجر» was a wrong choice
 * in Q1 ii and the key to Q1 vi; «چاند» was in Q5 ii's sentence and Q5 iv's key.
 */

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { answerRepeats, answerWord, giveawayNote } = require('../../bot/shared/services/assessment/fde-answer-repeats');
const { writeEarlyPaper } = require('../../bot/shared/services/assessment/fde-early-writer');
const { NO_PICTURES } = require('../../bot/shared/services/assessment/fde-early-prompt');

const S = (slot) => ({ slot });
const mcq = (question, options, answer) => ({ slot: 'g1.urdu.A.Q1', question, options, answer });
// The v22 G1 Urdu items, as exam.json holds them (pictures and schemes left out).
const V22_G1_URDU = {
  unseen: {
    objective: { MCQs: [
      mcq('لفظ "بلی" کس حرف سے شروع ہوتا ہے؟', ['الف) ب', 'ب) ل', 'ج) ی'], 'الف) ب'),
      mcq('ان میں سے پھل کون سا ہے؟', ['الف) گاجر', 'ب) مولی', 'ج) امرود'], 'ج) امرود'),
      mcq('لفظ "چڑیا" کس حرف سے شروع ہوتا ہے؟', ['الف) ج', 'ب) چ', 'ج) ڑ'], 'ب) چ'),
      mcq('"ب + ا + غ" کو جوڑنے سے کون سا لفظ بنتا ہے؟', ['الف) غار', 'ب) باپ', 'ج) باغ'], 'ج) باغ'),
      mcq('"گ + ا + ج + ر" کو جوڑنے سے کون سا لفظ بنتا ہے؟', ['الف) گاجر', 'ب) گلاب', 'ج) جانگ'], 'الف) گاجر'),
    ] },
    subjective: {
      'Join Letters': [
        { slot: 'g1.urdu.A.Q3', question: 'ب + ا + غ', answer: 'باغ' },
        { slot: 'g1.urdu.A.Q3', question: 'ب + ل + ی', answer: 'بلی' },
      ],
      'Fill in the Blanks': [
        { slot: 'g1.urdu.B.Q5', question: 'ننھی چڑیا ___ میں بیٹھی ہے۔', answer: 'گھونسلے', words: ['گھونسلے', 'روشنی', 'چاند'] },
        { slot: 'g1.urdu.B.Q5', question: 'چاند کی ___ سفید ہوتی ہے۔', answer: 'روشنی' },
        { slot: 'g1.urdu.B.Q5', question: 'رات کو آسمان پر ستاروں کے ساتھ ___ نکلتا ہے۔', answer: 'چاند' },
      ],
      'Masculine Feminine': [
        { slot: 'g1.urdu.B.Q7', question: 'بلا', answer: 'بلی' },
        { slot: 'g1.urdu.B.Q7', question: 'چڑا', answer: 'چڑیا' },
        { slot: 'g1.urdu.B.Q7', question: 'بھائی', answer: 'بہن' },
      ],
    },
  },
  _layout: { sections: [
    { id: 'A', slots: ['g1.urdu.A.Q1', 'g1.urdu.A.Q2', 'g1.urdu.A.Q3'].map(S) },
    { id: 'B', slots: ['g1.urdu.B.Q4', 'g1.urdu.B.Q5', 'g1.urdu.B.Q7'].map(S) },
  ] },
};

const bySlot = (flags) => Object.fromEntries(flags.map((f) => [f.slot, [...f.words].sort()]));

describe('answerRepeats', () => {
  test('flags every v22 G1 Urdu give-away on the later question', () => {
    const flags = answerRepeats(V22_G1_URDU);
    expect(flags.every((f) => f.reason === 'giveaway')).toBe(true);
    expect(bySlot(flags)).toEqual({
      'g1.urdu.A.Q1': ['گاجر'],
      'g1.urdu.A.Q3': ['باغ', 'بلی'].sort(),
      'g1.urdu.B.Q5': ['چاند'],
      'g1.urdu.B.Q7': ['بلی', 'چڑیا'].sort(),
    });
    expect(flags.find((f) => f.slot === 'g1.urdu.B.Q7').with).toEqual(expect.arrayContaining(['g1.urdu.A.Q1', 'g1.urdu.A.Q3', 'g1.urdu.B.Q5']));
  });

  test('a word the oral sheet asks gives a written answer away', () => {
    const exam = { unseen: { subjective: { W: [{ slot: 'g1.english.A.Q3', question: 'c _ t', answer: 'cat' }] } },
      _layout: { oral: { content: [{ id: 'read_aloud', script: 'A long story.', items: [{ ask: 'cat' }] }] } } };
    expect(answerRepeats(exam)).toEqual([{ slot: 'g1.english.A.Q3', reason: 'giveaway', words: ['cat'], with: ['oral'] }]);
  });

  test('a shared choice set, a word the slot keys twice, and a function word are not give-aways', () => {
    const exam = { unseen: { objective: { MCQs: [
      { slot: 'g1.english.C.Q15', question: 'You ___ my friend.', options: ['a) is', 'b) are'], answer: 'b) are' },
      { slot: 'g1.english.C.Q15', question: 'The bird ___ small.', options: ['a) is', 'b) are'], answer: 'a) is' },
      { slot: 'g2.english.C.Q13', question: 'She has ___ kite.', answer: 'a' },
      { slot: 'g2.english.B.Q9', question: 'Aisha ___ a doll.', answer: 'has' },
      { slot: 'g2.english.B.Q9', question: 'Ali ___ a ball.', answer: 'has' },
      { slot: 'g2.english.C.Q11', question: 'Hamza and Aisha are here. (pronoun)', answer: 'They' },
      { slot: 'g2.english.C.Q12', question: 'They are happy.', answer: 'are' },
    ] } } };
    expect(answerRepeats(exam)).toEqual([]);
  });

  test('a sentence, a sum, a number or a letter is not an answer word', () => {
    ['میں اسکول میں پڑھتا ہوں۔', 'تھا + لی', '42', 'ب) چ', 'ب، پ، ج'].forEach((answer) => expect(answerWord({ answer })).toBeNull());
    expect(answerWord({ answer: 'الف) گاجر' })).toBe('گاجر');
    expect(answerWord({ answer: 'Kite.' })).toBe('kite');
  });

  test('the re-ask note names the words', () => {
    expect(giveawayNote([{ slot: 'x', reason: 'giveaway', words: ['بلی'], with: [] }])).toMatch(/بلی[\s\S]*no answer word is printed/);
    expect(giveawayNote([{ slot: 'x', reason: 'repeat', pictures: ['cat'] }])).toBeNull();
  });
});

test('every section prompt says an answer word appears nowhere else on the paper', () => {
  const P = Patterns.get('fde_g5_2027').subjects.urdu;
  const section = P.sections[0];
  const text = Gen.buildPatternUserPrompt({ grade: 5, subject: 'urdu', pageContent: 'Book.', pageReference: '1-2',
    section, slots: section.slots, lang: P.medium, P, scope: { kind: 'fde', chapters: null, pages: null } });
  expect(text).toContain('An answer word appears nowhere else on the paper');
});

// The early writer: a section whose key an earlier section prints is re-asked, told the word.
function deps(P, reply) {
  const calls = [];
  const n = {};
  const d = {
    family: 'urdu',
    loadPatternContent: async () => ({ content: 'BOOK', pageReference: '1-50' }),
    patternModel: () => ({ model: 'test/model', job: 'assessment.generate' }),
    resolveModelForJob: () => ({ model: 'test/model' }),
    buildSystemPrompt: () => 'SYSTEM',
    sectionText: (s, loaded) => ({ content: loaded.content, pageReference: loaded.pageReference }),
    buildPatternUserPrompt: ({ section }) => `PROMPT ${section.id}\n${NO_PICTURES}`,
    sectionMessages: ({ system, user }) => [{ role: 'system', content: system }, { role: 'user', content: user }],
    warmSharedPrefixes: async () => [],
    writeSection: jest.fn(async ({ messages, section }) => {
      const usages = [{ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 }];
      if (section.id === 'oral') return { tree: { oral: P.oral.tasks.map((t) => ({ id: t.id, script: 'Story.', items: Array.from({ length: t.n || 0 }, (_, i) => ({ ask: `ask ${i}` })) })) }, usages };
      calls.push({ id: section.id, user: messages[1].content });
      n[section.id] = (n[section.id] || 0) + 1;
      const tree = { unseen: { objective: {}, subjective: {} } };
      section.slots.forEach((sl) => {
        const list = Array.from({ length: sl.generate }, (_, i) => ({
          slot: sl.slot, question: `Question ${i + 1} for ${sl.slot}`, marks: sl.marks_each, blooms: 'Remember',
          ...(sl.shape === 'mcq' ? { options: ['a) one', 'b) two', 'c) three'], answer: 'a) one' } : { answer: String(i + 1) }),
          ...(reply(section.id, n[section.id], sl.slot, i) || {}),
          scheme: { points: [{ kind: 'A', text: 'correct', marks: sl.marks_each }] },
          ...(sl.picture ? { picture: sl.picture[0] === 'object' ? { kind: 'object', name: `${sl.slot} thing ${i}` }
            : sl.picture[0] === 'scene' ? { kind: 'scene', describe: 'a park' } : { kind: 'clock', hour: 3, minute: 0 } } : {}),
        }));
        (tree.unseen[sl.category][sl.type] = tree.unseen[sl.category][sl.type] || []).push(...list);
      });
      return { tree, usages };
    }),
    mergeSections: (trees) => {
      const out = { unseen: { objective: {}, subjective: {} } };
      trees.forEach((t) => Object.entries(t.unseen).forEach(([cat, types]) => Object.entries(types).forEach(([type, list]) => {
        out.unseen[cat][type] = (out.unseen[cat][type] || []).concat(JSON.parse(JSON.stringify(list)));
      })));
      return out;
    },
    stripImageKeys: () => {},
    normaliseAnswers: () => {},
    emptyQuestionParts: () => [],
    topUp: (first, second) => second,
    sumUsage: () => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 }),
    countQuestions: () => 1,
    fail: (code, message, extra) => Object.assign(new Error(message), { code }, extra),
    logToFile: jest.fn(),
    resolvePictures: async (examJson) => examJson,
  };
  return { d, calls };
}

test('the early writer re-asks the later section, naming the word, and logs one still given away', async () => {
  const P = Patterns.get('fde_g1_2026').subjects.urdu;
  // Section A's Q1 prints «بلی» in a stem; Section B's Q7 keys it, both times it is written.
  const reply = (id, _n, slot, i) => {
    if (slot === 'g1.urdu.A.Q1' && i === 0) return { question: 'لفظ "بلی" کس حرف سے شروع ہوتا ہے؟' };
    if (slot === 'g1.urdu.B.Q7' && i === 0) return { question: 'بلا', answer: 'بلی' };
    return null;
  };
  const { d, calls } = deps(P, reply);
  const out = await writeEarlyPaper({ grade: 1, subject: 'urdu', pattern: 'fde_g1_2026', P }, d);
  expect(calls.filter((c) => c.id === 'A')).toHaveLength(1);
  const b = calls.filter((c) => c.id === 'B');
  expect(b).toHaveLength(2);
  expect(b[1].user).toMatch(/already appear elsewhere on this paper: بلی/);
  expect(out.examJson).toBeDefined();
  expect(d.logToFile).toHaveBeenCalledWith('[assessment] answers given away', expect.objectContaining({
    giveaways: [expect.objectContaining({ slot: 'g1.urdu.B.Q7', reason: 'giveaway', words: ['بلی'] })],
  }));
});
