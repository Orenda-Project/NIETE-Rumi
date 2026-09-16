/**
 * E2E — A RELIGIOUS LESSON REACHES THE TEACHER. bd-kpqu6.
 *
 * The unit suite (`religious-marks-false-positives.test.js`) proves the regex and the field
 * scope. It does NOT prove a teacher gets a PDF, because in production nothing refused a
 * *string* — the revision ladder refused a *document*. RELIGIOUS_MARKS is a blocking fail, a
 * blocking fail keeps `blockingCost(gates) > 0`, the ladder never breaks, it burns every round
 * trying to "fix" a word that was never broken, and the segment lands undeliverable.
 *
 * Three ICT lessons died that way on 2026-09-15. All three were Islamiat/Urdu segments whose
 * only sin was the ordinary plural "انبیاء" ("prophets"), which the old gate matched INSIDE as
 * the unhonorified "نبی".
 *
 * So this suite asserts at the layer the teacher actually feels:
 *   - the document comes back lint-clean and deliverable,
 *   - it costs ZERO revision rounds (the false positive is not merely survivable, it is gone),
 *   - and the genuine protection still refuses, at the same layer, in the same run.
 *
 * Red-first on the base branch: describe block A fails on the exact production string.
 *
 * The LLM and the renderer are injected/mocked so this stays hermetic — the assertions are
 * about the GATE'S VERDICT, which is the thing that was wrong.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});

const create = require('../../bot/shared/services/llm-client').__create;
const { authorLessonPlan } = require('../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

/** The exact string from the 2026-09-15 production refusal. */
const PROD_STRING = 'سیرتِ انبیاء سے متعلق مواد — نبی ﷺ کی تعلیمات';

/**
 * Put Urdu religious prose in a teacher-facing slot of an otherwise clean, schema-valid doc.
 *
 * `needs_human_review` is set because that is the SHAPE OF A REAL ISLAMIAT LESSON, not a
 * convenience. Check 6 of the gate (brief §4c.1, G5c) refuses any religious document that does
 * not carry the flag, and it refuses it whether or not this bug exists — see describe D, which
 * pins that hold. Leaving the flag off here would mean every assertion below was really
 * measuring check 6 and never reaching the boundary logic this fix changed.
 */
function religiousDoc(text = PROD_STRING) {
  const d = JSON.parse(JSON.stringify(CLEAN_DOC));
  const sec = d.sections.find((s) => (s.blocks || []).some((b) => b.type === 'paragraph'));
  sec.blocks.find((b) => b.type === 'paragraph').text = text;
  d.needs_human_review = true;
  return d;
}

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

/** The renderer is clean throughout — this suite is about the LINT gate, nothing else. */
const run = (rounds = 3) => authorLessonPlan({
  segment: SEGMENT, lang: 'en', model: 'test/model', rounds,
  renderCheck: jest.fn().mockResolvedValue([]), correlationId: 'c',
});

const religiousFails = (out) => (out.fails || []).map(String).filter((e) => e.startsWith('RELIGIOUS_MARKS'));

describe('A — the lesson that production refused now reaches the teacher', () => {
  test('the exact 2026-09-15 string is delivered, lint-clean, in zero revision rounds', async () => {
    create.mockResolvedValue(reply(religiousDoc()));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);                 // not one wasted round on a non-defect
    expect(create).toHaveBeenCalledTimes(1);    // authored once, never sent back for revision
    expect(out.lpDoc).toBeTruthy();             // there IS a document to render
  });

  test('the bare chapter title "سیرتِ انبیاء" is delivered', async () => {
    create.mockResolvedValue(reply(religiousDoc('سیرتِ انبیاء کا باب')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
  });

  test('an English lesson naming Muhammad Ali Jinnah is delivered', async () => {
    create.mockResolvedValue(reply(religiousDoc('Quaid-e-Azam Mohammad Ali Jinnah founded Pakistan in 1947.')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
  });
});

describe('B — the protection it exists for still refuses, at the same layer', () => {
  test('an unhonorified Prophet in lesson body is NOT delivered clean — bd-qzitp holds', async () => {
    // The gate's whole purpose. If this ever goes green the fix has gone too far.
    create.mockResolvedValue(reply(religiousDoc('نبی نے فرمایا کہ علم حاصل کرو')));

    const out = await run(1);

    expect(religiousFails(out).length).toBeGreaterThan(0);
    expect(out.lintClean).toBe(false);
  });

  test('a transliterated sacred name inside Urdu is NOT delivered clean', async () => {
    create.mockResolvedValue(reply(religiousDoc('سیرت کا سبق: یہ Allah کی وحدانیت پر ہے')));

    const out = await run(1);

    expect(religiousFails(out).length).toBeGreaterThan(0);
  });
});

describe('C — the ladder is not burning rounds on a word it cannot fix', () => {
  test('a religious lesson costs the SAME rounds as a non-religious one', async () => {
    // The production symptom was cost, not just refusal: every round was spent re-writing a
    // correct word. Parity with the control is the thing worth asserting.
    create.mockResolvedValue(reply(JSON.parse(JSON.stringify(CLEAN_DOC))));
    const control = await run();

    jest.clearAllMocks();
    create.mockResolvedValue(reply(religiousDoc()));
    const religious = await run();

    expect(religious.rounds).toBe(control.rounds);
  });
});

describe('D — the native-speaker hold is untouched by this fix', () => {
  test('a religious lesson WITHOUT needs_human_review is still refused', async () => {
    // The hold is the reason no Islamiat lesson is ever served on demand. This fix narrows
    // WHICH STRINGS COUNT AS A VIOLATION; it must not narrow the hold itself.
    const d = religiousDoc();
    delete d.needs_human_review;
    create.mockResolvedValue(reply(d));

    const out = await run(1);

    expect(religiousFails(out).some((e) => e.includes('needs_human_review'))).toBe(true);
  });
});

describe('E — a correctly-honorified companion is not reported as a slip', () => {
  // Check 3 is the CONSISTENCY rule: it fires only on a bare name the same document honorifies
  // somewhere else. Two matcher defects made a correctly-honorified name look bare, so the rule
  // reported an inconsistency that was not in the text. Both mentions go in one string because
  // the honorified set is document-wide.
  const LINE = 'حضرت خدیجۃ الکبریٰ رضی اللہ تعالیٰ عنہا کا لقب کیا تھا؟ حضرت خدیجۃ رضی اللہ عنہا کا ذکر';

  test('the production Grade 6 tafheem line is delivered, lint-clean', async () => {
    create.mockResolvedValue(reply(religiousDoc(LINE)));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);
  });

  test('a three-word name reaches its honorific', async () => {
    create.mockResolvedValue(reply(religiousDoc(
      'حضرت زینب بنت علی رضی اللہ عنہا کا ذکر آتا ہے۔ حضرت زینب رضی اللہ عنہا مشہور ہیں')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
  });

  test('a genuinely bare companion is STILL not delivered clean', async () => {
    // The consistency rule's whole point. If this goes green the fix has gone too far.
    create.mockResolvedValue(reply(religiousDoc(
      'حضرت خدیجۃ الکبریٰ کا لقب کیا تھا؟ حضرت خدیجۃ رضی اللہ عنہا کا ذکر')));

    const out = await run(1);

    expect(religiousFails(out).length).toBeGreaterThan(0);
    expect(out.lintClean).toBe(false);
  });
});
