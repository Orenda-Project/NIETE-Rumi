/**
 * Round-11 Social Studies (sandbox papers on the p.29 table, 7S2 re-ask):
 *
 *   1. Which government does a job. A FULL paper's Section D prompt already carries the p.29 rows
 *      (the syllabus pages include p.29), yet full_2 D.Q6 keyed two jobs to one government and
 *      listed «عوامی سڑکوں اور راستوں سے تجاوزات ہٹاتی ہے» as local work. So: (a) every Social
 *      Studies section whose pages name a government tier gets the rows, also when the chosen
 *      pages stop short of p.29; (b) the rule says one job per which-government item; (c) the
 *      layout holds an item that gives one row's job to another government.
 *   2. The re-ask note names the items the slot already keeps, so the refill is not one of them.
 *   3. Two items in one slot whose keys say the same thing (K2's height, with and without an
 *      extra clause) are one question.
 *   4. A held slot left short is asked for spares, so the re-ask can fill it with new facts.
 *
 * Recorded items are content from sandbox papers (no person in them); extra items are fictional.
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 40 ===\nسبق کا متن', pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, takenNote } = require('../../bot/shared/services/assessment/fde-layout');

const P = Patterns.get('fde_g5_2027').subjects;
const SST = P.social_studies;
const FDE = { kind: 'fde', chapters: null, pages: null };
const PAGES_30 = { kind: 'pages', chapters: null, pages: '30-33' };
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const REC = fixture('r11-sst-recorded');

const HEAD = 'The book\'s table on p.29 says which government does what.';
const PROVINCIAL = '- صوبائی حکومت: صوبے کا نظم و نسق (قانون سازی، عوامی سڑکوں اور راستوں سے تجاوزات ہٹانا، امن و امان کا قیام) چلاتی ہے؛';
const ONE_JOB = 'A which-government item asks about one job';

// Page 30 as the page store holds it names the tiers in prose; the table itself is on p.29.
const P30 = '=== Page 30 ===\nمقامی حکومت عوام کے روزمرہ مسائل حل کرتی ہے۔ صوبائی حکومت صوبے کے معاملات دیکھتی ہے۔';

function prompt(subject, sectionId, scope, pageContent) {
  const S = P[subject];
  const section = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent, pageReference: '30-33', section, slots: section.slots, lang: S.medium, P: S, scope,
  });
}

// An SST paper: the recorded Q1 MCQs and the given items, each under its slot's type.
function paper(items) {
  const unseen = {};
  for (const q of items) {
    const slot = SST.sections.flatMap((s) => s.slots).find((s) => s.slot === q.slot);
    ((unseen[slot.category] ||= {})[slot.type] ||= []).push(JSON.parse(JSON.stringify(q)));
  }
  return { unseen };
}
const placed = (laid, slot) => Object.values(laid.examJson.unseen).flatMap((t) => Object.values(t)).flat().filter((q) => q.slot === slot);
const short = (laid, slot) => (laid.shortfall.find((f) => f.slot === slot) || { missing: 0 }).missing;

describe('1. which government does a job', () => {
  test('pages that name a tier but stop short of p.29 still get the rows', () => {
    for (const id of SST.sections.map((s) => s.id)) {
      const text = prompt('social_studies', id, PAGES_30, P30);
      expect(text).toContain(HEAD);
      expect(text).toContain(PROVINCIAL);
    }
  });

  test('the rule says one job per which-government item', () => {
    const text = prompt('social_studies', 'D', FDE, P30);
    expect(text).toContain(ONE_JOB);
  });

  test('no other subject gets the rows from tier words', () => {
    for (const subject of ['maths', 'english', 'science', 'urdu']) {
      for (const s of P[subject].sections) expect(prompt(subject, s.id, PAGES_30, P30)).not.toContain(HEAD);
    }
  });

  test('recorded full_2 D.Q6 (encroachment given to the local government) is held, before and after the re-ask', () => {
    const wrong = REC.full_2_D_Q6[0];
    expect(wrong.answer).toContain('تجاوزات');
    for (const reasked of [false, true]) {
      const laid = applyLayout(paper([...REC.full_1_A_Q1, ...REC.full_2_D_Q6]), SST, FDE, { reasked });
      const d6 = placed(laid, 'social_studies.D.Q6');
      expect(d6.map((q) => q.question)).not.toContain(wrong.question);
      expect(d6).toHaveLength(5);
      expect(short(laid, 'social_studies.D.Q6')).toBe(1);
    }
  });

  test('a key that keeps each job in its own row is placed', () => {
    const right = [
      // The r10 red case, keyed as the book has it.
      { slot: 'social_studies.C.Q5', question: 'دکان داروں نے سڑک پر قبضہ کر کے راستہ بند کر دیا ہے۔ یہ مسئلہ کس حکومت کا ہے؟', answer: 'یہ صوبائی حکومت کا کام ہے کیونکہ عوامی سڑکوں اور راستوں سے تجاوزات ہٹانا صوبائی حکومت کی ذمہ داری ہے۔', scheme: { points: [{ kind: 'K', text: 'صوبائی حکومت', marks: 1 }, { kind: 'U', text: 'تجاوزات ہٹانا صوبائی کام ہے', marks: 2 }] } },
      // Two jobs, each keyed to its own government, and a comparison of all three.
      { slot: 'social_studies.D.Q6', question: 'گلی میں گندا پانی جمع ہے اور ٹھیلوں نے راستہ روک رکھا ہے۔ کس حکومت سے رابطہ کریں؟', answer: 'نکاسی آب مقامی حکومت کا کام ہے۔ تجاوزات ہٹانا صوبائی حکومت کا کام ہے۔ وفاقی حکومت دفاع اور خارجہ پالیسی دیکھتی ہے، صوبائی حکومت امن و امان دیکھتی ہے اور مقامی حکومت مویشی منڈیاں لگاتی ہے۔', scheme: { points: [{ kind: 'K', text: 'نکاسی آب: مقامی حکومت', marks: 3 }, { kind: 'K', text: 'تجاوزات: صوبائی حکومت', marks: 3 }] } },
      // A local job, a pronoun carrying the tier.
      { slot: 'social_studies.D.Q7', question: 'مویشی منڈی کون لگاتا ہے؟', answer: 'مقامی حکومت۔ یہ نکاسی آب کا انتظام بھی دیکھتی ہے۔', scheme: { points: [{ kind: 'K', text: 'مقامی حکومت', marks: 2 }] } },
    ];
    // Each on its own paper: the Q6 item's points hold the whole Q5 item (encroachment → provincial),
    // which round 13 holds as one item asked twice; the tier rule is what is tested here.
    for (const q of right) {
      const laid = applyLayout(paper([q]), SST, FDE, { reasked: false });
      expect(placed(laid, q.slot).map((x) => x.question)).toContain(q.question);
    }
  });

  // Right by p.29, and never held: a contrast opener, a tier named by its short name (صوبہ، وفاق),
  // civil defence and «امن و امان» as a wish are no row's job given to another government.
  test.each([
    'وفاقی حکومت دفاع کرتی ہے۔ اس کے برعکس امن و امان صوبے کا کام ہے۔',
    'صوبائی حکومت صوبے کا نظم چلاتی ہے۔ اس نظام میں وفاق دفاع اور خارجہ پالیسی دیکھتا ہے۔',
    'وفاقی حکومت دفاع اور خارجہ پالیسی دیکھتی ہے جبکہ صوبے داخلی پالیسی خود طے کرتے ہیں۔',
    'مقامی حکومت پانی کا انتظام کرتی ہے۔ ان کاموں سے الگ، صوبہ امن و امان سنبھالتا ہے۔',
    'مقامی حکومت قدرتی آفات کے متاثرین کی مدد کرتی ہے اور شہری دفاع میں مدد دیتی ہے۔',
    'مقامی حکومت صفائی کرتی ہے تاکہ علاقے میں امن و امان رہے۔',
  ])('a right answer is placed: %s', (answer) => {
    const q = { slot: 'social_studies.D.Q7', question: 'حکومتوں کے کام بتائیں۔', answer };
    const laid = applyLayout(paper([q]), SST, FDE, { reasked: true });
    expect(placed(laid, 'social_studies.D.Q7')).toHaveLength(1);
  });

  test('an MCQ keyed on the wrong government for a job in its stem is held; the right key is placed', () => {
    const mcq = (answer) => ({ slot: 'social_studies.A.Q1', question: 'عوامی سڑکوں سے تجاوزات ہٹانا کس حکومت کا کام ہے؟', options: ['(a) وفاقی حکومت', '(b) صوبائی حکومت', '(c) مقامی حکومت', '(d) عدلیہ'], answer });
    const wrong = applyLayout(paper([mcq('(c) مقامی حکومت')]), SST, FDE, { reasked: true });
    expect(placed(wrong, 'social_studies.A.Q1')).toHaveLength(0);
    const right = applyLayout(paper([mcq('(b) صوبائی حکومت')]), SST, FDE, { reasked: true });
    expect(placed(right, 'social_studies.A.Q1')).toHaveLength(1);
  });

  test('another subject\'s item with the same words is not judged', () => {
    const S = P.urdu;
    const slot = S.sections.flatMap((s) => s.slots).find((s) => s.shape !== 'mcq' && !s.parts_spec && s.shape === 'short');
    if (!slot) return;
    const q = { slot: slot.slot, question: 'سوال', answer: 'یہ مقامی حکومت کی ذمہ داری ہے۔ وہ تجاوزات ہٹاتی ہے۔' };
    const laid = applyLayout({ unseen: { [slot.category]: { [slot.type]: [q] } } }, S, FDE, { reasked: true });
    expect(Object.values(laid.examJson.unseen).flatMap((t) => Object.values(t)).flat().map((x) => x.question)).toContain('سوال');
  });
});

describe('2 + 4. the re-ask note', () => {
  const D = SST.sections.find((s) => s.id === 'D');
  const q7 = [
    { slot: 'social_studies.D.Q7', question: 'پاکستان کا سب سے بڑا صحرا کون سا ہے؟', answer: 'تھر' },
    { slot: 'social_studies.D.Q7', question: 'نانگا پربت کس ضلع میں واقع ہے؟', answer: 'دیامیر' },
  ];
  const exam = paper([...REC.full_1_A_Q1.slice(0, 3), ...q7]);

  test('a top-up re-ask names the items the slot keeps and asks for spares', () => {
    const note = takenNote(SST, D, exam, { topUp: true, shortfall: [{ slot: 'social_studies.D.Q7', missing: 6 }] });
    expect(note).toContain('Section A of this paper already asks');
    for (const q of q7) expect(note).toContain(q.question);
    expect(note).toContain('Q7 already keeps these items');
    // Six missing → ten new items asked for.
    expect(note).toContain('write 10 new Q7 items');
  });

  test('a whole re-ask (no top-up) keeps today\'s note', () => {
    const today = takenNote(SST, D, exam);
    expect(takenNote(SST, D, exam, { topUp: false, shortfall: [{ slot: 'social_studies.D.Q7', missing: 6 }] })).toBe(today);
    expect(today).not.toContain('already keeps');
  });

  test('through generatePatternExam: the re-asked Section D names Q7\'s kept items and asks for spares', async () => {
    const replies = {};
    for (const r of fixture('r9b-sst-ch46-replies')) {
      const sec = ['A', 'B', 'C', 'D'].find((s) => r.content.includes(`social_studies.${s}.`));
      (replies[sec] ||= []).push(r.content);
    }
    const asked = [];
    mockCreate.mockReset();
    mockCreate.mockImplementation(async (req) => {
      const text = req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const sec = ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));
      asked.push({ sec, text });
      const content = (replies[sec] || []).length > 1 ? replies[sec].shift() : replies[sec][0];
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    });
    await Gen.generatePatternExam({
      grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027',
      scope: { kind: 'chapters', chapters: [4, 6], pages: '26-33,40-48' }, pageRanges: '26-33,40-48', requestId: 'req-r11',
    });
    const d = asked.filter((a) => a.sec === 'D');
    expect(d).toHaveLength(2);
    expect(d[0].text).not.toContain('already keeps');
    expect(d[1].text).toContain('Q7 already keeps these items');
    expect(d[1].text).toMatch(/write \d+ new Q7 items/);
  });
});

describe('3. one fact once per slot, by its key', () => {
  test('recorded full_1 Q7: K2\'s height asked twice (one with an extra clause) is placed once', () => {
    const k2 = REC.full_1_D_Q7.filter((q) => q.question.includes('کے ٹو'));
    expect(k2).toHaveLength(2);
    const laid = applyLayout(paper([...REC.full_1_A_Q1, ...REC.full_1_D_Q7]), SST, FDE, { reasked: true });
    const q7 = placed(laid, 'social_studies.D.Q7').map((q) => q.question);
    expect(q7.filter((s) => s.includes('کے ٹو'))).toHaveLength(1);
  });

  test('two items about one place with different facts stay two', () => {
    const items = [
      { slot: 'social_studies.D.Q7', question: 'کے ٹو کی اونچائی کتنی ہے؟', answer: '8,611 میٹر' },
      { slot: 'social_studies.D.Q7', question: 'کے ٹو کس پہاڑی سلسلے میں ہے؟', answer: 'قراقرم' },
      { slot: 'social_studies.D.Q7', question: 'پاکستان کا سب سے بڑا صحرا کون سا ہے؟', answer: 'تھر' },
      { slot: 'social_studies.D.Q7', question: 'تھر کا صحرا کس صوبے میں ہے؟', answer: 'سندھ' },
    ];
    const laid = applyLayout(paper(items), SST, FDE, { reasked: true });
    expect(placed(laid, 'social_studies.D.Q7')).toHaveLength(4);
  });
});
