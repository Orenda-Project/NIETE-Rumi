/**
 * bd-5jmnfj.4.55 — v24 key-content findings (TDD red).
 *
 * 1. G2 Urdu Q9 (Dialogue): the stem asks for two friends planning a park game, but
 *    scheme.accept ("یہ بھی درست:") carried a different task, a child-shopkeeper shopping
 *    dialogue. Cause: the slot's prompt_rule offered two situations, and tidyAccepts
 *    never clears accept on an open composition slot (marked by its K points).
 * 2. G2 English oral listening item 4: "Why was Aisha a little sad?" -> "She missed her
 *    home in Multan and her old friends." The story never says she was sad or mentions
 *    old friends. oralContent must return the listening task as missing (so reaskOral
 *    re-asks it) when a non-apply answer uses words the script does not say.
 *
 * Rows are the real v24 g2-urdu-exam.json / g2-english-exam.json shapes.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const G2 = () => Patterns.get('fde_g2_2026').subjects;
const slotOf = (subject, id) => G2()[subject].sections.flatMap((s) => s.slots).find((s) => s.slot === id);

// ---------------------------------------------------------------- 1. Urdu Q9 accept
const SHOPPING = 'بچے اور دکان دار کے درمیان خریداری کا پانچ جملوں کا مربوط مکالمہ';
const k = (text) => ({ kind: 'K', text, marks: 2 });
const q9 = (accept) => ({
  slot: 'g2.urdu.B.Q9', lines: 6, marks: 10, blooms: 'Apply',
  answer: 'دوست ۱: کل چھٹی ہے، کیا ہم پارک چلیں؟ دوست ۲: ہاں، ضرور! ہم کون سا کھیل کھیلیں گے؟ دوست ۱: ہم گیند سے کھیلیں گے۔ دوست ۲: میں اپنی گیند ساتھ لے آؤں گا۔ دوست ۱: بہت خوب! ہم صبح آٹھ بجے ملیں گے۔',
  question: 'دو دوست چھٹی کے دن پارک میں کھیلنے کا منصوبہ بنا رہے ہیں۔ ان کے درمیان پانچ جملوں کا مکالمہ لکھیں۔',
  main_question: 'دیا گیا مکالمہ مکمل کریں۔',
  scheme: {
    accept,
    points: [
      k('پہلا جملہ مکالمے کا درست آغاز ہو'),
      k('دوسرا جملہ پہلے جملے کا مناسب جواب ہو'),
      k('تیسرا جملہ پچھلے جملے سے جڑا ہوا ہو'),
      k('چوتھا جملہ پچھلے جملے سے جڑا ہوا ہو'),
      k('پانچواں جملہ پچھلے جملے سے جڑا ہوا اور مکالمہ مکمل کرنے والا ہو'),
    ],
    checked: null,
    common_error: 'جملے ایک دوسرے سے بے ربط ہونا یا ایک ہی شخص کا بار بار بولنا۔',
  },
});
const runRows = (subject, type, rows, layout = true) => {
  const exam = { unseen: { subjective: { [type]: rows } } };
  if (layout) exam._layout = { v: 2, subject, sections: G2()[subject].sections };
  return normaliseScheme(exam).examJson.unseen.subjective[type];
};

describe('finding 1: G2 Urdu Q9 dialogue accept line sets another task', () => {
  test('v24 row: accept on the open dialogue slot comes back empty (shopping entry gone)', () => {
    const [row] = runRows('urdu', 'Dialogue', [q9([SHOPPING])]);
    expect(row.scheme.accept).toEqual([]);
  });

  test('the Q9 prompt_rule names one situation (two friends), never a shopkeeper', () => {
    const rule = slotOf('urdu', 'g2.urdu.B.Q9').prompt_rule;
    expect(rule).not.toMatch(/shopkeeper/i);
    expect(rule).toMatch(/two friends/i);
  });

  test('G2 English Q12 paragraph (open composition) also drops a stray accept', () => {
    const row = {
      slot: 'g2.english.C.Q12', lines: 7, marks: 10, blooms: 'Apply',
      answer: 'My house is big. It has three rooms. It has a green door. I love my house. My family lives here.',
      question: 'Write five sentences on "My House".',
      scheme: { accept: ['Five sentences about my school'], points: [k('on topic'), k('five sentences'), k('capitals'), k('spelling'), k('describing words')], checked: null, common_error: 'Writes fewer than five sentences.' },
    };
    const [out] = runRows('english', 'Paragraph', [row]);
    expect(out.scheme.accept).toEqual([]);
  });

  // ---- controls (green now, must stay green)
  test('control: one-sentence slot g2.english.B.Q2 keeps its accept entries', () => {
    const row = {
      slot: 'g2.english.B.Q2', lines: 1, marks: 2, blooms: 'Apply', answer: 'The cat is on the mat.',
      question: 'cat', scheme: { accept: ['I have a cat.'], points: [{ kind: 'A', text: 'correct sentence using the word', marks: 2 }], checked: null, common_error: 'x' },
    };
    const [out] = runRows('english', 'Sentences from Words', [row]);
    expect(out.scheme.accept).toEqual(['I have a cat.']);
  });

  test('control: G1 English Q13 greeting still gets Hello and Assalam-o-Alaikum', () => {
    const row = {
      slot: 'g1.english.C.Q13', lines: 1, marks: 2, answer: 'Good morning.', blooms: 'Apply', question: 'What will they say?',
      scheme: { accept: ['Good morning'], points: [{ kind: 'K', text: 'Writes the correct words', marks: 2 }], checked: null, common_error: 'x' },
    };
    const exam = { _layout: { v: 2, subject: 'english', sections: Patterns.get('fde_g1_2026').subjects.english.sections }, unseen: { subjective: { 'Speech Bubbles': [row] } } };
    const [out] = normaliseScheme(exam).examJson.unseen.subjective['Speech Bubbles'];
    expect(out.scheme.accept).toEqual(expect.arrayContaining(['Hello', 'Assalam-o-Alaikum']));
  });

  test('control: the same Q9 row with no _layout (non-FDE) keeps its accept as is', () => {
    const [row] = runRows('urdu', 'Dialogue', [q9([SHOPPING])], false);
    expect(row.scheme.accept).toEqual([SHOPPING]);
  });
});

// ---------------------------------------------------------------- 2. G2 English listening
const SCRIPT = 'One sunny day, Aisha, a new girl, sat in Pinky\'s class. Pinky wanted to say hello but felt shy. Sir Riaz gave Pinky a tip. He said, "Just say your name and ask about her." Pinky saw that Aisha was drawing a mango. Pinky asked, "Do you like mangoes?" Aisha said, "I love mangoes! I miss my home in Multan." Pinky smiled and said, "I can be your friend!"';
const V24_ITEMS = [
  { ask: 'Who was the new girl in Pinky\'s class?', answer: 'Aisha.' },
  { ask: 'What was Aisha drawing?', answer: 'A mango.' },
  { ask: 'Why did Pinky not say hello at first?', answer: 'She felt shy.' },
  { ask: 'Why was Aisha a little sad?', answer: 'She missed her home in Multan and her old friends.' },
  { ask: 'If a new child comes to your class, what can you say to them?', answer: 'Any kind answer, for example: Hello! My name is (name). Do you want to be my friend?' },
];
const SPEAKING = { id: 'speaking', items: [
  { ask: 'Topic: My best friend. Who is your best friend?', answer: '' },
  { ask: 'What do you like to do together?', answer: '' },
  { ask: 'Why do you like your friend?', answer: '' },
] };
const READ_ALOUD = { id: 'read_aloud', items: [{ ask: 'playground', answer: '' }], script: 'Pinky went to a playground big and wide, To Manghopir, where really old crocodiles hide. She heard they once were tiny, on a saint\'s head they sat, Now they\'re big crocs, imagine that! The Sheedi people, with joy in their heart, Celebrate their roots, with music and art.' };
const englishReply = (items) => ({ oral: [{ id: 'listening', script: SCRIPT, items }, SPEAKING, READ_ALOUD] });
const englishOral = () => G2().english.oral;

describe('finding 2: G2 English listening answer not said in the story', () => {
  test('v24 reply: item 4 (sad / old friends) makes the listening task missing, so it is re-asked', () => {
    const r = Prompt.oralContent(englishReply(V24_ITEMS), englishOral());
    expect(r.missing).toContain('listening');
  });

  test('the oral prompt tells the writer every listening answer is said in the story', () => {
    const text = Prompt.oralPrompt({ oral: englishOral(), grade: 2, P: G2().english, pageContent: 'BOOK' });
    expect(text).toMatch(/said in the story/i);
  });

  test('the G2 English listening ask puts the apply question last', () => {
    const task = englishOral().tasks.find((t) => t.id === 'listening');
    expect(task.ask).toMatch(/apply last/i);
  });

  // ---- controls (green now, must stay green)
  test('control: item 4 replaced by one the story says gives missing []', () => {
    const fixed = V24_ITEMS.slice();
    fixed[3] = { ask: 'What did Aisha miss?', answer: 'Her home in Multan.' };
    const r = Prompt.oralContent(englishReply(fixed), englishOral());
    expect(r.missing).toEqual([]);
    expect(r.content.find((c) => c.id === 'listening').items).toHaveLength(5);
  });

  test('control: the last (apply) item is exempt even though its words are not in the story', () => {
    const fixed = V24_ITEMS.slice();
    fixed[3] = { ask: 'What did Aisha miss?', answer: 'Her home in Multan.' };
    fixed[4] = { ask: 'What would you say to a new child?', answer: 'Welcome! Would you like to play cricket with us?' };
    expect(Prompt.oralContent(englishReply(fixed), englishOral()).missing).toEqual([]);
  });

  test('control: G2 Urdu poem task (v24 reply, «شاخ پر» vs «شاخ پہ») is not word-checked', () => {
    const reply = { oral: [
      { id: 'poem', script: 'صبح سویرے میں جب اٹھوں\nچھوڑ کے بستر باغ میں پہنچوں\nشاخ پہ کھلتے پھول کو دیکھوں\nننھی چڑیاں مجھ سے پہلے\nپیڑ پہ بیٹھی گیت سہانے\nکتنی خوشی سے گائیں مل کے',
        items: [
          { ask: 'بچہ صبح سویرے اٹھ کر کہاں پہنچتا ہے؟', answer: 'باغ میں' },
          { ask: 'پھول کہاں کھلتے ہیں؟', answer: 'شاخ پر' },
          { ask: 'ننھی چڑیاں کہاں بیٹھی ہیں؟', answer: 'پیڑ پر' },
          { ask: 'چڑیاں کیا کرتی ہیں؟', answer: 'چڑیاں مل کر سہانے گیت گاتی ہیں' },
          { ask: 'اس نظم میں بچے سے پہلے کون جاگ چکا ہے؟', answer: 'ننھی چڑیاں' },
        ] },
      { id: 'holidays', items: [
        { ask: 'گرمیوں کی چھٹیوں میں آپ کہاں گئے؟', answer: 'x' },
        { ask: 'آپ نے چھٹیوں میں کون سا کھیل کھیلا؟', answer: 'x' },
        { ask: 'چھٹیوں میں آپ کو سب سے زیادہ کیا اچھا لگا؟', answer: 'x' },
      ] },
      { id: 'dialogue', items: [], script: 'غصیلا بھنورا: آداب۔۔۔ آپ کون؟\nتَلیّا: میں۔۔۔ میں تَلیّا۔' },
    ] };
    expect(Prompt.oralContent(reply, G2().urdu.oral).missing).toEqual([]);
  });
});
