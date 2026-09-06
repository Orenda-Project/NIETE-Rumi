/**
 * bd-hgwfo — the LP keyword intercept is a receptionist, not a router.
 *
 * It used to fire on ANY mention of a lesson plan (bd-hvhhu), for one stated
 * reason: a message that fell through to the LLM "often produced a GENERATED
 * plan instead of the ready-made corpus". bd-2540 retired generation, so the
 * gate now guards a dead path while pre-empting the LLM router that already
 * knows which lesson was just delivered (bd-wpupy) and can rewrite it.
 *
 * Production, 16-30 Aug 2026: 748 messages intercepted; 47% were ones the
 * picker demonstrably could not answer — dictated observations, feedback on a
 * plan already sent, "shorten this lp". Only 153 were a bare command.
 *
 * New contract: fire ONLY when the whole message is the artefact name — the
 * isVideoCommand precedent (bd-2486) in the same handler. Anything carrying
 * content goes to the LLM.
 */

const { isLessonPlanRequest, matchDetail } = require('../../shared/utils/lp-intent');

describe('BARE — the whole message is the artefact name', () => {
  // Every distinct bare form seen in production, 16-30 Aug (153 messages),
  // plus the old exact-match set so this cannot quietly narrow below it.
  const bare = [
    'lp', 'LP', 'lps', '/lp', '/ lp', '/lps', 'lp/',
    'lesson', 'Lesson', 'lessons', '/lesson', '/lessons',
    'lesson plan', 'Lesson Plan', 'lesson plans', 'lessonplan', 'lesson-plan', 'Lesson  Plan',
    '/lesson plan', '/lesson plans', '/Lesson Plan',
    'لیسن', 'لیسن پلان', 'لیسن پلان۔', 'سبق کا منصوبہ',
    'lesson plan.', 'Lesson plan!', 'lesson plan?', '   lesson plan   ',
  ];
  test.each(bare)('fires on %p', (t) => {
    expect(isLessonPlanRequest(t)).toBe(true);
    expect(matchDetail(t).tier).toBe('bare');
  });
});

describe('CONTENT — anything beyond the name goes to the LLM', () => {
  // The ten follow-up phrasings that fired under the old matcher and hijacked
  // a teacher who had just been sent a lesson.
  const followUps = [
    'shorten this lp',
    'shorten this lesson plan',
    'simplify this lesson plan',
    'make this lesson plan simpler',
    'send me this lp as text',
    'is lesson plan chota kar do',
    'yeh lesson plan asaan kar dein',
    'اس لیسن پلان کو آسان کریں',
    'make the lp shorter',
    'this lp is too long',
    'summarize this lesson plan for me',
    'In urdu lesson plan',
    'But this lesson plan doesn\'t explain the lesson',
    'آپ کا بہت شکریہ، آپ کا لیسن پلان بالکل ٹھیک ہے۔',
    'جو بھی آپ نے لیسن پلان بھیجے ہیں، سارے ہی بکواس ہیں',
  ];
  test.each(followUps)('a follow-up never fires: %p', (t) => {
    expect(isLessonPlanRequest(t)).toBe(false);
  });

  // What the OLD matcher called STRONG — every one now belongs to the LLM,
  // which routes it to the Flow via the lesson_plan intent (same destination,
  // but decided with context).
  const oldStrong = [
    'can you send me the lesson plan for tomorrow',
    'i need a lesson plan please',
    'send lp',
    'lesson plan chahiye',
    'do you have lesson plans for grade 3 maths',
    'teaching plan for tomorrow',
    'plan for class',
    'مجھے سبق کا منصوبہ چاہیے',
    'سبق کی منصوبہ بندی',
    'sabaq ka mansooba',
    'aaj parhana hai',
    'kal ki class ke liye',
    'lesson ka plan bhejein',
    'create lesson plan',
    'Class 5th English Unit 5 Lesson plan',
    'grade 3 math chapter 2',
    'plan for grade 3 english',
    'سبق grade 3',
  ];
  test.each(oldStrong)('a request with content never fires: %p', (t) => {
    expect(isLessonPlanRequest(t)).toBe(false);
    expect(matchDetail(t).tier).toBe('none');
  });

  test('a long message with the phrase buried in it never fires', () => {
    const long = `${'blah '.repeat(200)}please send the lesson plan${' more'.repeat(50)}`;
    expect(isLessonPlanRequest(long)).toBe(false);
  });
});

describe('slash commands belong to their own routers', () => {
  const cmds = ['/menu', '/quiz', '/observe', '/training', '/video', '/help', '/start', '/language'];
  test.each(cmds)('never fires on %p', (t) => expect(isLessonPlanRequest(t)).toBe(false));
});

describe('input hygiene', () => {
  test.each([null, undefined, '', '   ', 42, {}])('non-string / empty input is false: %p', (t) => {
    expect(isLessonPlanRequest(t)).toBe(false);
    expect(matchDetail(t).tier).toBe('none');
  });

  test('partial words never fire', () => {
    for (const t of ['flp', 'clips', 'helpline', 'lessonplanning tips', 'lpz']) {
      expect(isLessonPlanRequest(t)).toBe(false);
    }
  });

  test('reports the token for logging', () => {
    const d = matchDetail('/lesson plan');
    expect(d.matched).toBe(true);
    expect(d.tier).toBe('bare');
    expect(d.token).toBeTruthy();
  });
});
