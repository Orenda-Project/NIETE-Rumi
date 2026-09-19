/**
 * Shared E2E harness for the religious-marks suites.
 *
 * Extracted when the stamp ruling (bd-c61xh) pushed `religious-marks-delivery.e2e.test.js` past
 * the 300-line limit. Nothing here is new — it is the harness that file already used, lifted so a
 * second suite can drive the same real authoring path.
 *
 * IMPORTANT: `jest.mock('../../bot/shared/services/llm-client', ...)` is hoisted per FILE, so it
 * stays in each test file. This module is required AFTER that mock is in place, which is why
 * `create` below is the doubled function and not the real client.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const create = require('../../../bot/shared/services/llm-client').__create;
const { authorLessonPlan } = require('../../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('../__fixtures__/v9_gate_base.lp.json');

/** The exact string from the 2026-09-15 production refusal. */
const PROD_STRING = 'سیرتِ انبیاء سے متعلق مواد — نبی ﷺ کی تعلیمات';

/**
 * Put Urdu religious prose in a teacher-facing slot of an otherwise clean, schema-valid doc.
 *
 * `needs_human_review` is set because that is the SHAPE OF A REAL ISLAMIAT LESSON, not a
 * convenience: check 6 of the gate (brief §4c.1, G5c) refuses any religious document that does not
 * carry the flag, whether or not the bug under test exists. Leaving it off would mean every
 * assertion was really measuring check 6 and never reaching the logic being exercised.
 */
function religiousDoc(text = PROD_STRING) {
  const d = JSON.parse(JSON.stringify(CLEAN_DOC));
  const sec = d.sections.find((s) => (s.blocks || []).some((b) => b.type === 'paragraph'));
  sec.blocks.find((b) => b.type === 'paragraph').text = text;
  d.needs_human_review = true;
  return d;
}

/** The untouched fixture — a schema-valid lesson with no religious content at all. */
const cleanDoc = () => JSON.parse(JSON.stringify(CLEAN_DOC));

const BOOK = { title: 'Islamiat 9', publisher: 'PCTB', subject: 'islamiat', grade: 9, medium: 'ur', language: 'Urdu', offset: 4 };
const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };
const SEGMENT = {
  segment_id: 'seg-religious-1', book_stem: 'grade_9_biology', grade: 9, subject: 'biology',
  medium: 'en', language: 'English', chapter_number: 1, chapter_title: 'The Biological Method',
  chapter_key: 'g9-bio-ch1', subtopic_title: 'Observation and hypothesis',
  menu_title: 'Observation & hypothesis', printed_page_start: 11, printed_page_end: 12,
  pages_covered: [11, 12], order_index: 3, lp_type: 'SCI-9-10', yt: null,
};

const reply = (obj) => ({
  choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

/** Write a throwaway page-truth tree and point the reader at it for the length of each test. */
function installPageTruth() {
  let dir;
  beforeEach(() => {
    jest.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-relig-'));
    const d = path.join(dir, SEGMENT.book_stem);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
    fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
    for (const n of [11, 12]) {
      fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
        printed_page_number: n, pdf_page_index: n + 4, page_type: 'content',
        blocks: [{ t: 'heading', text: `1.${n} Observation` }],
      }));
    }
    process.env.LP612_PAGE_TRUTH_DIR = dir;
  });
  afterEach(() => { delete process.env.LP612_PAGE_TRUTH_DIR; });
}

/** The renderer is clean throughout — these suites are about the LINT gate, nothing else. */
const run = (rounds = 3) => authorLessonPlan({
  segment: SEGMENT, lang: 'en', model: 'test/model', rounds,
  renderCheck: jest.fn().mockResolvedValue([]), correlationId: 'c',
});

const religiousFails = (out) => (out.fails || []).map(String).filter((e) => e.startsWith('RELIGIOUS_MARKS'));

/**
 * The refusal path is a THROW, not a return value.
 *
 * When the ladder runs out of rounds with a blocking fail still standing, `authorLessonPlan`
 * raises — there is no dirty document handed back, which is the point: nothing downstream can
 * accidentally serve it. So a "still refuses" test asserts on the raised error, and a test that
 * awaited a result would report the protection WORKING as a failure.
 */
const refusal = async (rounds = 1) => {
  try {
    const out = await run(rounds);
    throw new Error(`expected a refusal, but the lesson was delivered (lintClean=${out.lintClean})`);
  } catch (e) {
    if (/expected a refusal/.test(e.message)) throw e;
    return e.message;
  }
};

module.exports = {
  create, PROD_STRING, religiousDoc, cleanDoc, reply, BOOK, TOC, SEGMENT,
  installPageTruth, run, religiousFails, refusal,
};
