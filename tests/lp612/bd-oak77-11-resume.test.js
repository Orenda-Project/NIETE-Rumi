/**
 * bd-oak77.11 LAYER B, service side — `resumeFrom` SKIPS THE INITIAL AUTHOR CALL.
 *
 * The whole point of the checkpoint is the money and the minutes it saves. Persisting a document
 * that the next attempt then ignores would be a column that changes nothing — so this asserts the
 * saving itself: given a checkpointed document, the ladder does NOT issue the round-0 authoring
 * call (the single most expensive step in the job, ~60-90s and the bulk of the tokens), it gates the
 * checkpointed document instead, and the rounds already paid for are charged against the budget
 * rather than handed out a second time.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }),
    // bd-oak77.29: the author service resolves its client PER MODEL now, so the mock has to
    // state that half of llm-client's contract too. Same `create` spy either way — these
    // suites assert on the payload, not on which provider it went to.
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create };
});

const create = require('../../bot/shared/services/llm-client').__create;
const { authorLessonPlan } = require('../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const clone = (d) => JSON.parse(JSON.stringify(d));
const reply = (obj) => ({
  choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});
const OVERFLOW = 'PAGE COUNT: support needs 6 pages; the cap is 4. Cut it, or move content to the other part.';

const BOOK = { title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9, medium: 'en', language: 'English', offset: 4 };
const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };
const SEGMENT = {
  segment_id: 'seg-1', book_stem: 'grade_9_biology', grade: 9, subject: 'biology',
  medium: 'en', language: 'English', chapter_number: 1, chapter_title: 'The Biological Method',
  chapter_key: 'g9-bio-ch1', subtopic_title: 'Observation and hypothesis',
  menu_title: 'Observation & hypothesis', printed_page_start: 11, printed_page_end: 12,
  pages_covered: [11, 12], order_index: 3, lp_type: 'SCI-9-10', yt: null,
};

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-resume-'));
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

describe('resumeFrom', () => {
  test('a deliverable checkpoint costs ZERO LLM calls — the lesson is finished, not rewritten', async () => {
    const renderCheck = jest.fn().mockResolvedValue([]);
    const out = await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 3, renderCheck, correlationId: 'c',
      resumeFrom: { lpDoc: clone(CLEAN_DOC), rounds: 2 },
    });

    expect(create).not.toHaveBeenCalled();
    expect(out.lpDoc).toBeDefined();
    expect(out.rounds).toBe(2);              // the rounds a previous attempt already paid for
    expect(renderCheck).toHaveBeenCalled();  // it was still GATED — resuming is not trusting
  });

  test('a checkpoint that still has a blocking defect is revised, but round 0 is not re-authored', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([OVERFLOW])
      .mockResolvedValue([]);
    create.mockResolvedValue(reply(clone(CLEAN_DOC)));

    const out = await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 3, renderCheck, correlationId: 'c',
      resumeFrom: { lpDoc: clone(CLEAN_DOC), rounds: 1 },
    });

    expect(create).toHaveBeenCalledTimes(1);   // ONE revision, and no author call
    expect(out.rounds).toBe(2);                // 1 already paid for + 1 spent now
  });

  test('the rounds already paid for are charged against the budget, not handed out again', async () => {
    // rounds=3 with 3 already spent must still allow at least one attempt to clear the defect,
    // and must not silently grant a fresh budget of three.
    const renderCheck = jest.fn().mockResolvedValue([OVERFLOW]);
    create.mockResolvedValue(reply(clone(CLEAN_DOC)));

    const out = await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 3, renderCheck, correlationId: 'c',
      resumeFrom: { lpDoc: clone(CLEAN_DOC), rounds: 3 },
    });

    expect(create).toHaveBeenCalledTimes(1);   // exactly the one guaranteed round, not three
    expect(out.rounds).toBe(4);
  });

  test('a resumeFrom with no document is ignored — the ladder authors normally', async () => {
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(clone(CLEAN_DOC)));

    const out = await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 3, renderCheck, correlationId: 'c',
      resumeFrom: { rounds: 2 },
    });

    expect(create).toHaveBeenCalledTimes(1);   // the author call happened
    expect(out.rounds).toBe(0);
  });

  test('the resumed document is published to onCandidate at round 0, so a second death is also survivable', async () => {
    const renderCheck = jest.fn().mockResolvedValue([]);
    const seen = [];
    await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 3, renderCheck, correlationId: 'c',
      resumeFrom: { lpDoc: clone(CLEAN_DOC), rounds: 2 },
      onCandidate: (c) => seen.push(c),
    });
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0].rounds).toBe(2);
  });
});
