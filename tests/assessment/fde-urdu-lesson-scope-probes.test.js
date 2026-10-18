/**
 * Probes for Urdu Q1 on chosen lessons: grammar only from the chosen lessons, the hold that backs it,
 * and what must not move (the full syllabus, the other sections, the other subjects).
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, conceptOf, scopeLessons } = require('../../bot/shared/services/assessment/fde-layout');

const PAT = Patterns.get('fde_g5_2027');
const U = PAT.subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const ch = (...n) => ({ kind: 'chapters', chapters: n, pages: null });
const clone = (x) => JSON.parse(JSON.stringify(x));
const paper = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r21-urdu-sandbox-chapters_2.json'), 'utf8'));
const q1 = (exam) => exam.unseen.objective.MCQs;
const stems = (laid) => {
  const out = [];
  for (const types of Object.values(laid.examJson.unseen || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === 'urdu.A.Q1').map((q) => q.question));
  return out;
};
const mcq = (question, options, answer) => ({ slot: 'urdu.A.Q1', marks: 1, lines: 0, blooms: 'U', question, options, answer });
// Replace the paper's last Q1 item (a vocabulary item) with `item`, so the slot is not over-full.
const withItem = (item) => { const p = clone(paper); const list = q1(p); list[list.length - 1] = item; return p; };
const prompt = (subject, id, scope) => {
  const S = PAT.subjects[subject];
  const section = S.sections.find((s) => s.id === id);
  return Gen.buildPatternUserPrompt({ grade: 5, subject, pageContent: 'PAGE', pageReference: 'p', section, slots: section.slots, lang: S.medium, P: S, scope });
};
const LESSON10 = /اسم معرفہ|اسم صوت|اسم آلہ|نکرہ|صفت و موصوف/;

const CONJ = mcq('ان میں سے کون سا لفظ دو جملوں کو جوڑتا ہے؟', ['الف) اور', 'ب) کتاب', 'ج) چلنا', 'د) خوب'], 'الف) اور');
const DOUBT = mcq('درج ذیل میں سے شکیہ جملہ کون سا ہے؟', ['الف) شاید وہ کل آئے۔', 'ب) کاش وہ آئے۔', 'ج) وہ آیا۔', 'د) وہ آئے گا۔'], 'الف) شاید وہ کل آئے۔');
const TOOL = mcq('جس لفظ سے کسی اوزار کا نام ظاہر ہو، اسے کیا کہتے ہیں؟', ['الف) اسم آلہ', 'ب) اسم صوت', 'ج) اسم ظرف', 'د) فعل'], 'الف) اسم آلہ');

describe('the prompt: a lessons 6–7 paper never offers lesson-10 grammar in Q1\'s own slot text', () => {
  test('the Q1 rule and grain name متشابہ only', () => {
    const p = prompt('urdu', 'A', ch(6, 7));
    const block = p.slice(p.indexOf('**GENERATE THE FOLLOWING:**'), p.indexOf('**RULES:**'));
    expect(block).toMatch(/متشابہ الفاظ/);
    expect(block).not.toMatch(LESSON10);
    expect(block).not.toMatch(/half grammar|lessons 4–10/);
  });
  test('Sections B, C (Q2 (ب), Q4) are word for word the full-syllabus prompts\' own slot text on every chapter scope', () => {
    for (const id of ['B', 'C']) {
      const full = prompt('urdu', id, FDE);
      for (const s of [ch(4, 5), ch(6, 7), ch(7), ch(10)]) {
        const p = prompt('urdu', id, s);
        const block = (x) => x.slice(x.indexOf('**GENERATE THE FOLLOWING:**'), x.indexOf('**RULES:**'));
        expect(block(p)).toBe(block(full));
      }
    }
  });
  test('the other subjects never read the lesson table: a chapters scope prompt carries no Urdu lesson text', () => {
    for (const subject of ['maths', 'science', 'english', 'social_studies']) {
      expect(scopeLessons(PAT.subjects[subject], ch(6, 7))).toBeNull();
      for (const s of PAT.subjects[subject].sections) expect(prompt(subject, s.id, ch(6, 7))).not.toMatch(/قواعد sections/);
    }
  });
});

describe('the hold, per lesson', () => {
  test('a حرفِ عطف item: held on lessons 6–7, kept on lesson 8', () => {
    expect(conceptOf(CONJ)).toBe('conjunction');
    const on67 = applyLayout(withItem(CONJ), U, ch(6, 7), { reasked: false });
    expect(stems(on67)).not.toContain(CONJ.question);
    expect(on67.held).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'grammar_outside_lessons', concept: 'conjunction' })]));
    expect(stems(applyLayout(withItem(CONJ), U, ch(8), { reasked: false }))).toContain(CONJ.question);
  });
  test('a شکیہ item: kept on lessons 4–5, held on lesson 4 alone and on lesson 10', () => {
    expect(stems(applyLayout(withItem(DOUBT), U, ch(4, 5), { reasked: false }))).toContain(DOUBT.question);
    expect(stems(applyLayout(withItem(DOUBT), U, ch(4), { reasked: false }))).not.toContain(DOUBT.question);
    expect(stems(applyLayout(withItem(DOUBT), U, ch(10), { reasked: false }))).not.toContain(DOUBT.question);
  });
  test('an اسم آلہ item: held on lessons 6–7, kept on lesson 10 and on the full syllabus (nothing held for scope)', () => {
    expect(stems(applyLayout(withItem(TOOL), U, ch(6, 7), { reasked: false }))).not.toContain(TOOL.question);
    expect(stems(applyLayout(withItem(TOOL), U, ch(10), { reasked: false }))).toContain(TOOL.question);
    const full = applyLayout(withItem(TOOL), U, FDE, { reasked: false });
    expect(stems(full)).toContain(TOOL.question);
    expect(full.held).toBeUndefined();
  });
  test('the held record never rides on the printed paper (the renderer scans _layout for review text)', () => {
    const laid = applyLayout(withItem(TOOL), U, ch(6, 7), { reasked: false });
    expect(laid.held).toBeDefined();
    // The paper keeps the hold as a count only ({ slot, rule, n }): no item, no concept.
    const { holds, ...rest } = laid.examJson._layout;
    expect(JSON.stringify({ ...laid.examJson, _layout: rest })).not.toMatch(/grammar_outside_lessons/);
    holds.forEach((h) => expect(Object.keys(h).sort()).toEqual(['n', 'rule', 'slot']));
  });
  test('a pages scope across a lesson edge (pp 60–61) takes both lessons\' grammar', () => {
    expect(scopeLessons(U, { kind: 'pages', chapters: null, pages: '60-61' }).map((l) => l.lesson)).toEqual([6, 7]);
    expect(scopeLessons(U, { kind: 'pages', chapters: null, pages: '1-27' })).toBeNull();
    expect(scopeLessons(U, { kind: 'chapters', chapters: ['6', '7'], pages: null }).map((l) => l.lesson)).toEqual([6, 7]);
  });
});

describe('false holds: comprehension items that use a grammar word in plain sense', () => {
  // DOC: what the concept tags read in an ordinary story stem; a tag here is a hold on any scope whose
  // lessons do not teach that concept.
  test.each([
    ['a story stem «… پکارا … آواز»', mcq('سدرہ نے امینہ کو کس طرح پکارا؟', ['الف) اونچی آواز میں', 'ب) خط لکھ کر', 'ج) فون پر', 'د) اشارے سے'], 'الف) اونچی آواز میں')],
    ['a meaning item keyed «شک»', mcq('«شبہ» کا مطلب کیا ہے؟', ['الف) شک', 'ب) یقین', 'ج) خوشی', 'د) غصہ'], 'الف) شک')],
    ['a story stem with «عام»', mcq('ندی کا پانی کس عام وجہ سے گندا ہوتا ہے؟', ['الف) کچرا پھینکنے سے', 'ب) بارش سے', 'ج) ہوا سے', 'د) دھوپ سے'], 'الف) کچرا پھینکنے سے')],
  ])('%s asks no concept', (_name, q) => {
    expect(conceptOf(q)).toBeNull();
  });
});
