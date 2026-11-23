/**
 * bd-zrdvmi.39 (ICT feedback sheet, Lesson Plan row 528, second half). The reviewer's whole point
 * was "اس میں ریڈنگ کا وقت شامل نہیں ہے" — there is no reading TIME in it. bd-zrdvmi.17 put the
 * rule in every brief, and on 20 Nov the staging code's real plan for that lesson
 * (grade_6_urdu.c10.p051-054.tafheem) came back with a reading step that named who reads, the
 * pages and what to look for — and no minutes. A prompt rule alone left the fix partial.
 *
 * So the ladder now CHECKS it: a reading lesson (tafheem, reading_comprehension, buland_khwani)
 * must, before its first question step, have a step about the reading that says how many minutes.
 * A miss is a READING_TIME defect, which buys a revision round like any lint fail.
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
const { readingStepDefects, READING_SKILLS } = require('../../bot/shared/services/lp612-reading-step');

const BASE = require('./__fixtures__/v9_gate_base.lp.json');
const clone = (o) => JSON.parse(JSON.stringify(o));

/** The base doc with one paragraph added at the top of development (before the I Do). */
function withReadingBlock(text) {
  const d = clone(BASE);
  const dev = d.sections.find((s) => s.id === 'development');
  dev.blocks.splice(1, 0, { type: 'paragraph', id: 'reading-time', text });
  return d;
}

// Staging's 20 Nov output for row 528's lesson, verbatim: who, pages, what to look for — no minutes.
const NO_MINUTES = 'اب سبق خود پڑھیں گے۔ ٹیچر پہلے ص۵۲ کا پہلا پیراگراف بلند آواز سے پڑھ کر نمونہ پیش کریں، پھر طلبہ باری باری ص۵۲ تا ۵۴ باقی عبارت خاموشی سے یا باری باری بلند آواز سے پڑھیں۔ پڑھتے وقت ہر خاتون کا نام اور اس کا کام الگ الگ نشان زد کریں۔';
const WITH_MINUTES = `پڑھائی (۸ منٹ): ${NO_MINUTES}`;

describe('readingStepDefects', () => {
  test('the three reading lesson types are covered', () => {
    expect([...READING_SKILLS].sort()).toEqual(['buland_khwani', 'reading_comprehension', 'tafheem']);
  });

  test('row 528 as staging made it (reading step, no minutes) is a READING_TIME defect', () => {
    const fails = readingStepDefects(withReadingBlock(NO_MINUTES), 'tafheem');
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatch(/^READING_TIME: /);
    expect(fails[0]).toMatch(/minutes/);
  });

  test('a reading lesson with no reading step at all is a READING_TIME defect', () => {
    expect(readingStepDefects(clone(BASE), 'reading_comprehension')[0]).toMatch(/^READING_TIME: /);
  });

  test.each([
    ['Urdu digits', WITH_MINUTES],
    ['Latin digits, Urdu', `پڑھائی (8 منٹ): ${NO_MINUTES}`],
    ['Urdu number word', `پانچ منٹ تک طلبہ ص۵۲ خاموشی سے پڑھیں۔`],
    ['English', 'Reading (6 min): the teacher reads paragraph 1 aloud, then pupils read pp. 52-54 in turns.'],
    ['English words', 'Pupils read pages 12-13 silently for five minutes, noting each character.'],
  ])('a reading step with minutes passes (%s)', (_, text) => {
    expect(readingStepDefects(withReadingBlock(text), 'tafheem')).toEqual([]);
  });

  test('a block with its own minutes field counts', () => {
    const d = clone(BASE);
    d.sections.find((s) => s.id === 'development').blocks.splice(1, 0,
      { type: 'faded_example', id: 'read', minutes: 6, title: 'Read the passage', steps: ['Pupils read p.52 aloud in turns.'] });
    // faded_example is a question-type step; a timed READING one is still the reading step.
    expect(readingStepDefects(d, 'buland_khwani')).toEqual([]);
  });

  test('minutes on the reading step AFTER the first question step do not count', () => {
    const d = clone(BASE);
    d.sections.find((s) => s.id === 'homework').blocks.push({ type: 'paragraph', text: WITH_MINUTES });
    expect(readingStepDefects(d, 'tafheem')[0]).toMatch(/^READING_TIME: /);
  });

  test('a lesson that is not a reading lesson is never checked', () => {
    expect(readingStepDefects(clone(BASE), 'concept_build')).toEqual([]);
    expect(readingStepDefects(clone(BASE), undefined)).toEqual([]);
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-reading-gate-'));
    const d = path.join(dir, 'grade_6_urdu');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify({ title: 'Urdu', publisher: 'NBF', subject: 'urdu',
      grade: 6, medium: 'ur', language: 'Urdu', offset: 4, stem: 'grade_6_urdu' }));
    fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify({ chapters: [{ number: 10, title: 'باب', printed_start: 51 }] }));
    for (const n of [51, 52]) {
      fs.writeFileSync(path.join(d, `pg_0${n}.json`), JSON.stringify({ printed_page_number: n, pdf_page_index: n + 4,
        page_type: 'content', blocks: [{ t: 'prose', text: `صفحہ ${n} کی عبارت۔` }] }));
    }
    process.env.LP612_PAGE_TRUTH_DIR = dir;
    process.env.LP612_AUTHOR_ROUNDS = '1';
  });

  afterEach(() => {
    delete process.env.LP612_PAGE_TRUTH_DIR;
    delete process.env.LP612_AUTHOR_ROUNDS;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a tafheem plan with an untimed reading step is sent back for revision, naming READING_TIME', async () => {
    create.mockResolvedValueOnce(reply(withReadingBlock(NO_MINUTES)));
    create.mockResolvedValueOnce(reply(withReadingBlock(WITH_MINUTES)));
    const out = await authorLessonPlan({
      segment: {
        segment_id: 'grade_6_urdu.c10.p051-054.tafheem', book_stem: 'grade_6_urdu', grade: 6, subject: 'Urdu',
        medium: null, language: 'ur', chapter_number: 10, chapter_title: 'پاکستان کی نامور خواتین', chapter_key: 'c10',
        subtopic_title: 'سبق پڑھ کر تفہیم', menu_title: 'تفہیم', printed_page_start: 51, printed_page_end: 52,
        pages_covered: [51, 52], lp_type: 'content', skill_type: 'tafheem', slo_text: null,
      },
      lang: 'ur', model: 'anthropic/claude-sonnet-5', correlationId: 'test-reading-gate',
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(create.mock.calls[1][0].messages)).toMatch(/READING_TIME/);
    expect(readingStepDefects(out.lpDoc, 'tafheem')).toEqual([]);
  });
});
