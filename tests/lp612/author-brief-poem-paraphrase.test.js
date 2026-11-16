/**
 * bd-zrdvmi.6 (ICT feedback sheet, Lesson Plan row 728): the G9 English plan for the poem "Travel"
 * had no paraphrase of the poem ("No paraphrasing there"). Paraphrase is an exam skill the SLO map
 * names ("use paraphrasing skills to paraphrase a poem", 9_english / 12_english), and the brief's
 * own teacher quote says a poem lesson should be built around summaries, central idea and figures
 * of speech, yet no brief told the author to paraphrase the poem. Checked by hand: the only
 * "paraphras" hits in the four briefs were none.
 *
 * Same harness as author-brief-gender-neutral.test.js: drive the REAL authorLessonPlan(), mock only
 * the LLM boundary, and assert the system prompt for the standard brief and each flash sibling
 * tells the author that a poem lesson teaches a plain-words paraphrase in class. RED on purpose.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    // bd-oak77.29: the author service resolves its client PER MODEL, so the mock states that
    // half of llm-client's contract too. Same `create` spy either way.
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

const create = require('../../bot/shared/services/llm-client').__create;
const { authorLessonPlan } = require('../../bot/shared/services/lp612-author.service');

const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const SONNET = 'anthropic/claude-sonnet-5'; // non-flash -> standard tier, brief_author_v3.md
const FLASH = 'google/gemini-3.8-flash'; // matches /flash/i -> flash tier, family sibling brief

const BOOK_FOR = (stem, subject) => ({
  title: subject, publisher: 'NBF', subject, grade: 9,
  medium: 'en', language: 'English', offset: 4, stem,
});
const TOC = { chapters: [{ number: 1, title: 'Chapter One', printed_start: 9 }] };

function segmentFor(bookStem, subject) {
  return {
    segment_id: `seg-${bookStem}`,
    book_stem: bookStem,
    grade: 9,
    subject,
    medium: 'en',
    language: 'English',
    chapter_number: 1,
    chapter_title: 'Chapter One',
    chapter_key: 'ch1',
    part: null,
    subtopic_title: 'A subtopic',
    menu_title: 'A subtopic',
    section_ref: '1.1',
    printed_page_start: 11,
    printed_page_end: 12,
    pages_covered: [11, 12],
    order_index: 1,
    lp_type: 'SCI-9-10',
    segment_index: 1,
    day_number: 1,
    skill_type: 'concept',
    slo_text: 'An outcome.',
    yt: null,
    notes: null,
    prev_segment_id: null,
    next_segment_id: null,
  };
}

const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

let dir;

function seedPageTruth(bookStem, subject) {
  const d = path.join(dir, bookStem);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK_FOR(bookStem, subject)));
  fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
  for (const n of [11, 12]) {
    fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
      printed_page_number: n,
      pdf_page_index: n + 4,
      page_type: 'content',
      blocks: [
        { t: 'heading', text: `1.${n} A heading` },
        { t: 'prose', text: `Body text of printed page ${n}.` },
      ],
    }));
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-poem-'));
  process.env.LP612_PAGE_TRUTH_DIR = dir;
  process.env.LP612_AUTHOR_ROUNDS = '0';
  delete process.env.LP_AUTHOR_MODEL;
  delete process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS;
  delete process.env.LP612_AUTHOR_TIER;
});

afterEach(() => {
  for (const k of [
    'LP612_PAGE_TRUTH_DIR', 'LP612_AUTHOR_ROUNDS', 'LP_AUTHOR_MODEL',
    'LP_AUTHOR_MODEL_MATHS_PHYSICS', 'LP612_AUTHOR_TIER',
  ]) delete process.env[k];
  fs.rmSync(dir, { recursive: true, force: true });
});

const COVERS_POEM_PARAPHRASE = /poem[^.]*\bparaphrase\b[^.]*\b(in class|stanza|line)/i;

describe('bd-zrdvmi.6 — a poem lesson teaches a paraphrase of the poem', () => {
  test('the STANDARD brief (v3) carries the instruction', async () => {
    seedPageTruth('grade_9_english', 'english');
    create.mockResolvedValueOnce(reply(CLEAN_DOC));
    await authorLessonPlan({
      segment: segmentFor('grade_9_english', 'english'), lang: 'en', model: SONNET, correlationId: 'test-poem-standard',
    });
    expect(create.mock.calls[0][0].messages[0].content).toMatch(COVERS_POEM_PARAPHRASE);
  });

  test.each([
    ['maths', 'grade_9_mathematics', 'mathematics'],
    ['sci', 'grade_9_biology', 'biology'],
    ['prose', 'grade_9_english', 'english'],
  ])('the %s flash sibling brief carries the instruction', async (family, bookStem, subject) => {
    seedPageTruth(bookStem, subject);
    create.mockResolvedValueOnce(reply(CLEAN_DOC));
    await authorLessonPlan({
      segment: segmentFor(bookStem, subject), lang: 'en', model: FLASH, correlationId: `test-poem-${family}`,
    });
    expect(create.mock.calls[0][0].messages[0].content).toMatch(COVERS_POEM_PARAPHRASE);
  });
});
