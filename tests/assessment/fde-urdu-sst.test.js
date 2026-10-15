/**
 * Urdu, Social Studies and English board-pattern papers, from REAL model replies.
 *
 * The other pattern tests replay hand-built papers. These replay what the question writer
 * actually wrote for three full-syllabus papers (fixtures/fde/<subject>-gen-full.json, one reply
 * per section, recorded off the generation chain), so the checks below run on the shapes,
 * wording and slips a real reply has, not the ones we imagined.
 *
 * Mocked at the boundary only: the model client (it returns the recorded reply for the section
 * the prompt asks for) and the book loader. The book text is fictional: the held lessons (book
 * pp 1–27) are a placeholder line, never the Hamd or the Naat. Everything between — the prompts,
 * the pattern data, layout, the held-lessons filter, the scheme check, both renderers — is real.
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
const mockLoadPages = jest.fn();
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: (...a) => mockLoadPages(...a),
  loadChapterContent: () => { throw new Error('a pattern paper on the FDE syllabus loads pages, not a chapter'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
const Fde = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const PATTERN = 'fde_g5_2027';
const P = Patterns.get(PATTERN);
const recorded = (subject) => JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'fde', `${subject}-gen-full.json`), 'utf8',
));

// Fictional book text. The held page carries one line a test can make an item quote.
const HELD_LINE = 'یہ سطر صرف آزمائش کے لیے لکھی گئی ہے اور کسی سبق کا حصہ نہیں';
const HELD_TEXT = `=== Page 13 ===\n${HELD_LINE}`;
const BOOK_TEXT = '=== Page 30 ===\nسبق کا متن\n\n=== Page 80 ===\nسبق کا دوسرا متن';

function book() {
  mockLoadPages.mockImplementation(async ({ pageRanges }) => ({
    content: pageRanges === '1-27' ? HELD_TEXT : BOOK_TEXT,
    pageReference: String(pageRanges), pageCount: 2, pagesFound: [], pagesMissing: [],
  }));
}

/** The model: the recorded reply for whichever section the prompt asks for, `edit` applied. */
function model(subject, edit = (section, tree) => tree) {
  const rec = recorded(subject);
  mockCreate.mockImplementation(async (params) => {
    const section = /\*\*SECTION (\w+)\*\*/.exec(params.messages[1].content)[1];
    const raw = rec.sections[section];
    if (!raw) throw new Error(`no recorded reply for section ${section}`);
    const tree = edit(section, JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)));
    return { choices: [{ message: { content: JSON.stringify(tree) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 } };
  });
}

const generate = (subject) => Gen.generatePatternExam({
  grade: 5, subject, pattern: PATTERN, scope: { kind: 'fde', chapters: null, pages: null },
});

function render(examJson, subject) {
  const args = { examJson, grade: 5, subject, schoolName: null, pageReference: null, chapterTitle: null };
  return {
    paper: Renderer.renderPaper({ ...args, answerLines: true }),
    scheme: Renderer.renderAnswerKey({ ...args, paperFileName: `Grade5_${subject}_FDE.pdf` }),
  };
}

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

/** Every item the paper carries, with its slot. */
function items(examJson) {
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach((q) => (q && typeof q === 'object' && !Array.isArray(q) && q.slot ? out.push(q) : walk(q)));
    else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => k !== '_layout' && walk(v));
  };
  walk(examJson);
  return out;
}

// Printed text compared without spaces or direction marks: the renderer wraps every number in its
// own span, and draws ✓ as a picture, so neither is in the visible text the way it is in the data.
const squash = (s) => String(s).replace(/[\s\u200e\u200f\u2066-\u2069✓]/g, '');
/** What the paper prints for a line of the pattern: Urdu digits in Urdu, and a `{q}` is the item's own. */
const printed = (line, lang) => String(line).split(/\{q\}/).map((part) => squash(lang === 'ur' ? Fde.toUrduDigits(part) : part)).filter(Boolean);
const showsLine = (text, line, lang) => printed(line, lang).every((part) => squash(text).includes(part));

const slotsOf = (subject) => P.subjects[subject].sections.flatMap((s) => s.slots);
// An Urdu digit and the separator dot, with nothing but space or a direction mark between them.
const DIGIT_BESIDE_DOT = /[۰-۹][\s‎‏⁦-⁩]*·|·[\s‎‏⁦-⁩]*[۰-۹]/;

beforeEach(() => {
  mockCreate.mockReset();
  mockLoadPages.mockReset();
  book();
});

describe('Urdu: a real paper', () => {
  test('builds a 100-mark paper with every slot filled, one call per section and no item dropped', async () => {
    model('urdu');
    const out = await generate('urdu');
    expect(mockCreate).toHaveBeenCalledTimes(P.subjects.urdu.sections.length);
    expect(out.examJson._layout).toMatchObject({ preset_id: PATTERN, subject: 'urdu', total_marks: 100 });
    const have = new Set(items(out.examJson).map((q) => q.slot));
    for (const slot of slotsOf('urdu')) expect([slot.slot, have.has(slot.slot)]).toEqual([slot.slot, true]);
  });

  test('an item quoting the held lessons is dropped and the paper fails on that slot, never refilled', async () => {
    model('urdu', (section, tree) => {
      if (section !== 'A') return tree;
      const first = items(tree).find((q) => q.slot === 'urdu.A.Q1');
      first.question = `${HELD_LINE}؟`;
      return tree;
    });
    const err = await generate('urdu').catch((e) => e);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(err.shortfall).toEqual([{ slot: 'urdu.A.Q1', missing: 1 }]);
    // Each section asked once: a short slot is a failed paper, not a second call.
    expect(mockCreate).toHaveBeenCalledTimes(P.subjects.urdu.sections.length);
  });

  test('Q6 prints the Naat as FDE\'s own instruction, the scheme gives the 3·1·1 split and a page, and no verse is written', async () => {
    model('urdu');
    const { examJson } = await generate('urdu');
    const q6 = slotsOf('urdu').find((s) => s.slot === 'urdu.C.Q6');
    const naat = q6.alternatives.find((a) => a.kind === 'fixed');
    const { paper, scheme } = render(examJson, 'urdu');
    expect(visible(paper)).toContain(naat.instruction_ur);
    const schemeText = visible(scheme);
    expect(showsLine(schemeText, `تقسیم ${naat.split.join('، ')}`, 'ur')).toBe(true);
    expect(showsLine(schemeText, `سبق ${naat.book_lesson}، ص ${naat.book_page}`, 'ur')).toBe(true);
    // Nothing from the held pages reaches either file, and the Naat carries no written key.
    expect(visible(paper)).not.toContain(HELD_LINE);
    expect(schemeText).not.toContain(HELD_LINE);
    expect(naat.key).toBeNull();
  });

  test('an Urdu digit never sits beside the separator dot, on the paper or the scheme', async () => {
    model('urdu');
    const { examJson } = await generate('urdu');
    const { paper, scheme } = render(examJson, 'urdu');
    // The scheme does print the dot (its teacher's-copy band), so the rule below is tested, not vacuous.
    expect(visible(scheme)).toContain('·');
    expect(visible(paper)).not.toMatch(DIGIT_BESIDE_DOT);
    expect(visible(scheme)).not.toMatch(DIGIT_BESIDE_DOT);
  });

  test('the paragraph title comes from the closed list, exactly as listed', async () => {
    model('urdu');
    const { examJson } = await generate('urdu');
    const q8 = items(examJson).filter((q) => q.slot === 'urdu.C.Q8');
    expect(q8.length).toBeGreaterThan(0);
    const titled = q8.filter((q) => P.subjects.urdu.closed_lists.paragraphs.some((t) => String(q.question || '').includes(t)));
    expect(titled.length).toBeGreaterThanOrEqual(1);
  });

  test('every choice line on the paper is the pattern\'s own line', async () => {
    model('urdu');
    const { examJson } = await generate('urdu');
    const text = visible(render(examJson, 'urdu').paper);
    const counts = items(examJson).reduce((m, q) => m.set(q.slot, (m.get(q.slot) || 0) + 1), new Map());
    for (const slot of slotsOf('urdu')) {
      const line = Fde.choiceLine(slot, counts.get(slot.slot) || 0, 'ur');
      if (line.instruction) expect([slot.slot, showsLine(text, line.instruction, 'ur')]).toEqual([slot.slot, true]);
    }
  });
});

describe('Social Studies: a real paper', () => {
  test('builds a 100-mark paper with every slot filled', async () => {
    model('social_studies');
    const out = await generate('social_studies');
    expect(mockCreate).toHaveBeenCalledTimes(P.subjects.social_studies.sections.length);
    expect(out.examJson._layout).toMatchObject({ preset_id: PATTERN, subject: 'social_studies', total_marks: 100 });
    const have = new Set(items(out.examJson).map((q) => q.slot));
    for (const slot of slotsOf('social_studies')) expect([slot.slot, have.has(slot.slot)]).toEqual([slot.slot, true]);
  });

  test('the scheme has a row for every slot, each under its own question label', async () => {
    model('social_studies');
    const { examJson } = await generate('social_studies');
    const text = visible(render(examJson, 'social_studies').scheme);
    for (const slot of slotsOf('social_studies')) {
      expect([slot.slot, showsLine(text, slot.label_ur, 'ur')]).toEqual([slot.slot, true]);
    }
  });

  test('an Urdu digit never sits beside the separator dot, on the paper or the scheme', async () => {
    model('social_studies');
    const { examJson } = await generate('social_studies');
    const { paper, scheme } = render(examJson, 'social_studies');
    expect(visible(scheme)).toContain('·');
    expect(visible(paper)).not.toMatch(DIGIT_BESIDE_DOT);
    expect(visible(scheme)).not.toMatch(DIGIT_BESIDE_DOT);
  });

  test('every choice line on the paper is the pattern\'s own line', async () => {
    model('social_studies');
    const { examJson } = await generate('social_studies');
    const text = visible(render(examJson, 'social_studies').paper);
    const counts = items(examJson).reduce((m, q) => m.set(q.slot, (m.get(q.slot) || 0) + 1), new Map());
    for (const slot of slotsOf('social_studies')) {
      const line = Fde.choiceLine(slot, counts.get(slot.slot) || 0, 'ur');
      if (line.instruction) expect([slot.slot, showsLine(text, line.instruction, 'ur')]).toEqual([slot.slot, true]);
    }
  });
});

describe('English: a real paper', () => {
  test('builds a 100-mark paper, and its composition titles come from the closed lists', async () => {
    model('english');
    const { examJson } = await generate('english');
    expect(examJson._layout).toMatchObject({ preset_id: PATTERN, subject: 'english', total_marks: 100 });
    const lists = P.subjects.english.closed_lists;
    const topicItems = items(examJson).filter((q) => Array.isArray(q.topics));
    expect(topicItems.length).toBeGreaterThan(0);
    for (const q of topicItems) {
      for (const t of q.topics) expect([t, lists.paragraphs.includes(t)]).toEqual([t, true]);
    }
  });

  test('every choice line on the paper is the pattern\'s own line', async () => {
    model('english');
    const { examJson } = await generate('english');
    const text = visible(render(examJson, 'english').paper);
    const counts = items(examJson).reduce((m, q) => m.set(q.slot, (m.get(q.slot) || 0) + 1), new Map());
    for (const slot of slotsOf('english')) {
      const line = Fde.choiceLine(slot, counts.get(slot.slot) || 0, 'en');
      if (line.instruction) expect([slot.slot, showsLine(text, line.instruction, 'en')]).toEqual([slot.slot, true]);
    }
  });
});
