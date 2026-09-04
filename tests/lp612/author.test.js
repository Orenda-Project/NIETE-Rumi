/**
 * lp612-author.service — the LLM author and its revision ladder.
 *
 * This is a port of the pipeline's `author_lp.py::author()`, so the tests are written against
 * the behaviours that port had to preserve, each of which was bought with a failed pilot run:
 *
 *   • one author call, ONE retry when the reply carries no JSON — and the retry exists on the
 *     REVISION call too, because the asymmetry cost one pilot two of its three rounds;
 *   • the gates run PER ROUND, in process: schema first (it short-circuits — pedagogy findings
 *     on a broken shape are not trustworthy), then the vendored canon lint;
 *   • a round whose candidate is WORSE is rejected and the ladder CONTINUES. A bad roll costs
 *     the round, never the climb;
 *   • the revision prompt carries the previous document, the defects, and the "OVERSHOOT the
 *     cut by ~10%" instruction verbatim — word counters differ, and landing a few words over a
 *     ceiling costs another whole round.
 *
 * The LLM is mocked at the network boundary (`llm-client`), never the service under test.
 * Page-truth is served from a real temp directory via LP612_PAGE_TRUTH_DIR — the same code path
 * production uses, just a different source.
 *
 * NOTE ON THE GATES IN THIS SUITE: `ajv`, `katex` and `openchemlib` are stubbed in the root
 * suite (see tests/__mocks__ and SYNC.md §5). The stubs were checked against the real packages
 * on the fixture below and agree exactly — 0 fails, 2 BUDGET warns, PACING_SUM on a mutated
 * pacing, SCHEMA on `{}` — but a green lint here still means "the ported control flow saw a
 * clean gate", not "the canon gate passed as the bot will run it".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }), __create: create };
});

const create = require('../../bot/shared/services/llm-client').__create;
const {
  authorLessonPlan,
  resolveAuthorModel,
} = require('../../bot/shared/services/lp612-author.service');

const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const BOOK = {
  title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9,
  medium: 'en', language: 'English', offset: 4,
};
const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };

const SEGMENT = {
  segment_id: 'seg-1',
  book_stem: 'grade_9_biology',
  grade: 9,
  subject: 'biology',
  medium: 'en',
  language: 'English',
  chapter_number: 1,
  chapter_title: 'The Biological Method',
  chapter_key: 'g9-bio-ch1',
  part: null,
  subtopic_title: 'Observation and hypothesis',
  menu_title: 'Observation & hypothesis',
  section_ref: '1.2',
  printed_page_start: 11,
  printed_page_end: 12,
  pages_covered: [11, 12],
  order_index: 3,
  lp_type: 'SCI-9-10',
  segment_index: 1,
  day_number: 1,
  skill_type: 'concept',
  slo_text: 'Describe the steps of the biological method.',
  yt: null,
  notes: null,
  prev_segment_id: null,
  next_segment_id: 'seg-2',
};

/** A structurally broken document: fails SCHEMA, which short-circuits the rest of the lint. */
const BROKEN_DOC = { lesson_id: 'x' };

/** The clean fixture with its pacing knocked out — one deterministic lint FAIL, no schema error. */
function pacingBrokenDoc() {
  const d = JSON.parse(JSON.stringify(CLEAN_DOC));
  d.sections.find((s) => s.id === 'activity').minutes += 7;
  return d;
}

/**
 * Two more single-code breakages, so a ladder can be shown actually CLIMBING rather than
 * spinning: three blocking defects, then two, then one. Each mutation is verified to add
 * exactly one lint code on top of the ones below it, and none of them is `BUDGET` — an
 * advisory defect would not move the ladder at all (bd-wbvtb).
 *
 *   threeDefectDoc -> PLACEHOLDER + REF_ABSENT + PACING_SUM
 *   twoDefectDoc   -> REF_ABSENT + PACING_SUM
 *   pacingBrokenDoc-> PACING_SUM
 */
function twoDefectDoc() {
  const d = pacingBrokenDoc();
  d.page2.model_answers = [d.page2.model_answers[0]];   // a homework ref now resolves to nothing
  return d;
}
function threeDefectDoc() {
  const d = twoDefectDoc();
  d.provenance.topic = 'TODO';
  return d;
}

const reply = (obj, usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }) => ({
  choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }],
  usage,
});

let dir;

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-author-'));
  const d = path.join(dir, SEGMENT.book_stem);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
  fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
  for (const n of [11, 12]) {
    fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
      printed_page_number: n,
      pdf_page_index: n + 4,
      page_type: 'content',
      blocks: [
        { t: 'heading', text: `1.${n} Observation` },
        { t: 'prose', text: `The observable body text of printed page ${n}.` },
        { t: 'list', title: 'Learning Outcomes', items: ['Describe the steps of the biological method.'] },
      ],
    }));
  }
  process.env.LP612_PAGE_TRUTH_DIR = dir;
  delete process.env.LP_AUTHOR_MODEL;
  delete process.env.LP612_AUTHOR_ROUNDS;
});

afterEach(() => {
  delete process.env.LP612_PAGE_TRUTH_DIR;
  delete process.env.LP_AUTHOR_MODEL;
  delete process.env.LP612_AUTHOR_ROUNDS;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('resolveAuthorModel', () => {
  it('defaults to anthropic/claude-sonnet-5', () => {
    expect(resolveAuthorModel()).toBe('anthropic/claude-sonnet-5');
  });

  it('honours LP_AUTHOR_MODEL', () => {
    process.env.LP_AUTHOR_MODEL = 'openai/gpt-5.4-mini';
    expect(resolveAuthorModel()).toBe('openai/gpt-5.4-mini');
  });
});

describe('the author call', () => {
  it('sends the vendored brief as the system message and the page-truth as the user message', async () => {
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en', model: 'test/model' });

    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0][0];
    expect(args.model).toBe('test/model');
    expect(args.messages[0].role).toBe('system');
    // the brief is ~66KB — a short system message means the vendored brief was not loaded
    expect(args.messages[0].content.length).toBeGreaterThan(40000);
    const user = args.messages[1].content;
    expect(user).toContain('PRINTED PAGE 11');
    expect(user).toContain('PRINTED PAGE 12');
    expect(user).toContain('The observable body text of printed page 12.');
    expect(user).toContain(SEGMENT.subtopic_title);
    expect(out.model).toBe('test/model');
  });

  it('defaults the model from the environment when the caller passes none', async () => {
    process.env.LP_AUTHOR_MODEL = 'env/model';
    create.mockResolvedValue(reply(CLEAN_DOC));
    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en' });
    expect(create.mock.calls[0][0].model).toBe('env/model');
    expect(out.model).toBe('env/model');
  });

  it('disables reasoning with the OpenRouter spelling — it bills as completion tokens and truncates the JSON', async () => {
    create.mockResolvedValue(reply(CLEAN_DOC));
    await authorLessonPlan({ segment: SEGMENT, lang: 'en' });
    expect(create.mock.calls[0][0].reasoning).toEqual({ enabled: false });
  });

  it('strips a markdown fence around the JSON', async () => {
    create.mockResolvedValue(reply('```json\n' + JSON.stringify(CLEAN_DOC) + '\n```'));
    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en' });
    expect(out.lpDoc.lesson_id).toBe(CLEAN_DOC.lesson_id);
  });

  it('repairs a raw LaTeX backslash rather than letting \\frac parse into a form feed', async () => {
    // `\f` IS a legal JSON escape, so JSON.parse "succeeds" on "\frac" and silently
    // destroys the formula. The repair doubles it; a real "\n" newline must survive.
    const doc = JSON.parse(JSON.stringify(CLEAN_DOC));
    doc.notes = 'MATH \\frac{1}{2} and a real\nline break';
    // Emit the LaTeX the way a model does — one backslash, not JSON's escaped two.
    const raw = JSON.stringify(doc).replace('\\\\frac', '\\frac');
    create.mockResolvedValue(reply(raw));
    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en' });
    expect(out.lpDoc.notes).toContain('\\frac{1}{2}');
    expect(out.lpDoc.notes).toContain('\n'); // the genuine escape survives the repair
  });

  it('finds the JSON object when the model wraps it in prose', async () => {
    create.mockResolvedValue(reply('Here is the plan:\n' + JSON.stringify(CLEAN_DOC) + '\nHope that helps.'));
    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en' });
    expect(out.lpDoc.lesson_id).toBe(CLEAN_DOC.lesson_id);
  });

  it('retries ONCE when the first reply carries no JSON, then succeeds', async () => {
    create
      .mockResolvedValueOnce(reply('I cannot produce that.'))
      .mockResolvedValueOnce(reply(CLEAN_DOC));
    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(out.lintClean).toBe(true);
  });

  it('throws AUTHOR_UNPARSEABLE when BOTH attempts carry no JSON', async () => {
    create.mockResolvedValue(reply('still no JSON here'));
    const err = await authorLessonPlan({ segment: SEGMENT, lang: 'en' }).catch((e) => e);
    expect(err.code).toBe('AUTHOR_UNPARSEABLE');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('throws AUTHOR_LLM_FAILED when the transport fails on both attempts', async () => {
    create.mockRejectedValue(new Error('502 upstream'));
    const err = await authorLessonPlan({ segment: SEGMENT, lang: 'en' }).catch((e) => e);
    expect(err.code).toBe('AUTHOR_LLM_FAILED');
  });

  it('names the empty-content-plus-reasoning failure instead of dying later on "no JSON"', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: '', reasoning_content: 'thinking very hard' } }],
      usage: { completion_tokens: 5999 },
    });
    const err = await authorLessonPlan({ segment: SEGMENT, lang: 'en' }).catch((e) => e);
    expect(err.code).toBe('AUTHOR_LLM_FAILED');
    expect(err.message).toMatch(/reasoning/i);
  });

  it('propagates PAGE_TRUTH_MISSING and never calls the model for a book it cannot ground in', async () => {
    const err = await authorLessonPlan({
      segment: { ...SEGMENT, book_stem: 'no_such_book' }, lang: 'en',
    }).catch((e) => e);
    expect(err.code).toBe('PAGE_TRUTH_MISSING');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('the YouTube link is DATA from the segment, not something the model authors', () => {
  it('writes the segment yt url/title into the development section video slot', async () => {
    const doc = JSON.parse(JSON.stringify(CLEAN_DOC));
    delete doc.sections.find((s) => s.id === 'development').video;
    create.mockResolvedValue(reply(doc));

    const out = await authorLessonPlan({
      segment: {
        ...SEGMENT,
        yt: { url: 'https://youtu.be/abc123', title: 'The biological method in 4 minutes', channel: 'FreeSciEd', duration: '4:12' },
      },
      lang: 'en',
    });

    const dev = out.lpDoc.sections.find((s) => s.id === 'development');
    expect(dev.video).toMatchObject({
      url: 'https://youtu.be/abc123',
      title: 'The biological method in 4 minutes',
      channel: 'FreeSciEd',
      duration: '4:12',
    });
  });

  it('accepts yt as a JSON string (the column may arrive unparsed)', async () => {
    const doc = JSON.parse(JSON.stringify(CLEAN_DOC));
    delete doc.sections.find((s) => s.id === 'development').video;
    create.mockResolvedValue(reply(doc));

    const out = await authorLessonPlan({
      segment: { ...SEGMENT, yt: JSON.stringify({ url: 'https://youtu.be/zzz', title: 'A titled video' }) },
      lang: 'en',
    });

    expect(out.lpDoc.sections.find((s) => s.id === 'development').video)
      .toMatchObject({ url: 'https://youtu.be/zzz', title: 'A titled video' });
  });

  it('omits the video slot entirely when the segment carries no yt', async () => {
    const doc = JSON.parse(JSON.stringify(CLEAN_DOC));
    delete doc.sections.find((s) => s.id === 'development').video;
    create.mockResolvedValue(reply(doc));

    const out = await authorLessonPlan({ segment: { ...SEGMENT, yt: null }, lang: 'en' });

    expect(out.lpDoc.sections.find((s) => s.id === 'development').video).toBeUndefined();
  });

  it('DROPS a video the model invented when the segment has none — an unvalidated link must not reach a teacher', async () => {
    const doc = JSON.parse(JSON.stringify(CLEAN_DOC));
    doc.sections.find((s) => s.id === 'development').video = {
      url: 'https://youtube.com/watch?v=hallucinated', title: 'Something the model made up',
    };
    create.mockResolvedValue(reply(doc));

    const out = await authorLessonPlan({ segment: { ...SEGMENT, yt: null }, lang: 'en' });

    expect(out.lpDoc.sections.find((s) => s.id === 'development').video).toBeUndefined();
  });

  it('ignores a yt with no usable url', async () => {
    const doc = JSON.parse(JSON.stringify(CLEAN_DOC));
    delete doc.sections.find((s) => s.id === 'development').video;
    create.mockResolvedValue(reply(doc));
    const out = await authorLessonPlan({ segment: { ...SEGMENT, yt: { title: 'no url' } }, lang: 'en' });
    expect(out.lpDoc.sections.find((s) => s.id === 'development').video).toBeUndefined();
  });
});

describe('the gates', () => {
  it('reports a clean document as lintClean with no fails', async () => {
    create.mockResolvedValue(reply(CLEAN_DOC));
    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en' });
    expect(out.lintClean).toBe(true);
    expect(out.fails).toEqual([]);
    expect(out.rounds).toBe(0);
    expect(create).toHaveBeenCalledTimes(1); // no revision round was spent
  });

  it('surfaces lint warnings without treating them as failures', async () => {
    create.mockResolvedValue(reply(CLEAN_DOC));
    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en' });
    expect(out.warns.length).toBeGreaterThan(0);
    expect(out.lintClean).toBe(true);
  });

  it('short-circuits on a schema failure — the whole finding list is SCHEMA', async () => {
    create.mockResolvedValue(reply(BROKEN_DOC));
    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en', rounds: 0 });
    expect(out.lintClean).toBe(false);
    expect(out.fails.length).toBeGreaterThan(0);
    expect(out.fails.every((f) => f.startsWith('SCHEMA'))).toBe(true);
  });

  it('runs the canon lint on a schema-valid document', async () => {
    create.mockResolvedValue(reply(pacingBrokenDoc()));
    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en', rounds: 0 });
    expect(out.fails.some((f) => f.startsWith('PACING_SUM'))).toBe(true);
  });

  it('accumulates token usage across every call', async () => {
    create.mockResolvedValue(reply(CLEAN_DOC));
    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en' });
    expect(out.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 20, calls: 1 });
  });
});

describe('the revision ladder', () => {
  it('revises a defective document and stops as soon as it is clean', async () => {
    create
      .mockResolvedValueOnce(reply(pacingBrokenDoc()))
      .mockResolvedValueOnce(reply(CLEAN_DOC));

    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en', rounds: 3 });

    expect(create).toHaveBeenCalledTimes(2);
    expect(out.rounds).toBe(1);
    expect(out.lintClean).toBe(true);
    expect(out.fails).toEqual([]);
  });

  it('builds a revision prompt carrying the blocking defects, the previous doc and the original task', async () => {
    create
      .mockResolvedValueOnce(reply(pacingBrokenDoc()))
      .mockResolvedValueOnce(reply(CLEAN_DOC));

    await authorLessonPlan({ segment: SEGMENT, lang: 'en', rounds: 3 });

    const revisionUser = create.mock.calls[1][0].messages[1].content;
    expect(revisionUser).toContain('Return the COMPLETE corrected lp_doc JSON');
    expect(revisionUser).toContain('PREVIOUS lp_doc');
    expect(revisionUser).toContain('PACING_SUM');
    // the original task travels with it, so the model still has the page-truth
    expect(revisionUser).toContain('PRINTED PAGE 11');
    // THIS LINE USED TO ASSERT `OVERSHOOT the cut by about 10%` AND IT ENCODED THE DEFECT
    // (bd-owx8t). The preamble ordered a word cut, overshot by 10%, for `BUDGET` — a code that
    // has not gated delivery since bd-wbvtb and that fires on 59 of 62 real documents, while the
    // page-count block a few lines below says shortening sentences will not remove a page. The
    // prompt held two contradictory orders and this test held the wrong one in place.
    expect(revisionUser).not.toMatch(/OVERSHOOT/i);
    expect(revisionUser).not.toMatch(/word-budget/i);
  });

  it('rejects a WORSE candidate but keeps climbing — a bad round costs the round, never the ladder', async () => {
    create
      .mockResolvedValueOnce(reply(pacingBrokenDoc()))   // round 0: 1 defect
      .mockResolvedValueOnce(reply(BROKEN_DOC))          // round 1: many defects -> rejected
      .mockResolvedValueOnce(reply(CLEAN_DOC));          // round 2: clean -> kept

    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en', rounds: 3 });

    expect(create).toHaveBeenCalledTimes(3);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(2);
  });

  it('a rejected round revises from the document it KEPT, not from the worse candidate', async () => {
    create
      .mockResolvedValueOnce(reply(pacingBrokenDoc()))
      .mockResolvedValueOnce(reply(BROKEN_DOC))
      .mockResolvedValueOnce(reply(CLEAN_DOC));

    await authorLessonPlan({ segment: SEGMENT, lang: 'en', rounds: 3 });

    const thirdCallUser = create.mock.calls[2][0].messages[1].content;
    expect(thirdCallUser).toContain('PACING_SUM');
    expect(thirdCallUser).toContain(CLEAN_DOC.lesson_id);
  });

  it('an unparseable round costs that round, not the ladder', async () => {
    create
      .mockResolvedValueOnce(reply(pacingBrokenDoc()))
      .mockResolvedValueOnce(reply('nope'))             // round 1 attempt 1
      .mockResolvedValueOnce(reply('still nope'))       // round 1 attempt 2 (the retry)
      .mockResolvedValueOnce(reply(CLEAN_DOC));         // round 2

    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en', rounds: 3 });

    expect(create).toHaveBeenCalledTimes(4);
    expect(out.lintClean).toBe(true);
  });

  it('a transport blow-up in a round costs that round, not the ladder', async () => {
    create
      .mockResolvedValueOnce(reply(pacingBrokenDoc()))
      .mockRejectedValueOnce(new Error('502'))
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce(reply(CLEAN_DOC));

    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en', rounds: 3 });
    expect(out.lintClean).toBe(true);
  });

  it('stops at the round cap and returns the best document it reached, still dirty', async () => {
    create.mockResolvedValue(reply(pacingBrokenDoc()));

    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en', rounds: 2 });

    expect(create).toHaveBeenCalledTimes(3); // 1 author + 2 revisions
    expect(out.rounds).toBe(2);
    expect(out.lintClean).toBe(false);
    expect(out.fails.some((f) => f.startsWith('PACING_SUM'))).toBe(true);
    expect(out.lpDoc).toBeDefined();
  });

  it('defaults to 3 rounds', async () => {
    // bd-wbvtb changed what this has to be measured with. It used to hand back the SAME
    // pacing-broken document every round and count to 3 — which only proved the cap because
    // the ladder used to burn every round it was given, however useless. The ladder now gives
    // up after two rounds that reduce no blocking defect, so a document that never improves
    // stops at 2 and can no longer demonstrate a cap of 3.
    //
    // So the cap is now measured on a ladder that is genuinely still climbing: three stacked
    // blocking defects, one cleared per round, still dirty when the third round ends. That is
    // what "the default is 3" actually means, and it is the shape a real run has.
    create
      .mockResolvedValueOnce(reply(threeDefectDoc()))
      .mockResolvedValueOnce(reply(twoDefectDoc()))
      .mockResolvedValueOnce(reply(pacingBrokenDoc()))
      .mockResolvedValue(reply(pacingBrokenDoc()));

    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en' });

    expect(out.rounds).toBe(3);
    expect(create).toHaveBeenCalledTimes(4);     // author + 3 revisions
    expect(out.lintClean).toBe(false);
  });

  it('gives up early when four straight rounds reduce no blocking defect', async () => {
    // The guard against a runaway ladder. Deliberately measured with SIX rounds available,
    // because at the default of 3 it can never fire — which is the point: the threshold is set
    // at 4 so that a lesson whose progress is invisible to the defect list still gets its
    // rounds (study cell c09 needed five, showing one unchanged defect for four of them).
    create.mockResolvedValue(reply(pacingBrokenDoc()));

    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en', rounds: 6 });

    expect(out.rounds).toBe(4);
    expect(create).toHaveBeenCalledTimes(5);     // author + 4 revisions, then it stops
    expect(out.fails.some((f) => f.startsWith('PACING_SUM'))).toBe(true);
    expect(out.lpDoc).toBeDefined();
  });

  it('honours LP612_AUTHOR_ROUNDS', async () => {
    process.env.LP612_AUTHOR_ROUNDS = '1';
    create.mockResolvedValue(reply(pacingBrokenDoc()));
    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'en' });
    expect(out.rounds).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
