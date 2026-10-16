/**
 * Round-13 Social Studies (panel T6-A (iii): no two C/D items answerable with the same point set):
 *
 *   1. A D.Q6 item whose marking points contain a C.Q5 item's points is held: a Q5 point is in
 *      the Q6 item when at least half of its words are in one Q6 point, and the Q6 item contains
 *      the Q5 item when at least half of the Q5 points are in it. The Q6 item is the one held
 *      (and re-asked); the Q5 item stays. Red: chapters_1 Q5 ۳ (a purse) ↔ Q6 ۲ (a wallet).
 *   2. When Sections C and D are both asked again, D is asked after C, and its note lists the
 *      Q5 items C's second reply left on the paper, not the first layout's.
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
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const SST = Patterns.get('fde_g5_2027').subjects.social_studies;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const CH1 = fixture('r12-sst-sandbox-chapters_1');
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t)).flat().filter((q) => q && q.slot === slot);
const lay = (exam, opts) => applyLayout(JSON.parse(JSON.stringify(exam)), SST, scopeOf(exam), opts);
const short = (laid, slot) => (laid.shortfall.find((f) => f.slot === slot) || { missing: 0 }).missing;
const slotOf = (id) => SST.sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const C5 = 'social_studies.C.Q5';
const D6 = 'social_studies.D.Q6';

const PURSE = items(CH1, C5)[2];
const WALLET = items(CH1, D6)[1];

describe('1. a Q6 item that contains a Q5 item\'s points is held', () => {
  test('the fixture is the pair the panel named', () => {
    expect(PURSE.question).toContain('پرس');
    expect(WALLET.question).toContain('بٹوہ');
  });

  test('chapters_1: the wallet Q6 is held before the re-ask, and the purse Q5 stays', () => {
    const laid = lay(CH1, { reasked: false });
    expect(items(laid.examJson, D6).map((q) => q.question)).not.toContain(WALLET.question);
    expect(items(laid.examJson, C5).map((q) => q.question)).toContain(PURSE.question);
    expect(short(laid, D6)).toBeGreaterThanOrEqual(1);
  });

  test('a Q6 item on another duty (peace and harmony, Q6 ۶) is placed', () => {
    const peace = items(CH1, D6)[5];
    expect(items(lay(CH1, { reasked: false }).examJson, D6).map((q) => q.question)).toContain(peace.question);
  });

  test('after the re-ask a new Q6 item takes the wallet\'s place', () => {
    const exam = JSON.parse(JSON.stringify(CH1));
    const slot = slotOf(D6);
    const fresh = {
      slot: D6,
      question: 'آپ کے محلے کی سڑک پر روشنی کا انتظام نہیں ہے۔ آپ کس ادارے سے رابطہ کریں گے اور کیسے؟',
      answer: 'میں مقامی حکومت کے دفتر میں درخواست دوں گا، محلے والوں کے دستخط ساتھ لگاؤں گا اور جواب کا انتظار کروں گا۔',
      scheme: { points: [{ kind: 'A', text: 'مقامی حکومت کی نشاندہی', marks: 2 }, { kind: 'A', text: 'تحریری درخواست', marks: 2 }, { kind: 'A', text: 'محلے والوں کی شمولیت', marks: 2 }] },
    };
    const SPARES = [
      ['اسکول کے باہر کوڑا پھینکا جاتا ہے۔ آپ اپنی جماعت کے ساتھ کیا مہم چلائیں گے؟', 'جماعت کے ساتھ صفائی مہم چلا کر کوڑے دان رکھواؤں گا۔', 'صفائی مہم'],
      ['پاکستان کے میدانی علاقوں میں زراعت کیوں زیادہ ہوتی ہے؟ وضاحت کریں۔', 'میدانی علاقوں کی زمین زرخیز اور ہموار ہے اور دریاؤں سے پانی ملتا ہے۔', 'زرخیز زمین'],
      ['ووٹ ڈالنا ایک شہری کی ذمہ داری کیوں ہے؟ وضاحت کریں۔', 'ووٹ سے عوام اپنے نمائندے چنتے ہیں جو قانون بناتے ہیں۔', 'نمائندوں کا انتخاب'],
    ].map(([question, answer, point]) => ({ slot: D6, question, answer, scheme: { points: [{ kind: 'A', text: point, marks: 6 }] } }));
    // The re-asked reply comes after the first in the merged tree: four new items, as a top-up asks.
    exam.unseen[slot.category][slot.type] = [...items(exam, D6), fresh, ...SPARES];
    const placed = items(lay(exam, { reasked: true }).examJson, D6).map((q) => q.question);
    expect(placed).toContain(fresh.question);
    expect(placed).not.toContain(WALLET.question);
  });

  test('after the re-ask, with nothing else to take its place, the held Q6 comes back: no short paper', () => {
    const laid = lay(CH1, { reasked: true });
    expect(laid.shortfall).toEqual([]);
  });

  test('a Q6 item with no marking points is never held by this rule', () => {
    const exam = JSON.parse(JSON.stringify(CH1));
    const w = items(exam, D6)[1];
    delete w.scheme;
    expect(items(lay(exam, { reasked: false }).examJson, D6).map((q) => q.question)).toContain(WALLET.question);
  });
});

describe('2. when C and D are both asked again, D is told the Q5 items C\'s second reply kept', () => {
  test('through generatePatternExam: D\'s re-ask comes after C\'s and lists a Q5 only C\'s second reply wrote', async () => {
    const replies = {};
    for (const r of fixture('r9b-sst-ch46-replies')) {
      const sec = ['A', 'B', 'C', 'D'].find((s) => r.content.includes(`social_studies.${s}.`));
      (replies[sec] ||= []).push(r.content);
    }
    const drop = (json, slot, n) => {
      const tree = JSON.parse(json);
      let done = false;
      const walk = (o) => {
        if (done || !o || typeof o !== 'object') return;
        for (const v of Object.values(o)) {
          if (Array.isArray(v) && v.some((q) => q && q.slot === slot)) { v.splice(v.findIndex((q) => q && q.slot === slot), n); done = true; return; }
          walk(v);
        }
      };
      walk(tree);
      expect(done).toBe(true);
      return JSON.stringify(tree);
    };
    const NEW_Q5 = 'آپ کی گلی میں پانی کا نل کئی دن سے ٹوٹا ہوا ہے اور پانی ضائع ہو رہا ہے۔ آپ کیا کریں گے؟';
    const secondC = JSON.parse(replies.C[0]);
    let added = false;
    const add = (o) => {
      if (added || !o || typeof o !== 'object') return;
      for (const v of Object.values(o)) {
        if (Array.isArray(v) && v.some((q) => q && q.slot === C5)) {
          const i = v.findIndex((q) => q && q.slot === C5);
          v.splice(i, 1, { ...v[i], question: NEW_Q5, answer: 'میں بڑوں کو بتاؤں گا اور واٹر بورڈ کو اطلاع دوں گا تاکہ نل ٹھیک ہو اور پانی ضائع نہ ہو۔', accept: [], scheme: { points: [{ kind: 'A', text: 'ٹوٹے نل کی اطلاع دینا', marks: 1 }, { kind: 'A', text: 'پانی بچانا', marks: 1 }, { kind: 'A', text: 'متعلقہ ادارے سے رابطہ', marks: 1 }] } });
          added = true; return;
        }
        add(v);
      }
    };
    add(secondC);
    expect(added).toBe(true);
    // C's first reply is short of Q5 (it wrote one spare, so two are taken out) and its second
    // carries a Q5 the first never wrote; D's first reply is one Q6 short.
    replies.C = [drop(replies.C[0], C5, 2), JSON.stringify(secondC)];
    replies.D = [drop(replies.D[0], D6, 1), replies.D[0]];
    const asked = [];
    mockCreate.mockReset();
    mockCreate.mockImplementation(async (req) => {
      const text = req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const sec = ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));
      asked.push({ sec, text });
      // C's re-ask answers only after a pause, so a D re-ask written beside it would be asked first.
      const n = asked.filter((x) => x.sec === sec).length;
      if (sec === 'C' && n === 2) { await new Promise((r) => setTimeout(r, 20)); asked.push({ sec: 'C answered', text: '' }); }
      const content = (replies[sec] || []).length > 1 ? replies[sec].shift() : replies[sec][0];
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    });
    await Gen.generatePatternExam({
      grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027',
      scope: { kind: 'chapters', chapters: [4, 6], pages: '26-33,40-48' }, pageRanges: '26-33,40-48', requestId: 'req-r13',
    }).catch(() => null);
    const order = asked.map((x) => x.sec);
    const c2 = order.indexOf('C answered');
    const d2 = order.indexOf('D', order.indexOf('D') + 1);
    expect(c2).toBeGreaterThan(-1);
    // D's re-ask is sent only once C's re-ask has answered.
    expect(d2).toBeGreaterThan(c2);
    const dNote = asked[d2].text;
    expect(dNote).toContain('Q5 of this paper already sets these situations');
    expect(dNote).toContain(NEW_Q5);
  });
});
