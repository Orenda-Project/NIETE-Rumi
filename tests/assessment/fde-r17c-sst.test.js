/**
 * Social Studies reader pass, round 4: a D slot the reader would leave short takes the slot's unplaced
 * first-ask spares, read in the same re-check call; a Q7 keyed on a Q1 key is held; Q6 never asks a
 * history fact.
 */

const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 4 ===\nسبق کا متن', pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const SST = Patterns.get('fde_g5_2027').subjects.social_studies;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === slot);
const Q1 = 'social_studies.A.Q1';
const C5 = 'social_studies.C.Q5';
const D6 = 'social_studies.D.Q6';
const D7 = 'social_studies.D.Q7';
const slotOf = (id) => SST.sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (text) => text.includes(Reader.READER_MARK);
const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));
const logged = (msg) => mockLog.mock.calls.filter(([m]) => m === msg).map(([, d]) => d);
const lead = (t) => String(t).slice(0, 40);

/**
 * A recorded paper replayed through the engine: each section's replies in the order the model gave
 * them, and the reader's replies in turn (`reader` overrides one by its call number).
 */
async function replay(rec, { reader = {} } = {}) {
  const queue = { A: [...rec.replies.A], B: [...rec.replies.B], C: [...rec.replies.C], D: [...rec.replies.D] };
  const asked = [];
  mockCreate.mockReset();
  mockLog.mockReset();
  mockCreate.mockImplementation(async (req) => {
    const text = textOf(req);
    if (isReader(text)) {
      const n = asked.filter((a) => a.sec === 'reader').length + 1;
      asked.push({ sec: 'reader', text });
      const content = reader[n] ? reader[n](text) : rec.reader[n - 1];
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 9000, completion_tokens: 300, total_tokens: 9300 } };
    }
    const sec = sectionOf(text);
    asked.push({ sec, text });
    const content = queue[sec].length > 1 ? queue[sec].shift() : queue[sec][0];
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  });
  const out = await Gen.generatePatternExam({
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: rec.scope, pageRanges: rec.scope.pages, requestId: 'req-r17c', readerPass: true,
  }).catch((e) => ({ error: e }));
  return { asked, out };
}

// The stems a reader reply flags, read from the prompt it answered (label → printed line).
function flaggedStems(prompt, reply, stale = []) {
  const lines = prompt.split('\n');
  return JSON.parse(reply).candidates.filter((c) => c.given_away === true && !stale.includes(c.by)).map((c) => {
    const line = lines.find((l) => l.startsWith(`${c.item} `));
    return line ? line.slice(c.item.length + 1).trim() : null;
  }).filter(Boolean);
}
const onlyLine = (prompt) => (prompt.split('\n').find((l) => l.startsWith('Judge ONLY these items:')) || '');
const judgedLabels = (prompt) => onlyLine(prompt).match(/Q\d+\.\d+/g) || [];

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

// The reader replies recorded here number the paper their run printed. Two later holds would change
// that paper before the reader reads it, so each replay keeps it as recorded: chapters_1's C reply keys
// one Q5 on a religious premise («اللہ تعالیٰ نے تمام انسان برابر پیدا کیے …»), which is now held, so it
// takes that item's civic answer; chapters_7's D stems print the Q1 key «ایدھی فاؤنڈیشن», which now holds
// that Q1 item before the reader can catch the pair, so they name the organisation without it.
// Q1 items whose key a C/D stem (or their own stem) names are held now too, so each takes the place of an item
// no stem names, in its own position: Q1's numbering, which the recorded reader replies use, stays as printed.
const NEUTRAL = [
  ['پاکستان کا قومی پھول کون سا ہے؟', ['الف) گلاب', 'ب) چنبیلی', 'ج) سورج مکھی', 'د) کنول'], 'ب) چنبیلی'],
  ['پاکستان کا قومی جانور کون سا ہے؟', ['الف) شیر', 'ب) ہاتھی', 'ج) مارخور', 'د) ہرن'], 'ج) مارخور'],
  ['پاکستان کا قومی درخت کون سا ہے؟', ['الف) دیودار', 'ب) نیم', 'ج) شیشم', 'د) پیپل'], 'الف) دیودار'],
];
const neutralQ1 = (r, stems) => {
  r.replies.A = r.replies.A.map((json) => {
    const tree = JSON.parse(json);
    const mcqs = (tree.unseen.objective || {}).MCQs || [];
    stems.forEach((stem, i) => {
      const q = mcqs.find((x) => x.question === stem);
      if (q) Object.assign(q, { question: NEUTRAL[i][0], options: NEUTRAL[i][1], answer: NEUTRAL[i][2] });
    });
    return JSON.stringify(tree);
  });
};
const asRecorded = {
  chapters_1: (r) => {
    r.replies.C = r.replies.C.map((c) => c.replace('اللہ تعالیٰ نے تمام انسان برابر پیدا کیے ہیں اور سب آدم و حوا علیھما السلام کی اولاد ہیں۔', 'اقوام متحدہ کے منشور کے مطابق تمام انسان برابر ہیں اور سب کی عزت برابر ہے۔'));
    // Q5 «پرنٹ میڈیا اور الیکٹرانک میڈیا میں فرق …» names Q1 «ٹیلی وژن اور ریڈیو …»'s key, a giver the recorded reader
    // cites: the Q5 names the two media by an example each instead.
    r.replies.C = r.replies.C.map((c) => c.split('پرنٹ میڈیا اور الیکٹرانک میڈیا میں فرق').join('اخبار اور ٹیلی وژن میں فرق'));
    neutralQ1(r, ['ایدھی فاؤنڈیشن کے بانی کون تھے؟',
      'ایک بچہ اسکول میں اپنے ہم جماعت کے مذہب کی وجہ سے اسے کھیل میں شامل نہیں کرتا۔ یہ کس اصول کے خلاف ہے؟']);
  },
  // Its Q1 «عبدالستار ایدھی نے کون سی فلاحی تنظیم قائم کی؟ → ایدھی فاؤنڈیشن» names its own key, and is now held for
  // it; the recorded reader quotes that stem to catch a Q7, so the stem stays and its key no longer repeats it.
  chapters_7: (r) => {
    r.replies.D = r.replies.D.map((d) => d.split('ایدھی فاؤنڈیشن').join('ایدھی کی تنظیم'));
    r.replies.A = r.replies.A.map((a) => a.split('ایدھی فاؤنڈیشن').join('ایک فلاحی فاؤنڈیشن'));
  },
};
// The recorded flags whose giver is a Q1 item that now never prints (above): what it gave away is no give-away.
const STALE = { chapters_1: ['Q1.5'], chapters_7: [] };

describe('1. a D slot the reader would leave short takes its unplaced first-ask spares, read in the same re-check', () => {
  for (const name of ['chapters_1', 'chapters_7']) {
    const rec = clone(fixture(`r17c-sst-refused-${name}`));
    asRecorded[name](rec);

    test(`${name}: the recorded paper builds, and no item the reader caught prints`, async () => {
      const { asked, out } = await replay(rec);
      const reads = asked.filter((a) => a.sec === 'reader');
      // Still one read and one re-check: the spares ride in the re-check, no call is added.
      expect(reads).toHaveLength(2);
      expect(out.error && out.error.code).toBeUndefined();
      // chapters_7's recorded reader replies label the paper its D reply made when marking-only points
      // still held Q6 items they did not restate; D now lays out other Q6s, so those labels name other
      // items and only chapters_1's replies still read this paper.
      if (name === 'chapters_1') {
        const caught = [...flaggedStems(reads[0].text, rec.reader[0], STALE[name]), ...flaggedStems(reads[1].text, rec.reader[1], STALE[name])];
        expect(caught.length).toBeGreaterThanOrEqual(5 - STALE[name].length);
        const printed = [C5, D6, D7].flatMap((s) => items(out.examJson, s)).map((q) => lead(q.question));
        expect(caught.map(lead).filter((s) => printed.includes(s))).toEqual([]);
      }
      expect(items(out.examJson, D7).length).toBeGreaterThanOrEqual(slotOf(D7).attempt + 1);
      expect(out.examJson._layout.reader.spares).toBeGreaterThan(0);
      const line = logged('[assessment] reader pass').pop();
      expect(line.error).toBeUndefined();
      expect(line.spares).toBe(out.examJson._layout.reader.spares);
    });

    test(`${name}: the re-check is asked about the spares as well as the replacements`, async () => {
      const { asked, out } = await replay(rec);
      const reads = asked.filter((a) => a.sec === 'reader');
      const judged = judgedLabels(reads[1].text);
      const q7 = judged.filter((l) => l.startsWith('Q7.'));
      // Every spare that prints was among the items the re-check judged.
      const lines = reads[1].text.split('\n');
      const judgedStems = judged.map((l) => (lines.find((x) => x.startsWith(`${l} `)) || '').slice(l.length + 1).trim()).map(lead);
      const fromSpares = items(out.examJson, D7).map((q) => lead(q.question)).filter((s) => !reads[0].text.includes(s));
      expect(q7.length).toBeGreaterThan(0);
      expect(fromSpares.every((s) => judgedStems.includes(s))).toBe(true);
    });

    test(`${name}: when the re-check flags the spares too, the paper still fails closed and none of them prints`, async () => {
      const { asked, out } = await replay(rec, {
        reader: {
          2: (prompt) => {
            const judged = judgedLabels(prompt);
            const lines = prompt.split('\n');
            return JSON.stringify({
              candidates: judged.map((item) => {
                const stem = (lines.find((x) => x.startsWith(`${item} `)) || '').slice(item.length + 1).trim();
                return { item, by: item, evidence: stem.split(' ').slice(0, 3).join(' '), reason: 'own stem', given_away: true };
              }),
            });
          },
        },
      });
      expect(out.error && out.error.code).toBe('PATTERN_SHORT_SLOT');
      expect(out.error.shortfall.map((f) => f.slot)).toContain(D7);
      const reads = asked.filter((a) => a.sec === 'reader');
      expect(reads).toHaveLength(2);
      const rec2 = out.error.examJson._layout.reader;
      expect(rec2.error).toBe('the paper would be short');
      expect(rec2.spares).toBe(0);
    });
  }

  test('chapters_1: a re-check that clears every replacement prints no spare', async () => {
    const rec = clone(fixture('r17c-sst-refused-chapters_1'));
    asRecorded.chapters_1(rec);
    const { asked, out } = await replay(rec, { reader: { 2: () => JSON.stringify({ candidates: [] }) } });
    const reads = asked.filter((a) => a.sec === 'reader');
    expect(out.error && out.error.code).toBeUndefined();
    expect(out.examJson._layout.reader.spares).toBe(0);
    // Every D item that prints was on the paper the first read saw, or a top-up replacement.
    const topUp = asked.filter((a) => a.sec === 'D').length;
    expect(topUp).toBeGreaterThan(1);
    const spareStems = judgedLabels(reads[1].text).map((l) => (reads[1].text.split('\n').find((x) => x.startsWith(`${l} `)) || '').slice(l.length + 1).trim())
      .map(lead).filter((s) => !items(out.examJson, D7).concat(items(out.examJson, D6)).some((q) => lead(q.question) === s));
    expect(out.examJson._layout.reader.spares_read).toBe(spareStems.length);
  });
});

describe('2(a). a D.Q7 whose key or accepted answer is a Q1 key is held against Section A', () => {
  const exam = fixture('r17c-sst-local-chapters_6');
  const scope = { kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages };
  const minto = items(exam, D7)[3];

  test('setup: the recorded Q7 4 accepts «لاہور», and Q1 11 is keyed «د) لاہور»', () => {
    expect(minto.scheme.accept).toContain('لاہور');
    expect(items(exam, Q1)[10].answer).toBe('د) لاہور');
  });

  test('chapters_6: Q7 «… اجلاس کہاں منعقد ہوا؟ → لاہور کے منٹو پارک» does not print', () => {
    const laid = applyLayout(clone(exam), SST, scope, { reasked: true });
    expect(items(laid.examJson, D7).map((q) => q.question)).not.toContain(minto.question);
    expect(laid.held.some((h) => h.slot === D7 && h.rule === 'section_a' && h.q.question === minto.question)).toBe(true);
  });
});

describe('2(b). a C.Q5 two Q1 items answer together is held against Section A', () => {
  const exam = fixture('r17c-sst-local-chapters_5');
  const scope = { kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages };
  const q5 = items(exam, C5)[4];

  test('setup: Q5 5 compares democracy and monarchy; Q1 6 and Q1 18 print each half', () => {
    expect(q5.question).toContain('جمہوریت اور شہنشاہیت');
    expect(items(exam, Q1)[5].answer).toContain('ووٹوں');
    expect(items(exam, Q1)[17].answer).toContain('شہنشاہیت');
  });

  test('chapters_5: Q5 «جمہوریت اور شہنشاہیت میں کیا فرق ہے؟» does not print', () => {
    const laid = applyLayout(clone(exam), SST, scope, { reasked: true });
    expect(items(laid.examJson, C5).map((q) => q.question)).not.toContain(q5.question);
    expect(laid.held.some((h) => h.slot === C5 && h.rule === 'section_a' && h.q.question === q5.question)).toBe(true);
  });

  test('chapters_3: no Q5 is held against Section A (Q5 8, 0.58 of its answer in two Q1 items, is below the line)', () => {
    const ch3 = fixture('r17c-sst-local-chapters_3');
    const sc = { kind: ch3._layout.scope.kind, chapters: ch3._layout.scope.chapters, pages: ch3._layout.scope.pages };
    const laid = applyLayout(clone(ch3), SST, sc, { reasked: true });
    expect(laid.held.filter((h) => h.slot === C5 && h.rule === 'section_a')).toEqual([]);
  });
});

describe('3. Q6 never asks a history fact', () => {
  test('the Social Studies D prompt says so, and Q7 is where history recall goes', async () => {
    const rec = fixture('r17c-sst-refused-chapters_1');
    const { asked } = await replay(rec);
    const d = asked.find((a) => a.sec === 'D').text;
    expect(d).toContain('A Q6 situation never asks a history fact; history recall goes to Q7.');
  });
});
