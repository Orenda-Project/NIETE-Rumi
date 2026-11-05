/**
 * Social Studies reader pass: a caught question never prints, the record keeps what the reader caught,
 * and the first ask for Q5, Q6 and Q7 carries spares.
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
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 40 ===\nسبق کا متن', pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const ALL = Patterns.get('fde_g5_2027').subjects;
const SST = ALL.social_studies;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const paper = (p) => fixture(`r17-sst-local-${p}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t)).flat().filter((q) => q && q.slot === slot);
const lay = (exam, opts) => applyLayout(clone(exam), SST, scopeOf(exam), opts);
const stems = (exam, slot) => items(exam, slot).map((q) => q.question);
const Q1 = 'social_studies.A.Q1';
const B4 = 'social_studies.B.Q4';
const C5 = 'social_studies.C.Q5';
const D6 = 'social_studies.D.Q6';
const D7 = 'social_studies.D.Q7';
const section = (id) => SST.sections.find((s) => s.id === id);
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (text) => text.includes(Reader.READER_MARK);
const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));

// One section's reply as the model writes it: unseen → category → type → [items].
function replyOf(exam, sectionId) {
  const tree = { unseen: {} };
  for (const slot of section(sectionId).slots) {
    ((tree.unseen[slot.category] ||= {})[slot.type] ||= []).push(...items(exam, slot.slot).map((q) => ({ ...q })));
  }
  return JSON.stringify(tree);
}

/**
 * The engine on a recorded paper. `replies[sec]` are served in turn (the last one again after);
 * `reader(text, n)` answers the reader's calls; `topUp` answers a D call carrying the reader's note.
 */
async function run(exam, { replies = {}, reader = null, topUp = null, readerPass = false } = {}) {
  // Section A's re-ask writes new Q1 items: a Q1 item a C or D stem gives away is held and Section A asked
  // again, and a recorded paper has no reply of its own for that.
  const queue = {
    A: replies.A || [replyOf(exam, 'A'), fixture('sst-a-reask-fresh').reply], B: replies.B || [replyOf(exam, 'B')], C: replies.C || [replyOf(exam, 'C')], D: replies.D || [replyOf(exam, 'D')],
  };
  const asked = [];
  mockCreate.mockReset();
  mockLog.mockReset();
  mockCreate.mockImplementation(async (req) => {
    const text = textOf(req);
    if (isReader(text)) {
      const n = asked.filter((a) => a.sec === 'reader').length + 1;
      asked.push({ sec: 'reader', text, req });
      const content = await reader(text, n);
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 9000, completion_tokens: 300, total_tokens: 9300 } };
    }
    const sec = sectionOf(text);
    asked.push({ sec, text });
    let content;
    if (sec === 'D' && topUp && text.includes('A reader of this paper found')) content = topUp;
    else content = queue[sec].length > 1 ? queue[sec].shift() : queue[sec][0];
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  });
  const out = await Gen.generatePatternExam({
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: scopeOf(exam), pageRanges: '1-20', requestId: 'req-r17b',
    ...(readerPass ? { readerPass: true } : {}),
  }).catch((e) => ({ error: e }));
  return { asked, out };
}
const logged = (msg) => mockLog.mock.calls.filter(([m]) => m === msg).map(([, d]) => d);
// generated_at is the clock's; everything else must match.
const stable = (exam) => { const e = clone(exam); delete e._layout.generated_at; delete e._layout.reader; return e; };

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

// chapters_1 keys one Q5 on a religious premise («… حضرت آدم اور حضرت حوا علیہما السلام کی اولاد ہیں»),
// which the engine now drops; the counts here are read off a plain layout, so that item takes a civic
// answer and the paper is otherwise as recorded.
const civic = (exam) => {
  const e = JSON.parse(JSON.stringify(exam));
  for (const q of Object.values(e.unseen).flatMap((t) => Object.values(t)).flat()) {
    if (q && typeof q.answer === 'string') q.answer = q.answer.replace('اور حضرت آدم اور حضرت حوا علیہما السلام کی اولاد ہیں', 'اور اقوام متحدہ کا منشور سب کو برابر مانتا ہے');
  }
  return e;
};
const CH1 = civic(paper('chapters_1'));
const CH2 = paper('chapters_2');
const labelsOf = (text, prefix) => text.split('\n').filter((x) => new RegExp(`^${prefix}\\.\\d+ `).test(x)).map((x) => x.split(' ')[0]);
const q1Evidence = (text, n = 20) => { const l = text.split('\n').find((x) => x.startsWith(`Q1.${n} →`)); return l.split('→')[1].trim().split(' ').slice(0, 3).join(' '); };

describe('1. a reader-caught item never prints, even when taking it off would leave the slot short', () => {
  test('setup: chapters_1 C.Q5 after the re-ask layout, and the floor', () => {
    const n = items(lay(CH1, { reasked: true }).examJson, C5).length;
    const slot = SST.sections.flatMap((s) => s.slots).find((s) => s.slot === C5);
    expect({ n, floor: slot.attempt + 1 }).toEqual({ n: expect.any(Number), floor: 7 });
  });

  test('chapters_1: the reader flags enough Q5s to take C.Q5 below attempt + 1; none of them prints', async () => {
    const before = items(lay(CH1, { reasked: true }).examJson, C5).length;
    const k = before - 6; // leaves 6 < 7
    let flaggedStems = [];
    const { out } = await run(CH1, {
      readerPass: true,
      reader: async (text, n) => {
        if (n !== 1) return JSON.stringify({ candidates: [] });
        const ev = q1Evidence(text);
        const labs = labelsOf(text, 'Q5').slice(0, k);
        const exam = lay(CH1, { reasked: true }).examJson;
        flaggedStems = labs.map((l) => items(exam, C5)[Number(l.split('.')[1]) - 1].question);
        return JSON.stringify({ candidates: labs.map((item) => ({ item, by: 'Q1.20', evidence: ev, reason: 'answered by Q1 20', given_away: true })) });
      },
    });
    expect(flaggedStems.length).toBe(k);
    const printed = out.error ? [] : stems(out.examJson, C5);
    // The ruling: a caught question never prints. Either the paper fails closed, or none prints.
    expect(flaggedStems.filter((s) => printed.includes(s))).toEqual([]);
  });

  test('chapters_1, same: if the paper prints, its reader record names every flagged item', async () => {
    const before = items(lay(CH1, { reasked: true }).examJson, C5).length;
    const { out } = await run(CH1, {
      readerPass: true,
      reader: async (text) => JSON.stringify({ candidates: labelsOf(text, 'Q5').slice(0, before - 6).map((item) => ({ item, by: 'Q1.20', evidence: q1Evidence(text), reason: 'r', given_away: true })) }),
    });
    if (out.error) return; // failing closed is also within the ruling
    expect(out.examJson._layout.reader.items.length).toBe(before - 6);
  });

  test('chapters_2: two Q7s flagged, the top-up writes nothing new; neither flagged Q7 prints', async () => {
    let flaggedStems = [];
    const empty = JSON.stringify({ unseen: { subjective: { 'Short Questions (2)': [] } } });
    const { out } = await run(CH2, {
      readerPass: true,
      topUp: empty,
      reader: async (text, n) => {
        if (n !== 1) return JSON.stringify({ candidates: [] });
        const labs = labelsOf(text, 'Q7').slice(0, 2);
        const exam = lay(CH2, { reasked: true }).examJson;
        flaggedStems = labs.map((l) => items(exam, D7)[Number(l.split('.')[1]) - 1].question);
        return JSON.stringify({ candidates: labs.map((item) => ({ item, by: item, evidence: items(exam, D7)[Number(item.split('.')[1]) - 1].question.split(' ').slice(0, 3).join(' '), reason: 'own stem', given_away: true })) });
      },
    });
    expect(flaggedStems.length).toBe(2);
    const printed = out.error ? [] : stems(out.examJson, D7);
    expect(flaggedStems.filter((s) => printed.includes(s))).toEqual([]);
  });
});

describe('controls', () => {
  test('one Q5 flagged on chapters_1 (stays at or above the floor): taken off, recorded', async () => {
    const before = items(lay(CH1, { reasked: true }).examJson, C5).length;
    const { out } = await run(CH1, {
      readerPass: true,
      reader: async (text) => JSON.stringify({ candidates: [{ item: 'Q5.1', by: 'Q1.20', evidence: q1Evidence(text), reason: 'r', given_away: true }] }),
    });
    expect(out.error).toBeUndefined();
    if (before - 1 >= 7) expect(items(out.examJson, C5)).toHaveLength(before - 1);
  });

  test('a flag on a Q1 label or an unknown label is ignored: the paper equals pass OFF', async () => {
    const off = await run(CH2);
    const on = await run(CH2, { readerPass: true, reader: async () => JSON.stringify({ candidates: [{ item: 'Q1.3', by: 'Q1.4', evidence: 'x y z', reason: 'r', given_away: true }, { item: 'Q9.1', by: 'Q1.4', evidence: 'abc def', given_away: true }] }) });
    expect(on.out.error).toBeUndefined();
    expect(stable(on.out.examJson)).toEqual(stable(off.out.examJson));
  });

  test('reader flag ON for urdu only: an SST paper makes no reader call (the orchestrator gate)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/assessment/assessment-orchestrator.service.js'), 'utf8');
    expect(src).toMatch(/READER_SUBJECTS\.includes\(readKey\) && \(await fdeReaderPassSubjects\(\)\)\.includes\(readKey\)/);
  });

  test('_layout.short_choice carries no free text (the renderer scans _layout)', () => {
    const exam = lay(CH1, { reasked: true }).examJson;
    for (const c of exam._layout.short_choice || []) expect(Object.keys(c).sort()).toEqual(['generate', 'printed', 'slot']);
  });
});

describe('2. a paper that fails closed names what the reader caught', () => {
  test('chapters_1: C.Q5 below its floor refuses PATTERN_SHORT_SLOT with every flag on the record', async () => {
    const before = items(lay(CH1, { reasked: true }).examJson, C5).length;
    const k = before - 6;
    const { out } = await run(CH1, {
      readerPass: true,
      reader: async (text) => JSON.stringify({ candidates: labelsOf(text, 'Q5').slice(0, k).map((item) => ({ item, by: 'Q1.20', evidence: q1Evidence(text), reason: 'answered by Q1 20', given_away: true })) }),
    });
    expect(out.error && out.error.code).toBe('PATTERN_SHORT_SLOT');
    expect(out.error.shortfall.map((f) => f.slot)).toContain(C5);
    const rec = out.error.examJson._layout.reader;
    expect(rec.error).toBe('the paper would be short');
    expect(rec.flagged).toBe(k);
    expect(rec.items).toHaveLength(k);
    expect(rec.items.every((i) => i.outcome === 'taken_off')).toBe(true);
    // The refused paper itself carries none of the caught items.
    const kept = items(out.error.examJson, C5).map((q) => q.question);
    const caught = rec.items.map((i) => i.label);
    expect(kept).toHaveLength(6);
    expect(caught.every((l) => /^Q5\.\d+$/.test(l))).toBe(true);
    const line = logged('[assessment] reader pass').pop();
    expect(line).toMatchObject({ subject: 'social_studies', flagged: k, error: 'the paper would be short' });
  });

  test('chapters_2: a top-up that writes nothing new refuses, and the record names both Q7s', async () => {
    const empty = JSON.stringify({ unseen: { subjective: { 'Short Questions (2)': [] } } });
    const { out } = await run(CH2, {
      readerPass: true,
      topUp: empty,
      reader: async (text, n) => {
        if (n !== 1) return JSON.stringify({ candidates: [] });
        const exam = lay(CH2, { reasked: true }).examJson;
        return JSON.stringify({ candidates: labelsOf(text, 'Q7').slice(0, 2).map((item) => ({ item, by: item, evidence: items(exam, D7)[Number(item.split('.')[1]) - 1].question.split(' ').slice(0, 3).join(' '), reason: 'own stem', given_away: true })) });
      },
    });
    expect(out.error && out.error.code).toBe('PATTERN_SHORT_SLOT');
    expect(out.error.examJson._layout.reader.items.map((i) => i.label)).toEqual(['Q7.1', 'Q7.2']);
  });
});

describe('3. the first ask for C and D carries spares (Social Studies only)', () => {
  const slotLine = (text, slot) => text.split('\n').find((l) => l.includes(`tag every item "slot": "${slot}"`));
  test('C.Q5 asks 9 + 2, D.Q6 6 + 2, D.Q7 8 + 2; the paper still prints 9, 6 and 8', async () => {
    const { asked, out } = await run(CH1);
    const c = asked.find((a) => a.sec === 'C').text;
    const d = asked.find((a) => a.sec === 'D').text;
    expect(slotLine(c, C5)).toMatch(/generate EXACTLY 11 items/);
    expect(slotLine(d, D6)).toMatch(/generate EXACTLY 8 items/);
    expect(slotLine(d, D7)).toMatch(/generate EXACTLY 10 items/);
    expect(c).toMatch(/the paper prints the first 9 /);
    expect(out.error).toBeUndefined();
    expect(items(out.examJson, C5).length).toBeLessThanOrEqual(9);
  });

  test('Section A and B ask exactly what they print', async () => {
    const { asked } = await run(CH1);
    const a = asked.find((x) => x.sec === 'A').text;
    expect(slotLine(a, Q1)).toMatch(/generate EXACTLY 20 items/);
    expect(a).not.toMatch(/the paper prints the first/);
  });
});
