/**
 * Round-14 Social Studies (panel T6-A and T6 (E) on four sandbox papers):
 *
 *   1. Section D is written after Section C's first reply, and its first prompt carries C's Q5
 *      questions with their marking points. Every contained C/D pair on the four papers was a
 *      FIRST-reply Q6 (D was written beside C, from the same pages), so a hold alone re-asks D on
 *      most papers. Red: chapters_1 Q5 ۳ (a purse found on the road) and Q6 ۲ (a wallet).
 *   2. Two Q7 ← Q1 holes in the Section A hold: «سینٹ» / «سینیٹ» spelt two ways (chapters_2 Q7 ۱
 *      = Q1 ۱۹, key 104), and a fact carried by an MCQ's stem (chapters_1 Q1 ۱۲ «ایدھی فاؤنڈیشن نے …»
 *      with its key, Q7 ۲ «… کون سی فلاحی تنظیم قائم کی؟»).
 *   3. One thinking level per choice group, as FDE's own paper has it: Q5 Understand, Q6 Apply,
 *      Q7 Remember. A book-recall item among situations put 8 of 12 groups at E 1.
 *   4. Section A's keys never run in a strict period (chapters_1: الف ب ج د five times over).
 *
 * The papers are recorded sandbox content (people in them are the model's own fictional ones).
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
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const ALL = Patterns.get('fde_g5_2027').subjects;
const SST = ALL.social_studies;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const PAPERS = ['chapters_1', 'chapters_2', 'full_1', 'full_2'];
const paper = (p) => fixture(`r14-sst-sandbox-${p}`);
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t)).flat().filter((q) => q && q.slot === slot);
const lay = (exam, opts) => applyLayout(JSON.parse(JSON.stringify(exam)), SST, scopeOf(exam), opts);
const A1 = 'social_studies.A.Q1';
const C5 = 'social_studies.C.Q5';
const D6 = 'social_studies.D.Q6';
const D7 = 'social_studies.D.Q7';

// One section's reply as the model writes it: unseen → category → type → [items].
function replyOf(exam, sectionId, P = SST) {
  const tree = { unseen: {} };
  for (const slot of P.sections.find((s) => s.id === sectionId).slots) {
    const list = items(exam, slot.slot).map((q) => ({ ...q }));
    ((tree.unseen[slot.category] ||= {})[slot.type] ||= []).push(...list);
  }
  return JSON.stringify(tree);
}
const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));

describe('1. Section D is written after Section C, told C\'s Q5 questions and points', () => {
  const CH1 = paper('chapters_1');
  const PURSE = items(CH1, C5)[2];

  async function run(exam) {
    const replies = Object.fromEntries(['A', 'B', 'C', 'D'].map((s) => [s, replyOf(exam, s)]));
    const events = [];
    mockCreate.mockReset();
    mockCreate.mockImplementation(async (req) => {
      const text = req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const sec = sectionOf(text);
      events.push({ at: 'asked', sec, text });
      // C answers last of the first three: a D written beside it would be asked before it answered.
      await new Promise((r) => setTimeout(r, sec === 'C' ? 30 : 5));
      events.push({ at: 'answered', sec });
      return { choices: [{ message: { content: replies[sec] }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    });
    await Gen.generatePatternExam({
      grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027',
      scope: scopeOf(exam), pageRanges: exam._layout.scope.pages || '1-20', requestId: 'req-r14',
    }).catch(() => null);
    return events;
  }

  test('the fixture is the pair the panel named', () => {
    expect(PURSE.question).toContain('بٹوہ');
    expect(items(CH1, D6)[1].question).toContain('بٹوہ');
  });

  test('D\'s FIRST ask goes only after C\'s first reply has answered; A and B still go beside C', async () => {
    const events = await run(CH1);
    const firstD = events.findIndex((e) => e.at === 'asked' && e.sec === 'D');
    const cAnswered = events.findIndex((e) => e.at === 'answered' && e.sec === 'C');
    expect(firstD).toBeGreaterThan(-1);
    expect(firstD).toBeGreaterThan(cAnswered);
    for (const s of ['A', 'B']) {
      expect(events.findIndex((e) => e.at === 'asked' && e.sec === s)).toBeLessThan(cAnswered);
    }
  });

  test('D\'s first prompt lists C\'s Q5 questions with their marking points', async () => {
    const events = await run(CH1);
    const dFirst = events.find((e) => e.at === 'asked' && e.sec === 'D').text;
    expect(dFirst).toContain('A child who answers these has already answered them');
    for (const q of items(CH1, C5)) expect(dFirst).toContain(q.question.trim());
    for (const p of PURSE.scheme.points) expect(dFirst).toContain(p.text.trim());
  });

  test('every other subject still writes its sections side by side', async () => {
    for (const subject of ['science', 'english', 'maths', 'urdu']) {
      const P = ALL[subject];
      mockCreate.mockReset();
      const events = [];
      mockCreate.mockImplementation(async () => {
        events.push('asked');
        await new Promise((r) => setTimeout(r, 5));
        events.push('answered');
        return { choices: [{ message: { content: '{"unseen":{}}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
      });
      await Gen.generatePatternExam({ grade: 5, subject, pattern: 'fde_g5_2027', scope: { kind: 'pages', chapters: null, pages: '10-20' }, pageRanges: '10-20' }).catch(() => null);
      // Every section's first ask is out before the first answer comes back.
      expect(events.indexOf('answered')).toBe(P.sections.length);
    }
  });
});

describe('2. Q7 ← Q1: a spelling fold, and a fact carried by the MCQ\'s stem', () => {
  test('chapters_2 Q7 ۱ «سینٹ» = Q1 ۱۹ «سینیٹ … → 104» is held before the re-ask', () => {
    const CH2 = paper('chapters_2');
    const senate = items(CH2, D7)[0];
    expect(senate.question).toContain('سینٹ');
    expect(items(CH2, A1)[18].question).toContain('سینیٹ');
    expect(items(lay(CH2, { reasked: false }).examJson, D7).map((q) => q.question)).not.toContain(senate.question);
  });

  test('chapters_1 Q7 ۲ (Edhi\'s organisation) ← Q1 ۱۲\'s stem and key is held before the re-ask', () => {
    const CH1 = paper('chapters_1');
    const edhi = items(CH1, D7)[1];
    expect(items(CH1, A1)[11].question).toContain('ایدھی فاؤنڈیشن');
    expect(items(lay(CH1, { reasked: false }).examJson, D7).map((q) => q.question)).not.toContain(edhi.question);
  });

  test('the fold and the stem reading hold nothing else on the four papers', () => {
    // Every Q5 and Q7 item the four papers printed, laid out again: only the two pairs above are held.
    const held = [];
    for (const p of PAPERS) {
      const exam = paper(p);
      const laid = lay(exam, { reasked: false }).examJson;
      for (const slot of [C5, D7]) {
        const kept = new Set(items(laid, slot).map((q) => q.question));
        held.push(...items(exam, slot).filter((q) => !kept.has(q.question)).map((q) => `${p} ${q.question}`));
      }
    }
    expect(held).toEqual([
      'chapters_1 عبدالستار ایدھی نے کون سی فلاحی تنظیم قائم کی؟',
      'chapters_2 پاکستان میں سینٹ کے ارکان کی تعداد کتنی ہے؟',
      // Round 15: a one-fact Q7 that Q6 ۳'s model answer states («1864ء میں سائنٹیفک سوسائٹی قائم کی»).
      'chapters_2 سرسید احمد خان نے 1864ء میں کون سا ادارہ قائم کیا؟',
      // The two-Q1 rule: Q1 ۱۴ prints the five-hour rule and its words cover 0.67 of this Q5's answer.
      // The child still works the time out, so it is a partial: the rule's one false hold on the
      // recorded papers, which costs a spare, never a wrong paper.
      'full_2 لاہور میں گرینچ کے وقت سے 5 گھنٹے کا فرق ہے۔ اگر وہاں صبح کے 6 بجے ہیں تو لاہور میں کیا وقت ہوگا اور کیوں؟',
    ]);
  });
});

describe('3. one thinking level per choice group (Q5 Understand, Q6 Apply, Q7 Remember)', () => {
  const prompt = (subject, id, scope) => {
    const S = ALL[subject];
    const section = S.sections.find((s) => s.id === id);
    return Gen.buildPatternUserPrompt({ grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20', section, slots: section.slots, lang: S.medium, P: S, scope });
  };
  const SCOPES = [{ kind: 'fde', chapters: null, pages: null }, { kind: 'chapters', chapters: [1, 2], pages: null }, { kind: 'pages', chapters: null, pages: '26-33' }];

  test('C asks Q5 for Understand items only; D asks Q6 for Apply situations and Q7 for Remember facts', () => {
    for (const scope of SCOPES) {
      const c = prompt('social_studies', 'C', scope);
      const d = prompt('social_studies', 'D', scope);
      expect(c).toMatch(/Every Q5 item is Understand/);
      expect(d).toMatch(/Every Q6 item is Apply/);
      expect(d).toMatch(/Every Q7 item is Remember/);
      expect(c).not.toMatch(/Every Q6 item|Every Q7 item/);
      expect(d).not.toMatch(/Every Q5 item/);
      // The mixed rules that put a recall item among situations are gone.
      for (const t of [c, d]) {
        expect(t).not.toContain('the rest may explain or compare book facts');
        expect(t).not.toContain('Q5 and Q6 are situations');
      }
    }
  });

  test('no other subject and no other SST section carries a band line', () => {
    for (const subject of Object.keys(ALL)) {
      for (const s of ALL[subject].sections) {
        if (subject === 'social_studies' && (s.id === 'C' || s.id === 'D')) continue;
        expect(prompt(subject, s.id, SCOPES[1])).not.toMatch(/Every Q[567] item is/);
      }
    }
  });
});

describe('5. a D left whole by C\'s re-ask is kept, not written again', () => {
  // chapters_1: Q6 ۲ (a wallet) restates Q5 ۳ (a purse) and Q6 ۴ (water-shortage news) restates
  // Q5 ۴ (cleanliness-drive news), so D is short before the re-ask. C's first reply carries a
  // review mark, so C is asked again whole, and its second reply sets two other cases in place of
  // the purse and the drive: once C has answered, nothing in D restates a Q5 and D is whole.
  const CH1 = paper('chapters_1');
  const withItems = (json, slot, list) => {
    const tree = JSON.parse(json);
    for (const types of Object.values(tree.unseen)) for (const [t, l] of Object.entries(types)) {
      if (l.some((q) => q.slot === slot)) types[t] = [...l.filter((q) => q.slot !== slot), ...list];
    }
    return JSON.stringify(tree);
  };
  const point = (text, marks) => ({ kind: 'K', text, marks });
  const FRESH_Q5 = [
    { slot: C5, question: 'پاکستان کے میدانی علاقوں میں زراعت کیوں زیادہ ہوتی ہے؟ دو وجوہات لکھیں۔', answer: 'میدانی علاقوں کی زمین زرخیز اور ہموار ہے اور دریاؤں سے پانی ملتا ہے۔', scheme: { points: [point('زرخیز اور ہموار زمین', 2), point('دریاؤں سے آب پاشی', 1)] } },
    { slot: C5, question: 'شمالی پہاڑی علاقوں میں سردیوں میں برف کیوں پڑتی ہے؟ دو وجوہات لکھیں۔', answer: 'یہ علاقے بہت بلند ہیں جہاں درجۂ حرارت نقطۂ انجماد سے نیچے چلا جاتا ہے اور سرد ہوائیں چلتی ہیں۔', scheme: { points: [point('بلندی پر درجۂ حرارت نقطۂ انجماد سے نیچے', 2), point('سرد ہوائیں', 1)] } },
  ];
  const NEUTRAL_Q7 = { slot: D7, question: 'پاکستان کا قومی پھول کون سا ہے؟', answer: 'چنبیلی', scheme: { points: [point('چنبیلی', 2)] } };

  test('D is asked once: C\'s re-ask removed the only Q5s its Q6s restated', async () => {
    const q5 = items(CH1, C5);
    const replies = {
      A: [replyOf(CH1, 'A')],
      B: [replyOf(CH1, 'B')],
      // First reply: a review mark the paper must never print (built here, never a literal in the
      // source). Second: the purse and the drive replaced by two other cases.
      C: [withItems(replyOf(CH1, 'C'), C5, q5.map((q, i) => (i === 0 ? { ...q, scheme: { ...q.scheme, common_error: `${'needs'} ${'review'}` } } : q))),
        withItems(replyOf(CH1, 'C'), C5, [...q5.filter((_, i) => i !== 2 && i !== 3), ...FRESH_Q5])],
      // D as printed, with the Q7 Section A gives away (Edhi's organisation) swapped for another fact.
      D: [withItems(replyOf(CH1, 'D'), D7, items(CH1, D7).map((q, i) => (i === 1 ? NEUTRAL_Q7 : q)))],
    };
    const asked = [];
    mockCreate.mockReset();
    mockCreate.mockImplementation(async (req) => {
      const text = req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const sec = sectionOf(text);
      asked.push(sec);
      const content = replies[sec].length > 1 ? replies[sec].shift() : replies[sec][0];
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    });
    await Gen.generatePatternExam({
      grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027',
      scope: scopeOf(CH1), pageRanges: '1-20', requestId: 'req-r14-whole-d',
    }).catch(() => null);
    expect(asked.filter((s) => s === 'C')).toHaveLength(2);
    expect(asked.filter((s) => s === 'D')).toHaveLength(1);
  });
});

describe('4. Section A\'s keys never run in a strict period', () => {
  const letters = (exam) => items(exam, A1).map((q) => String(q.answer).trim().split(/[)\s]/)[0]);
  const periodic = (seq) => [2, 3, 4].some((p) => seq.length >= 2 * p && seq.every((x, i) => i < p || x === seq[i - p]));

  test('chapters_1: الف ب ج د ×5 as recorded, and the layout breaks the period', () => {
    const CH1 = paper('chapters_1');
    expect(periodic(letters(CH1))).toBe(true);
    const laid = lay(CH1, { reasked: true }).examJson;
    expect(periodic(letters(laid))).toBe(false);
  });

  test('every MCQ still keys the same option text, and no letter holds more than 6 of 20', () => {
    const CH1 = paper('chapters_1');
    const keyText = (q) => {
      const at = ['الف', 'ب', 'ج', 'د'].indexOf(String(q.answer).trim().split(/[)\s]/)[0]);
      return String(q.options[at]).replace(/^\s*\(?(?:الف|ب|ج|د)\)\s*/, '');
    };
    const before = new Map(items(CH1, A1).map((q) => [q.question, keyText(q)]));
    const after = items(lay(CH1, { reasked: true }).examJson, A1);
    for (const q of after) expect(keyText(q)).toBe(before.get(q.question));
    const counts = {};
    for (const l of letters({ unseen: { x: { y: after } } })) counts[l] = (counts[l] || 0) + 1;
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(6);
  });

  test('a paper whose keys have no period is left as it is', () => {
    const FULL1 = paper('full_1');
    expect(periodic(letters(FULL1))).toBe(false);
    // Read against the items that print: a Q1 item a C/D stem gives away is held, the rest keep their order.
    const laid = lay(FULL1, { reasked: true });
    const gone = new Set(laid.held.filter((h) => h.slot === A1).map((h) => h.q.question));
    const kept = { unseen: { x: { y: items(FULL1, A1).filter((q) => !gone.has(q.question)) } } };
    expect(letters(laid.examJson)).toEqual(letters(kept));
  });

  test('another subject\'s periodic keys are broken too (bd-5jmnfj.4.50.7), each item keeping its key text', () => {
    const CH1 = paper('chapters_1');
    // The same twenty MCQs laid as an Urdu paper's Q1 keep their order and the option text they key.
    // The Urdu layout's own holds may leave some out; the ones it prints are dealt like Social Studies.
    const U = ALL.urdu;
    const q1 = U.sections.flatMap((s) => s.slots).find((s) => s.shape === 'mcq');
    const input = items(CH1, A1).map((q) => ({ ...q, slot: q1.slot }));
    const exam = { unseen: { [q1.category]: { [q1.type]: input.map((q) => ({ ...q })) } } };
    const laid = applyLayout(exam, U, { kind: 'chapters', chapters: [4, 5], pages: null }, { reasked: true }).examJson;
    const got = items(laid, q1.slot);
    expect(got.length).toBeGreaterThan(0);
    const at = got.map((q) => input.findIndex((x) => x.question === q.question));
    expect(at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1]))).toBe(true);
    const keyed = (q) => q.options[['الف', 'ب', 'ج', 'د'].indexOf(String(q.answer).trim().split(/[)\s]/)[0])].replace(/^\s*\(?(?:الف|ب|ج|د)\)\s*/, '');
    expect(got.map(keyed)).toEqual(at.map((i) => keyed(input[i])));
    expect(periodic(got.map((q) => String(q.answer).trim().split(/[)\s]/)[0]))).toBe(false);
  });
});
