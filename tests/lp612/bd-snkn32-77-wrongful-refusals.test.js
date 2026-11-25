/**
 * bd-snkn32.77 (queue #296) — "Make my own" grades 1-5: 112 gate refusals on live, 9-24 Nov (Axiom niete-logs,
 * 'LP K-5 own: rewrite refused'). Most were the word checks misreading ordinary lines. Every line below is copied
 * from a live refusal (one marked "built" is rebuilt from a truncated log line). Each child still works alone in
 * these lines, the teacher checks the whole class, and no board is used: none should refuse.
 */
const P = require('../../bot/shared/services/lp-own-period');
const { checkK5Rewrite } = require('../../bot/shared/services/lp-k5-own');
const { refusalCode } = require('../../bot/shared/services/lp-k5-own-refusal');

describe('You Do pair/group check: wrongful refusals from live', () => {
  const NOT_TOGETHER = [
    // "which food group" — a category, not children in groups
    'دودھ اور گوشت خوراک کے کس کس گروہ میں آتے ہیں؟ لکھو۔',
    'دودھ کس گروہ میں آتا ہے اور گوشت کس گروہ میں آتا ہے؟ ہر ایک کا نام الگ الگ لکھو۔',
    'کتاب بند کرکے تینوں گروہوں کے نام اور ہر گروہ میں کم از کم ایک جانور کی وجہ کاپی میں لکھو۔',
    '(پیچھے و درمیانی سطح) صفحہ ۵۸ دیکھ کر لکھو: چاول اور گاجر کس کس گروہ میں آتے ہیں؟',
    // the plan saying NO pairs
    'Each child works alone in the copy; no pair or group work now.',
    'Each child works alone in her own copy; no talking to a partner during this part.',
    // maths: things in groups of n
    'Behind children do an easier matched task: Q1 (p.168, 14 cookies in groups of 2) and one copy-work item (p.170 Q3, naan packs), using finger counting if needed.',
    'If still unsure, count fish on fingers in groups of 10 before writing the fraction.',
    // matching a word with its meaning
    'کمزور طلبہ کے لیے: لفظ کے ساتھ اشارہ یاد کر کے لفظ اور معنی کی جوڑی بنائیں (لکھنے کی بجائے زبانی جوڑی)۔',
    // "using both words together, write one sentence"
    "جو آگے ہیں وہ 'مجسمہ' اور 'کھنڈرات' دونوں الفاظ سے مل کر ایک جملہ خود لکھیں۔",
    'لازمی اور آگاہ دونوں الفاظ سے مل کر ایک جملہ کاپی میں لکھیں۔',
    // the teacher redoing one with the class (causative: کروائیں / پڑھوائیں)
    'کامیابی کی شرط: چار میں سے تین درست ہوں تو آگے بڑھیں؛ ورنہ ایک جوڑ مل کر دوبارہ کروائیں۔',
    'کامیابی: چھ میں سے چار درست ہوں تو آگے بڑھیں؛ ورنہ ایک جوڑ دوبارہ مل کر کروائیں۔',
    "چوکور جانچ: 'جس نے لکھ لیا، قلم رکھ کر ہاتھ اوپر کرے۔' تھوڑا وقت دے کر سب سے بند ۳ کی مکرر سطر مل کر بلند آواز پڑھوائیں۔",
    // the whole class together, or the teacher with them
    'ہر بچہ اکیلے کاپی یا کتاب میں لکھے، آخر میں جماعت سے مل کر جانچ کریں۔',
    'آخر میں سب مل کر اپنی کتاب اوپر اٹھا کر دکھائیں؛ معلم تین مکمل جملے چیک کریں (نظر سے، سب کی ایک ساتھ)۔',
    'اگر زیادہ تر انگوٹھے نیچے ہوں تو تینوں سوال سب مل کر دوبارہ زبانی دہرائیں، پھر دوبارہ لکھنے دیں۔',
    'ابتدائی سطح کے بچے صرف مرحلہ ۱ کے مختصر جملے پر وقفہ نشان لگائیں؛ استاد مدد کے لیے ایک بار مل کر پڑھیں۔',
    // a sentence frame or an example sentence, not an instruction
    "معلم جماعت میں گھوم کر دیکھے؛ جو بچہ رک جائے، اس سے صرف پوچھیں: 'کون؟ کیسا؟ مل کر کیا؟' اور انگلی سے صفحہ ۱۱۴ کی مثال دکھائیں۔",
    'تیسرا جملہ: ہم مل کر کیا کرتے ہیں؟',
    'درمیانی اور آگے بچے: تینوں جملے (کون؟ کیسا؟ مل کر کیا؟) خود لکھیں؛ آگے والے چوتھا جملہ بھی لکھیں۔',
    'مثال: چھوٹی چھوٹی کوششیں مل کر بڑی طاقت بن جاتی ہیں — اتحاد سے بڑا اثر پیدا ہوتا ہے۔',
    'اتفاق = مل کر متحد ہونا، جیسے قطرے مل کر نہر بناتے ہیں۔',
    'Bilal eats breakfast before class. How do the digestive and circulatory systems work together to help him learn?',
  ];
  test.each(NOT_TOGETHER)('not pair or group work: %s', (line) => {
    expect(P.together(line)).toBeNull();
  });

  const TOGETHER = [
    'Mark where you will pause before you practise reading it aloud to your partner.',
    'مل کر غور کریں (صفحہ ۱۰۴، سوال ۱): ہماری خوراک میں سبزیوں کا کیا کردار ہے؟ مختصر جواب لکھیں۔',
    'Work in pairs to solve Q2.',
    'Now work together with the child next to you.',
    'بچے گروہ میں بیٹھ کر سوال حل کریں۔',
    'دو دو بچے مل کر سوال حل کریں۔',
    'اپنی جوڑی کے ساتھ جواب ملائیں۔',
    'اپنے ساتھی کے ساتھ جواب ملائیں۔',
    'گروپ میں کام کریں۔',
  ];
  test.each(TOGETHER)('still pair or group work: %s', (line) => {
    expect(P.together(line)).not.toBeNull();
  });
});

describe('per-child check: counting or reading "one by one" is not checking each child', () => {
  const plan = (line) => ({ weDo: { steps: [line] } });
  const NOT_PER_CHILD = [
    "Point to 'feast', 'cake' and 'kind' one by one in their story.",
    'Point to each of the 4 parts one by one while counting aloud.',
    'Name one thing you can count one by one, like apples.',
    "Can we count coins one by one? How do you know 'coins' is countable?",
    'Point to the hand and count the small lines one by one with the class.',
    'Ask whole class: "How do we read the decimal digits — one by one or as a number?"',
    'Row 1 (behind): I read p.132 sentences one by one. Point to each word.',
    'کتاب میں صفحہ ۱۳۴ کی سطر پر انگلی رکھیں اور تینوں الفاظ ایک ایک کر کے پڑھیں۔', // built
  ];
  test.each(NOT_PER_CHILD)('not a per-child check: %s', (line) => {
    expect(P.perChildChecks(plan(line))).toEqual([]);
  });

  const PER_CHILD = [
    "Check each child's copy.",
    'Call the children to the front one by one to read.',
    'Listen to each student read the line.',
    'بچوں کو ایک ایک کر کے بلائیں اور سنیں۔',
    'ہر بچے کی کاپی چیک کریں۔',
  ];
  test.each(PER_CHILD)('still a per-child check: %s', (line) => {
    expect(P.perChildChecks(plan(line))).toHaveLength(1);
  });
});

describe('board check (no board ticked): a board that is not hers to use', () => {
  const script = (line) => ({
    goal: 'G', meta: { day: 1 }, hook: { warmUp: { teacherAsks: 'Q?' } }, iDo: { steps: [{ say: line }] },
    weDo: { action: 'Point to page 4.' }, youDo: { action: 'Each child writes alone.' }, wrap: { exitOptions: [{ prompt: 'One.' }] },
  });
  const board = (line) => checkK5Rewrite(script('x'), script(line), { resources: ['textbook'] }).filter((r) => r.includes('board'));
  test.each([
    "Six jalebis cost Rs.60, as shown on p.173's sign board. If you buy three, what do you pay?",
    'Point to the board-free steps written on the page itself (numbers 1-3).',
    'کتاب کے صفحہ ۲ کا سبز باکس کھلا رکھیں، بورڈ کی ضرورت نہیں۔',
  ])('not a board use: %s', (line) => {
    expect(board(line)).toEqual([]);
  });
  test('a real board use still refuses, and the reason shows the words around "board"', () => {
    const r = board('Group by level using rows. Row A (behind): read only one decimal. Row B: copy the table the teacher draws on the board.');
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('on the board');
  });
});

describe('refusalCode: what the teacher is told when a plan cannot be made', () => {
  test.each([
    [['uses a board she does not have ("x"): use the book page instead'], 'OWN_NEEDS_BOARD'],
    [['uses slates ("x"): the children work in the book'], 'OWN_SLATES'],
    [['You Do has pair or group work ("x", the words "in pairs"): …'], 'OWN_GROUP_WORK'],
    [['not in Urdu: an Urdu book\'s plan must be Urdu'], 'OWN_NOT_URDU'],
    [['the reply was not a JSON plan'], 'NOT_ACCEPTED'],
    [['goal (the learning outcome) changed'], 'NOT_ACCEPTED'],
    [[], 'NOT_ACCEPTED'],
    [undefined, 'NOT_ACCEPTED'],
  ])('%j → %s', (reasons, code) => {
    expect(refusalCode(reasons)).toBe(code);
  });
  test('the first reason the teacher can act on wins', () => {
    expect(refusalCode(['goal (the learning outcome) changed', 'uses a board she does not have ("x"): …'])).toBe('OWN_NEEDS_BOARD');
  });
});

describe('the job: a refused plan ends with a code that says what to change', () => {
  test('rewriteK5 reports the last reasons; the row fails with that code', async () => {
    const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');
    const SCRIPT = { goal: 'G', meta: { day: 1 }, hook: { a: 'x' }, iDo: { steps: ['s'] }, weDo: { a: 'x' }, youDo: { a: 'x' }, wrap: { a: 'x' } };
    const deps = {
      claimOwn: jest.fn(async () => ({ id: 'own-1', user_id: 'u1', lesson_id: 'g1', lang: 'en', template_version: 'k5_own_v1', status: 'authoring', answers: {} })),
      loadSegment: jest.fn(), readStoredDoc: jest.fn(), revise: jest.fn(), render: jest.fn(), readFile: jest.fn(),
      loadK5: jest.fn(async () => ({ script: SCRIPT, lang: 'en', grade: 1, subject: 'math', subjectName: 'Math' })),
      rewriteK5: jest.fn(async ({ onRefused }) => { onRefused(['uses a board she does not have ("x"): use the book page instead']); return null; }),
      renderK5: jest.fn(), upload: jest.fn(async () => {}), patchOwn: jest.fn(async () => {}), sleep: jest.fn(), now: () => 0, log: jest.fn(),
    };
    await createOwnWorker(deps).process({ ownId: 'own-1' });
    const failed = deps.patchOwn.mock.calls.map((c) => c[1]).find((p) => p.status === 'failed');
    expect(failed).toEqual(expect.objectContaining({ error_code: 'OWN_NEEDS_BOARD' }));
  });
});
