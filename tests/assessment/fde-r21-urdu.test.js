/**
 * Urdu board-pattern papers: Section A items that give each other away.
 *
 * 1. Story pairs. A Q1 stem that names a person or thing of the same story as another Q1 item, where
 *    that name is the other item's key and none of its other options («سدرہ کی فاختہ آزاد کرنے کے بعد
 *    …» beside «… تکیے کے پاس کیا رکھا تھا؟ → کاغذ کی دو فاختائیں»), is held. A stem that names two of
 *    the item's options («جنگل میں شیر کے شکار …» beside «… کیا بننے کو کہا؟» among لومڑی / شیر) stays.
 *    The reader is told the shape and reads the Q1 block item by item.
 * 2. The key's letters. One check for every self-key shape: the key's one content word, printed in its
 *    own stem (quoted or not) and in no other option's, holds the item: «بننا» → بن, «ڈالنا» → ڈالی,
 *    «ان پڑھ» → «ان اور ان», «… کی صفت بیان کرنے والے لفظ …» → اسم صفت. The prompt says a verb sense
 *    is given by a paraphrase, never by its infinitive.
 * 3. One grammar concept once. The second item of a concept is held: «… میں اسم معرفہ کون سا ہے؟»
 *    beside «… خاص نام کے بجائے … عام چیز …؟ → اسکول»; a homograph definition beside a homograph
 *    instance. Distinct concepts (اسم صوت، اسم آلہ، اسم معرفہ، موصوف، حرفِ عطف) all stay.
 *
 * The recorded papers are sandbox replies (content only).
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { conceptRepeats } = require('./helpers/urdu-concept-once');

const PAT = Patterns.get('fde_g5_2027');
const U = PAT.subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const read = (name) => fixture(`r21-urdu-sandbox-${name}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1 = (exam) => items(exam, 'urdu.A.Q1');
const laid = (exam) => applyLayout(clone(exam), U, FDE, { reasked: false });
const stems = (exam) => q1(laid(exam).examJson).map((q) => q.question);
const shortQ1 = (exam) => (laid(exam).shortfall.find((f) => f.slot === 'urdu.A.Q1') || { missing: 0 }).missing;
const find = (exam, re) => q1(exam).find((q) => re.test(q.question));
// One recorded paper with one Q1 item swapped for `swap` (the rest as the sandbox wrote it).
function withItem(name, re, swap) {
  const exam = read(name);
  Object.assign(find(exam, re), swap);
  return exam;
}

async function askReader(exam, reply) {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const out = await Gen._askReader({ examJson: exam, P: U, model: 'anthropic-direct/test', ownModel: 'anthropic-direct/test', job: 'assessment.generate.fde', usages: [] });
  return { ...out, sent: textOf(mockCreate.mock.calls[0][0]) };
}
const labelOf = (labels, re) => [...labels].find(([, q]) => re.test(q.question))[0];
const rulesOf = (sent) => sent.slice(0, sent.indexOf(Reader.PAPER_HEAD));

describe('Q1 story pairs: a stem that names another item\'s key', () => {
  test('chapters_2: «سدرہ کی فاختہ …» beside «… تکیے کے پاس کیا رکھا تھا؟ → کاغذ کی دو فاختائیں»: one is held', () => {
    const exam = read('chapters_2');
    expect(find(exam, /تکیے کے پاس کیا رکھا تھا/).answer).toBe('الف) کاغذ کی دو فاختائیں');
    const out = stems(exam);
    expect(out.some((s) => /سدرہ کی فاختہ آزاد کرنے کے بعد/.test(s)) && out.some((s) => /تکیے کے پاس کیا رکھا تھا/.test(s))).toBe(false);
  });

  test('chapters_1: «جنگل میں شیر کے شکار …» names both لومڑی and شیر, so «… کیا بننے کو کہا؟ → شیر» stays', () => {
    const exam = read('chapters_1');
    const out = stems(exam);
    expect(out.some((s) => /شیر کے شکار کا بچا ہوا حصہ/.test(s))).toBe(true);
    expect(out.some((s) => /کیا بننے کو کہا/.test(s))).toBe(true);
    // Short only by the antonyms and synonyms asked again (the full syllabus asks each once).
    expect(shortQ1(exam)).toBe(conceptRepeats(q1(exam)).length);
  });

  test('a stem of the same story that names only the key option holds the pair (the same item with لومڑی out of the cue)', () => {
    const exam = withItem('chapters_1', /شیر کے شکار کا بچا ہوا حصہ/, { question: 'کاہل آدمی نے جنگل میں شیر کو کیا کرتے دیکھا؟', answer: 'الف) شکار لاتے', options: ['الف) شکار لاتے', 'ب) سوتے', 'ج) دوڑتے', 'د) نہاتے'] });
    const out = stems(exam);
    expect(out.some((s) => /شیر کو کیا کرتے دیکھا/.test(s)) && out.some((s) => /کیا بننے کو کہا/.test(s))).toBe(false);
    // Without a word of the same story (the stems share none but the name), the name is no cue.
    const other = withItem('chapters_1', /شیر کے شکار کا بچا ہوا حصہ/, { question: 'جنگل میں شیر کس جگہ آرام کرتا تھا؟', answer: 'الف) غار میں', options: ['الف) غار میں', 'ب) دریا کے پاس', 'ج) درخت پر', 'د) میدان میں'] });
    expect(stems(other).some((s) => /شیر کس جگہ آرام کرتا تھا/.test(s)) && stems(other).some((s) => /کیا بننے کو کہا/.test(s))).toBe(true);
  });

  test('the protagonist\'s name in both stems is no cue: full_1\'s فاطمہ جناح items all stay', () => {
    const exam = read('full_1');
    const out = stems(exam);
    for (const re of [/کس شعبے کی ڈگری/, /مینا بازار|کیا منعقد کرنے کو کہا/]) expect(out.some((s) => re.test(s))).toBe(true);
  });

  test('the reader prompt sent names the story-pair shape and asks every Q1 item against the other Q1 items', async () => {
    const exam = read('chapters_2');
    const { labels } = Reader.buildReaderPrompt(exam, U);
    const asks = labelOf(labels, /جنگ کے خلاف پیغام پھیلانے کے لیے کیا بنایا/);
    const by = labelOf(labels, /اپنے ڈرامے کہاں پیش کرتے تھے/);
    const { sent, flags } = await askReader(exam, { candidates: [
      { item: asks, by, evidence: 'سدرہ اور اس کے دوست اپنے ڈرامے کہاں پیش کرتے تھے', reason: 'a stem names the key', given_away: true },
    ] });
    const rules = rulesOf(sent);
    expect(rules).toMatch(/names a person, thing or event from the same story/);
    expect(rules).toContain('اپنے ڈرامے کہاں پیش کرتے تھے');
    expect(rules).toMatch(/For EACH item ask: could a child answer\s+this item from the text of the other Q1 items/);
    expect(rules).toMatch(/names two or more of this item's options/);
    expect(flags.map((f) => f.item)).toEqual([asks]);
  });
});

describe('the key\'s letters in its own stem', () => {
  test('full_2 Q1 «… «جنگل» اور دوسرا «بننا»…» → بن is held', () => {
    const exam = read('full_2');
    expect(find(exam, /«بننا»/).answer).toBe('الف) بن');
    expect(stems(exam).some((s) => /«بننا»/.test(s))).toBe(false);
    expect(shortQ1(exam)).toBe(1);
  });

  test('chapters_2 Q1 «… «شاخ» اور … «ڈالنا» …» → ڈالی is held by its letters alone (no other homograph item on the paper)', () => {
    const exam = read('chapters_2');
    const def = find(exam, /ایک ہی املا اور مختلف معنی والے الفاظ کیا کہلاتے ہیں/);
    Object.assign(def, { question: '«گندگی» کا متضاد کون سا ہے؟', options: ['الف) صفائی', 'ب) بدبو', 'ج) غبار', 'د) آلودگی'], answer: 'الف) صفائی' });
    expect(stems(exam).some((s) => /«ڈالنا»/.test(s))).toBe(false);
  });

  test('r20 full_1 «ان پڑھ» … → «ان اور ان» is held', () => {
    const exam = fixture('r20-urdu-sandbox-full_1');
    expect(find(exam, /«ان پڑھ»/).answer).toBe('ب) ان اور ان');
    expect(stems(exam).some((s) => /«ان پڑھ»/.test(s))).toBe(false);
  });

  test('r19 full_1 «… «گاڑی» کی صفت بیان کرنے والے لفظ …» → اسم صفت is still held', () => {
    const exam = fixture('r19-urdu-sandbox-full_1');
    expect(stems(exam).some((s) => /کی صفت بیان کرنے والے لفظ/.test(s))).toBe(false);
  });

  test('a stem that prints another option too stays («سبز پتا» → پتا beside سبز), and options that differ only by marks stay («سحر» → سَحَر beside سِحر)', () => {
    const exam = read('full_1');
    expect(stems(exam).some((s) => /«سبز پتا»/.test(s))).toBe(true);
    const marks = withItem('full_1', /«سبز پتا»/, { question: '«سحر» بمعنی جادو کا ہم شکل لفظ، جس کا مطلب صبح ہے، کس طرح لکھا جاتا ہے؟', options: ['الف) سِحر', 'ب) سُحر', 'ج) سَحَر', 'د) صحر'], answer: 'ج) سَحَر' });
    expect(stems(marks).some((s) => /بمعنی جادو کا ہم شکل لفظ/.test(s))).toBe(true);
  });

  test('a meaning whose key repeats the asked word stays («تاب کاری» → «تاب کار عناصر …»)', () => {
    expect(stems(read('full_1')).some((s) => /«تاب کاری» سے کیا مراد ہے/.test(s))).toBe(true);
  });

  test('the Section A prompt says a verb sense is given by a paraphrase, never its infinitive; other subjects\' prompts do not', () => {
    const section = U.sections.find((s) => s.slots.some((x) => x.slot === 'urdu.A.Q1'));
    const ur = Gen.buildPatternUserPrompt({ grade: 5, subject: 'urdu', pageContent: 'x', pageReference: '1', section, lang: 'ur', P: U, scope: FDE });
    expect(ur).toContain('Give a verb sense by a paraphrase or a sentence, never by its infinitive');
    for (const subject of ['english', 'science', 'maths', 'social_studies']) {
      const P = PAT.subjects[subject];
      for (const sec of P.sections) {
        const p = Gen.buildPatternUserPrompt({ grade: 5, subject, pageContent: 'x', pageReference: '1', section: sec, lang: 'en', P, scope: FDE });
        expect(p).not.toContain('never by its infinitive');
      }
    }
  });
});

describe('one grammar concept once on the paper', () => {
  test('full_1: «… میں اسم معرفہ کون سا ہے؟» and «… خاص نام کے بجائے … عام چیز …؟ → اسکول» print once between them', () => {
    const exam = read('full_1');
    const out = stems(exam);
    expect(out.some((s) => /میں اسم معرفہ کون سا ہے/.test(s))).toBe(true);
    expect(out.some((s) => /خاص نام کے بجائے/.test(s))).toBe(false);
  });

  test('chapters_2: the homograph definition and the homograph instance print once between them', () => {
    const out = stems(read('chapters_2'));
    expect(out.filter((s) => /ایک ہی املا|املا ایک/.test(s))).toHaveLength(1);
  });

  test('full_2: five distinct concepts (اسم صوت، اسم آلہ، اسم معرفہ، موصوف، حرفِ عطف) all stay', () => {
    const out = stems(read('full_2'));
    for (const re of [/کائیں کائیں/, /ہتھیار یا اوزار/, /خاص شخص، جگہ یا چیز/, /موصوف کون سا لفظ/, /حرفِ عطف کون سا/]) expect(out.some((s) => re.test(s))).toBe(true);
  });

  test('the full syllabus asks the antonym once: the first of chapters_1\'s two antonyms prints, the second is held', () => {
    const out = stems(read('chapters_1'));
    expect(out.some((s) => /«بہادر» کا متضاد/.test(s))).toBe(true);
    expect(out.some((s) => /«دشمن» کا متضاد/.test(s))).toBe(false);
  });
});
