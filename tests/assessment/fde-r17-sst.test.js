/**
 * Round-17 Social Studies (eight local papers on the round-15 head: 14 T6-A items against an
 * allowance of 1, and one paper refused for an empty mind map):
 *
 *   1. The reader pass reads Social Studies too. It judges the Q5, Q6 and Q7 items by T6-A: a
 *      duplicate, an item whose whole answer Section A prints (a Q1 key, or a fact a Q1 stem states:
 *      chapters_2 Q7 ۲ «… کس سال ابھرا؟ → 1947ء» beside Q1 ۵ «پاکستان 1947ء میں …»), and an item
 *      whose points another C/D item's answer contains. A flagged D item is taken off, Section D is
 *      topped up once, and the reader checks the replacements only; a flagged Q5 is taken off.
 *   2. A caught question never prints. After the extra D ask, a held item does not go back: a choice
 *      slot (Q5, Q6, Q7) prints fewer items while it still offers a choice (at least its count to
 *      answer plus one), its count to answer and its marks unchanged; below that, and in a
 *      compulsory slot, the slot is short and the paper fails as a short paper always has.
 *      (chapters_6 printed Q7 ۷ «پاکستان کے پہلے وزیر اعظم کون تھے؟» = Q1 ۳ through the put-back.)
 *   3. B's re-ask for an empty mind map names it where the reply carries it ("Mind Map", its slot):
 *      chapters_5's two B replies both had no mind map, the second told only «Q4 needs 1 more».
 *
 * The papers are local model output (people in them are the model's own fictional ones).
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
// A Q1 item whose key a C/D stem names is held by its own rule, and Section A is asked again; these tests
// read the choice slots, so they set Section A's places aside.
const notQ1 = (shortfall) => shortfall.filter((f) => f.slot !== Q1);
const namedQ1 = (r) => r.held.filter((h) => h.slot === Q1 && h.rule === 'key_named_in_stem').length;
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
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: scopeOf(exam), pageRanges: '1-20', requestId: 'req-r17',
    ...(readerPass ? { readerPass: true } : {}),
  }).catch((e) => ({ error: e }));
  return { asked, out };
}
const logged = (msg) => mockLog.mock.calls.filter(([m]) => m === msg).map(([, d]) => d);
// generated_at is the clock's; everything else must match.
const stable = (exam) => { const e = clone(exam); delete e._layout.generated_at; delete e._layout.reader; return e; };

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

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

describe('2. a caught question never prints', () => {
  // chapters_6's which-government Q6 («… کس حکومت کی ذمہ داری ہے؟») only names who does each job, so it
  // is held as recall; here it is a fictional two-idea situation, so these tests read Q7.
  const CH6 = (() => {
    const ex = paper('chapters_6');
    const q = items(ex, D6).find((x) => /کس حکومت کی ذمہ داری/.test(x.question));
    q.question = 'سلیم کی گلی میں روز کچرا جمع ہوتا ہے اور ہمسائے ایک دوسرے کو الزام دیتے ہیں۔ سلیم کو کیا کرنا چاہیے؟ دو باتیں بتائیں اور ہر ایک کی وجہ لکھیں۔';
    q.scheme = { ...q.scheme, points: [
      { text: 'ہمسایوں سے مل کر صفائی کی باری طے کرنا تاکہ جھگڑا نہ ہو', marks: 3, kind: 'A' },
      { text: 'کچرا کوڑے دان میں ڈالنے کی عادت تاکہ بیماری نہ پھیلے', marks: 3, kind: 'A' },
    ] };
    return ex;
  })();
  const FULL2 = paper('full_2');
  const FULL1 = paper('full_1');

  test('the fixtures are the items the local review named', () => {
    expect(stems(CH6, D7)).toContain('پاکستان کے پہلے وزیر اعظم کون تھے؟');
    expect(stems(CH6, Q1).some((s) => /پہلے وزیر اعظم/.test(s))).toBe(true);
    expect(stems(FULL2, D7)).toContain('پاکستان کا سب سے بڑا صحرا کون سا ہے؟');
  });

  // The rule: a choice slot prints what it has while it still offers a choice
  // (printed >= attempt + 1). At its count to answer the child has no choice left: that is the
  // compulsory rule, a re-ask and then a short paper.
  // chapters_6 with its second held Q7 swapped for a fresh one (a fictional item, not in Section A).
  const oneHeldQ7 = () => {
    const ex = clone(CH6);
    const q = items(ex, D7).find((x) => /اسلامیہ کالج پشاور کا سنگ بنیاد/.test(x.question));
    q.question = 'پاکستان کا قومی پرندہ کون سا ہے؟';
    q.answer = 'چکور';
    if (q.scheme) q.scheme = { ...q.scheme, points: ['چکور'], accept: [] };
    return ex;
  };

  test('chapters_6: the two Q7s held against Section A do not print; with no choice left (6 of 8, answer 6) Q7 is short', () => {
    const r = lay(CH6, { reasked: true });
    const printed = stems(r.examJson, D7);
    expect(printed).not.toContain('پاکستان کے پہلے وزیر اعظم کون تھے؟');
    expect(printed.some((s) => /اسلامیہ کالج پشاور کا سنگ بنیاد/.test(s))).toBe(false);
    expect(printed).toHaveLength(6);
    expect(notQ1(r.shortfall)).toEqual([{ slot: D7, missing: 1 }]);
    expect(r.held.filter((h) => h.printed)).toEqual([]);
  });

  test('one Q7 held: Q7 prints 7 of 8, still a choice, and is not short', () => {
    const r = lay(oneHeldQ7(), { reasked: true });
    expect(stems(r.examJson, D7)).not.toContain('پاکستان کے پہلے وزیر اعظم کون تھے؟');
    expect(stems(r.examJson, D7)).toHaveLength(7);
    expect(notQ1(r.shortfall)).toEqual([]);
    // Q6 «… گلگت بلتستان … تین جون کے منصوبے …» asks only what was done (book recall), so Q6 prints 5 of 6 too.
    expect(r.examJson._layout.short_choice).toEqual([{ slot: D6, printed: 5, generate: 6 }, { slot: D7, printed: 7, generate: 8 }]);
  });

  test('full_2 Q7 ۸ (= Q1 ۱۶) and full_1\'s which-government Q6 do not print; full_1 Q6 ۶ (held before only on marking-only points) prints', () => {
    expect(stems(lay(FULL2, { reasked: true }).examJson, D7)).not.toContain('پاکستان کا سب سے بڑا صحرا کون سا ہے؟');
    const f1 = lay(FULL1, { reasked: true });
    expect(stems(f1.examJson, D6).some((s) => /صفائی مہم/.test(s))).toBe(true);
    expect(stems(f1.examJson, D6).some((s) => /مویشی منڈی کا انتظام کون سی حکومت/.test(s))).toBe(false);
    expect(stems(f1.examJson, D6)).toHaveLength(5);
    expect(notQ1(f1.shortfall)).toEqual([]);
  });

  test('a choice slot below its count to answer plus one is short', () => {
    const cut = clone(CH6);
    const kept = items(lay(CH6, { reasked: true }).examJson, D7).slice(0, 5).map((q) => q.question);
    for (const types of Object.values(cut.unseen)) for (const [t, l] of Object.entries(types)) types[t] = l.filter((q) => q.slot !== D7 || kept.includes(q.question));
    expect(notQ1(lay(cut, { reasked: true }).shortfall)).toEqual([{ slot: D7, missing: 2 }]);
  });

  test('a compulsory slot never prints a repeat to fill its place: A.Q1 is short', () => {
    const dup = oneHeldQ7();
    const mcqs = dup.unseen.objective.MCQs;
    mcqs[19] = clone(mcqs[0]);
    const r = lay(dup, { reasked: true });
    expect(stems(r.examJson, Q1).filter((s) => s === mcqs[0].question)).toHaveLength(1);
    expect(stems(r.examJson, Q1)).toHaveLength(19 - namedQ1(r));
    expect(r.shortfall).toEqual([{ slot: Q1, missing: 1 + namedQ1(r) }]);
  });

  test('before the re-ask a choice slot is still short of what it offers (so it is asked again)', () => {
    expect(lay(CH6, { reasked: false }).shortfall.find((f) => f.slot === D7)).toEqual({ slot: D7, missing: 2 });
  });

  test('through the engine: chapters_6 with one Q7 held builds, the held Q7 does not print, and the log names the short choice', async () => {
    const { out } = await run(oneHeldQ7());
    expect(out.error).toBeUndefined();
    expect(stems(out.examJson, D7)).not.toContain('پاکستان کے پہلے وزیر اعظم کون تھے؟');
    expect(stems(out.examJson, D7)).toHaveLength(7);
    const row = logged('[assessment] held items')[0];
    expect(row.held.every((h) => h.printed === 0)).toBe(true);
    expect(row.shortChoice).toEqual(expect.arrayContaining([expect.objectContaining({ slot: D7, printed: 7 })]));
  });

  test('through the engine: chapters_6 with both Q7s held and nothing new from the re-ask fails closed on Q7', async () => {
    const { out } = await run(CH6);
    expect(out.error && out.error.code).toBe('PATTERN_SHORT_SLOT');
    expect(out.error.shortfall).toEqual([{ slot: D7, missing: 1 }]);
  });
});

describe('3. an empty mind map: B\'s re-ask names it', () => {
  const rec = fixture('r17-sst-local-chapters_5-replies');
  const FULL1 = paper('full_1');
  const mindMap = items(FULL1, B4)[0];
  const withMap = (json) => {
    const tree = JSON.parse(json);
    tree.unseen.subjective['Mind Map'] = [clone(mindMap)];
    return JSON.stringify(tree);
  };
  // The recorded D replies (chapters 4 + 6) carry which-government Q6s that only name who does each job,
  // held as recall. Here they explain with two ideas, so D fills and the
  // test reads B alone.
  const explained = (json) => {
    const tree = JSON.parse(json);
    for (const q of tree.unseen.subjective['Long Question'] || []) {
      if (!/Q6/.test(q.slot) || !/حکومت/.test(q.question)) continue;
      q.scheme = { ...q.scheme, points: [
        { text: 'مل کر کام کرنے سے مسئلہ جلد حل ہوتا ہے کیونکہ ہر ایک اپنا حصہ سنبھالتا ہے', marks: 3, kind: 'A' },
        { text: 'شہری شکایت درج کرا کے اور صفائی رکھ کر خود بھی مدد کرتے ہیں', marks: 3, kind: 'A' },
      ] };
    }
    return JSON.stringify(tree);
  };
  // chapters_5's exam as the engine sees it: the recorded replies stand in for a paper.
  const exam = { _layout: { scope: { kind: 'chapters', chapters: rec.scope.chapters, pages: rec.scope.pages } }, unseen: {} };

  test('the recorded B replies have no mind map', () => {
    for (const r of rec.replies.B) expect(JSON.parse(r).unseen.subjective['Mind Map'] || []).toEqual([]);
  });

  test('the re-ask asks for exactly one "Mind Map" item under its slot, and the paper builds', async () => {
    const { asked, out } = await run(exam, {
      replies: { A: [...rec.replies.A, fixture('sst-a-reask-fresh').reply], B: [rec.replies.B[0], withMap(rec.replies.B[1])], C: rec.replies.C, D: rec.replies.D.map(explained) },
    });
    const bs = asked.filter((a) => a.sec === 'B');
    expect(bs).toHaveLength(2);
    const note = bs[1].text.slice(bs[0].text.length);
    expect(note).toMatch(/exactly one Q4 item/);
    expect(note).toContain('"Mind Map"');
    expect(note).toContain(`"slot": "${B4}"`);
    expect(note).not.toMatch(/write \d+ new Q4 items/);
    expect(out.error && out.error.code).toBeUndefined();
    expect(items(out.examJson, B4)).toHaveLength(1);
  });
});

describe('1. the reader pass reads Social Studies', () => {
  const CH2 = paper('chapters_2');
  const CH1 = civic(paper('chapters_1'));
  const YEAR_Q7 = 'پاکستان دنیا کے نقشے پر کس سال ابھرا؟';
  // Replacement Q7s the top-up writes (fictional, one-fact).
  const NEW_Q7 = [
    ['دریائے سندھ کس سمندر میں گرتا ہے؟', 'بحیرہ عرب'],
    ['پاکستان کا قومی کھیل کون سا ہے؟', 'ہاکی'],
    ['کوہ ہمالیہ کس سمت میں واقع ہے؟', 'شمال'],
    ['ضلعی حکومت کا سربراہ کون ہوتا ہے؟', 'ضلع ناظم'],
  ].map(([q, a]) => ({ slot: D7, question: q, answer: a, scheme: { points: [{ text: a, marks: 2 }] } }));
  const topUp = JSON.stringify({ unseen: { subjective: { 'Short Questions (2)': NEW_Q7 } } });
  const labelOf = (text, re) => { const l = text.split('\n').find((x) => /^Q\d\.\d+ /.test(x) && re.test(x)); return l ? l.split(' ')[0] : null; };

  test('Social Studies is a reader subject; its prompt judges Q5, Q6 and Q7 and lists their answers', () => {
    expect(Reader.READER_SUBJECTS).toEqual(expect.arrayContaining(['urdu', 'social_studies']));
    const exam = lay(CH2, { reasked: true }).examJson;
    const { prompt, labels } = Reader.buildReaderPrompt(exam, SST);
    expect([...labels.keys()].filter((l) => l.startsWith('Q7.'))).toHaveLength(items(exam, D7).length);
    expect([...labels.keys()].some((l) => l.startsWith('Q1.'))).toBe(false);
    expect(prompt).toContain(Reader.ANSWERS_HEAD);
    expect(prompt).toMatch(/^Q1\.5 → .*قائد اعظم/m);
    expect(prompt).toMatch(/^Q7\.\d+ → پاکستان 1947ء میں دنیا کے نقشے پر ابھرا۔/m);
    expect(prompt).toMatch(/a fact a Q1 stem states/);
  });

  test('the Urdu prompt and note are byte-identical to before', () => {
    const crypto = require('crypto');
    const want = fixture('r17-urdu-reader-prompt-sha');
    const U = ALL.urdu;
    const dir = path.join(__dirname, 'fixtures', 'fde');
    for (const [f, sha] of Object.entries(want)) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const a = Reader.buildReaderPrompt(j, U);
      const b = Reader.buildReaderPrompt(j, U, { only: Reader.itemsOf(j, 'urdu.A.Q1').slice(0, 2) });
      const note = Reader.readerNote([{ item: [...a.labels.keys()][0], by: 'Q2', reason: 'x' }], a.labels);
      // The candidate list code appends for the reader is its own block, checked by its own tests; every
      // byte before it stays as it was.
      const cut = (prompt) => prompt.split(`\n\n${Reader.CANDIDATES_HEAD}`)[0];
      const got = crypto.createHash('sha256').update(`${cut(a.prompt)}\u0000${cut(b.prompt)}\u0000${note}\u0000${JSON.stringify([...a.blocks])}`).digest('base64');
      expect([f, got]).toEqual([f, sha]);
    }
  });

  test('chapters_2: a Q7 Section A gives away is taken off, D is topped up once, the reader checks only the replacements', async () => {
    let flagged = null;
    const { asked, out } = await run(CH2, {
      readerPass: true,
      topUp,
      reader: async (text, n) => {
        if (n === 1) {
          flagged = labelOf(text, /کس سال ابھرا/);
          return JSON.stringify({ candidates: [
            { item: flagged, by: 'Q1.5', evidence: 'پاکستان 1947ء میں', reason: 'Q1 ۵ states the year', given_away: true },
            { item: 'Q5.1', by: 'Q1.2', evidence: 'حکومت', reason: 'only a shared word', given_away: false },
          ] });
        }
        return JSON.stringify({ candidates: [] });
      },
    });
    expect(out.error).toBeUndefined();
    expect(flagged).toMatch(/^Q7\.\d+$/);
    expect(stems(out.examJson, D7)).not.toContain(YEAR_Q7);
    expect(stems(out.examJson, D7)).toContain(NEW_Q7[0].question);
    const readers = asked.filter((a) => a.sec === 'reader');
    expect(readers).toHaveLength(2);
    expect(readers[0].req).toMatchObject({ job: 'assessment.generate', response_format: { type: 'json_object' }, reasoning: { effort: 'high' } });
    // The re-check judges only the replacements.
    const only = readers[1].text.split('\n').find((l) => l.startsWith(Reader.ONLY_HEAD));
    expect(only).toBeTruthy();
    const named = only.split(' The other')[0].match(/Q\d\.\d+/g);
    expect(named).toEqual([labelOf(readers[1].text, /دریائے سندھ/)]);
    // One D top-up, told what was taken off; no C or A call after the read.
    const afterRead = asked.slice(asked.indexOf(readers[0]) + 1);
    expect(afterRead.filter((a) => a.sec === 'D')).toHaveLength(1);
    expect(afterRead.filter((a) => a.sec === 'C' || a.sec === 'A')).toHaveLength(0);
    expect(afterRead.find((a) => a.sec === 'D').text).toContain(YEAR_Q7);
    expect(out.examJson._layout.reader).toMatchObject({ flagged: 1, still_flagged: 0, items: [{ label: flagged, by: 'Q1.5', outcome: 'replaced' }] });
    expect(logged('[assessment] reader pass')[0]).toMatchObject({ requestId: 'req-r17', subject: 'social_studies', flagged: 1 });
  });

  test('a replacement the reader still flags is taken off too, and never comes back', async () => {
    const { out } = await run(CH2, {
      readerPass: true,
      topUp,
      reader: async (text, n) => {
        if (n === 1) return JSON.stringify({ candidates: [{ item: labelOf(text, /کس سال ابھرا/), by: 'Q1.5', evidence: 'پاکستان 1947ء میں', reason: 'year', given_away: true }] });
        // The one replacement placed (Q7 was one short) restates a Q5 answer.
        return JSON.stringify({ candidates: [{ item: labelOf(text, /دریائے سندھ/), by: labelOf(text, /دریائے سندھ/), evidence: 'دریائے سندھ کس سمندر', reason: 'own stem', given_away: true }] });
      },
    });
    expect(out.error).toBeUndefined();
    expect(stems(out.examJson, D7)).not.toContain(YEAR_Q7);
    expect(stems(out.examJson, D7)).not.toContain(NEW_Q7[0].question);
    expect(stems(out.examJson, D7)).toHaveLength(7);
    expect(out.examJson._layout.reader).toMatchObject({ flagged: 1, still_flagged: 1 });
  });

  test('chapters_1: a flagged Q5 is taken off with no re-ask; Q5 prints fewer items', async () => {
    const before = items(lay(CH1, { reasked: true }).examJson, C5).length;
    let flagged = null;
    const { asked, out } = await run(CH1, {
      readerPass: true,
      reader: async (text, n) => {
        if (n !== 1) throw new Error('no second read without a replacement');
        flagged = 'Q5.8';
        const q5 = items(lay(CH1, { reasked: true }).examJson, C5)[7];
        const q1 = text.split('\n').find((l) => l.startsWith('Q1.20 →'));
        return JSON.stringify({ candidates: [{ item: flagged, by: 'Q1.20', evidence: q1.split('→')[1].trim().split(' ').slice(0, 3).join(' '), reason: `${q5.question.slice(0, 20)} answered by Q1 ۲۰`, given_away: true }] });
      },
    });
    expect(out.error).toBeUndefined();
    expect(items(out.examJson, C5)).toHaveLength(before - 1);
    const readers = asked.filter((a) => a.sec === 'reader');
    expect(readers).toHaveLength(1);
    expect(asked.slice(asked.indexOf(readers[0]) + 1)).toHaveLength(0);
    expect(out.examJson._layout.reader).toMatchObject({ flagged: 1, items: [{ label: 'Q5.8', outcome: 'taken_off' }] });
  });

  test.each([
    ['a failed read', async () => { throw new Error('timeout'); }],
    ['a reply with no candidates list', async () => '{"flags":[]}'],
  ])('%s: the paper prints as it would without the pass, the error recorded', async (name, reader) => {
    const off = await run(CH2);
    const on = await run(CH2, { readerPass: true, reader });
    expect(on.out.error).toBeUndefined();
    expect(stable(on.out.examJson)).toEqual(stable(off.out.examJson));
    expect(on.out.examJson._layout.reader.error).toMatch(/^read: /);
  });

  test('pass OFF: no reader call, and no reader record', async () => {
    const { asked, out } = await run(CH2);
    expect(asked.some((a) => a.sec === 'reader')).toBe(false);
    expect(out.examJson._layout.reader).toBeUndefined();
  });
});

describe('1b. the reader\'s record never makes the paper refuse', () => {
  // SST items print «اسی طرح» in their own text on recorded papers; a reader reason that quotes one
  // lands in _layout.reader, which the renderer must not read as review chrome.
  const { renderPaper, renderMarkingScheme } = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
  const CH2 = paper('chapters_2');
  const NEW_Q7 = { slot: D7, question: 'دریائے سندھ کس سمندر میں گرتا ہے؟', answer: 'بحیرہ عرب', scheme: { points: [{ text: 'بحیرہ عرب', marks: 2 }] } };
  const topUp = JSON.stringify({ unseen: { subjective: { 'Short Questions (2)': [NEW_Q7] } } });
  const labelOf = (text, re) => { const l = text.split('\n').find((x) => /^Q\d\.\d+ /.test(x) && re.test(x)); return l ? l.split(' ')[0] : null; };

  test.each(['اسی طرح', 'مسودہ', 'needs review', 'filler'])('a reason quoting «%s»: the paper and the scheme render', async (quoted) => {
    const { out } = await run(CH2, {
      readerPass: true,
      topUp,
      reader: async (text, n) => (n === 1
        ? JSON.stringify({ candidates: [{ item: labelOf(text, /کس سال ابھرا/), by: 'Q1.5', evidence: 'پاکستان 1947ء میں', reason: `Q1 ۵ states the year, «${quoted}»`, given_away: true }] })
        : JSON.stringify({ candidates: [] })),
    });
    expect(out.error).toBeUndefined();
    expect(JSON.stringify(out.examJson._layout.reader)).toContain(quoted);
    const args = { examJson: out.examJson, grade: 5, subject: 'social_studies' };
    expect(() => renderPaper(args)).not.toThrow();
    expect(() => renderMarkingScheme(args)).not.toThrow();
  });
});
