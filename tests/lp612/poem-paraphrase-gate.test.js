/**
 * bd-zrdvmi.44.1 (ICT feedback sheet, Lesson Plan row 728). The reviewer of the G9 English poem
 * 'Travel' plan wrote "No paraphrasing there". bd-zrdvmi.6 put rule 12 in the author brief ("a poem
 * lesson teaches a paraphrase of the poem, in class"), but on 21 Nov main's code wrote that very
 * lesson again (fixture travel_poem_main_21nov.lp.json, verbatim) with no paraphrase in class: the
 * word appears only in differentiation ("may paraphrase") and the marking note. A brief rule alone
 * left the fix partial, so the ladder now CHECKS it: a POEM_PARAPHRASE defect buys a revision round.
 */
jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { poemParaphraseDefects, isPoemReading } = require('../../bot/shared/services/lp612-poem-paraphrase');

const TRAVEL = require('./__fixtures__/travel_poem_main_21nov.lp.json');
const clone = (o) => JSON.parse(JSON.stringify(o));
const TITLE = "Reading and understanding the poem 'Travel'";

/** TRAVEL with a teacher-modelled paraphrase in the I Do and a pupils' paraphrase task in the We Do. */
function withParaphrase({ teacher = true, pupils = true } = {}) {
  const d = clone(TRAVEL);
  const dev = d.sections.find((s) => s.id === 'development');
  const act = d.sections.find((s) => s.id === 'activity');
  if (teacher) {
    dev.blocks.splice(1, 0, { type: 'paragraph', id: 'paraphrase-model',
      text: "Stanza 1, the poet's words: 'The railroad track is miles away'. In plain words: the train line is far from the poet's home, but she can still hear the trains." });
  }
  if (pupils) {
    act.blocks.splice(0, 0, { type: 'paragraph', id: 'paraphrase-pupils',
      text: 'Pairs paraphrase stanza 2 in their own words, then two pairs read theirs aloud.' });
  }
  return d;
}

describe('isPoemReading', () => {
  test.each([
    [TITLE, 'reading_comprehension', true],
    ['نظم "حمد" کا مطالعہ، بلند آواز قرأت اور فہمی سوالات', 'buland_khwani', true],
    ['Writing skills: summarising a poem', 'writing', false],
    ['Reading: The Last Sermon', 'reading_comprehension', false],
  ])('%s / %s -> %s', (title, skill, want) => {
    expect(isPoemReading(title, skill)).toBe(want);
  });
});

describe('poemParaphraseDefects', () => {
  test("row 728: main's 21 Nov Travel plan (paraphrase only in differentiation/marking) is a POEM_PARAPHRASE defect", () => {
    const fails = poemParaphraseDefects(clone(TRAVEL), 'reading_comprehension', TITLE);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatch(/^POEM_PARAPHRASE: /);
    expect(fails[0]).toMatch(/stanza/);
  });

  test('a teacher-modelled paraphrase AND a pupils\' paraphrase task in class passes', () => {
    expect(poemParaphraseDefects(withParaphrase(), 'reading_comprehension', TITLE)).toEqual([]);
  });

  test('a teacher paraphrase with no pupil turn still fails (pupils must paraphrase a stanza)', () => {
    expect(poemParaphraseDefects(withParaphrase({ pupils: false }), 'reading_comprehension', TITLE)[0])
      .toMatch(/^POEM_PARAPHRASE: /);
  });

  test('a paraphrase only in homework does not count', () => {
    const d = clone(TRAVEL);
    d.sections.find((s) => s.id === 'homework').blocks.push({ type: 'paragraph', text: 'Paraphrase stanza 3 in your own words.' });
    expect(poemParaphraseDefects(d, 'reading_comprehension', TITLE)).toHaveLength(1);
  });

  test('an Urdu poem plan with مفہوم by the teacher and by pupils passes', () => {
    const d = clone(TRAVEL);
    d.sections.find((s) => s.id === 'development').blocks.push({ type: 'paragraph', text: 'پہلا بند: شاعر کے الفاظ، پھر آسان الفاظ میں مفہوم۔' });
    d.sections.find((s) => s.id === 'activity').blocks.push({ type: 'paragraph', text: 'جوڑیاں دوسرے بند کا مفہوم اپنے الفاظ میں لکھیں۔' });
    expect(poemParaphraseDefects(d, 'buland_khwani', 'نظم "حمد" کا مطالعہ')).toEqual([]);
  });

  test('not a poem reading lesson: never a defect', () => {
    expect(poemParaphraseDefects(clone(TRAVEL), 'reading_comprehension', 'Reading: The Last Sermon')).toEqual([]);
    expect(poemParaphraseDefects(clone(TRAVEL), 'writing', TITLE)).toEqual([]);
    expect(poemParaphraseDefects(null, 'reading_comprehension', TITLE)).toEqual([]);
  });
});

describe('the authoring ladder acts on it', () => {
  const create = require('../../bot/shared/services/llm-client').__create;
  const { authorLessonPlan } = require('../../bot/shared/services/lp612-author.service');
  const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
  let dir;

  beforeEach(() => {
    jest.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-poem-gate-'));
    const d = path.join(dir, 'grade_9_english');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify({ title: 'English', publisher: 'NBF', subject: 'english',
      grade: 9, medium: 'en', language: 'English', offset: 4, stem: 'grade_9_english' }));
    fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify({ chapters: [{ number: 9, title: 'Travel and Tourism', printed_start: 116 }] }));
    for (const n of [116, 117]) {
      fs.writeFileSync(path.join(d, `pg_${n}.json`), JSON.stringify({ printed_page_number: n, pdf_page_index: n + 4,
        page_type: 'content', blocks: [{ t: 'prose', text: `The railroad track is miles away (page ${n}).` }] }));
    }
    process.env.LP612_PAGE_TRUTH_DIR = dir;
    process.env.LP612_AUTHOR_ROUNDS = '1';
  });

  afterEach(() => {
    delete process.env.LP612_PAGE_TRUTH_DIR;
    delete process.env.LP612_AUTHOR_ROUNDS;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a poem plan with no in-class paraphrase is sent back with POEM_PARAPHRASE and the fix is kept', async () => {
    create.mockResolvedValueOnce(reply(clone(TRAVEL)));
    create.mockResolvedValueOnce(reply(withParaphrase()));
    const out = await authorLessonPlan({
      segment: {
        segment_id: 'grade_9_english.c09.p116-118.reading_comprehension', book_stem: 'grade_9_english', grade: 9,
        subject: 'English', medium: 'English', language: 'en', chapter_number: 9, chapter_title: 'Travel and Tourism',
        chapter_key: 'c09', subtopic_title: TITLE, menu_title: 'Travel: reading', printed_page_start: 116,
        printed_page_end: 117, pages_covered: [116, 117], lp_type: 'content', skill_type: 'reading_comprehension', slo_text: null,
      },
      lang: 'en', model: 'anthropic/claude-sonnet-5', correlationId: 'test-poem-gate',
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(create.mock.calls[1][0].messages)).toMatch(/POEM_PARAPHRASE/);
    expect(poemParaphraseDefects(out.lpDoc, 'reading_comprehension', TITLE)).toEqual([]);
  });
});
