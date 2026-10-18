/**
 * Social Studies, round 7: the reader names two Section D give-aways (a Q6 whose every marking point
 * is a Q1 key, across any number of Q1 items; a Q6 whose points are the wrong options of a "which act
 * is right" Q1 item, not done), a Q6 that only says which government does each job is held as recall,
 * the D prompt sends "which map / medium / government for each need" to Q7, and a re-ask says in the
 * log why its slot was short.
 */

const fs = require('fs');
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
const URDU = Patterns.get('fde_g5_2027').subjects.urdu;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === slot);
const Q1 = 'social_studies.A.Q1';
const D6 = 'social_studies.D.Q6';
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (text) => text.includes(Reader.READER_MARK);
const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const lead = (t) => String(t).slice(0, 40);
const keyOf = (q) => Reader.keyOf(q);
const logged = (name) => mockLog.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

async function replay(rec, { reader = {}, edit = null } = {}) {
  const r = clone(rec);
  if (edit) edit(r);
  const queue = { A: [...r.replies.A], B: [...r.replies.B], C: [...r.replies.C], D: [...r.replies.D] };
  const asked = [];
  mockCreate.mockReset();
  mockLog.mockReset();
  mockCreate.mockImplementation(async (req) => {
    const text = textOf(req);
    if (isReader(text)) {
      const n = asked.filter((a) => a.sec === 'reader').length + 1;
      asked.push({ sec: 'reader', text });
      const content = reader[n] ? reader[n](text) : JSON.stringify({ candidates: [] });
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 9000, completion_tokens: 300, total_tokens: 9300 } };
    }
    const sec = sectionOf(text);
    asked.push({ sec, text });
    const content = queue[sec].length > 1 ? queue[sec].shift() : queue[sec][0];
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  });
  const out = await Gen.generatePatternExam({
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: r.scope, pageRanges: r.scope.pages, requestId: 'req-r17g', readerPass: true,
  }).catch((e) => ({ error: e }));
  return { asked, out };
}

// The printed label of a stem in a reader prompt («Q6.2 بلال کو …» → «Q6.2»).
const labelOf = (prompt, stem) => {
  const line = prompt.split('\n').find((l) => /^Q\d+(\.\d+)? /.test(l) && l.includes(lead(stem)));
  return line ? line.split(' ')[0] : null;
};

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

describe('1. the reader names two Section D give-aways', () => {
  const exam = fixture('r17g-sst-local-chapters_2');
  const q1 = items(exam, Q1);
  const [q6a, q6b] = items(exam, D6);
  const wrong12 = q1[11].options.filter((o) => o !== q1[11].answer).map((o) => o.replace(/^\S+\)\s*/, ''));

  test('setup: Q6 1\'s three acts are the keys of Q1 6, 7 and 12; Q6 2\'s are Q1 12\'s three wrong options, not done', () => {
    expect(keyOf(q1[5])).toContain('رائے کا احترام کرتے ہوئے دلیل');
    expect(keyOf(q1[6])).toContain('ٹھنڈے دماغ سے جواب دینا');
    expect(keyOf(q1[11])).toContain('مناسب زبان');
    expect(q1[11].question).toContain('کون سا عمل درست ہے');
    expect(wrong12.join(' ')).toContain('تصاویر بغیر اجازت');
    expect(q6a.scheme.points.map((p) => p.text).join(' ')).toContain('ٹھنڈے دماغ');
    expect(q6b.scheme.points.map((p) => p.text).join(' ')).toContain('بغیر اجازت');
  });

  test('the prompt names a C/D item whose every marking point is a Q1 key, across any number of Q1 items', () => {
    const { prompt } = Reader.buildReaderPrompt(exam, SST);
    expect(prompt).toContain('EACH of its marking points is printed in Section A as a Q1 key, across any number of Q1 items');
    expect(prompt).toContain('does not save it when the act itself is the key');
  });

  test('the prompt names the wrong options of a "which act is right" Q1 item, read as acts not done', () => {
    const { prompt } = Reader.buildReaderPrompt(exam, SST);
    expect(prompt).toContain('its wrong options are wrong acts');
    expect(prompt).toContain('unless that Q1 item asks which act is');
  });

  test('a partly answered item stays unflagged: the only exception is every point\'s act a Q1 key, or every point a wrong act', () => {
    const { prompt } = Reader.buildReaderPrompt(exam, SST);
    expect(prompt).toContain('its answer without the reasons its points ask for');
    expect(prompt).toContain('the one exception is the rule above where EACH point\'s act is a Q1 key');
    expect(prompt).toContain('a C/D item EVERY one of whose points is one of those acts, not done');
    expect(prompt).toContain('When even one point is an act no Q1 item prints, or a reason, a benefit or a definition of its own, it is partial');
  });

  test('a flag on Q6 1 that quotes three Q1 keys, all three named in `by`, is kept', () => {
    const { prompt, labels, blocks, split } = Reader.buildReaderPrompt(exam, SST);
    const item = labelOf(prompt, q6a.question);
    expect(item).toBe('Q6.1');
    const reply = { candidates: [{ item, by: 'Q1.6, Q1.7, Q1.12', evidence: 'رائے کا احترام کرتے ہوئے دلیل سے بات کرنا | ٹھنڈے دماغ سے جواب دینا | گفتگو میں مناسب زبان استعمال کرنا', reason: 'each point is a Q1 key', given_away: true }] };
    expect(Reader.parseFlags(reply, labels, null, blocks, { split }).map((f) => f.item)).toEqual(['Q6.1']);
  });

  test('a flag on Q6 2 that quotes Q1 12\'s three wrong options is kept', () => {
    const { prompt, labels, blocks, split } = Reader.buildReaderPrompt(exam, SST);
    const item = labelOf(prompt, q6b.question);
    expect(item).toBe('Q6.2');
    const reply = { candidates: [{ item, by: 'Q1.12', evidence: wrong12.join(' | '), reason: 'its points are the wrong acts of Q1.12, not done', given_away: true }] };
    expect(Reader.parseFlags(reply, labels, null, blocks, { split }).map((f) => f.item)).toEqual(['Q6.2']);
  });

  test('a flag that quotes a wrong option no Q1 item prints is dropped', () => {
    const { prompt, labels, blocks, split } = Reader.buildReaderPrompt(exam, SST);
    const item = labelOf(prompt, q6b.question);
    const reply = { candidates: [{ item, by: 'Q1.12', evidence: 'دوسروں کے پاس ورڈ مانگنا', reason: 'x', given_away: true }] };
    expect(Reader.parseFlags(reply, labels, null, blocks, { split })).toEqual([]);
  });

  test('chapters_2 through the engine: the reader is asked both shapes, takes Q6 1 and 2 off, and D is topped up', async () => {
    const rec = fixture('r17g-sst-replies-chapters_2');
    // Three Q1 items of this reply are given away by C and D stems and Section A is asked again; the
    // recording's own re-ask reply writes nothing new, so the re-ask here writes fresh items. The Q1
    // items the reader names are found by their text: the held ones' places are refilled at the end.
    let by6 = null;
    let by12 = null;
    const { asked, out } = await replay(rec, {
      edit: (r) => r.replies.A.push(fixture('sst-a-reask-fresh').reply),
      reader: {
        1: (prompt) => {
          [by6, by12] = [[q1[5], q1[6], q1[11]].map((q) => labelOf(prompt, q.question)).join(', '), labelOf(prompt, q1[11].question)];
          return JSON.stringify({ candidates: [
            { item: labelOf(prompt, q6a.question), by: by6, evidence: 'رائے کا احترام کرتے ہوئے دلیل سے بات کرنا | ٹھنڈے دماغ سے جواب دینا | گفتگو میں مناسب زبان استعمال کرنا', reason: 'each point is a Q1 key', given_away: true },
            { item: labelOf(prompt, q6b.question), by: by12, evidence: wrong12.join(' | '), reason: 'its points are the wrong acts of that Q1 item, not done', given_away: true },
          ] });
        },
      },
    });
    const first = asked.find((a) => a.sec === 'reader');
    expect(first.text).toContain('EACH of its marking points is printed in Section A as a Q1 key');
    expect(first.text).toContain('its wrong options are wrong acts');
    expect(out.error && out.error.code).toBeUndefined();
    const printed = items(out.examJson, D6).map((q) => q.question);
    expect(printed).not.toContain(q6a.question);
    expect(printed).not.toContain(q6b.question);
    expect(printed.length).toBe(items(exam, D6).length);
    expect(by6).toMatch(/^Q1\.\d+, Q1\.\d+, Q1\.\d+$/);
    expect(out.examJson._layout.reader.items.map((x) => x.by)).toEqual(expect.arrayContaining([by6, by12]));
  });

  test('Urdu: the reader prompt carries none of these lines', () => {
    const urdu = fixture('r14-urdu-sandbox-full_1');
    const { prompt } = Reader.buildReaderPrompt(urdu, URDU);
    expect(prompt).not.toContain('EACH of its marking points');
    expect(prompt).not.toContain('its wrong options are wrong acts');
  });
});

describe('2. a Q6 that only says which government does each job is recall', () => {
  const ch5 = fixture('r17g-sst-local-chapters_5');
  const ch6 = fixture('r17g-sst-local-chapters_6');
  const tiers5 = items(ch5, D6)[3];
  const tiers6 = items(ch6, D6)[5];
  const lay = (exam) => applyLayout(clone(exam), SST, scopeOf(exam), { reasked: true });
  const ruleOf = (laid, q) => laid.held.filter((h) => h.q.question === q.question).map((h) => h.rule);

  test('setup: chapters_5 Q6 4 says which government removes encroachments and which helps orphans; chapters_6 Q6 6 asks which keeps the peace', () => {
    expect(tiers5.scheme.points[0].text).toContain('صوبائی حکومت کا کام ہے');
    expect(tiers5.scheme.points[2].text).toContain('مقامی حکومت کرتی ہے');
    expect(tiers6.question).toContain('کس حکومت کی ہے');
    expect(tiers6.scheme.points[2].text).toContain('صوبہ');
  });

  test('chapters_5 Q6 4 («… حکومت کا کام ہے», «… حکومت کرتی ہے», one explaining point) is held as naming a body', () => {
    expect(ruleOf(lay(ch5), tiers5)).toContain('names_body');
  });

  test('chapters_6 Q6 6 (a province padding point, one explaining point) is held as naming a body', () => {
    expect(ruleOf(lay(ch6), tiers6)).toContain('names_body');
  });

  test('control: a Q6 whose points mention a province while explaining two ideas, asking no body, prints', () => {
    const e = clone(ch5);
    const q = items(e, D6)[0];
    Object.assign(q, { question: 'احمد ایک گاؤں میں رہتا ہے جہاں کھیتوں کو پانی کم ملتا ہے۔ وہ پانی بچانے کے لیے کیا کرے؟ دو طریقے بتا کر وضاحت کریں۔',
      answer: 'کھالوں کو پکا کرے اور فصلوں کو ضرورت کے مطابق پانی دے۔',
      scheme: { points: [{ text: 'صوبہ پنجاب میں زیادہ تر لوگ کھیتی باڑی کرتے ہیں اس لیے پانی بچانا ضروری ہے', marks: 2, kind: 'K' }, { text: 'کھالوں کو پکا کرنے سے پانی زمین میں ضائع نہیں ہوتا', marks: 2, kind: 'K' }, { text: 'فصلوں کو ضرورت کے مطابق پانی دینے سے پانی بچتا ہے', marks: 2, kind: 'K' }] } });
    expect(ruleOf(lay(e), q)).not.toContain('names_body');
  });

  test('control: a which-government Q6 whose answer explains with two ideas besides the naming point prints', () => {
    const e = clone(ch5);
    const q = items(e, D6)[0];
    Object.assign(q, { question: 'علی کی گلی میں کئی دن سے گندا پانی کھڑا ہے۔ یہ کام کس حکومت کا ہے اور گلی والے خود کیا کریں؟ دو باتوں سے وضاحت کریں۔',
      answer: 'نکاسی آب مقامی حکومت کا کام ہے۔ گلی والے نالی میں کچرا نہ ڈالیں اور مل کر شکایت درج کرائیں۔',
      scheme: { points: [{ text: 'نکاسی آب مقامی حکومت کا کام ہے', marks: 2, kind: 'K' }, { text: 'نالی میں کچرا نہ ڈالنے سے پانی رکتا نہیں', marks: 2, kind: 'K' }, { text: 'کھڑے پانی سے مچھر اور بیماریاں پھیلتی ہیں اس لیے جلد صفائی ضروری ہے', marks: 2, kind: 'K' }] } });
    expect(ruleOf(lay(e), q)).not.toContain('names_body');
  });

  test('the D prompt sends "which map, medium or government for each need" to Q7, through the engine', async () => {
    await replay(fixture('r17g-sst-replies-chapters_2'));
    const dPrompts = mockCreate.mock.calls.map((c) => textOf(c[0])).filter((t) => sectionOf(t) === 'D' && !isReader(t));
    expect(dPrompts.length).toBeGreaterThan(0);
    expect(dPrompts[0]).toContain('A Q6 is never "which map, which medium or which government for each need": such items go to Q7 as one-fact items.');
  });
});

describe('3. a re-ask says in the log why its slot was short', () => {
  // Three more are held as given away by a C or D stem: Q5 «ٹیلی وژن اور ریڈیو میں کیا فرق ہے؟» and
  // «امن اور ہم آہنگی … کیوں فائدہ مند ہیں؟» ask what two Q1 items ask, and a Q6 situation prints
  // «کمپیوٹر اور انٹرنیٹ», a Q1 key, on the same topic.
  test('chapters_2: A.Q1 was short because the reply wrote 19 items, and C and D gave three away', async () => {
    await replay(fixture('r17g-sst-replies-chapters_2'));
    const a = logged('[assessment] section re-asked').find((x) => x.section === 'A');
    expect(a.why).toEqual([{ slot: Q1, written: 19, held: { asked_in_c: 2, key_in_stem: 1, key_named_in_stem: 3 } }]);
  });

  test('an A.Q1 item the layout holds is named, with its rule, in the held items line', async () => {
    await replay(fixture('r17g-sst-replies-chapters_2'), {
      edit: (r) => {
        const a = JSON.parse(r.replies.A[0]);
        const mcqs = a.unseen.objective.MCQs;
        mcqs.push(clone(mcqs[0]), clone(mcqs[1]));
        r.replies.A[0] = JSON.stringify(a);
      },
    });
    const rows = logged('[assessment] held items').flatMap((x) => x.held);
    expect(rows.filter((x) => x.slot === Q1).length).toBeGreaterThan(0);
    expect(rows.find((x) => x.slot === Q1).rule).toEqual(expect.any(String));
  });
});

describe('4. Social Studies logs its held items once, as rows per rule', () => {
  // The first-layout held-items line is for the other subjects' scope holds. Social Studies always
  // returns `held` (its Section D reads it), so it must not log that raw line as well: one line, rows
  // of { slot, rule, held, printed }, never whole items.
  test('one held items line, and no row carries an item', async () => {
    await replay(fixture('r17g-sst-replies-chapters_2'), {
      edit: (r) => {
        const a = JSON.parse(r.replies.A[0]);
        const mcqs = a.unseen.objective.MCQs;
        mcqs.push(clone(mcqs[0]), clone(mcqs[1]));
        r.replies.A[0] = JSON.stringify(a);
      },
    });
    const lines = logged('[assessment] held items');
    expect(lines).toHaveLength(1);
    expect(lines[0].held.every((row) => !('q' in row))).toBe(true);
  });
});
