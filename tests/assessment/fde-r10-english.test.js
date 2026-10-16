/**
 * English board-pattern paper, two defects from the sandbox train-7E papers:
 *
 * 1. Q4 (`shape: 'words'`, words printed, FDE's instruction carries no {q}) printed the model's own
 *    restatement under FDE's line: «Write the meaning of each given word and use it in a sentence of
 *    your own…» under «Use any five of the following words in meaningful sentences.» The blanking
 *    that stops this ran for Urdu only. Fixture: that paper's own items (chapters Units 3–4).
 * 2. An unnamed adult in the Q2 passage was «he» («An old man watched them… he joined the
 *    children»), though the section's general rules carry the unnamed-person sentence. The passage
 *    slot's own rule now carries it, where the passage is asked for.
 *
 * Mocked at the boundary only: the model client and the book loader. The prompts, the pattern data,
 * the layout, the filters and the renderer are the real modules.
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
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const PATTERN = 'fde_g5_2027';
const P = Patterns.get(PATTERN).subjects;
const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r10-english-chapters2.json'), 'utf8'));

// The sandbox paper's own Q4 question (request 9cbd25b8).
const RESTATED = 'Write the meaning of each given word and use it in a sentence of your own. Any five words will be marked.';
const PASSAGE_PEOPLE = 'In the passage, a person who is not named (an old man, a shopkeeper, a farmer) is \'they\' (An old man smiled. The next day, they joined the children…); only a named character is he or she.';

const loaded = (content, pageReference) => ({ content, pageReference, pageCount: 1, pagesFound: [], pagesMissing: [] });
const reply = (content) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 },
});

/** Each section call is answered with the fixture's items of the slots its prompt asks for. */
function fakeModel(patches = {}) {
  mockCreate.mockImplementation(async (params) => {
    const prompt = params.messages[1].content;
    const src = fixture();
    const tree = { unseen: {} };
    for (const [category, types] of Object.entries(src.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`));
        if (!mine.length) continue;
        mine.forEach((q) => { if (patches[q.slot]) patches[q.slot](q); });
        tree.unseen[category] = tree.unseen[category] || {};
        tree.unseen[category][type] = mine;
      }
    }
    return reply(JSON.stringify(tree));
  });
}

function book() {
  const text = Array.from({ length: 120 }, (_, i) => `=== Page ${i + 1} ===\nBook text ${i + 1}.`).join('\n\n');
  mockLoadPages.mockImplementation(async ({ pageRanges }) => loaded(text, String(pageRanges)));
  mockLoadChapter.mockImplementation(async () => loaded(text, '1-120'));
}

const ARGS = { grade: 5, subject: 'english', pattern: PATTERN, scope: { kind: 'fde', chapters: null, pages: null }, pageRanges: null, chapterNumber: null };
const itemOf = (examJson, slot) => {
  for (const types of Object.values(examJson.unseen || {})) {
    for (const list of Object.values(types)) {
      const hit = list.find((q) => q.slot === slot);
      if (hit) return hit;
    }
  }
  return null;
};

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); mockLoadPages.mockReset(); mockLoadChapter.mockReset(); });

describe('english Q4: the model\'s restated instruction never prints', () => {
  test('the sandbox paper\'s Q4 question is blanked; its words and answer stay', async () => {
    book();
    fakeModel();
    const out = await Gen.generatePatternExam(ARGS);
    const q4 = itemOf(out.examJson, 'english.C.Q4');
    expect(q4.question).toBe('');
    expect(q4.words).toEqual(itemOf(fixture(), 'english.C.Q4').words);
    expect(q4.answer).toEqual(itemOf(fixture(), 'english.C.Q4').answer);
  });

  test('Q3 (its question is the passage to punctuate) keeps its question', async () => {
    book();
    fakeModel();
    const out = await Gen.generatePatternExam(ARGS);
    expect(itemOf(out.examJson, 'english.C.Q3').question).toBe(itemOf(fixture(), 'english.C.Q3').question);
  });

  test('the printed paper shows FDE\'s Q4 line once and no restatement', async () => {
    book();
    fakeModel();
    const out = await Gen.generatePatternExam(ARGS);
    const html = R.renderPaper({ examJson: out.examJson, grade: 5, subject: 'english', answerLines: true });
    const q4 = P.english.sections.find((s) => s.id === 'C').slots.find((s) => s.slot === 'english.C.Q4');
    expect(html.split(q4.instruction_en).length - 1).toBe(1);
    expect(html).not.toContain('Write the meaning of each given word');
    expect(html).toMatch(/data-slot="english\.C\.Q4"><(?!\/)/);
    // The same paper with the restatement put back prints it: the checks above can fail.
    itemOf(out.examJson, 'english.C.Q4').question = RESTATED;
    const withStem = R.renderPaper({ examJson: out.examJson, grade: 5, subject: 'english', answerLines: true });
    expect(withStem).toContain('Write the meaning of each given word');
  });

  test('a words slot whose instruction takes {q} (Q5) keeps its question', () => {
    const tree = () => ({ unseen: { subjective: { 'Rhyming Words': [{ slot: 'english.C.Q5', question: 'Colours', words: ['red', 'blue'] }] } } });
    const exam = tree();
    Gen._blankWordsStems(exam, P.english, 'english');
    expect(exam).toEqual(tree());
  });

  test('subjects without a printed-words slot are untouched', () => {
    for (const key of ['maths', 'science', 'social_studies']) {
      expect(P[key].sections.some((sec) => (sec.slots || []).some((s) => s.shape === 'words' && s.print_words))).toBe(false);
    }
  });
});

describe('english Q2: unnamed people in the passage are they', () => {
  const SCOPES = [
    { kind: 'fde', chapters: null, pages: null },
    { kind: 'chapters', chapters: [6, 7], pages: null },
    { kind: 'pages', chapters: null, pages: '31-56' },
  ];
  const promptFor = (subject, sectionId, scope) => {
    const S = P[subject];
    const section = S.sections.find((s) => s.id === sectionId);
    return Gen.buildPatternUserPrompt({
      grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20', section, slots: section.slots, lang: S.medium, P: S, scope,
    });
  };
  const slotLine = (text, slot) => text.split('\n').find((l) => l.startsWith('• ') && l.includes(`"slot": "${slot}"`)) || '';
  const ruleUnder = (text, slot) => {
    const lines = text.split('\n');
    const at = lines.indexOf(slotLine(text, slot));
    const out = [];
    for (let i = at + 1; i < lines.length && lines[i].startsWith('  '); i += 1) out.push(lines[i]);
    return out.join('\n');
  };

  test('the passage slot\'s own rule carries the sentence on every scope', () => {
    for (const scope of SCOPES) {
      expect(ruleUnder(promptFor('english', 'B', scope), 'english.B.Q2')).toContain(PASSAGE_PEOPLE);
    }
  });

  test('the passage prompt reaches the model with the sentence', async () => {
    book();
    fakeModel();
    await Gen.generatePatternExam(ARGS);
    const sent = mockCreate.mock.calls.map(([p]) => p.messages[1].content).filter((t) => t.includes('"slot": "english.B.Q2"'));
    expect(sent.length).toBeGreaterThan(0);
    sent.forEach((t) => expect(t).toContain(PASSAGE_PEOPLE));
  });

  test('no other section or subject carries it', () => {
    for (const subject of ['maths', 'english', 'science', 'social_studies', 'urdu']) {
      for (const { id } of P[subject].sections) {
        if (subject === 'english' && id === 'B') continue;
        for (const scope of SCOPES) expect(promptFor(subject, id, scope)).not.toContain(PASSAGE_PEOPLE);
      }
    }
  });
});
