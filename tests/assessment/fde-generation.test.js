/**
 * A board-pattern paper is written one SECTION at a time, in parallel.
 *
 * One call for a whole 48-item paper with a marking scheme on every written item runs past what a
 * single reply can carry, so each section is its own call: its own slots, its own pages (Maths
 * sets Section B from Units 1–8 and Section C from Units 11–12), its own 12,000-token ceiling and
 * its own one retry. The sections are then merged and run through the same chain every pattern
 * paper goes through: layout, the Urdu held-lessons filter, the scheme check, the maths key check.
 *
 * Mocked at the boundary only: the model client (getClient) and the book loader (BookContent).
 * The prompts, the pattern data, the layout pass and the checks are the real modules. The model's
 * replies are the three worked fixture papers in fixtures/fde/, cut per section.
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
const mockLoadPages = jest.fn();
const mockLoadChapter = jest.fn();
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: (...a) => mockLoadPages(...a),
  loadChapterContent: (...a) => mockLoadChapter(...a),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const PATTERN = 'fde_g5_2027';
const P = Patterns.get(PATTERN);
const FIXTURES = path.join(__dirname, 'fixtures', 'fde');
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));

const R1 = 'a single-procedure computation on given numbers counts as Understand; a word problem, a multi-step or unitary problem, a graph from data, a missing angle count as Apply; a fact, name or definition is Remember';
const FAMILIES = 'Q2\'s twelve items are four families of three — one number-sense item, one straight computation, one word problem — from Units 1–2, 3–4, 5–6, 7–8 respectively; Q4–Q8 are one each: draw, area, perimeter, average, missing angle.';
const HELD = 'never lessons 1, 2 or 3 (حمد، نعت، ایفائے عہد)';

// One page per unit band, so a test can see which pages a section was set from.
const MATHS_PAGES = '=== Page 5 ===\nPlace value up to ten lakh.\n\n=== Page 100 ===\nDecimals and percentages.\n\n'
  + '=== Page 220 ===\nAngles: obtuse, supplementary, straight.\n\n=== Page 255 ===\nBar graphs and averages.';
const URDU_PAGES = '=== Page 30 ===\nسبق چار کا متن\n\n=== Page 80 ===\nسبق سات: ندی کی فریاد';
// Lesson 2 (the Naat), book p.26: text an Urdu item must never quote.
const HELD_PAGE_26 = 'سرور کونین کی مدحت میں یہ اشعار پڑھے جاتے ہیں';
const HELD_PAGES = `=== Page 3 ===\nسبق اول کی ابتدا\n\n=== Page 26 ===\n${HELD_PAGE_26}`;

function loaded(content, pageReference) {
  return { content, pageReference, pageCount: 1, pagesFound: [], pagesMissing: [] };
}

/** The model's reply for one section: the fixture's items whose slot the prompt asked for. */
function sectionReply(name, userPrompt, edit = (tree) => tree) {
  const src = fixture(name);
  const tree = { unseen: {} };
  for (const [category, types] of Object.entries(src.unseen)) {
    for (const [type, list] of Object.entries(types)) {
      const mine = list.filter((q) => userPrompt.includes(`"slot": "${q.slot}"`));
      if (!mine.length) continue;
      tree.unseen[category] = tree.unseen[category] || {};
      tree.unseen[category][type] = mine;
    }
  }
  return edit(tree);
}

const reply = (content, usage = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 }, finish = 'stop') => ({
  choices: [{ message: { content }, finish_reason: finish }], usage,
});

/** A model that answers every section from the fixture; `override(sectionId, prompt)` may replace a reply. */
function fakeModel(name, override = () => null) {
  mockCreate.mockImplementation(async (params) => {
    const prompt = params.messages[1].content;
    const sec = /\*\*SECTION (\w+)\*\*/.exec(prompt)[1];
    const custom = override(sec, prompt);
    if (custom) return custom;
    return reply(JSON.stringify(sectionReply(name, prompt)));
  });
}

function bookFor(name) {
  mockLoadPages.mockImplementation(async ({ pageRanges }) => {
    if (pageRanges === '1-27') return loaded(HELD_PAGES, '1-27');
    return loaded(name === 'urdu' ? URDU_PAGES : MATHS_PAGES, String(pageRanges));
  });
}

const ARGS = (subject, extra = {}) => ({
  grade: 5, subject, pattern: PATTERN, scope: { kind: 'fde', chapters: null, pages: null },
  pageRanges: null, chapterNumber: null, ...extra,
});

const promptsBySection = () => Object.fromEntries(mockCreate.mock.calls.map(([params]) => {
  const prompt = params.messages[1].content;
  return [/\*\*SECTION (\w+)\*\*/.exec(prompt)[1], prompt];
}));
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, data]) => data);

beforeEach(() => {
  mockCreate.mockReset(); mockLog.mockReset(); mockLoadPages.mockReset(); mockLoadChapter.mockReset();
});

describe('generatePatternExam: one call per section', () => {
  test('section calls with the right slots and pages', async () => {
    bookFor('maths');
    fakeModel('maths');
    const out = await Gen.generatePatternExam(ARGS('maths'));

    // The pages are loaded once, for the whole FDE syllabus.
    expect(mockLoadPages).toHaveBeenCalledTimes(1);
    expect(mockLoadPages.mock.calls[0][0]).toMatchObject({ grade: 5, subject: 'maths', pageRanges: P.subjects.maths.scope.page_ranges });

    expect(mockCreate).toHaveBeenCalledTimes(3);
    const prompts = promptsBySection();
    expect(Object.keys(prompts).sort()).toEqual(['A', 'B', 'C']);

    // Each section names its own slots and no other section's.
    for (const sec of P.subjects.maths.sections) {
      for (const other of P.subjects.maths.sections) {
        for (const slot of other.slots) {
          const tagged = prompts[sec.id].includes(`"slot": "${slot.slot}"`);
          expect([sec.id, slot.slot, tagged]).toEqual([sec.id, slot.slot, other.id === sec.id]);
        }
      }
    }

    // Section A: the whole syllabus. B: Units 1–8 only. C: Units 11–12 only.
    expect(prompts.A).toContain('=== Page 5 ===');
    expect(prompts.A).toContain('=== Page 255 ===');
    expect(prompts.B).toContain('=== Page 5 ===');
    expect(prompts.B).toContain('=== Page 100 ===');
    expect(prompts.B).not.toContain('=== Page 220 ===');
    expect(prompts.B).not.toContain('=== Page 255 ===');
    expect(prompts.C).toContain('=== Page 220 ===');
    expect(prompts.C).toContain('=== Page 255 ===');
    expect(prompts.C).not.toContain('=== Page 5 ===');
    const ranges = Patterns.scopeFor(PATTERN, 'maths').section_ranges;
    expect(prompts.B).toContain(`**Page Reference:** ${ranges.B}`);
    expect(prompts.C).toContain(`**Page Reference:** ${ranges.C}`);

    // The merged paper is laid out in the pattern's shape.
    expect(out.examJson._layout).toMatchObject({ preset_id: PATTERN, subject: 'maths', total_marks: 100 });
    expect(out.layout).toEqual({ placed: 48, unplaced: 0 });
    expect(out.questionCount).toBe(48);
    expect(out.chapterTitle).toBeNull();
    expect(out.sections.map((s) => s.id)).toEqual(['A', 'B', 'C']);
    expect(out.sections[1].slots).toEqual(['maths.B.Q2']);
    expect(out.pageReference).toBe(P.subjects.maths.scope.page_ranges);

    // One `generating` line per section, one `layout applied`, and the planted wrong key replaced.
    const gen = logged('[assessment] generating');
    expect(gen.map((g) => g.section).sort()).toEqual(['A', 'B', 'C']);
    expect(gen[0]).toMatchObject({ pattern: PATTERN, cost: 0.01 });
    expect(gen[0].usage).toBeTruthy();
    expect(typeof gen[0].elapsedMs).toBe('number');
    expect(logged('[assessment] layout applied')).toEqual([
      expect.objectContaining({ pattern: PATTERN, placed: 48, unplaced: 0, totalMarks: 100, sections: ['A', 'B', 'C'] }),
    ]);
    expect(logged('[assessment] maths key replaced')).toEqual([
      expect.objectContaining({ slot: expect.stringMatching(/^maths\./), computed: '44', model: '44.5' }),
    ]);
  });

  test('max_tokens 12000 per call, timeout 240000, the rest as generateExam sends it', async () => {
    bookFor('maths');
    fakeModel('maths');
    await Gen.generatePatternExam(ARGS('maths'));
    expect(mockCreate).toHaveBeenCalledTimes(3);
    for (const [params, options] of mockCreate.mock.calls) {
      expect(params.max_tokens).toBe(12000);
      expect(options).toEqual({ timeout: 240000 });
      expect('timeout' in params).toBe(false);
      expect(params.job).toBe('assessment.generate');
      expect(params.temperature).toBe(0.7);
      expect(params.response_format).toEqual({ type: 'json_object' });
      expect(typeof params.model).toBe('string');
    }
  });

  test('one failed section retried once then BAD_JSON', async () => {
    bookFor('maths');
    fakeModel('maths', (sec) => (sec === 'B' ? reply('this is not json') : null));
    await expect(Gen.generatePatternExam(ARGS('maths'))).rejects.toMatchObject({ code: 'BAD_JSON' });
    const bySection = mockCreate.mock.calls.map(([p]) => /\*\*SECTION (\w+)\*\*/.exec(p.messages[1].content)[1]);
    expect(bySection.filter((s) => s === 'B')).toHaveLength(2);
    expect(bySection.filter((s) => s === 'A')).toHaveLength(1);
    expect(bySection.filter((s) => s === 'C')).toHaveLength(1);
  });

  test('an empty section reply is retried once and the second answer is used', async () => {
    bookFor('maths');
    let emptied = false;
    fakeModel('maths', (sec) => {
      if (sec !== 'C' || emptied) return null;
      emptied = true;
      return reply('', { prompt_tokens: 1000, completion_tokens: 0, total_tokens: 1000 });
    });
    const out = await Gen.generatePatternExam(ARGS('maths'));
    expect(mockCreate).toHaveBeenCalledTimes(4);
    expect(out.layout.placed).toBe(48);
  });

  test('a section cut off at the ceiling is TRUNCATED, and a thrown call is MODEL_UNAVAILABLE', async () => {
    bookFor('maths');
    fakeModel('maths', (sec) => (sec === 'A'
      ? reply('{"unseen": {"objective": {"MCQs": [{"question": "q', undefined, 'length') : null));
    await expect(Gen.generatePatternExam(ARGS('maths'))).rejects.toMatchObject({ code: 'TRUNCATED' });

    mockCreate.mockReset();
    fakeModel('maths', (sec) => { if (sec === 'C') throw new Error('socket hang up'); return null; });
    await expect(Gen.generatePatternExam(ARGS('maths'))).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });

  test('an unknown pattern or an ineligible subject is PATTERN_INELIGIBLE, before any call', async () => {
    bookFor('maths');
    await expect(Gen.generatePatternExam(ARGS('maths', { pattern: 'nope' }))).rejects.toMatchObject({ code: 'PATTERN_INELIGIBLE' });
    await expect(Gen.generatePatternExam(ARGS('islamiat'))).rejects.toMatchObject({ code: 'PATTERN_INELIGIBLE' });
    await expect(Gen.generatePatternExam(ARGS('maths', { grade: 4 }))).rejects.toMatchObject({ code: 'PATTERN_INELIGIBLE' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('a book loader error passes through untouched', async () => {
    const err = Object.assign(new Error('There is no text on those pages.'), { code: 'NO_CONTENT' });
    mockLoadPages.mockRejectedValue(err);
    await expect(Gen.generatePatternExam(ARGS('maths'))).rejects.toBe(err);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('a chapters scope uses the job\'s pages and every section gets all of them', async () => {
    bookFor('maths');
    fakeModel('maths');
    const out = await Gen.generatePatternExam(ARGS('maths', { scope: { kind: 'chapters', chapters: [3, 4], pages: null }, pageRanges: '42-90' }));
    expect(mockLoadPages.mock.calls[0][0].pageRanges).toBe('42-90');
    const prompts = promptsBySection();
    for (const id of ['A', 'B', 'C']) expect(prompts[id]).toContain('=== Page 220 ===');
    expect(out.examJson._layout.scope).toMatchObject({ kind: 'chapters', chapters: [3, 4] });
  });
});

describe('the prompts', () => {
  test('buildSystemPrompt unchanged', async () => {
    bookFor('maths');
    fakeModel('maths');
    await Gen.generatePatternExam(ARGS('maths'));
    const golden = fs.readFileSync(path.join(GOLDEN, 'system-prompt.maths.txt'), 'utf8');
    expect(Gen.buildSystemPrompt({ subject: 'maths', includeAnswerKey: true })).toBe(golden);
    for (const [params] of mockCreate.mock.calls) {
      expect(params.messages[0]).toEqual({ role: 'system', content: golden });
    }
  });

  test('buildUserPrompt unchanged', () => {
    const PAGE = '=== Page 12 ===\nFractions\nA fraction names a part of a whole.\n=== Page 13 ===\nEquivalent fractions name the same part.';
    const unseen = Gen.buildUserPrompt({
      grade: 5, subject: 'maths', pageContent: PAGE, pageReference: '12-13', contentSource: 'unseen', questionCount: 10,
      questionTypes: [
        { id: 'MCQs', count: 5, category: 'objective' },
        { id: 'Short Questions', count: 3, category: 'subjective' },
        { id: 'Word Problems', count: 2, category: 'subjective' },
      ],
    });
    expect(unseen).toBe(fs.readFileSync(path.join(GOLDEN, 'user-prompt.unseen.txt'), 'utf8'));
    const budget = Gen.buildUserPrompt({
      grade: 5, subject: 'urdu', pageContent: PAGE, pageReference: '12-13', contentSource: 'unseen', questionCount: 7,
      totalMarks: 40,
      questionTypes: [{ id: 'MCQs', count: 6, category: 'objective' }, { id: 'Essay Writing', count: 1, category: 'subjective' }],
    });
    expect(budget).toBe(fs.readFileSync(path.join(GOLDEN, 'user-prompt.budget.txt'), 'utf8'));
  });

  test('pattern prompt names every slot with EXACTLY n, the R1 sentence, the families rule', () => {
    const S = P.subjects.maths;
    const scope = { kind: 'fde' };
    const prompt = (sec) => Gen.buildPatternUserPrompt({
      grade: 5, subject: 'maths', pageContent: MATHS_PAGES, pageReference: '1-12', section: sec, slots: sec.slots, lang: 'en', P: S, scope,
    });
    const [A, B, C] = S.sections.map(prompt);

    for (const [sec, text] of [[S.sections[0], A], [S.sections[1], B], [S.sections[2], C]]) {
      expect(text).toContain('**Book Text Content:**');
      expect(text).toContain(`**SECTION ${sec.id}**`);
      for (const slot of sec.slots) {
        expect(text).toContain(`generate EXACTLY ${slot.generate}`);
        expect(text).toContain(`"slot": "${slot.slot}"`);
        expect(text).toContain(`"${slot.type}"`);
        expect(text).toContain(slot.prompt_rule);
        expect(text).toContain(slot.grain.kind);
      }
      expect(text).toContain(R1);
      expect(text).toContain('Set every item from the book text above. Never set an item on \'Create and Connect\' or \'Discovery Playground\' activities.');
      expect(text).toContain('The paper carries no pictures. A slot marked frame prints an empty frame: write the instruction and the labels/word bank only; never \'look at the picture\'.');
      expect(text).toContain('Marks: use EXACTLY the marks given per slot.');
      expect(text).toContain('blooms is one of Remember, Understand, Apply.');
      expect(text).toContain('For every WRITTEN item add scheme: { points: [{text, marks, kind: M|A|U|K|L}] summing EXACTLY to the item\'s marks, accept: [EVERY method the textbook teaches for this item], common_error }.');
      expect(text).toContain('give the data as table: { headers, rows }');
      expect(text.trimEnd().endsWith('Return the JSON only.')).toBe(true);
    }

    // Recall MCQs only where the MCQs are; the families rule on B and C; the choice where there is one.
    expect(A).toContain('include 3–5 straight recall MCQs');
    expect(B).not.toContain('include 3–5 straight recall MCQs');
    expect(B).toContain(FAMILIES);
    expect(C).toContain(FAMILIES);
    expect(A).not.toContain(FAMILIES);
    expect(B).toContain('the child chooses 8 of 12; make all 12 the same difficulty');
    expect(C).toContain('the child chooses 3 of 5; make all 5 the same difficulty');
    expect(A).not.toMatch(/the child chooses \d+ of \d+/);
    expect(B).toContain('units 1-2: number_sense, computation, word_problem');
    expect(C).toContain('draw, area, perimeter, average, missing_angle');
    // No marks budget, ever.
    for (const text of [A, B, C]) expect(text).not.toMatch(/must be worth \d+ marks/);
  });

  test('english and urdu composition sections carry their closed lists', () => {
    const E = P.subjects.english;
    const C = E.sections.find((s) => s.id === 'C');
    const text = Gen.buildPatternUserPrompt({
      grade: 5, subject: 'english', pageContent: 'x', pageReference: '1-138', section: C, slots: C.slots, lang: 'en', P: E, scope: { kind: 'fde' },
    });
    for (const list of Object.values(E.closed_lists)) for (const item of list) expect(text).toContain(item);
    const A = E.sections.find((s) => s.id === 'A');
    const textA = Gen.buildPatternUserPrompt({
      grade: 5, subject: 'english', pageContent: 'x', pageReference: '1-138', section: A, slots: A.slots, lang: 'en', P: E, scope: { kind: 'fde' },
    });
    expect(textA).not.toContain(E.closed_lists.paragraphs[0]);
  });

  test('urdu prompt forbids lessons 1–3 and religiousFilter drops an item quoting p. 26', async () => {
    const U = P.subjects.urdu;
    for (const sec of U.sections) {
      const text = Gen.buildPatternUserPrompt({
        grade: 5, subject: 'urdu', pageContent: URDU_PAGES, pageReference: '28-107', section: sec, slots: sec.slots, lang: 'ur', P: U, scope: { kind: 'fde' },
      });
      expect(text).toContain(HELD);
      if (sec.id === 'B') expect(text).toContain('the (ب) pick lists must be words that appear in the passage, at least two of each kind');
      else expect(text).not.toContain('the (ب) pick lists');
    }

    // The filter, on a laid-out Urdu paper with one MCQ quoting lesson 2.
    bookFor('urdu');
    const raw = fixture('urdu');
    raw.unseen.objective.MCQs[4].question = `درج ذیل جملہ مکمل کریں: «${HELD_PAGE_26}»`;
    const laid = applyLayout(raw, U, { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' }).examJson;
    const dropped = await Gen.religiousFilter(laid, U, { grade: 5, subject: 'urdu' });
    expect(dropped).toEqual([{ slot: 'urdu.A.Q1', reason: 'lesson_1_3' }]);
    expect(laid.unseen.objective.MCQs).toHaveLength(19);
    expect(mockLoadPages).toHaveBeenCalledTimes(1);
    expect(mockLoadPages.mock.calls[0][0]).toMatchObject({ grade: 5, subject: 'urdu', pageRanges: '1-27' });

    // Nothing else in the fixture quotes those pages; and a non-Urdu paper is never touched.
    const clean = applyLayout(fixture('urdu'), U, { kind: 'fde' }).examJson;
    expect(await Gen.religiousFilter(clean, U, { grade: 5, subject: 'urdu' })).toEqual([]);
    mockLoadPages.mockClear();
    const maths = applyLayout(fixture('maths'), P.subjects.maths, { kind: 'fde' }).examJson;
    expect(await Gen.religiousFilter(maths, P.subjects.maths, { grade: 5, subject: 'maths' })).toEqual([]);
    expect(mockLoadPages).not.toHaveBeenCalled();
  });

  test('a held item dropped from a full slot fails the urdu paper as a shortfall', async () => {
    bookFor('urdu');
    fakeModel('urdu', (sec, prompt) => (sec === 'A'
      ? reply(JSON.stringify(sectionReply('urdu', prompt, (tree) => {
        tree.unseen.objective.MCQs[0].answer = HELD_PAGE_26;
        return tree;
      })))
      : null));
    const err = await Gen.generatePatternExam(ARGS('urdu')).catch((e) => e);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(err.shortfall).toEqual([{ slot: 'urdu.A.Q1', missing: 1 }]);
    expect(logged('[assessment] held item dropped')).toEqual([{ slot: 'urdu.A.Q1', reason: 'lesson_1_3' }]);
    expect(mockLoadPages.mock.calls.map(([a]) => a.pageRanges)).toEqual([U_PAGES(), '1-27']);
  });

  test('the urdu fixture, clean, makes a whole paper', async () => {
    bookFor('urdu');
    fakeModel('urdu');
    const out = await Gen.generatePatternExam(ARGS('urdu'));
    expect(out.layout).toEqual({ placed: 35, unplaced: 0 });
    expect(out.examJson._layout.medium).toBe('ur');
    expect(logged('[assessment] held item dropped')).toEqual([]);
  });
});

function U_PAGES() { return P.subjects.urdu.scope.page_ranges; }

describe('the paper keeps the pattern\'s shape', () => {
  test('a shortfall fails the paper with PATTERN_SHORT_SLOT', async () => {
    bookFor('maths');
    fakeModel('maths', (sec, prompt) => (sec === 'B'
      ? reply(JSON.stringify(sectionReply('maths', prompt, (tree) => {
        tree.unseen.subjective['Word Problems'] = tree.unseen.subjective['Word Problems'].slice(0, 10);
        return tree;
      })))
      : null));
    const err = await Gen.generatePatternExam(ARGS('maths')).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(err.shortfall).toEqual([{ slot: 'maths.B.Q2', missing: 2 }]);
  });

  test('totalMarks on the job is ignored: no budget trimming on a pattern paper', async () => {
    bookFor('maths');
    fakeModel('maths');
    const out = await Gen.generatePatternExam(ARGS('maths', { totalMarks: 40 }));
    expect(out.questionCount).toBe(48);
    expect(out.examJson._layout.total_marks).toBe(100);
    for (const [params] of mockCreate.mock.calls) {
      expect(params.messages[1].content).not.toMatch(/worth 40 marks/);
    }
  });

  test('tokens summed across sections', async () => {
    bookFor('maths');
    const usage = { A: [100, 10], B: [200, 20], C: [400, 40] };
    fakeModel('maths', (sec, prompt) => {
      const [p, c] = usage[sec];
      return reply(JSON.stringify(sectionReply('maths', prompt)), { prompt_tokens: p, completion_tokens: c, total_tokens: p + c, cost: 0.5 });
    });
    const out = await Gen.generatePatternExam(ARGS('maths'));
    expect(out.tokenData).toMatchObject({ inputTokens: 700, outputTokens: 70, totalTokens: 770 });
    expect(typeof out.tokenData.model).toBe('string');
    expect(out.sections.map((s) => s.usage.prompt_tokens)).toEqual([100, 200, 400]);
    expect(typeof out.elapsedMs).toBe('number');
  });
});
