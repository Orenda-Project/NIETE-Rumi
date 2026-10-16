/**
 * Round-6 Social Studies key rule (panel T8): which government does a job comes from the book's
 * three-tier table on p.29. The page store keeps that table's three columns run together, line by
 * line, so a sandbox chapters paper (Ch 4 + 6, pages 26-33) keyed «سڑک کے کنارے ناجائز قبضے سے
 * راستہ بند» to مقامی حکومت, quoting the provincial cell «عوامی سڑکوں اور راستوں سے تجاوزات ہٹانا»
 * as local work. When a section's pages carry that table, its prompt is given the table's rows
 * column by column. The rule is proved through buildPatternUserPrompt (the assembly the engine
 * sends) and through generatePatternExam with only the book store and the model mocked.
 */

const fs = require('fs');
const path = require('path');
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027').subjects;
const FDE = { kind: 'fde', chapters: null, pages: null };
const CHAPTERS = { kind: 'chapters', chapters: [4, 6], pages: '26-33, 40-48' };
const PAGES = { kind: 'pages', chapters: null, pages: '26-33' };
const ALL_SCOPES = [FDE, CHAPTERS, PAGES];
const SUBJECTS = ['maths', 'english', 'science', 'social_studies', 'urdu'];

// Page 29 as the page store holds it (columns interleaved).
const P29 = fs.readFileSync(path.join(__dirname, 'fixtures/fde/r10-sst-p29.txt'), 'utf8');
const WITH_TABLE = `=== Page 28 ===\nمقننہ (Legislature)\n\n${P29}\n=== Page 30 ===\nجمہوریت (Democracy)`;

const HEAD = 'The book\'s table on p.29 says which government does what.';
const PROVINCIAL = '- صوبائی حکومت: صوبے کا نظم و نسق (قانون سازی، عوامی سڑکوں اور راستوں سے تجاوزات ہٹانا، امن و امان کا قیام) چلاتی ہے؛ صوبائی محصولات کی نگرانی کرتی ہے؛ صوبوں کی داخلی پالیسی کے معاملات سنبھالتی ہے۔';
const LOCAL = '- مقامی حکومت: مویشی منڈیاں اور عوامی میلے منعقد کرتی ہے؛ پینے کے پانی کا بندوبست اور نکاسی آب کا انتظام دیکھتی ہے؛ بیواؤں، یتیموں، معذوروں اور قدرتی آفات کے متاثرین کی مدد کرتی ہے۔';
const FEDERAL = '- وفاقی حکومت: ملکی دفاع (مسلح افواج کے امور) کی نگرانی کرتی ہے؛ ملکی معیشت کو سنبھالتی ہے؛ خارجہ پالیسی (بیرونی ممالک سے تعلقات کے معاملات) کی نگرانی کرتی ہے۔';
const KEY_RULE = 'An item, key or marking point that says which government (وفاقی، صوبائی یا مقامی) does a job takes it from these rows only';

function prompt(subject, sectionId, scope = CHAPTERS, pageContent = WITH_TABLE) {
  const S = P[subject];
  const section = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent, pageReference: '26-33',
    section, slots: section.slots, lang: S.medium, P: S, scope,
  });
}
const sectionIds = (subject) => P[subject].sections.map((s) => s.id);

describe('round-6 Social Studies three-tier table', () => {
  test('pages hold p.29 → every Social Studies section gets the table rows column by column, every scope', () => {
    for (const scope of ALL_SCOPES) {
      for (const id of sectionIds('social_studies')) {
        const text = prompt('social_studies', id, scope);
        expect(text).toContain(HEAD);
        expect(text).toContain(FEDERAL);
        expect(text).toContain(PROVINCIAL);
        expect(text).toContain(LOCAL);
        expect(text).toContain(KEY_RULE);
        // Once, among the rules, before the closing JSON-only line.
        expect(text.split(HEAD)).toHaveLength(2);
        expect(text.indexOf(HEAD)).toBeLessThan(text.indexOf('Return the JSON only.'));
      }
    }
  });

  // The red item: the encroachment cell is provincial, never in the local row.
  test('encroachment on public roads is in the provincial row, not the local one', () => {
    const text = prompt('social_studies', 'C');
    const local = text.split('\n').find((l) => l.startsWith('- مقامی حکومت:'));
    const provincial = text.split('\n').find((l) => l.startsWith('- صوبائی حکومت:'));
    expect(provincial).toContain('تجاوزات');
    expect(local).not.toContain('تجاوزات');
  });

  test('pages without the table → no table, the prompt is today\'s', () => {
    for (const scope of ALL_SCOPES) {
      for (const id of sectionIds('social_studies')) {
        const text = prompt('social_studies', id, scope, '=== Page 40 ===\nBook text.');
        expect(text).not.toContain(HEAD);
        expect(text).not.toContain(KEY_RULE);
      }
    }
  });

  test('no other subject carries it, even on text that holds the table', () => {
    for (const subject of SUBJECTS.filter((s) => s !== 'social_studies')) {
      for (const id of sectionIds(subject)) {
        expect(prompt(subject, id)).not.toContain(HEAD);
        expect(prompt(subject, id)).not.toContain(KEY_RULE);
      }
    }
  });
});

describe('three-tier table through generatePatternExam', () => {
  let calls;
  function load(content) {
    jest.resetModules();
    calls = [];
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    jest.doMock('../../bot/shared/services/assessment/book-content.service', () => ({
      loadPageRangeContent: async ({ pageRanges }) => ({ content, pageReference: pageRanges }),
      loadChapterContent: async () => ({ content, pageReference: '26-33' }),
    }));
    jest.doMock('../../bot/shared/services/llm-client', () => ({
      getClient: () => ({ chat: { completions: { create: async (req) => {
        calls.push(req.messages[req.messages.length - 1].content);
        return { choices: [{ message: { content: '{"unseen":{}}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
      } } } }),
    }));
    return require('../../bot/shared/services/assessment/assessment-generation.service');
  }
  const section = (id) => calls.find((c) => c.includes(`**SECTION ${id}**`));

  test('chapters 4 + 6 (pages 26-33, 40-48) → Sections C and D carry the table rows', async () => {
    const G = load(WITH_TABLE);
    await G.generatePatternExam({ grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: CHAPTERS, pageRanges: '26-33, 40-48' }).catch(() => {});
    for (const id of ['C', 'D']) {
      expect(section(id)).toBeTruthy();
      expect(section(id)).toContain(PROVINCIAL);
      expect(section(id)).toContain(LOCAL);
    }
  });

  test('pages without p.29 → no table in any section', async () => {
    const G = load('=== Page 40 ===\nBook text.');
    await G.generatePatternExam({ grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: PAGES, pageRanges: '40-48' }).catch(() => {});
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).not.toContain(HEAD);
  });
});
