/**
 * Urdu board-pattern papers, six more rules from the last round of sandbox papers:
 *
 * 1. Lessons that hold one prose story (lessons 6–7: «امن کی فاختہ» and a poem; any single lesson; pages
 *    inside one lesson) gave Q1 sixteen story facts that named each other. Section A now asks for at
 *    most eight story items, the rest from the lessons' word lists, meanings, idioms and the poem, and
 *    each item says where it comes from (`source`, never printed). A ninth story item is held, and a
 *    top-up is told how many story items are left.
 *
 * The papers are the sandbox's own (content only). The model boundary and the book store are mocked,
 * never the chain.
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
const mockLog = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn(), logWarn: jest.fn() }));
const mockPages = jest.fn();
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: (...a) => mockPages(...a),
  loadChapterContent: (...a) => mockPages(...a),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const ch = (...n) => ({ kind: 'chapters', chapters: n, pages: null });
const FIX = path.join(__dirname, 'fixtures', 'fde');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const lay = (exam, scope, opts = {}) => applyLayout(clone(exam), U, scope, { now: 'x', ...opts });
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (prompt) => prompt.includes(Reader.READER_MARK);
const sectionOf = (prompt) => ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, d]) => d);

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1 = (exam) => items(exam, 'urdu.A.Q1');
const has = (exam, re) => q1(exam).some((q) => re.test(q.question));

// ── 1. A Q1 mix for a one-story scope ──────────────────────────────────────────────────────────

// The lessons 6–7 sandbox paper as it printed: 16 of its 20 Q1 items are facts of the story, two are
// the poem's, ۱ is a meaning and ۶ a homograph. Each item is given the source Section A now declares.
const POEM = /ندی/;
function sourced(exam) {
  const out = clone(exam);
  q1(out).forEach((q, i) => { q.source = i === 0 ? 'meaning' : i === 5 ? 'word' : POEM.test(q.question) ? 'poem' : 'story'; });
  return out;
}
const STORY_STEMS = new Set(q1(sourced(fixture('r21f-urdu-sandbox-chapters_4'))).filter((q) => q.source === 'story').map((q) => q.question));
const stories = (exam) => q1(exam).filter((q) => STORY_STEMS.has(q.question));
const L67 = { kind: 'chapters', chapters: [6, 7], pages: '50-60, 61-70' };

describe('1. sandbox chapters_4 (lessons 6–7): sixteen story items', () => {
  const paper = sourced(fixture('r21f-urdu-sandbox-chapters_4'));

  test('the paper as printed asks sixteen story facts', () => {
    expect(stories(paper)).toHaveLength(16);
  });

  test('the layout keeps eight story items and holds the rest; Q1 is short until a top-up', () => {
    const r = lay(paper, ch(6, 7));
    expect(stories(r.examJson).length).toBeLessThanOrEqual(8);
    expect(r.examJson._layout.holds).toEqual(expect.arrayContaining([expect.objectContaining({ slot: 'urdu.A.Q1', rule: 'story_cap' })]));
    expect(r.examJson._layout.story_items).toBe(stories(r.examJson).length);
    expect(r.shortfall.find((f) => f.slot === 'urdu.A.Q1')).toBeTruthy();
  });

  test('the source never prints', () => {
    const r = lay(paper, ch(6, 7), { reasked: true });
    expect(q1(r.examJson).some((q) => Object.prototype.hasOwnProperty.call(q, 'source'))).toBe(false);
  });

  test('a single lesson and a pages scope inside one lesson are one story too', () => {
    expect(lay(paper, ch(6)).examJson._layout.holds).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'story_cap' })]));
    expect(lay(paper, { kind: 'pages', chapters: null, pages: '51-55' }).examJson._layout.holds)
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'story_cap' })]));
  });

  test.each([['lessons 4–5 (two prose lessons)', ch(4, 5)], ['the full syllabus', FDE]])('%s: no story cap (control)', (_, scope) => {
    const r = lay(paper, scope);
    expect((r.examJson._layout.holds || []).some((h) => h.rule === 'story_cap')).toBe(false);
    expect(r.examJson._layout.story_items).toBeUndefined();
    expect(q1(r.examJson).some((q) => Object.prototype.hasOwnProperty.call(q, 'source'))).toBe(false);
  });

  test('a reply that declares no source is laid out as before (control)', () => {
    const plainPaper = fixture('r21f-urdu-sandbox-chapters_4');
    const r = lay(plainPaper, ch(6, 7));
    expect((r.examJson._layout.holds || []).some((h) => h.rule === 'story_cap')).toBe(false);
    expect(r.examJson._layout.story_items).toBeUndefined();
  });
});

// The engine on lessons 6–7: Section A's first reply is the sandbox paper's 20 items with their
// sources; Section B and C are the recorded lessons 4–5 replies (their content does not matter here).
const rec = fixture('r18-urdu-refused-chapters1');
const REPLY_B = rec.replies.B;
const REPLY_C = rec.replies.C.split('کی عادت اپنانی چاہیے').join('کی عادت ڈالنی ہو گی');
const mcqs = (list) => JSON.stringify({ unseen: { objective: { MCQs: clone(list) } } });
const WORDS = [['تاب کاری', 'ایٹمی شعاعوں کا اثر'], ['جھکڑ', 'تیز آندھی'], ['سانچے', 'ڈھانچے، قالب'], ['بین الاقوامی', 'کئی ملکوں کا'],
  ['دامن', 'کپڑے کا نچلا کنارا'], ['امن', 'سکون اور صلح'], ['فضا', 'ہوا اور آسمان'], ['افق', 'جہاں زمین آسمان سے ملتی دکھائی دے'],
  ['خاک', 'مٹی، دھول'], ['گونجنا', 'آواز کا پھیلنا']];
const meaning = ([w, k]) => ({
  slot: 'urdu.A.Q1', question: `لفظ «${w}» سے کیا مراد ہے؟`, source: 'meaning',
  options: [`الف) ${k}`, 'ب) پہاڑ کی چوٹی', 'ج) آسمان کا رنگ', 'د) رات کا وقت'], answer: `الف) ${k}`, marks: 1,
});
function book() {
  const c = JSON.parse(REPLY_C);
  const q6 = Object.values(c.unseen.subjective || {}).flat().find((q) => q && q.slot === 'urdu.C.Q6');
  const content = ['=== Page 63 ===', 'ندی کی فریاد', ...String((q6 && q6.passage) || '').split('\n')].join('\n\n');
  mockPages.mockImplementation(async ({ pageRanges } = {}) => ({ content, pageReference: String(pageRanges || '50') }));
}
function serve(a, reader = null) {
  const asked = [];
  mockCreate.mockImplementation(async (req) => {
    const prompt = textOf(req);
    if (isReader(prompt)) {
      const n = asked.filter((x) => x.sec === 'reader').length + 1;
      asked.push({ sec: 'reader', prompt });
      return { choices: [{ message: { content: reader ? reader(prompt, n) : '{"candidates":[]}' }, finish_reason: 'stop' }], usage: { total_tokens: 100 } };
    }
    const sec = sectionOf(prompt);
    asked.push({ sec, prompt });
    const n = asked.filter((x) => x.sec === sec).length;
    const content = sec === 'A' ? a(n, prompt) : sec === 'B' ? REPLY_B : REPLY_C;
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
  });
  return asked;
}
const run = (scope, extra = {}) => Gen.generatePatternExam({
  grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope, pageRanges: scope.pages || null, requestId: 'req-r21f', ...extra,
}).then((ok) => ({ ok }), (err) => ({ err }));

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); mockPages.mockReset(); book(); });

const STORY_CAP = /at most 8 of the 20 Q1 items ask a fact of the story/;
const SOURCE_FIELD = /Give every Q1 item a "source" field/;
const USED_UP = /Story items are used up/;

describe('1. the engine on lessons 6–7', () => {
  const first = q1(sourced(fixture('r21f-urdu-sandbox-chapters_4'))).map((q) => ({ ...q, slot: 'urdu.A.Q1' }));

  test('Section A asks for at most eight story items and a source per item', async () => {
    const asked = serve(() => mcqs(first));
    await run(L67);
    const a = asked.find((x) => x.sec === 'A').prompt;
    expect(a).toMatch(STORY_CAP);
    expect(a).toMatch(SOURCE_FIELD);
    expect(asked.find((x) => x.sec === 'B').prompt).not.toMatch(STORY_CAP);
    expect(asked.find((x) => x.sec === 'C').prompt).not.toMatch(STORY_CAP);
  });

  test('the top-up is told story items are used up, and its new items fill Q1: the paper prints at most eight story items', async () => {
    const asked = serve((n) => (n === 1 ? mcqs(first) : mcqs(WORDS.map(meaning))));
    const out = await run(L67);
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    const as = asked.filter((x) => x.sec === 'A');
    expect(as.length).toBeGreaterThan(1);
    expect(as[1].prompt).toMatch(USED_UP);
    expect(stories(out.ok.examJson).length).toBeLessThanOrEqual(8);
    expect(q1(out.ok.examJson)).toHaveLength(20);
  });

  test.each([['lessons 4–5', { kind: 'chapters', chapters: [4, 5], pages: '28-37, 38-49' }], ['the full syllabus', FDE]])('%s: no story line (control)', async (_, scope) => {
    const asked = serve(() => mcqs(first));
    await run(scope);
    const a = asked.find((x) => x.sec === 'A').prompt;
    expect(a).not.toMatch(STORY_CAP);
    expect(a).not.toMatch(SOURCE_FIELD);
  });
});
