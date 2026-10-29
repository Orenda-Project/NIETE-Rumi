/**
 * Urdu board-pattern papers: the Section A give-aways a fourth local run printed, each on its own
 * recorded paper.
 *
 * (a) A spelling item that prints its key inside a longer quote: «جس چیز سے … یعنی گرم مصالحہ» کا
 *     درست املا کون سا ہے؟ → مصالحہ.
 * (b) The meaning in the stem and the idiom as the key, which Q5 asks the child to use: «بہت زیادہ
 *     غصے میں آ جانا» → آگ بگولا ہونا (Q5 «آگ بگولا ہونا»); «… بہت شرمندہ …» → شرم سے پانی پانی ہونا
 *     (Q5 «پانی پانی ہونا»).
 * (c) A quoted word list that prints another item's key: «کمبل، آتش دان، مونگ پھلی، ریوڑیاں» … →
 *     سردی beside «… کون سا لفظ شامل نہیں ہو سکتا؟ → آتش دان».
 * (d) The Section A prompt asks each grammar concept once, and none that Q4 asks.
 * (e) A Section A still short after its top-up is topped up once more, with spares sized to what it
 *     is missing; a held item that comes back is one held inside Q1, never one held against
 *     Section C (chapters_3 Q1 ۲۰ «… پانی صاف ہوگا تو انسان کس چیز سے بچیں گے؟ → بیماری سے»
 *     under the Q6 verse «پانی جو صاف ہوگا بیماری سے بچوگے»).
 *
 * The recorded papers are local replies (content only).
 */

const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
// The book store holds lesson 7's poem (the verses the recorded Q6 prints) for any range asked.
const mockPages = ['=== Page 63 ===', 'سبق ۷', 'ندی کی فریاد', 'شاعر: کوثر صدیقی',
  'پاکیزہ مجھ کو کر دو کرکے مری صفائی', 'میرا بھی فائدہ ہے انساں کی بھی بھلائی',
  'تم مجھ کو صاف رکھ کے خود بھی سکھی رہوگے', 'پانی جو صاف ہوگا بیماری سے بچوگے'].join('\n\n');
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: mockPages, pageReference: String(pageRanges) }),
  loadChapterContent: async () => ({ content: mockPages, pageReference: '63' }),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, takenNote } = require('../../bot/shared/services/assessment/fde-layout');
const { logToFile } = require('../../bot/shared/utils/logger');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `r16-urdu-local-${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const sectionA = U.sections.find((s) => s.slots.some((x) => x.slot === 'urdu.A.Q1'));
const sectionC = U.sections.find((s) => s.slots.some((x) => x.slot === 'urdu.C.Q4'));

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1Stems = (exam) => items(exam, 'urdu.A.Q1').map((q) => q.question);
const lay = (paper, reasked) => applyLayout(clone({ unseen: paper.unseen }), U, paper._scope, { reasked });
const recorded = (paper, re) => items(paper, 'urdu.A.Q1').find((q) => re.test(q.question));

describe('(a) a spelling item whose stem prints its key anywhere is held', () => {
  const full2 = read('full2');
  const spelling = recorded(full2, /یعنی گرم مصالحہ/);

  test('the recorded item is on the paper as given', () => {
    expect(spelling.answer).toBe('ب) مصالحہ');
  });

  test('full_2 Q1 ۱۶ «… یعنی گرم مصالحہ» کا درست املا → مصالحہ does not print, before or after the re-ask', () => {
    expect(q1Stems(lay(full2, false).examJson)).not.toContain(spelling.question);
    expect(q1Stems(lay(full2, true).examJson)).not.toContain(spelling.question);
  });

  test('a spelling item that quotes a meaning, not its key, stays', () => {
    const exam = clone({ unseen: full2.unseen, _scope: full2._scope });
    const q = items(exam, 'urdu.A.Q1').find((x) => x.question === spelling.question);
    q.question = '«جس چیز سے کھانے کو مزہ اور خوشبو ملتی ہے» اس کا درست املا کون سا ہے؟';
    expect(q1Stems(lay(exam, false).examJson)).toContain(q.question);
  });
});

describe('(b) a Q1 key that is, or holds, a Q5 idiom is held', () => {
  const full2 = read('full2');
  const angry = recorded(full2, /بہت زیادہ غصے میں آ جانا/);
  const ashamed = recorded(full2, /بہت شرمندہ ہو جائے/);

  test('the recorded items and Q5 words are on the paper as given', () => {
    expect(angry.answer).toBe('ب) آگ بگولا ہونا');
    expect(ashamed.answer).toBe('د) شرم سے پانی پانی ہونا');
    const q5 = items(full2, 'urdu.C.Q5')[0].words;
    expect(q5).toEqual(expect.arrayContaining(['آگ بگولا ہونا', 'پانی پانی ہونا']));
  });

  test('full_2 Q1 ۱۵ (→ آگ بگولا ہونا) and ۱۴ (→ شرم سے پانی پانی ہونا) do not print, before or after the re-ask', () => {
    for (const reasked of [false, true]) {
      const stems = q1Stems(lay(full2, reasked).examJson);
      expect(stems).not.toContain(angry.question);
      expect(stems).not.toContain(ashamed.question);
    }
  });

  test('a one-word key inside a Q5 idiom stays («پانی» beside «پانی پانی ہونا»)', () => {
    const exam = clone({ unseen: full2.unseen, _scope: full2._scope });
    const q = items(exam, 'urdu.A.Q1').find((x) => x.question === ashamed.question);
    q.question = 'ندی کس چیز سے بنتی ہے؟';
    q.options = ['الف) ریت', 'ب) پانی', 'ج) پتھر', 'د) ہوا'];
    q.answer = 'ب) پانی';
    expect(q1Stems(lay(exam, false).examJson)).toContain(q.question);
  });
});

describe('(c) a quoted word list that prints another item\'s key gives it away', () => {
  const ch3 = read('chapters3');
  const list = recorded(ch3, /^«کمبل، آتش دان/);
  const asks = recorded(ch3, /کون سا لفظ شامل نہیں ہو سکتا/);

  test('the recorded pair is on the paper as given', () => {
    expect(asks.answer).toBe('د) آتش دان');
    expect(list.answer).toBe('د) سردی');
  });

  test('chapters_3 Q1 ۱۱ «کمبل، آتش دان، …» and ۱۲ (→ آتش دان) do not both print', () => {
    for (const reasked of [false, true]) {
      const stems = q1Stems(lay(ch3, reasked).examJson);
      expect(stems.includes(list.question) && stems.includes(asks.question)).toBe(false);
    }
  });

  test('a quoted example sentence still names the kind it asks about («… تمنائی جملہ»)', () => {
    const exam = clone({ unseen: ch3.unseen, _scope: ch3._scope });
    const q1 = items(exam, 'urdu.A.Q1');
    q1[0].question = '«کاش میں بھی پرندہ ہوتا» یہ کس قسم کا جملہ ہے؟';
    q1[0].options = ['الف) تمنائی جملہ', 'ب) شکیہ جملہ', 'ج) سوالیہ جملہ', 'د) شرطیہ جملہ'];
    q1[0].answer = 'الف) تمنائی جملہ';
    q1[1].question = 'کون سا لفظ تمنائی جملے میں استعمال ہوتا ہے؟';
    q1[1].options = ['الف) کاش', 'ب) شاید', 'ج) اگر', 'د) تو'];
    q1[1].answer = 'الف) کاش';
    // تمنائی is lesson 5's grammar: on this lessons 6–7 paper the item is held for scope, so the point
    // is read on lessons 4–5.
    expect(q1Stems(lay(exam, false).examJson)).not.toContain(q1[0].question);
    const stems = q1Stems(lay({ ...exam, _scope: { kind: 'chapters', chapters: [4, 5], pages: null } }, false).examJson);
    expect(stems).toContain(q1[0].question);
  });
});

describe('(d) the Urdu Section A prompt asks each grammar concept once, and none Q4 asks', () => {
  const prompt = (section) => Gen.buildPatternUserPrompt({
    grade: 5, subject: 'urdu', pageContent: mockPages, pageReference: '50-70', section, slots: section.slots,
    lang: U.medium, P: U, scope: { kind: 'chapters', chapters: [6, 7], pages: '50-60, 61-70' }, poem: null,
  });

  // On chosen lessons the line names those lessons' concepts only (lessons 6–7: متشابہ الفاظ); the
  // full syllabus keeps its list.
  test('Section A carries the line', () => {
    const a = prompt(sectionA);
    expect(a).toContain('Q1 asks each grammar concept of these lessons (متشابہ الفاظ) in one item only');
    expect(a).toMatch(/Q4 on this paper asks گروہی الفاظ, حروفِ شرط و جزا, a present-to-future tense change and ارکان سازی; no Q1 item asks any of these/);
    const full = Gen.buildPatternUserPrompt({
      grade: 5, subject: 'urdu', pageContent: mockPages, pageReference: '28-107', section: sectionA, slots: sectionA.slots,
      lang: U.medium, P: U, scope: { kind: 'fde', chapters: null, pages: null }, poem: null,
    });
    expect(full).toContain('Q1 asks each grammar concept (شکیہ، تمنائی، شرط و جزا، حرفِ عطف, and so on) in one item only');
    expect(full).toMatch(/Q4 on this paper asks گروہی الفاظ, حروفِ شرط و جزا, a present-to-future tense change and ارکان سازی; no Q1 item asks any of these/);
  });

  test('Section C does not', () => {
    expect(prompt(sectionC)).not.toContain('in one item only');
  });
});

describe('(e) the put-back: spares sized to the gap, one more A-only top-up, and never a Section C hold', () => {
  const ch3 = read('chapters3');
  const verse = recorded(ch3, /پانی صاف ہوگا تو انسان کس چیز سے بچیں گے/);

  test('the top-up asks for max(2, ⌈missing / 2⌉) spares', () => {
    const exam = clone({ unseen: ch3.unseen });
    const note = (missing) => takenNote(U, sectionA, exam, { topUp: true, shortfall: [{ slot: 'urdu.A.Q1', missing }] });
    expect(note(7)).toMatch(/Q1 needs 7 more\. Write 11 new items/);
    expect(note(3)).toMatch(/Q1 needs 3 more\. Write 5 new items/);
    expect(note(1)).toMatch(/Q1 needs 1 more\. Write 3 new items/);
  });

  test('chapters_3: the Q6-verse item ۲۰ held on the first layout is not put back after the re-ask', () => {
    expect(q1Stems(lay(ch3, false).examJson)).not.toContain(verse.question);
    const after = lay(ch3, true);
    expect(q1Stems(after.examJson)).not.toContain(verse.question);
    expect(after.shortfall.map((f) => f.slot)).toContain("urdu.A.Q1");
  });

  test('an item held inside Q1 (a stem that asks two questions) is put back for a place nothing else takes', () => {
    const exam = clone({ unseen: ch3.unseen, _scope: ch3._scope });
    const q = items(exam, 'urdu.A.Q1').find((x) => x.question === verse.question);
    q.question = 'ندی کس بات کی فریاد کرتی ہے؟ وہ کس سے بات کرتی ہے؟';
    q.options = ['الف) صفائی کی', 'ب) کھانے کی', 'ج) کھیل کی', 'د) سفر کی'];
    q.answer = 'الف) صفائی کی';
    expect(q1Stems(lay(exam, false).examJson)).not.toContain(q.question);
    const before = lay(exam, false);
    const after = lay(exam, true);
    expect(q1Stems(after.examJson)).toContain(q.question);
    expect(q1Stems(after.examJson)).toHaveLength(q1Stems(before.examJson).length + 1);
    // Q1's put-back only (this recorded paper's Q4 ارکان item, whose key and accept split a word
    // apart, is put back for its own place too).
    expect(after.putBack.filter((x) => x.slot === 'urdu.A.Q1')).toEqual([{ slot: 'urdu.A.Q1', rule: 'asks_two' }]);
  });

  test('a two-question stem that is also held against Section C never comes back', () => {
    const full2 = read('full2');
    const exam = clone({ unseen: full2.unseen, _scope: full2._scope });
    const q = items(exam, 'urdu.A.Q1').find((x) => /بہت زیادہ غصے میں آ جانا/.test(x.question));
    q.question = '«بہت زیادہ غصے میں آ جانا» کے لیے کون سا محاورہ درست ہے؟ اس کا مطلب کیا ہے؟';
    const after = lay(exam, true);
    expect(q1Stems(after.examJson)).not.toContain(q.question);
    // Q1's put-back only (this recorded paper's Q4 ارکان item, keyed «کر – کَ – را» and accepting
    // «کر – کرا», is put back for its own place).
    expect((after.putBack || []).filter((x) => x.slot === 'urdu.A.Q1')).toEqual([]);
  });

  test('a spelling item keyed on a function word in its stem\'s own frame stays («درج ذیل میں سے …» → میں)', () => {
    const full2 = read('full2');
    const exam = clone({ unseen: full2.unseen, _scope: full2._scope });
    const q = items(exam, 'urdu.A.Q1').find((x) => /یعنی گرم مصالحہ/.test(x.question));
    q.question = 'درج ذیل میں سے کس لفظ کا املا درست ہے؟';
    q.options = ['الف) مے', 'ب) میں', 'ج) مئیں', 'د) میںن'];
    q.answer = 'ب) میں';
    expect(q1Stems(lay(exam, false).examJson)).toContain(q.question);
  });

  describe('through generatePatternExam, with chapters_3\'s replies as recorded', () => {
    const rec = read('ch3-replies');
    beforeEach(() => { mockCreate.mockReset(); logToFile.mockClear(); });
    const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    const SPARES = [['سچ', 'جھوٹ'], ['امیر', 'غریب'], ['دن', 'رات'], ['اونچا', 'نیچا']].map(([w, k]) => ({
      slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `لفظ «${w}» کا متضاد کون سا ہے؟`,
      options: [`الف) ${k}`, 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: `الف) ${k}`, marks: 1,
    }));
    // The first A reply and the recorded top-up (nine items, three of them twins of kept facts);
    // any later A call writes only spares, as many as its note asks for.
    function serve() {
      const asked = [];
      mockCreate.mockImplementation(async (req) => {
        const prompt = textOf(req);
        const sec = ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
        asked.push({ sec, prompt });
        const nA = asked.filter((a) => a.sec === 'A').length;
        let content = rec.replies[sec === 'A' ? 'A1' : sec];
        if (sec === 'A' && nA === 2) content = rec.replies.A2;
        // Q4's «… متعلق ہیں: سورج، کرنیں، دھوپ، روشنی» → سورج is held (the key is the one option its
        // list prints); a later C call writes that item with the group named in the stem.
        if (sec === 'C' && asked.filter((a) => a.sec === 'C').length > 1) {
          content = content.replace('گروہی الفاظ میں سے وہ لفظ چنیں جس سے یہ سب الفاظ متعلق ہیں: سورج، کرنیں، دھوپ، روشنی', '«کرنیں، دھوپ، روشنی، گرمی» یہ گروہی الفاظ کس لفظ سے متعلق ہیں؟');
        }
        if (sec === 'A' && nA > 2) {
          const m = prompt.match(/Write (\d+) new items/);
          content = JSON.stringify({ unseen: { objective: { MCQs: clone(SPARES).slice(0, m ? Number(m[1]) : 0) } } });
        }
        return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
      });
      return asked;
    }

    test('the top-up asks for 8 + 4; one more A-only top-up fills the last place; ۲۰ never prints; Q1 is whole', async () => {
      const asked = serve();
      const out = await Gen.generatePatternExam({
        grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: rec.scope, pageRanges: rec.scope.pages, requestId: 'req-r16',
      }).then((r) => ({ ok: r }), (err) => ({ err }));
      expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
      const q1 = q1Stems(out.ok.examJson);
      expect(q1).toHaveLength(20);
      expect(q1).not.toContain(verse.question);
      const a = asked.filter((x) => x.sec === 'A');
      expect(a).toHaveLength(3);
      // The first reply holds 8: the Q6-verse item, six Q3/Q5 meaning items and «آتش دان» (c).
      expect(a[1].prompt).toMatch(/Q1 needs 8 more\. Write 12 new items/);
      expect(a[2].prompt).toMatch(/Q1 needs \d+ more\. Write \d+ new items/);
      // B once; C twice: its Q4 «… سورج» item is held and Section C is asked once more for it.
      expect(asked.filter((x) => x.sec !== 'A')).toHaveLength(3);
      expect(logToFile.mock.calls.some(([msg, data]) => msg === '[assessment] section topped up again' && data.section === 'A')).toBe(true);
    });
  });
});
