/**
 * Urdu board-pattern papers, the two structural fails of the round-5 sandbox papers:
 *
 *   1. Section A gives Section C away: a Q1 MCQ keyed on the same answer as a Q4 item
 *      («اگر – تو», «اسکول»). Urdu joins the cross-section table: such a Q1 item is held (the
 *      re-ask of Section A is told Q4's questions and answers), and comes back only after the
 *      re-ask when nothing else can take its place. Q4 is never touched.
 *   2. Lessons with no poem (4–5, 8–9, …) cannot set Q6's verses: the only poem in lessons 4–10
 *      is lesson 7 «ندی کی فریاد» (book pp 63–64). Its page text is given to Section C, the way
 *      English Q5 is given its nearest poem.
 *
 * Proved through applyLayout / takenNote and through generatePatternExam with only the model,
 * the logger and the book store mocked. The recorded papers are sandbox replies (content only,
 * no person in them); the book pages are the Grade 5 Urdu book's pp 63–64.
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
const mockLoads = [];
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

// Book pp 63–64 as the page store holds them: the poem's couplets with the book's reflection
// questions between them, then the poet's letter and the lesson's exercises.
const mockPoemPages = [
  '=== Page 63 ===',
  'سبق ۷', '', 'ندی کی فریاد', '', 'متن کا سفر', '', 'عنوان: ندی کی فریاد', '', 'شاعر: کوثر صدیقی', '',
  'یہ گندگی ہے کیسی آئی ہے یہ کہاں سے؟', '', 'شہروں کی یہ غلاظت آئی ہے کیسے بہہ کے؟', '',
  'آبی آلودگی کی کیا وجوہات ہو سکتی ہیں اور', '', 'ہم اسے کیسے کم کر سکتے ہیں؟', '',
  'دم گھٹ رہا ہے میرا بدبوہے جان لیوا', '', 'گرتا ہے مجھ میں آکے شہروں کا گندہ نالہ', '',
  '',
  '=== Page 64 ===',
  'سبق ۷', '', 'ندی کی فریاد', '',
  'فریاد بے نوا کی سنتا نہیں ہے کوئی', '', 'سمجھے جو میرے دکھ کو ایسا نہیں ہے کوئی', '',
  'پیارے طلبہ!', '', 'میں کوثر صدیقی ہوں۔ میری شاعری اردو زبان کی خوب صورتی اور اس کے اظہار', '',
  'گہرائی تک پہنچنا', '', '۱. خالی جگہوں کو پڑکریں۔',
].join('\n');
const mockLessons45 = '=== Page 28 ===\nسبق ۴\n\nمادرِ ملت محترمہ فاطمہ جناح کی داستان\n\n=== Page 49 ===\nحکایاتِ سعدی';

jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => {
    mockLoads.push(String(pageRanges));
    if (String(pageRanges) === '63-64') return { content: mockPoemPages, pageReference: '63-64' };
    return { content: mockLessons45, pageReference: String(pageRanges) };
  },
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, takenNote } = require('../../bot/shared/services/assessment/fde-layout');

const P = Patterns.get('fde_g5_2027').subjects;
const U = P.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const L45 = { kind: 'chapters', chapters: [4, 5], pages: '28-49' };
const L67 = { kind: 'chapters', chapters: [6, 7], pages: '50-70' };
const papers = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r10-urdu-sandbox-papers.json'), 'utf8'));
const pagesText = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `=== Page ${from + i} ===\nمتن ${from + i}`).join('\n\n');

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const clone = (x) => JSON.parse(JSON.stringify(x));

beforeEach(() => { mockCreate.mockReset(); mockLoads.length = 0; });

describe('urdu Q1 ↔ Q4: Section A never gives a Q4 answer away', () => {
  test('full_1: Q1 «حرفِ شرط و جزا» keyed «اگر – تو» is held while Q4 asks «اگر - تو»; Q4 is untouched', () => {
    const exam = clone(papers.full_1);
    const { examJson, shortfall } = applyLayout(exam, U, FDE, { reasked: false });
    const q1 = items(examJson, 'urdu.A.Q1');
    expect(q1.map((q) => q.question)).not.toContain('درج ذیل میں سے حرفِ شرط و جزا کا درست جوڑا کون سا ہے؟');
    expect(q1).toHaveLength(19);
    expect(shortfall).toEqual(expect.arrayContaining([expect.objectContaining({ slot: 'urdu.A.Q1', missing: 1 })]));
    expect(items(examJson, 'urdu.C.Q4')).toHaveLength(4);
  });

  test('chapters_1: Q1 «… کس لفظ سے» keyed «اسکول» is held while Q4 ۱ is keyed «اسکول»', () => {
    const exam = clone(papers.chapters_1);
    const { examJson } = applyLayout(exam, U, L67, { reasked: false });
    const q1 = items(examJson, 'urdu.A.Q1');
    expect(q1.some((q) => q.question.startsWith('قلم، کاپی، بستہ، تختی'))).toBe(false);
    expect(q1).toHaveLength(19);
    expect(items(examJson, 'urdu.C.Q4').map((q) => q.answer)).toContain('الف) اسکول');
  });

  test('after the one re-ask, a held item comes back only for a place nothing else takes', () => {
    const { examJson } = applyLayout(clone(papers.full_1), U, FDE, { reasked: true });
    expect(items(examJson, 'urdu.A.Q1')).toHaveLength(20);
  });

  test('a paper with no shared key lays out as before', () => {
    const exam = clone(papers.lessons_4_5_failed);
    const { examJson } = applyLayout(exam, U, L45, { reasked: false });
    expect(items(examJson, 'urdu.A.Q1')).toHaveLength(20);
  });

  test('the re-asked Section A is told Q4\'s questions and answers; other sections are not', () => {
    const sec = (id) => U.sections.find((s) => s.id === id);
    const note = takenNote(U, sec('A'), papers.full_1);
    expect(note).toContain('Q4 of this paper');
    expect(note).toContain('___ محنت کرو گے ___ کامیاب ہو گے');
    expect(note).toContain('اگر - تو');
    expect(note).toContain('بارش');
    expect(takenNote(U, sec('B'), papers.full_1)).toBeNull();
    expect(takenNote(U, sec('C'), papers.full_1)).toBeNull();
  });
});

describe('urdu Q6 on lessons with no poem: lesson 7\'s poem is given', () => {
  test('poems: lesson 7 «ندی کی فریاد», book pp 63–64, from the book store; never a held lesson', () => {
    expect(U.poems).toEqual([{ unit: 7, pages: '63-64', title: 'ندی کی فریاد', poet: 'کوثر صدیقی' }]);
    for (const poem of U.poems) expect(U.scope.held).not.toContain(poem.unit);
  });

  test('lessons 4–5 / 8–9 / 9–10 → lesson 7\'s poem; 6–7, 7–8 and the FDE syllabus → none', () => {
    expect(Gen.patternPoemFor({ P: U, scope: L45, pageContent: pagesText(28, 49) })).toMatchObject({ unit: 7, pages: '63-64' });
    expect(Gen.patternPoemFor({ P: U, scope: L45, pageContent: pagesText(71, 94) })).toMatchObject({ unit: 7, pages: '63-64' });
    expect(Gen.patternPoemFor({ P: U, scope: L45, pageContent: pagesText(83, 107) })).toMatchObject({ unit: 7, pages: '63-64' });
    expect(Gen.patternPoemFor({ P: U, scope: L67, pageContent: pagesText(50, 70) })).toBeNull();
    expect(Gen.patternPoemFor({ P: U, scope: L45, pageContent: pagesText(61, 82) })).toBeNull();
    expect(Gen.patternPoemFor({ P: U, scope: FDE, pageContent: pagesText(28, 107) })).toBeNull();
  });

  test('the given poem is in the Section C prompt only, and only on Urdu', () => {
    const poem = { unit: 7, pages: '63-64', title: 'ندی کی فریاد', content: '=== Page 63 ===\nیہ گندگی ہے کیسی آئی ہے یہ کہاں سے؟' };
    const build = (id, scope, extra = {}) => {
      const section = U.sections.find((s) => s.id === id);
      return Gen.buildPatternUserPrompt({ grade: 5, subject: 'urdu', pageContent: 'متن', pageReference: '28-49', section, slots: section.slots, lang: 'ur', P: U, scope, ...extra });
    };
    const c = build('C', L45, { poem });
    expect(c).toContain('**Poem for Q6 (book pp. 63-64):**');
    expect(c).toContain('یہ گندگی ہے کیسی آئی ہے یہ کہاں سے؟');
    expect(c).toContain('Q6\'s verses (درج ذیل اشعار کا مفہوم واضح کریں) come from this poem, lesson 7 «ندی کی فریاد» (book pp. 63-64), whatever lessons the paper covers');
    for (const id of ['A', 'B']) expect(build(id, L45, { poem })).toBe(build(id, L45));
    expect(build('C', FDE, { poem })).toBe(build('C', FDE));
    expect(build('C', L45)).not.toContain('Poem for Q6');
  });
});

// The lessons 4–5 sandbox request (scope chapters [4,5]) failed twice with PATTERN_SHORT_SLOT
// urdu.C.Q6: the model is told to quote lesson 7 and never shown it. The mock model answers each
// section with that request's recorded reply; it writes Q6's verses only when it is shown a poem
// (copying four of its verse lines), as a model that cannot invent book verses would.
describe('lessons 4–5 through generatePatternExam', () => {
  const recorded = papers.lessons_4_5_failed;
  const sectionOf = (prompt) => ['A', 'B', 'C'].find((s) => prompt.includes(`"slot": "urdu.${s}.`));
  const treeFor = (sec) => {
    const tree = {};
    for (const [cat, types] of Object.entries(recorded.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = list.filter((q) => q.slot.startsWith(`urdu.${sec}.`));
        if (mine.length) (tree[cat] ||= {})[type] = clone(mine);
      }
    }
    return tree;
  };
  const reply = (tree) => ({
    choices: [{ message: { content: JSON.stringify({ unseen: tree }) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
  });
  const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

  function serve({ q1GivesQ4Away = false } = {}) {
    const asked = [];
    mockCreate.mockImplementation(async (req) => {
      const prompt = textOf(req);
      const sec = sectionOf(prompt);
      asked.push({ sec, prompt });
      const tree = treeFor(sec);
      if (sec === 'A' && q1GivesQ4Away && asked.filter((a) => a.sec === 'A').length === 1) {
        // Q4 ۲ of this request is «___ تم محنت کرو گے ___» keyed «الف) اگر، تو».
        tree.objective.MCQs[19] = {
          slot: 'urdu.A.Q1', question: 'درج ذیل میں سے حرفِ شرط و جزا کا درست جوڑا کون سا ہے؟',
          options: ['الف) اور – پھر', 'ب) اگر – تو', 'ج) پر – و', 'د) سے – کو'], answer: 'ب) اگر – تو',
        };
      }
      const at = prompt.indexOf('**Poem for Q6');
      if (sec === 'C' && at >= 0) {
        const verses = prompt.slice(at).split('```')[1].split('\n')
          .filter((l) => /(سے|کے|لیوا|نالہ)؟?$/.test(l.trim()) && l.trim().split(' ').length >= 6).slice(0, 4);
        tree.subjective['Poem Explanation'] = [{
          slot: 'urdu.C.Q6', type: 'Poem Explanation', question: 'درج ذیل اشعار کا مفہوم واضح کریں۔',
          passage: verses.join('\n'),
          answer: 'ندی کہتی ہے کہ شہروں کا گندا پانی اس میں گرتا ہے اور اس کا دم گھٹتا ہے۔',
          scheme: { points: [{ text: 'گندگی کا ذکر', marks: 2, band: 'U' }, { text: 'ندی کی تکلیف', marks: 2, band: 'U' }, { text: 'زبان', marks: 1, band: 'A' }] },
        }];
      }
      return reply(tree);
    });
    return asked;
  }
  const run = () => Gen.generatePatternExam({
    grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: L45, pageRanges: '28-49', requestId: 'req-r10u',
  });

  test('lesson 7\'s poem page is loaded and given to Section C only; the build is no longer short of Q6', async () => {
    const asked = serve();
    const out = await run().then((r) => ({ ok: r }), (err) => ({ err }));
    // The same request built nothing before (PATTERN_SHORT_SLOT, urdu.C.Q6 missing 1); now it builds.
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    expect(mockLoads).toContain('63-64');
    const c = asked.find((a) => a.sec === 'C').prompt;
    expect(c).toContain('**Poem for Q6 (book pp. 63-64):**');
    expect(c).toContain('فریاد بے نوا کی سنتا نہیں ہے کوئی');
    // The poet's letter and the exercises after the poem are not given as the poem.
    expect(c.split('**Poem for Q6')[1].split('```')[1]).not.toContain('پیارے طلبہ');
    for (const a of asked.filter((x) => x.sec !== 'C')) expect(a.prompt).not.toContain('Poem for Q6');
    const q6 = items(out.ok.examJson, 'urdu.C.Q6');
    expect(q6).toHaveLength(1);
    expect(q6[0].passage.split('\n')).toEqual(['یہ گندگی ہے کیسی آئی ہے یہ کہاں سے؟', 'شہروں کی یہ غلاظت آئی ہے کیسے بہہ کے؟', 'دم گھٹ رہا ہے میرا بدبوہے جان لیوا', 'گرتا ہے مجھ میں آکے شہروں کا گندہ نالہ']);
  });

  test('a Q1 keyed like a Q4 item: Section A is asked again, told Q4; the repeat is not printed', async () => {
    const asked = serve({ q1GivesQ4Away: true });
    const out = await run().then((r) => ({ ok: r }), (err) => ({ err }));
    const a = asked.filter((x) => x.sec === 'A');
    expect(a).toHaveLength(2);
    expect(a[0].prompt).not.toContain('Q4 of this paper');
    expect(a[1].prompt).toContain('Q4 of this paper');
    expect(a[1].prompt).toContain('اگر، تو');
    expect(out.err).toBeUndefined();
    const q1 = items(out.ok.examJson, 'urdu.A.Q1');
    expect(q1).toHaveLength(20);
    expect(q1.map((q) => q.question)).not.toContain('درج ذیل میں سے حرفِ شرط و جزا کا درست جوڑا کون سا ہے؟');
  });
});
