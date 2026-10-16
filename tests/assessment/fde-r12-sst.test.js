/**
 * Round-12 Social Studies (four sandbox papers on the 7S4 head; panel T6):
 *
 *   1. A Q5/Q7 answer that prints a Q1 MCQ whole is held: a Q1 key of a phrase printed in the
 *      answer, or a short key printed with most of what the MCQ asks. The answer is read whole;
 *      today's rule reads it point by point, and a point names a fact without printing it.
 *   2. One question once in every slot, not only the held ones: the re-asked A.Q1 wrote a kept
 *      MCQ again with its options shuffled. A top-up of A is told what Q1 keeps (today it is told
 *      nothing), and a repeat comes back after the re-ask only for a place nothing else takes.
 *   3. A re-asked Section D is told Q5's situations, so Q6/Q7 set other cases.
 *
 * The papers are recorded sandbox content (people in them are the model's own fictional ones);
 * the extra items are fictional.
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
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const PAPERS = ['full_1', 'full_2', 'chapters_1', 'chapters_2'];
const REC = Object.fromEntries(PAPERS.map((p) => [p, fixture(`r12-sst-sandbox-${p}`)]));
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });

const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t)).flat().filter((q) => q && q.slot === slot);
const lay = (exam, opts) => applyLayout(JSON.parse(JSON.stringify(exam)), SST, scopeOf(exam), opts);
const short = (laid, slot) => (laid.shortfall.find((f) => f.slot === slot) || { missing: 0 }).missing;
const C5 = 'social_studies.C.Q5';
const D6 = 'social_studies.D.Q6';
const D7 = 'social_studies.D.Q7';
const A1 = 'social_studies.A.Q1';

// The panel's eight "whole answer printed in Section A" items (3 of 3 or 2 of 3 personas), by
// their printed number in the slot.
const WHOLE = {
  full_1: { [C5]: [2] },
  full_2: { [C5]: [1, 7] },
  chapters_1: { [C5]: [2, 8], [D7]: [2] },
  chapters_2: { [C5]: [3, 6] },
};

describe('1. a Q5/Q7 answer that prints a Q1 MCQ whole is held', () => {
  for (const p of PAPERS) {
    test(`${p}: every whole-answer item the panel named is held before the re-ask`, () => {
      const exam = REC[p];
      const laid = lay(exam, { reasked: false });
      for (const [slot, nos] of Object.entries(WHOLE[p])) {
        const kept = items(laid.examJson, slot).map((q) => q.question);
        for (const n of nos) expect(kept).not.toContain(items(exam, slot)[n - 1].question);
      }
    });
  }

  test('full_2 Q5 ۱ (the burst pipe: tier AND reason are Q1 ۷\'s stem and key) is the one in the brief', () => {
    const q = items(REC.full_2, C5)[0];
    expect(q.answer).toContain('نکاسی آب کا انتظام مقامی حکومت دیکھتی ہے');
    expect(items(lay(REC.full_2, { reasked: false }).examJson, C5).map((x) => x.question)).not.toContain(q.question);
  });

  test('after the one re-ask the held items fill the slot again: no paper comes back short', () => {
    for (const p of PAPERS) {
      const laid = lay(REC[p], { reasked: true });
      expect(laid.shortfall).toEqual([]);
    }
  });

  test('a long answer that names a Q1 key but asks something else is placed', () => {
    const exam = JSON.parse(JSON.stringify(REC.full_2));
    // Q1 ۷ is keyed «مقامی حکومت» on water and drainage; this answer is about a cattle market.
    const q = {
      slot: C5,
      question: 'آپ کے قصبے میں ہر ہفتے مویشی منڈی لگتی ہے مگر وہاں صفائی نہیں ہوتی۔ آپ کس سے بات کریں گے اور کیا تجویز دیں گے؟',
      answer: 'میں مقامی حکومت کے دفتر جا کر منڈی کی صفائی کی درخواست دوں گا اور تجویز دوں گا کہ منڈی کے بعد کوڑا اٹھانے کا وقت مقرر ہو۔',
      scheme: { points: [{ kind: 'A', text: 'درست ادارے کا انتخاب', marks: 1 }, { kind: 'K', text: 'صفائی کی تجویز', marks: 1 }, { kind: 'K', text: 'وقت مقرر کرنا', marks: 1 }] },
    };
    const slot = SST.sections.flatMap((s) => s.slots).find((s) => s.slot === C5);
    exam.unseen[slot.category][slot.type] = [q, ...items(exam, C5).slice(1)];
    expect(items(lay(exam, { reasked: false }).examJson, C5).map((x) => x.question)).toContain(q.question);
  });

  test('a partial FDE\'s own paper prints (Q1\'s key is one point of a longer answer) is placed', () => {
    // FDE's model paper: Q1 «Lines of latitudes are ___ in numbers → 180» beside Q5 «Define lines of
    // latitude. How many are these in numbers?».
    const exam = JSON.parse(JSON.stringify(REC.full_1));
    const a = SST.sections.flatMap((s) => s.slots).find((s) => s.slot === A1);
    const c = SST.sections.flatMap((s) => s.slots).find((s) => s.slot === C5);
    const q1 = exam.unseen[a.category][a.type].find((q) => q.slot === A1);
    Object.assign(q1, { question: 'خطوط عرض بلد کی تعداد کتنی ہے؟', options: ['الف) 90', 'ب) 180', 'ج) 360', 'د) 24'], answer: 'ب) 180' });
    const q = {
      slot: C5,
      question: 'خطوط عرض بلد کی تعریف کریں۔ ان کی تعداد کتنی ہے؟',
      answer: 'خطوط عرض بلد وہ فرضی لکیریں ہیں جو خط استوا کے متوازی مشرق سے مغرب کی طرف کھینچی جاتی ہیں اور فاصلہ ناپنے میں مدد دیتی ہیں۔ ان کی تعداد 180 ہے۔',
      scheme: { points: [{ kind: 'K', text: 'فرضی لکیروں کی تعریف', marks: 1 }, { kind: 'K', text: 'خط استوا کے متوازی', marks: 1 }, { kind: 'K', text: 'تعداد 180', marks: 1 }] },
    };
    exam.unseen[c.category][c.type] = [q, ...items(exam, C5).slice(1)];
    expect(items(lay(exam, { reasked: false }).examJson, C5).map((x) => x.question)).toContain(q.question);
  });
});

describe('2. one question once in every slot', () => {
  test('chapters_2 A.Q1 ۱ = ۲۰ (options shuffled) is placed once before the re-ask: the slot is short by 1', () => {
    const q1 = items(REC.chapters_2, A1);
    expect(q1[0].question).toBe(q1[19].question);
    const laid = lay(REC.chapters_2, { reasked: false });
    const placed = items(laid.examJson, A1).map((q) => q.question);
    expect(placed.filter((s) => s === q1[0].question)).toHaveLength(1);
    expect(short(laid, A1)).toBe(1);
  });

  test('after the re-ask a new item takes the place; the repeat only when nothing else can', () => {
    const exam = JSON.parse(JSON.stringify(REC.chapters_2));
    const slot = SST.sections.flatMap((s) => s.slots).find((s) => s.slot === A1);
    const fresh = { slot: A1, question: 'عدلیہ کا بنیادی کام کیا ہے؟', options: ['الف) قانون بنانا', 'ب) انصاف فراہم کرنا', 'ج) ٹیکس جمع کرنا', 'د) سڑکیں بنانا'], answer: 'ب) انصاف فراہم کرنا' };
    exam.unseen[slot.category][slot.type].push(fresh);
    const withFresh = items(lay(exam, { reasked: true }).examJson, A1).map((q) => q.question);
    expect(withFresh).toContain(fresh.question);
    expect(withFresh.filter((s) => s === items(REC.chapters_2, A1)[0].question)).toHaveLength(1);
    const alone = lay(REC.chapters_2, { reasked: true });
    expect(items(alone.examJson, A1)).toHaveLength(20);
    expect(short(alone, A1)).toBe(0);
  });

  test('a top-up of Section A names every Q1 item it keeps and asks for spares; a whole re-ask is told nothing', () => {
    const A = SST.sections.find((s) => s.id === 'A');
    const kept = lay(REC.chapters_2, { reasked: false }).examJson;
    const note = takenNote(SST, A, kept, { topUp: true, shortfall: [{ slot: A1, missing: 1 }] });
    expect(note).toContain('Q1 already keeps these items');
    for (const q of items(kept, A1)) expect(note).toContain(q.question.trim());
    expect(note).toContain('write 5 new Q1 items');
    expect(note).toContain("each testing a fact that Q1's kept items do not test");
    expect(takenNote(SST, A, kept, { topUp: false, shortfall: [{ slot: A1, missing: 1 }] })).toBeNull();
    expect(takenNote(SST, A, kept)).toBeNull();
  });

  test('a top-up of Section D also names what a short Q6 keeps', () => {
    const D = SST.sections.find((s) => s.id === 'D');
    const kept = lay(REC.chapters_2, { reasked: false }).examJson;
    const note = takenNote(SST, D, kept, { topUp: true, shortfall: [{ slot: D6, missing: 2 }, { slot: D7, missing: 3 }] });
    expect(note).toContain('Q6 already keeps these items');
    expect(note).toContain("each testing a fact that Q6's kept items do not test");
    expect(note).toContain("each testing a fact that neither Section A nor Q7's kept items test");
  });

  test('another subject\'s top-up of a section with no held slot is told nothing, as before', () => {
    for (const key of ['maths', 'science', 'english', 'urdu']) {
      const S = P[key];
      for (const section of S.sections) {
        const slot = section.slots[0].slot;
        const note = takenNote(S, section, { unseen: {} }, { topUp: true, shortfall: [{ slot, missing: 1 }] });
        const today = takenNote(S, section, { unseen: {} });
        expect(note).toBe(today);
      }
    }
  });

  test('through generatePatternExam: Section A one Q1 short is asked again with what Q1 keeps', async () => {
    const replies = {};
    for (const r of fixture('r9b-sst-ch46-replies')) {
      const sec = ['A', 'B', 'C', 'D'].find((s) => r.content.includes(`social_studies.${s}.`));
      (replies[sec] ||= []).push(r.content);
    }
    // The first Section A reply is one Q1 MCQ short; the second is the whole reply.
    const fullA = replies.A[0];
    const tree = JSON.parse(fullA);
    let dropped = null;
    const drop = (o) => {
      if (dropped || !o || typeof o !== 'object') return;
      for (const v of Object.values(o)) {
        if (Array.isArray(v) && v.some((q) => q && q.slot === A1)) { dropped = v.splice(v.findIndex((q) => q && q.slot === A1), 1)[0]; return; }
        drop(v);
      }
    };
    drop(tree);
    expect(dropped).toBeTruthy();
    replies.A = [JSON.stringify(tree), fullA];
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
      scope: { kind: 'chapters', chapters: [4, 6], pages: '26-33,40-48' }, pageRanges: '26-33,40-48', requestId: 'req-r12',
    });
    const a = asked.filter((x) => x.sec === 'A');
    expect(a).toHaveLength(2);
    expect(a[0].text).not.toContain('already keeps');
    expect(a[1].text).toContain('Q1 already keeps these items');
    expect(a[1].text).toContain('write 5 new Q1 items');
    // Section D's re-ask is told Q5's situations.
    const d = asked.filter((x) => x.sec === 'D');
    expect(d.length).toBeGreaterThanOrEqual(2);
    expect(d[0].text).not.toContain('Q5 of this paper already sets these situations');
    expect(d[d.length - 1].text).toContain('Q5 of this paper already sets these situations');
  });
});

describe('3. a re-asked Section D is told Q5\'s situations', () => {
  const D = SST.sections.find((s) => s.id === 'D');
  const C = SST.sections.find((s) => s.id === 'C');

  test('chapters_1: D\'s note lists every Q5 stem the first layout placed (the wallet among them)', () => {
    const kept = lay(REC.chapters_1, { reasked: false }).examJson;
    const note = takenNote(SST, D, kept);
    expect(note).toContain('Q5 of this paper already sets these situations');
    const q5 = items(kept, C5);
    expect(q5.length).toBeGreaterThan(0);
    for (const q of q5) expect(note).toContain(q.question.trim());
    expect(note).toContain('No Q6 or Q7 item you write may reuse a Q5 situation');
  });

  test('Section C\'s own note is unchanged: it is not told Q5', () => {
    const kept = lay(REC.chapters_1, { reasked: false }).examJson;
    expect(takenNote(SST, C, kept)).not.toContain('already sets these situations');
  });

  test('a paper with no Q5 placed gives D today\'s note', () => {
    const kept = lay(REC.chapters_1, { reasked: false }).examJson;
    for (const t of Object.values(kept.unseen)) for (const [k, l] of Object.entries(t)) t[k] = l.filter((q) => q.slot !== C5);
    expect(takenNote(SST, D, kept)).not.toContain('already sets these situations');
  });
});
