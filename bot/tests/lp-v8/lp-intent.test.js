/**
 * FEAT-059 / bd-hvhhu — LP intent matcher (TDD, red first).
 *
 * The existing intercept (text-message.handler.js) is EXACT-MATCH only:
 *   /^(lp|lesson\s*plan|لیسن\s*پلان|lesson-plan|\/lp)$/i
 * so "can you send me the lesson plan for tomorrow" falls straight through to
 * the LLM intent path. The spec is that ANY mention opens the LP menu.
 *
 * Opening a menu on a false positive is cheap but not free — it interrupts
 * whatever the teacher was actually doing — so the matcher is tiered:
 * STRONG fires on a mention anywhere, WEAK (bare "plan"/"lesson"/"سبق") needs a
 * teaching companion word, and a BLOCK list wins over both.
 */

const { isLessonPlanRequest, matchDetail } = require('../../shared/utils/lp-intent');

describe('STRONG — fires on a mention anywhere in the message', () => {
  const cases = [
    'lesson plan',
    'Lesson Plan',
    'lesson plans',
    'lessonplan',
    'lesson-plan',
    'lp',
    'LP',
    'lps',
    '/lp',
    'can you send me the lesson plan for tomorrow',
    'i need a lesson plan please',
    'send lp',
    'lesson plan chahiye',
    'do you have lesson plans for grade 3 maths',
    'teaching plan for tomorrow',
    'plan for class',
    "plan for tomorrow's class",
    'سبق کا منصوبہ',
    'مجھے سبق کا منصوبہ چاہیے',
    'سبق کی منصوبہ بندی',
    'لیسن پلان',
    'سبق کی تیاری',
    'sabaq ka mansooba',
    'sabak ka mansuba chahiye',
    'mujhe mansooba chahiye',
    'aaj parhana hai',
    'kal parhana hai',
    'kal ki class ke liye',
    'lesson ka plan bhejein',
  ];
  test.each(cases)('fires on %p', (text) => {
    expect(isLessonPlanRequest(text)).toBe(true);
  });

  test('reports which tier and token matched, for logging', () => {
    const d = matchDetail('can you send me the lesson plan for tomorrow');
    expect(d.matched).toBe(true);
    expect(d.tier).toBe('strong');
    expect(d.token).toBeTruthy();
  });
});

describe('WEAK — a bare word only counts with a teaching companion', () => {
  const fires = [
    'plan for grade 3 english',
    'i need a plan for class 5',
    'plan for chapter 2',
    'lesson for tomorrow',
    'kal ke lesson ke liye kuch bhejo',
    'سبق grade 3',
    'sabaq for class 4',
    'plan for maths today',
  ];
  test.each(fires)('fires with a companion: %p', (t) => expect(isLessonPlanRequest(t)).toBe(true));

  const doesNot = [
    'I have a plan',
    'what is the plan',
    'that was a good lesson',
    'plan kya hai',
    'no plan yet',
    'the lesson was fun',
  ];
  test.each(doesNot)('stays quiet without one: %p', (t) => expect(isLessonPlanRequest(t)).toBe(false));

  test('reports the weak tier', () => {
    expect(matchDetail('plan for grade 3 english').tier).toBe('weak');
  });
});

describe('BLOCK — wins over everything, including a strong token', () => {
  const blocked = [
    'lesson learned',
    'lessons learnt from the training',
    'that was a life lesson',
    'my data plan expired',
    'we need a business plan',
    'can you make a meeting plan',
    'plan a meeting with the AEO',
    'what is the payment plan',
    'travel plan for the school trip',
    'send me the video lesson',
    'plan b if she does not come',
  ];
  test.each(blocked)('never fires on %p', (t) => expect(isLessonPlanRequest(t)).toBe(false));

  test('a block phrase beats a strong token in the same message', () => {
    expect(isLessonPlanRequest('lesson learned, but send me the lesson plan')).toBe(false);
    expect(matchDetail('lesson learned, but send me the lesson plan').tier).toBe('blocked');
  });
});

describe('slash commands belong to their own routers', () => {
  const cmds = ['/menu', '/quiz', '/observe', '/training', '/video', '/help', '/start'];
  test.each(cmds)('never fires on %p', (t) => expect(isLessonPlanRequest(t)).toBe(false));

  test('but /lp is ours', () => expect(isLessonPlanRequest('/lp')).toBe(true));
});

describe('no regression against the OLD exact-match regex', () => {
  // Every string the old intercept matched must still match.
  const OLD = /^(lp|lesson\s*plan|لیسن\s*پلان|lesson-plan|\/lp)$/i;
  const olds = ['lp', 'LP', 'lesson plan', 'lessonplan', 'Lesson  Plan', 'لیسن پلان', 'lesson-plan', '/lp'];
  test.each(olds)('%p matched before and still matches', (t) => {
    expect(OLD.test(t.trim())).toBe(true);
    expect(isLessonPlanRequest(t)).toBe(true);
  });
});

describe('input hygiene', () => {
  test.each([null, undefined, '', '   ', 42, {}])('non-string / empty input is false: %p', (t) => {
    expect(isLessonPlanRequest(t)).toBe(false);
  });

  test('leading and trailing whitespace does not matter', () => {
    expect(isLessonPlanRequest('   lesson plan   ')).toBe(true);
  });

  test('word boundaries stop partial matches', () => {
    expect(isLessonPlanRequest('flp')).toBe(false);
    expect(isLessonPlanRequest('clips')).toBe(false);
    expect(isLessonPlanRequest('helpline')).toBe(false);
  });

  test('a very long message with the phrase buried in it still fires', () => {
    const long = `${'blah '.repeat(200)}please send the lesson plan${' more'.repeat(50)}`;
    expect(isLessonPlanRequest(long)).toBe(true);
  });
});
