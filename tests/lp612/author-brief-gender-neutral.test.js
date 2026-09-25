/**
 * bd-oak77.32 — Defect A: an unnamed incidental character in a worked scenario gets a gendered
 * pronoun. House rule: gender-neutral ALWAYS — a name, or they/them.
 *
 * L6 "Gender-neutral register" (`brief_author_v3.md` ~line 288, embedded verbatim in all three
 * flash siblings — `brief_author_v3_flash_{maths,sci,prose}.md`) covers exactly three things:
 * addressing the TEACHER neutrally, Urdu verb-stem neutrality for the teacher/pupil "you", and
 * "examples must name both girls and boys doing the actual work" (a NAMED-character balance
 * rule). None of that reaches an UNNAMED incidental character in a worked scenario — "the lab
 * assistant", "the shopkeeper", "the driver" — who today gets whatever pronoun the model happens
 * to pick. Confirmed by `rg -n -i "pronoun|gender|they/them" bot/`: the only hits are L6 itself.
 *
 * This suite drives the REAL assembly function (`authorLessonPlan`), mocking only the
 * network/LLM boundary, and asserts the system prompt handed to every brief variant — the
 * standard brief and each of the three flash siblings — carries an explicit instruction covering
 * the unnamed-character case. It does not exist yet anywhere in the corpus: RED on purpose.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-gender-'));
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

// The instruction that SHOULD exist and does not: an unnamed character gets "they/them" (or a
// name), never a guessed gender. Verified absent by hand across all four briefs before writing
// this — the sole "unnamed" hit in any brief is an unrelated graph-axis-labelling rule
// ("A graph with an unnamed axis is a BLOCKING defect"), nowhere near pronoun language.
const COVERS_UNNAMED_CHARACTERS = /unnamed[^.]*\b(they|them|their)\b/i;

describe('bd-oak77.32 — an unnamed worked-scenario character must be gender-neutral', () => {
  test('the STANDARD brief (v3) carries the instruction', async () => {
    seedPageTruth('grade_9_biology', 'biology');
    create.mockResolvedValueOnce(reply(CLEAN_DOC));

    await authorLessonPlan({
      segment: segmentFor('grade_9_biology', 'biology'),
      lang: 'en',
      model: SONNET,
      correlationId: 'test-gender-standard',
    });

    const call = create.mock.calls[0][0];
    const prompt = call.messages[0].content;
    expect(prompt).toMatch(COVERS_UNNAMED_CHARACTERS);
  });

  test.each([
    ['maths', 'grade_9_mathematics', 'mathematics'],
    ['sci', 'grade_9_biology', 'biology'],
    ['prose', 'grade_10_urdu', 'urdu'],
  ])('the %s flash sibling brief carries the instruction', async (family, bookStem, subject) => {
    seedPageTruth(bookStem, subject);
    create.mockResolvedValueOnce(reply(CLEAN_DOC));

    await authorLessonPlan({
      segment: segmentFor(bookStem, subject),
      lang: 'en',
      model: FLASH,
      correlationId: `test-gender-${family}`,
    });

    const call = create.mock.calls[0][0];
    const prompt = call.messages[0].content;
    expect(prompt).toMatch(COVERS_UNNAMED_CHARACTERS);
  });
});
