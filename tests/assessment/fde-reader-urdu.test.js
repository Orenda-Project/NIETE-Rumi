/**
 * Urdu board-pattern papers: a reader pass after the final layout.
 *
 * Three local rounds each found a Section A give-away of a new shape, and some of them share no
 * text with the item they give away: «نہ جانے، کیا خبر اور شاید … کس قسم کے جملوں میں آتے ہیں؟ →
 * شکیہ» answers «کون سا جملہ شکیہ ہے؟». No string rule sees that. So, when the engine is told to,
 * one model call reads the printed question paper (no keys) beside Q1's keys and names the Q1
 * items a child could answer from text printed elsewhere. Those are held, Section A is asked once
 * for replacements, the paper is laid out again, and the reader checks the replacements only.
 *
 * The paper is replayed from a recorded local run (content only); the model boundary is mocked,
 * never the chain.
 */

const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const path = require('path');

const mockCreate = jest.fn();
const mockLog = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn(), logWarn: jest.fn() }));
// The book store holds the poem the recorded Q6 prints (lesson 7, «ندی کی فریاد»), for any range asked.
const mockPages = (() => {
  const replies = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'fde', 'reader-urdu-local-chapters_1.json'), 'utf8')).replies;
  const q6 = JSON.parse(replies.C).unseen.subjective['Poem Explanation'][0];
  return ['=== Page 63 ===', 'سبق ۷', 'ندی کی فریاد', 'شاعر: کوثر صدیقی', ...q6.passage.split('\n')].join('\n\n');
})();
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: mockPages, pageReference: String(pageRanges) }),
  loadChapterContent: async () => ({ content: mockPages, pageReference: '28' }),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const rec = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'reader-urdu-local-chapters_1.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (prompt) => prompt.includes(Reader.READER_MARK);

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1Stems = (exam) => items(exam, 'urdu.A.Q1').map((q) => q.question);
// The recorded concept twin: ۱۶ states the rule that answers ۱۳.
const RULE_STEM = /نہ جانے/;

// Replacement MCQs the reader's top-up writes (fictional, everyday facts).
const NEW = [['دریا', 'پانی کا بڑا بہاؤ'], ['کتاب خانہ', 'کتابوں کا گھر'], ['باغبان', 'باغ کی دیکھ بھال کرنے والا'], ['درزی', 'کپڑے سینے والا']]
  .map(([w, k]) => ({
    slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `لفظ «${w}» سے کیا مراد ہے؟`,
    options: [`الف) ${k}`, 'ب) پہاڑ کی چوٹی', 'ج) آسمان کا رنگ', 'د) رات کا وقت'], answer: `الف) ${k}`, marks: 1,
  }));

/**
 * Serves the recorded section replies, and the reader's replies from `reader` (a function of the
 * reader prompt and its call number, returning the reply content or throwing).
 */
function serve({ reader = null, topUp = NEW, topUp2 = null } = {}) {
  const asked = [];
  mockCreate.mockImplementation(async (req) => {
    const prompt = textOf(req);
    if (isReader(prompt)) {
      const n = asked.filter((a) => a.sec === 'reader').length + 1;
      asked.push({ sec: 'reader', prompt, req });
      const content = await reader(prompt, n);
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 9000, completion_tokens: 300, total_tokens: 9300 } };
    }
    const sec = ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
    asked.push({ sec, prompt, req });
    const nA = asked.filter((a) => a.sec === 'A').length;
    let content = rec.replies[sec === 'A' ? 'A1' : sec];
    if (sec === 'A' && nA === 2) content = rec.replies.A2;
    if (sec === 'A' && nA === 3) content = JSON.stringify({ unseen: { objective: { MCQs: clone(topUp) } } });
    if (sec === 'A' && nA === 4 && topUp2) content = JSON.stringify({ unseen: { objective: { MCQs: clone(topUp2) } } });
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
  });
  return asked;
}

// The label the reader prompt gives the first Q1 item matching `re` («Q1.16»).
function labelOf(prompt, re) {
  const line = prompt.split('\n').find((l) => /^Q1\.\d+ /.test(l) && re.test(l));
  return line ? line.split(' ')[0] : null;
}

const run = (extra = {}) => Gen.generatePatternExam({
  grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: rec.scope, pageRanges: rec.scope.pages, requestId: 'req-reader', ...extra,
}).then((r) => ({ ok: r }), (err) => ({ err }));

// generated_at is the clock's, and `_layout.reader` is the pass's own record (asserted where it
// matters, absent on an OFF paper); everything else must match.
const stable = (exam) => { const e = clone(exam); delete e._layout.generated_at; delete e._layout.reader; return e; };

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

describe('the recorded paper, as it prints today', () => {
  test('chapters_1 prints the concept twin (the shape the reader pass is for)', async () => {
    serve();
    const out = await run();
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    const stems = q1Stems(out.ok.examJson);
    expect(stems).toHaveLength(20);
    expect(stems.some((s) => RULE_STEM.test(s))).toBe(true);
  });
});

describe('reader pass ON: a flagged item does not print', () => {
  test('the flagged Q1 item is held, Section A is asked once for replacements, the reader re-checks only those', async () => {
    let flagged = null;
    const asked = serve({
      reader: async (prompt, n) => {
        if (n === 1) {
          flagged = labelOf(prompt, RULE_STEM);
          return JSON.stringify({ candidates: [
            { item: flagged, by: 'Q1.13', evidence: 'شاید کل بارش ہو جائے', reason: 'states the rule that answers which sentence is شکیہ', given_away: true },
            // A candidate the reader decided against is not held.
            { item: 'Q1.1', by: 'Q2', evidence: 'کراچی', reason: 'only a distractor', given_away: false },
          ] });
        }
        return JSON.stringify({ candidates: [] });
      },
    });
    const out = await run({ readerPass: true });
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    expect(flagged).toMatch(/^Q1\.\d+$/);
    const stems = q1Stems(out.ok.examJson);
    expect(stems).toHaveLength(20);
    expect(stems.some((s) => RULE_STEM.test(s))).toBe(false);
    expect(stems).toContain(NEW[0].question);

    const readers = asked.filter((a) => a.sec === 'reader');
    expect(readers).toHaveLength(2);
    // The FDE model and job, JSON, high effort.
    expect(readers[0].req).toMatchObject({ job: 'assessment.generate', response_format: { type: 'json_object' }, reasoning: { effort: 'high' }, max_tokens: 8000 });
    // The first read is the printed paper, never a key outside Q1's side list.
    const first = readers[0].prompt;
    expect(first).toContain('Q6');
    expect(first).not.toMatch(/scheme|common_error/);
    // The re-check names only the replacement.
    const only = readers[1].prompt.split('\n').find((l) => l.startsWith(Reader.ONLY_HEAD));
    expect(only).toBeTruthy();
    expect(only.match(/Q1\.\d+/g)).toHaveLength(1);

    const a = asked.filter((x) => x.sec === 'A');
    expect(a).toHaveLength(3);
    expect(a[2].prompt).toContain('never write these again');
    expect(a[2].prompt).toContain('states the rule that answers which sentence is شکیہ');
    // The top-up asks twice what it lacks, plus spares: the layout holds many of a top-up's items on a
    // narrow scope (5 asked, 4 held on a local lessons 6-7 paper), and the extras never print.
    const write = Number((a[2].prompt.match(/Write (\d+) new items/) || [])[1]);
    expect(write).toBeGreaterThanOrEqual(2 * 1 + 2);

    const line = mockLog.mock.calls.find(([m]) => m === '[assessment] reader pass');
    expect(line).toBeTruthy();
    expect(line[1]).toMatchObject({ requestId: 'req-reader', subject: 'urdu', flagged: 1, replaced: 1, still_flagged: 0 });
    expect(typeof line[1].ms).toBe('number');
    expect(line[1].tokens).toBe(9300 * 2);
    // The reader's calls are billed with the paper.
    expect(out.ok.tokenData.totalTokens).toBe(1500 * 5 + 9300 * 2);
    // The paper itself records what the reader did: a panel reads it from exam_json, no log needed.
    expect(out.ok.examJson._layout.reader).toMatchObject({ flagged: 1, replaced: 1, still_flagged: 0, put_back: 0 });
    expect(out.ok.examJson._layout.reader.items).toEqual([{ label: flagged, by: 'Q1.13', reason: 'states the rule that answers which sentence is شکیہ', outcome: 'replaced' }]);
  });

  test('a replacement the re-check still flags is taken off; a place still empty after one more top-up fails the paper closed, never putting the caught item back', async () => {
    let flagged = null;
    const asked = serve({
      topUp: NEW.slice(0, 1),
      reader: async (prompt, n) => {
        if (n === 1) {
          flagged = labelOf(prompt, RULE_STEM);
          return JSON.stringify({ candidates: [{ item: flagged, by: 'Q1.13', evidence: 'شاید کل بارش ہو جائے', reason: 'rule twin', given_away: true }] });
        }
        const again = labelOf(prompt, /دریا/);
        return JSON.stringify({ candidates: [{ item: again, by: 'Q1.1', evidence: 'محترمہ فاطمہ جناح', reason: 'stand-in give-away by another Q1 item', given_away: true }] });
      },
    });
    const out = await run({ readerPass: true });
    expect(out.err && out.err.code).toBe('PATTERN_SHORT_SLOT');
    expect(out.err.shortfall).toEqual([{ slot: 'urdu.A.Q1', missing: 1 }]);
    const stems = q1Stems(out.err.examJson);
    expect(stems).not.toContain(NEW[0].question);
    // The in-Q1 hold is never put back: a caught item does not print.
    expect(stems.some((s) => RULE_STEM.test(s))).toBe(false);
    // One more top-up ran (the 4th Section A call) before the paper failed.
    expect(asked.filter((x) => x.sec === 'A')).toHaveLength(4);
    const line = mockLog.mock.calls.find(([m]) => m === '[assessment] reader pass');
    expect(line[1]).toMatchObject({ flagged: 1, replaced: 0, still_flagged: 1, put_back: 0, top_ups: 2, error: 'the paper would be short' });
    // The failed paper's record names every flag.
    expect(out.err.examJson._layout.reader.items.map((x) => x.outcome)).toEqual(['replaced', 'taken_off']);
  });

  test('nothing flagged: no top-up, and the paper is the one it would be with the pass off', async () => {
    serve();
    const off = await run();
    mockCreate.mockReset(); mockLog.mockReset();
    const asked = serve({ reader: async () => JSON.stringify({ candidates: [] }) });
    const on = await run({ readerPass: true });
    // The same paper; the pass leaves only its record (flagged 0), and an OFF paper has none.
    expect(on.ok.examJson._layout.reader).toMatchObject({ flagged: 0, items: [] });
    expect(off.ok.examJson._layout.reader).toBeUndefined();
    delete on.ok.examJson._layout.reader;
    expect(stable(on.ok.examJson)).toEqual(stable(off.ok.examJson));
    expect(asked.filter((x) => x.sec === 'A')).toHaveLength(2);
    expect(asked.filter((x) => x.sec === 'reader')).toHaveLength(1);
  });
});

describe('a reader failure never fails a paper', () => {
  const offPaper = async () => { serve(); const off = await run(); mockCreate.mockReset(); mockLog.mockReset(); return off; };

  test.each([
    ['malformed JSON', async () => 'flags: not json {'],
    ['a timeout', async () => { throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }); }],
    ['a reply with no candidates list', async () => JSON.stringify({ flags: [{ item: 'Q1.1', by: 'Q2', evidence: 'کراچی', given_away: true }] })],
    ['a flag on an item that is not on the paper', async () => JSON.stringify({ candidates: [{ item: 'Q1.99', by: 'Q2', evidence: 'کراچی', reason: 'x', given_away: true }] })],
    ['a flag whose evidence is not printed where it says', async () => JSON.stringify({ candidates: [{ item: 'Q1.1', by: 'Q6', evidence: 'کراچی', reason: 'x', given_away: true }] })],
    ['a correction written after the reply', async () => '{"candidates":[]}\n\nCorrection:\n\n{"candidates":[]}'],
  ])('%s: the paper prints as it does with the pass off, and the error is logged', async (name, reader) => {
    const off = await offPaper();
    serve({ reader });
    const on = await run({ readerPass: true });
    expect(on.err).toBeUndefined();
    expect(stable(on.ok.examJson)).toEqual(stable(off.ok.examJson));
    // The paper carries the pass's record and no item: a failed read never names one.
    expect(on.ok.examJson._layout.reader).toMatchObject({ flagged: 0, replaced: 0, put_back: 0, items: [] });
    expect(off.ok.examJson._layout.reader).toBeUndefined();
    const line = mockLog.mock.calls.find(([m]) => m === '[assessment] reader pass');
    expect(line).toBeTruthy();
    expect(line[1]).toMatchObject({ subject: 'urdu', flagged: 0, replaced: 0 });
  });

  test('a failed top-up fails the paper closed: the caught item never prints, and the record keeps it', async () => {
    const asked = [];
    mockCreate.mockImplementation(async (req) => {
      const prompt = textOf(req);
      if (isReader(prompt)) return { choices: [{ message: { content: JSON.stringify({ candidates: [{ item: labelOf(prompt, RULE_STEM), by: 'Q1.13', evidence: 'شاید کل بارش ہو جائے', reason: 'x', given_away: true }] }) }, finish_reason: 'stop' }], usage: {} };
      const sec = ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
      asked.push(sec);
      const nA = asked.filter((s) => s === 'A').length;
      if (sec === 'A' && nA === 3) throw new Error('upstream 529');
      const content = sec === 'A' ? rec.replies[nA === 2 ? 'A2' : 'A1'] : rec.replies[sec];
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: {} };
    });
    const on = await run({ readerPass: true });
    expect(on.err && on.err.code).toBe('PATTERN_SHORT_SLOT');
    expect(q1Stems(on.err.examJson).some((s) => RULE_STEM.test(s))).toBe(false);
    expect(on.err.examJson._layout.reader).toMatchObject({ flagged: 1, error: expect.stringMatching(/^top-up: /) });
    expect(on.err.examJson._layout.reader.items).toHaveLength(1);
  });
});

describe('review findings', () => {
  const offPaper = async () => { serve(); const off = await run(); mockCreate.mockReset(); mockLog.mockReset(); return off; };
  const ruleFlag = (prompt) => ({ item: labelOf(prompt, RULE_STEM), by: 'Q1.13', evidence: 'شاید کل بارش ہو جائے', reason: 'rule twin', given_away: true });

  test('a top-up whose items carry text the paper refuses to print fails the paper closed', async () => {
    const marked = clone(NEW).map((q, i) => (i === 0 ? { ...q, question: `${q.question} ${String.fromCodePoint(0x26A0)}` } : q));
    serve({ topUp: marked, reader: async (prompt, n) => JSON.stringify({ candidates: n === 1 ? [ruleFlag(prompt)] : [] }) });
    const on = await run({ readerPass: true });
    expect(on.err && on.err.code).toBe('PATTERN_SHORT_SLOT');
    expect(q1Stems(on.err.examJson).some((s) => RULE_STEM.test(s))).toBe(false);
    const line = mockLog.mock.calls.find(([m]) => m === '[assessment] reader pass');
    expect(line[1].error).toMatch(/refused text/);
  });

  test('a flag that names the item as its own giver, or quotes a two-letter word, is not held', async () => {
    const off = await offPaper();
    serve({
      reader: async (prompt) => {
        const own = labelOf(prompt, RULE_STEM);
        return JSON.stringify({ candidates: [
          // Its own options are what the child picks from: «شکیہ» is printed only there.
          { item: own, by: own, evidence: 'شکیہ', reason: 'own options', given_away: true },
          { item: own, by: 'Q1', evidence: 'شکیہ', reason: 'bare Q1', given_away: true },
          { item: own, by: 'Q2', evidence: 'کا', reason: 'a two-letter word', given_away: true },
        ] });
      },
    });
    const on = await run({ readerPass: true });
    expect(stable(on.ok.examJson)).toEqual(stable(off.ok.examJson));
  });

  test('on the re-check, a replacement whose text gives away a kept item is taken off', async () => {
    // The reader names the KEPT item as given away, by the replacement: the replacement comes off,
    // and one more top-up fills its place.
    const asked = serve({
      topUp2: NEW.slice(3, 4),
      reader: async (prompt, n) => {
        if (n === 1) return JSON.stringify({ candidates: [ruleFlag(prompt)] });
        const kept = labelOf(prompt, /پیدائش کس شہر/);
        const repl = labelOf(prompt, /«دریا»/);
        return JSON.stringify({ candidates: [{ item: kept, by: repl, evidence: 'دریا', reason: 'stand-in: the replacement answers a kept item', given_away: true }] });
      },
    });
    const out = await run({ readerPass: true });
    expect(out.err).toBeUndefined();
    const stems = q1Stems(out.ok.examJson);
    expect(stems).toHaveLength(20);
    expect(stems).not.toContain(NEW[0].question);
    expect(stems).toContain(NEW[3].question);
    expect(stems.some((s) => /پیدائش کس شہر/.test(s))).toBe(true);
    expect(asked.filter((a) => a.sec === 'reader')).toHaveLength(3);
    const line = mockLog.mock.calls.find(([m]) => m === '[assessment] reader pass');
    expect(line[1]).toMatchObject({ flagged: 1, still_flagged: 1, rechecked: true });
  });

  test('a re-check that fails says so in the telemetry', async () => {
    serve({ reader: async (prompt, n) => { if (n === 1) return JSON.stringify({ candidates: [ruleFlag(prompt)] }); throw new Error('timed out'); } });
    const out = await run({ readerPass: true });
    expect(out.err).toBeUndefined();
    const line = mockLog.mock.calls.find(([m]) => m === '[assessment] reader pass');
    expect(line[1]).toMatchObject({ flagged: 1, rechecked: false });
  });
});

describe('a reply the client already parsed', () => {
  test('a reader reply whose content is an object is read, not dropped as a failed read', async () => {
    let flagged = null;
    serve({
      reader: async (prompt, n) => {
        if (n === 1) {
          flagged = labelOf(prompt, RULE_STEM);
          return { candidates: [{ item: flagged, by: 'Q1.13', evidence: 'شاید کل بارش ہو جائے', reason: 'rule twin', given_away: true }] };
        }
        return { candidates: [] };
      },
    });
    const out = await run({ readerPass: true });
    expect(q1Stems(out.ok.examJson).some((s) => RULE_STEM.test(s))).toBe(false);
    const line = mockLog.mock.calls.find(([m]) => m === '[assessment] reader pass');
    expect(line[1].error).toBeUndefined();
    expect(line[1]).toMatchObject({ flagged: 1, replaced: 1 });
  });
});

describe('reader pass OFF, or not Urdu: no reader call', () => {
  test('flag absent: no reader prompt is ever sent', async () => {
    const asked = serve({ reader: async () => { throw new Error('must not be called'); } });
    const out = await run();
    expect(out.err).toBeUndefined();
    expect(asked.some((a) => a.sec === 'reader')).toBe(false);
    expect(mockLog.mock.calls.some(([m]) => m === '[assessment] reader pass')).toBe(false);
  });

  test('readerPass: false is the same paper as no flag at all', async () => {
    serve();
    const a = await run();
    mockCreate.mockReset();
    serve();
    const b = await run({ readerPass: false });
    expect(stable(b.ok.examJson)).toEqual(stable(a.ok.examJson));
  });
});

describe('the reader prompt', () => {
  const laidPaper = async () => { serve(); const off = await run(); return off.ok.examJson; };

  test('prints the question paper without answers or schemes, and Q1 keys only in the side list', async () => {
    const exam = await laidPaper();
    const { prompt, labels } = Reader.buildReaderPrompt(exam, U);
    expect(labels.size).toBe(20);
    const paper = prompt.slice(prompt.indexOf(Reader.PAPER_HEAD), prompt.indexOf(Reader.KEYS_HEAD));
    // A Section C model answer and a Q2 answer never reach the paper text.
    const c3 = items(exam, 'urdu.C.Q3')[0];
    expect(paper).not.toContain(c3.answer.split('\n')[0]);
    const q2 = items(exam, 'urdu.B.Q2')[0];
    // (An answer the passage itself prints word for word is printed, as the passage.)
    const q2answers = q2.parts.flatMap((p) => (p.questions || []).map((x) => x.answer)).filter((ans) => !q2.passage.includes(ans.replace(/۔$/, '')));
    expect(q2answers.length).toBeGreaterThan(0);
    q2answers.forEach((ans) => expect(paper).not.toContain(ans));
    // The verses and Q3's words do print.
    expect(paper).toContain(items(exam, 'urdu.C.Q6')[0].passage.split('\n')[0]);
    expect(paper).toContain(items(exam, 'urdu.C.Q3')[0].words[0]);
    // Q1's keys come after the paper, one per item.
    const keys = prompt.slice(prompt.indexOf(Reader.KEYS_HEAD));
    expect(keys.split('\n').filter((l) => /^Q1\.\d+ → /.test(l))).toHaveLength(20);
  });

  test('parseFlags keeps a candidate only when it is judged given away, names a Q1 item of the prompt, and quotes text printed under its giver', () => {
    const labels = new Map([['Q1.1', {}], ['Q1.2', {}]]);
    const blocks = new Map([['Q1.1', Reader.fold('«نہ جانے»، «کیا خبر» اور «شاید»')], ['Q1.2', Reader.fold('کون سا جملہ شکیہ ہے؟')], ['Q4.1', Reader.fold('اگر تم محنت کرو گے ___ کامیاب')], ['Q4.2', Reader.fold('کاش')]]);
    const reply = { candidates: [
      { item: 'Q1.2', by: 'Q1.1', evidence: 'نہ جانے، کیا خبر اور شاید', reason: 'r', given_away: true },
      { item: 'Q1.1', by: 'Q4', evidence: 'اگر تم محنت کرو گے', reason: 'any Q4 item', given_away: true },
      { item: 'Q1.1', by: 'Q4.1', evidence: 'again', given_away: true },
      { item: 'Q1.2', by: 'Q6', evidence: 'شاید', given_away: true },
      { item: 'Q1.2', by: 'Q1.1', evidence: 'شاید', given_away: false },
      { item: 'Q2', by: 'Q1.1', evidence: 'شاید', given_away: true },
      { item: 'Q1.9', by: 'Q1.1', evidence: 'شاید', given_away: true },
      'x', null,
    ] };
    expect(Reader.parseFlags(reply, labels, null, blocks).map((f) => [f.item, f.by])).toEqual([['Q1.2', 'Q1.1'], ['Q1.1', 'Q4']]);
    // A quote the giver does not print is dropped (Q6 is not on this paper; Q4.2 does not print it).
    expect(Reader.parseFlags({ candidates: [{ item: 'Q1.1', by: 'Q4.2', evidence: 'محنت', given_away: true }] }, labels, null, blocks)).toEqual([]);
    // On a re-check only the items asked about count.
    expect(Reader.parseFlags(reply, labels, ['Q1.1'], blocks).map((f) => f.item)).toEqual(['Q1.1']);
    expect(() => Reader.parseFlags({ flags: [] }, labels)).toThrow();
    // An item is never its own giver by block: only its stem counts, and a quote needs a word of three letters.
    expect(Reader.parseFlags({ candidates: [{ item: 'Q1.1', by: 'Q1.1', evidence: 'شاید', given_away: true }] }, labels, null, blocks)).toEqual([]);
    expect(Reader.parseFlags({ candidates: [{ item: 'Q1.2', by: 'Q1.1', evidence: 'نہ', given_away: true }] }, labels, null, blocks)).toEqual([]);
    expect(Reader.parseFlags({ candidates: [{ item: 'Q1.2', by: 'Q1.1.', evidence: 'کیا خبر', given_away: true }] }, labels, null, blocks).map((f) => f.by)).toEqual(['Q1.1.']);
    // On a re-check, a flag on a kept item BY a replacement flags the replacement.
    expect(Reader.parseFlags({ candidates: [{ item: 'Q1.2', by: 'Q1.1', evidence: 'کیا خبر', given_away: true }] }, labels, ['Q1.1'], blocks))
      .toEqual([{ item: 'Q1.1', by: 'Q1.2', evidence: 'کیا خبر', reason: '', gives: true }]);
  });

  test('fold reads Arabic letter forms, diacritics and spacing as the same text', () => {
    expect(Reader.fold('سَحَر  کي')).toBe(Reader.fold('سحر کی'));
    expect(Reader.fold('«کاش»، ہم')).toBe(' کاش ہم ');
    expect(Reader.fold('سبق ٧')).toBe(Reader.fold('سبق ۷'));
    // Whole words: «کا» is not found inside «کاش».
    expect(Reader.fold('کاش ہم').includes(Reader.fold('کا'))).toBe(false);
  });
});

// A fourth local round (8 fresh papers) found four give-aways the reader judged NOT given away
// (its raw replies listed three of them as candidates with given_away:false). Each is a shape the
// prompt never named; the distractor rule even told it to pass the fourth.
describe('the shapes a local round missed', () => {
  const RULES = (() => {
    const { prompt } = Reader.buildReaderPrompt({ unseen: {} }, U);
    return prompt.slice(0, prompt.indexOf(Reader.PAPER_HEAD));
  })();

  test('the prompt names each shape as a give-away', () => {
    // A stem that, besides the word it asks about, prints a phrase meaning its key.
    expect(RULES).toMatch(/its own stem explains its key/);
    // A verse or passage whose sense answers the item, in other words.
    expect(RULES).toMatch(/the SENSE of a verse line or a passage sentence answers it/);
    // The key's idiom or word printed elsewhere in another form.
    expect(RULES).toMatch(/another form of its key/);
    // Another item's option that states the answer as a fact.
    expect(RULES).toMatch(/an option of another item states its answer as a fact/);
    // The old rule passed every distractor; only a bare word that tells nothing is passed now.
    expect(RULES).not.toMatch(/an option that is only a distractor elsewhere/);
  });

  test('each shape, flagged with its own quote, is kept by the evidence check', () => {
    const q = (question, options) => ({ question, options });
    const labels = new Map([
      ['Q1.2', q('سدرہ نے اپنے دوستوں کے ساتھ مل کر کیا بنایا؟', ['الف) کتب خانہ', 'ج) تھیڑ کمپنی'])],
      ['Q1.6', q('نظم میں ندی انسانوں سے کیا چاہتی ہے؟', ['الف) اسے صاف کیا جائے'])],
      ['Q1.13', q('«ٹکڑا ٹکڑا ہو جانا» کے مفہوم میں «خواب چکنا چور ہونا» کا مطلب کیا ہے؟', ['د) امیدوں کا ٹوٹ جانا'])],
      ['Q1.14', q('محاورے «دھوم مچ جانا» کا کیا مطلب ہے؟', ['د) بہت مشہور ہو جانا'])],
      ['Q1.17', q('سربراہ نے سدرہ سے کس بات کی اجازت مانگی؟', ['الف) یہی ڈراما پیش کرنے کی', 'ب) سدرہ کی تھیڑ کمپنی بند کرنے کی'])],
    ]);
    const blocks = new Map([...labels].map(([l, x]) => [l, Reader.fold([x.question, x.options.join(' | ')].join(' '))]));
    blocks.set('Q5', Reader.fold('دھوم مچانا، منھ پھیر لینا'));
    blocks.set('Q6', Reader.fold('یہ گندگی ہے کیسی آئی ہے یہ کہاں سے؟'));
    const reply = { candidates: [
      { item: 'Q1.2', by: 'Q1.17', evidence: 'سدرہ کی تھیڑ کمپنی', given_away: true },
      { item: 'Q1.6', by: 'Q6', evidence: 'یہ گندگی ہے کیسی آئی ہے یہ کہاں سے؟', given_away: true },
      { item: 'Q1.13', by: 'Q1.13', evidence: 'ٹکڑا ٹکڑا ہو جانا', given_away: true },
      { item: 'Q1.14', by: 'Q5', evidence: 'دھوم مچانا', given_away: true },
    ] };
    expect(Reader.parseFlags(reply, labels, null, blocks).map((f) => f.item)).toEqual(['Q1.2', 'Q1.6', 'Q1.13', 'Q1.14']);
  });
});

describe('only Urdu (and Social Studies, its own pass)', () => {
  test('the subjects the pass can ever read', () => {
    expect(Reader.READER_SUBJECTS).toEqual(['urdu', 'social_studies']);
  });

  // A Maths pattern paper from the recorded fixture, each section answered with its own slots.
  const maths = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'maths.json'), 'utf8'));
  function serveMaths() {
    let reads = 0;
    mockCreate.mockImplementation(async (req) => {
      const prompt = textOf(req);
      if (isReader(prompt)) { reads += 1; return { choices: [{ message: { content: '{"candidates":[]}' }, finish_reason: 'stop' }], usage: {} }; }
      const tree = { unseen: {} };
      for (const [cat, types] of Object.entries(maths.unseen)) {
        for (const [type, list] of Object.entries(types)) {
          const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`));
          if (mine.length) ((tree.unseen[cat] ||= {})[type] = mine);
        }
      }
      return { choices: [{ message: { content: JSON.stringify(tree) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    });
    return () => reads;
  }
  const mathsRun = (extra) => Gen.generatePatternExam({ grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null }, ...extra });

  test('a Maths paper told to read is never read, and is the paper it is without the pass', async () => {
    serveMaths();
    const off = await mathsRun({});
    mockCreate.mockReset(); mockLog.mockReset();
    const reads = serveMaths();
    const on = await mathsRun({ readerPass: true });
    expect(reads()).toBe(0);
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(stable(on.examJson)).toEqual(stable(off.examJson));
    expect(mockLog.mock.calls.some(([m]) => m === '[assessment] reader pass')).toBe(false);
  });
});
