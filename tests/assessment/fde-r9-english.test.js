/**
 * Round-5 English prompt rules for board-pattern sections (the panels' round-4 English paper defects).
 * Each rule is proved through buildPatternUserPrompt, the assembly the engine sends; the Q5 poem
 * is also proved through generatePatternExam with only the book store and the model mocked, since
 * the poem's page text is loaded there.
 */

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027').subjects;
const FDE = { kind: 'fde', chapters: null, pages: null };
const CHAPTERS = { kind: 'chapters', chapters: [1, 2], pages: null };
const PAGES = { kind: 'pages', chapters: null, pages: '31-56' };
const ALL_SCOPES = [FDE, CHAPTERS, PAGES];
const SUBJECTS = ['maths', 'english', 'science', 'social_studies', 'urdu'];

const pagesText = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `=== Page ${from + i} ===\nBook text ${from + i}.`).join('\n\n');

function prompt(subject, sectionId, scope = FDE, extra = {}) {
  const S = P[subject];
  const section = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20',
    section, slots: section.slots, lang: S.medium, P: S, scope, ...extra,
  });
}
/** One slot's block in the GENERATE list: its bullet line and the indented lines under it. */
function slotBlock(text, slotId) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('• ') && l.includes(`"slot": "${slotId}"`));
  if (at < 0) return null;
  const out = [lines[at]];
  for (let i = at + 1; i < lines.length && lines[i].startsWith('  '); i += 1) out.push(lines[i]);
  return out.join('\n');
}

const Q1B_QUOTE = 'Never refer to an underline the paper cannot show; quote the word or phrase instead.';
const Q1B_ONE = 'Each item is one sentence to rewrite, with its instruction once.';
const Q5_POEM = 'Q5 uses a poem printed in the book. If these pages hold no poem, take the nearest poem in the syllabus, name its unit in the title, and print its lines verbatim; never write verse and never call prose a poem.';

describe('round-5 english pattern prompt rules', () => {
  test('english Q1(b): quote, never underline; one sentence per item', () => {
    for (const scope of ALL_SCOPES) {
      const text = prompt('english', 'A', scope);
      const q1b = slotBlock(text, 'english.A.Q1b');
      expect(q1b).toContain(Q1B_QUOTE);
      expect(q1b).toContain(Q1B_ONE);
      // Q1(a) keeps its own sentence and gains nothing.
      expect(slotBlock(text, 'english.A.Q1a')).not.toContain(Q1B_ONE);
    }
    for (const subject of SUBJECTS.filter((s) => s !== 'english')) {
      for (const { id } of P[subject].sections) expect(prompt(subject, id, CHAPTERS)).not.toContain(Q1B_ONE);
    }
  });

  test('english poems: titles and pages from the book', () => {
    expect(P.english.poems).toEqual([
      { unit: 2, pages: '20', title: 'Colours' },
      { unit: 8, pages: '100-101', title: 'City Life vs. Farm Life: A Friendly Debate' },
    ]);
  });

  test('english Q5: pages with no poem → the nearest poem chosen', () => {
    expect(Gen.patternPoemFor({ P: P.english, scope: PAGES, pageContent: pagesText(31, 56) })).toMatchObject({ unit: 2, pages: '20' });
    expect(Gen.patternPoemFor({ P: P.english, scope: PAGES, pageContent: pagesText(70, 97) })).toMatchObject({ unit: 8, pages: '100-101' });
    // A poem page inside the chosen pages: nothing to inject.
    expect(Gen.patternPoemFor({ P: P.english, scope: PAGES, pageContent: pagesText(15, 30) })).toBeNull();
    expect(Gen.patternPoemFor({ P: P.english, scope: PAGES, pageContent: pagesText(95, 110) })).toBeNull();
    // FDE scope and other subjects: never.
    expect(Gen.patternPoemFor({ P: P.english, scope: FDE, pageContent: pagesText(31, 56) })).toBeNull();
    expect(Gen.patternPoemFor({ P: P.science, scope: PAGES, pageContent: pagesText(31, 56) })).toBeNull();
  });

  test('english Q5: an injected poem is in the Section C prompt only', () => {
    const poem = { unit: 2, pages: '20', title: 'Colours', content: '=== Page 20 ===\nMy hair is reddish blondish brown,' };
    const c = prompt('english', 'C', PAGES, { poem });
    expect(c).toContain('Q5 uses this poem from Unit 2 (book p.20); print only its verse lines, exactly as given, never a heading, instruction or activity line; title «Colours (Unit 2)».');
    expect(c).toContain('My hair is reddish blondish brown,');
    expect(c).not.toContain(Q5_POEM);
    for (const id of ['A', 'B']) expect(prompt('english', id, PAGES, { poem })).not.toContain('reddish blondish');
    // No poem given: the section prompt is today's, rule and all.
    expect(prompt('english', 'C', PAGES)).toContain(Q5_POEM);
    expect(prompt('english', 'C', FDE, { poem })).not.toContain('reddish blondish');
  });
});

describe('english Q5 poem through generatePatternExam', () => {
  let calls;
  let loads;
  function load({ poemFails = false } = {}) {
    jest.resetModules();
    calls = [];
    loads = [];
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    jest.doMock('../../bot/shared/services/assessment/book-content.service', () => ({
      loadPageRangeContent: async ({ pageRanges }) => {
        loads.push(pageRanges);
        if (pageRanges === '20') {
          if (poemFails) throw new Error('page store down');
          return { content: '=== Page 20 ===\nColours by Shel Silverstein\nMy hair is reddish blondish brown,\nObject: Illustration of a notepad icon with text bubble: "What messages do you think the poet is telling?"\nBut it\'s silver when it\'s wet.\nDiving Deeper\nActivity 1: Article Expedition\nFill in the blanks.', pageReference: '20' };
        }
        return { content: pagesText(31, 56), pageReference: pageRanges };
      },
      loadChapterContent: async () => ({ content: 'Book text.', pageReference: '1-2' }),
    }));
    jest.doMock('../../bot/shared/services/llm-client', () => ({
      getClient: () => ({ chat: { completions: { create: async (req) => {
        calls.push(req.messages[req.messages.length - 1].content);
        return { choices: [{ message: { content: '{"unseen":{}}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
      } } } }),
    }));
    return require('../../bot/shared/services/assessment/assessment-generation.service');
  }
  const sectionC = () => calls.find((c) => c.includes('**SECTION C**'));

  test('pages 31-56 → Colours page text loaded and put in Section C', async () => {
    const G = load();
    await G.generatePatternExam({ grade: 5, subject: 'english', pattern: 'fde_g5_2027', scope: PAGES, pageRanges: '31-56' }).catch(() => {});
    expect(loads).toContain('20');
    expect(sectionC()).toContain('My hair is reddish blondish brown,');
    expect(sectionC()).toContain('title «Colours (Unit 2)»');
  });

  // The page store keeps the book's picture notes ("Object: Illustration of …") between the poem's
  // lines; Q5 is told to print the given lines exactly, so those notes are not given.
  test('injected poem: the book\'s picture notes are not given', async () => {
    const G = load();
    await G.generatePatternExam({ grade: 5, subject: 'english', pattern: 'fde_g5_2027', scope: PAGES, pageRanges: '31-56' }).catch(() => {});
    const poemBlock = sectionC().split('**Poem for Q5')[1].split('```')[1];
    expect(poemBlock).toContain('My hair is reddish blondish brown,');
    expect(poemBlock).toContain('But it\'s silver when it\'s wet.');
    expect(poemBlock).not.toContain('Object:');
    expect(poemBlock).not.toContain('notepad icon');
  });

  // After the poem the page goes on to its activities ("Diving Deeper"); they are not the poem.
  test('injected poem: the page stops at its activities', async () => {
    const G = load();
    await G.generatePatternExam({ grade: 5, subject: 'english', pattern: 'fde_g5_2027', scope: PAGES, pageRanges: '31-56' }).catch(() => {});
    const poemBlock = sectionC().split('**Poem for Q5')[1].split('```')[1];
    expect(poemBlock).toContain('But it\'s silver when it\'s wet.');
    expect(poemBlock).not.toContain('Diving Deeper');
    expect(poemBlock).not.toContain('Article Expedition');
  });

  test('page text cannot be loaded → no injection, today\'s Q5 rule', async () => {
    const G = load({ poemFails: true });
    await G.generatePatternExam({ grade: 5, subject: 'english', pattern: 'fde_g5_2027', scope: PAGES, pageRanges: '31-56' }).catch(() => {});
    expect(sectionC()).toBeTruthy();
    expect(sectionC()).not.toContain('reddish blondish');
    expect(sectionC()).toContain(Q5_POEM);
  });
});
