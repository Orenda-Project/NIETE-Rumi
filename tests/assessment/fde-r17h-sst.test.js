/**
 * Social Studies, round 8: an item whose answer rests on a religious premise is held; a Q6 that only
 * relays what a named child asks is recall; a Q1 item given away by a Section C/D stem (its key printed
 * there) or asked again by a Q5 is held and Section A asked again; Section B's topics print once and
 * Q3's box instruction comes from the pattern; Section A is told its thinking-level counts; Q7 never asks
 * what every child knows without the book.
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 4 ===\nسبق کا متن', pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const { applyLayout, takenNote } = require('../../bot/shared/services/assessment/fde-layout');

const PRESET = Patterns.get('fde_g5_2027');
const SST = PRESET.subjects.social_studies;
const FIX = path.join(__dirname, 'fixtures', 'fde');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === slot);
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const lay = (exam, reasked = false) => applyLayout(clone(exam), SST, scopeOf(exam), { reasked, now: 'T' });
const heldRules = (laid, stem) => laid.held.filter((h) => h.q && h.q.question === stem).map((h) => h.rule);
const printed = (laid, slot) => items(laid.examJson, slot).map((q) => q.question);
const prompt = (S, sec, subject) => Gen.buildPatternUserPrompt({
  grade: 5, subject, pageContent: 'متن', pageReference: '1-9', section: sec, slots: sec.slots, lang: 'ur', P: S, scope: { kind: 'fde' },
});
const OTHERS = ['maths', 'science', 'english', 'urdu'];
const Q1 = 'social_studies.A.Q1';
const Q5 = 'social_studies.C.Q5';
const Q6 = 'social_studies.D.Q6';
const Q7 = 'social_studies.D.Q7';

const PREMISE_RULE = 'Never set an item whose answer rests on a religious premise (what Allah created or commands, a prophet\'s story, a verse or a hadith said in other words); book p.5 is asked only for its civic sentences (the UN charter, equal basic rights).';
const Q6_ASKS = 'A Q6 poses a decision or advice in a situation; never "X asks what Y is" or "X wants to know why": an answer that is the book\'s text in order is a Q5.';
// Both lines were widened in round 9 (fde-r17i-sst): Q1's counts to 16 Remember / 2 Understand, Q7's examples.
const Q7_COMMON = 'A Q7 item is never a fact every Grade 5 child knows without the book (the year Pakistan was made, its capital, its national language, washing hands before eating, that television shows pictures, the name of a social media app); it asks a fact these pages teach.';
const Q1_BANDS = 'Q1: at least 16 Remember items and at most 2 Understand; any other Q1 item is Apply (a situation the child decides).';

const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (text) => text.includes(Reader.READER_MARK);
const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));
const logged = (name) => mockLog.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

async function replay(rec, { edit = null } = {}) {
  const r = clone(rec);
  if (edit) edit(r);
  const queue = { A: [...r.replies.A], B: [...r.replies.B], C: [...r.replies.C], D: [...r.replies.D] };
  const asked = [];
  mockCreate.mockReset();
  mockLog.mockReset();
  mockCreate.mockImplementation(async (req) => {
    const text = textOf(req);
    if (isReader(text)) {
      asked.push({ sec: 'reader', text });
      return { choices: [{ message: { content: JSON.stringify({ candidates: [] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    }
    const sec = sectionOf(text);
    asked.push({ sec, text });
    const content = queue[sec].length > 1 ? queue[sec].shift() : queue[sec][0];
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  });
  const out = await Gen.generatePatternExam({
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: r.scope, pageRanges: r.scope.pages, requestId: 'req-r17h', readerPass: false,
  }).catch((e) => ({ error: e }));
  return { asked, out };
}

// What a Section A re-ask writes when it is told what C and D print: six Q1 items no C or D stem on the
// recorded papers names (the recordings hold only the replies their own run was given).
const FRESH_A = fixture('sst-a-reask-fresh').reply;

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

describe('1. an item whose answer rests on a religious premise is held', () => {
  const ch1 = fixture('r17h-sst-sandbox-chapters_1');
  const premise = items(ch1, Q5)[1];
  const mk = (text) => ({ slot: Q5, question: 'سوال؟', answer: text, scheme: { points: [{ kind: 'K', text, marks: 1 }] } });
  const exam = (list) => ({ unseen: { subjective: { 'Short Questions': list } } });

  test('setup: chapters_1 C.Q5 2 keys «اللہ تعالیٰ نے تمام انسان برابر پیدا کیے ہیں»', () => {
    expect(premise.question).toContain('اعلیٰ یا ادنیٰ');
    expect(premise.scheme.points[0].text).toContain('اللہ تعالیٰ');
  });

  test('the sandbox item is dropped, named by its premise term', async () => {
    const e = clone(ch1);
    const dropped = await Gen.religiousFilter(e, SST, { grade: 5, subject: 'social_studies' });
    // Its answer («… علیہ السلام …») is read before its points («اللہ تعالیٰ نے …»).
    expect(dropped.map((d) => [d.slot, d.reason, d.term])).toEqual([[Q5, 'religious_text', 'علیہ السلام']]);
    expect(items(e, Q5).map((q) => q.question)).not.toContain(premise.question);
  });

  test('a second recorded paper (local chapters_1): «… حضرت آدم اور حضرت حوا علیہما السلام کی اولاد ہیں» is dropped too', async () => {
    const e = fixture('r17-sst-local-chapters_1');
    const stem = items(e, Q5).find((q) => q.answer.includes('علیہما السلام')).question;
    const dropped = await Gen.religiousFilter(e, SST, { grade: 5, subject: 'social_studies' });
    expect(dropped.map((d) => [d.slot, d.term])).toEqual([[Q5, 'علیھا السلام']]);
    expect(items(e, Q5).map((q) => q.question)).not.toContain(stem);
  });

  test.each([
    ['علیہ السلام', 'سب حضرت آدم علیہ السلام کی اولاد ہیں'],
    ['علیھا السلام', 'حضرت حوا علیھا السلام سب کی ماں ہیں'],
    ['علیھا السلام', 'سب آدم و حوا علیھما السلام کی اولاد ہیں'],
    ['اللہ تعالیٰ', 'اللہ تعالیٰ نے سب انسان برابر پیدا کیے'],
    ['ﷺ', 'حضورﷺ نے برابری کا درس دیا'],
    ['رب', 'سب کا رب ایک ہے'],
  ])('%s in a scheme point holds the item', async (term, text) => {
    const dropped = await Gen.religiousFilter(exam([mk(text)]), SST, { grade: 5, subject: 'social_studies' });
    expect(dropped.map((d) => d.term)).toEqual([term]);
  });

  test.each([
    'عبداللہ ہارون نے تحریک پاکستان میں حصہ لیا',
    'بحیرہ عرب پاکستان کے جنوب میں ہے',
    'عربی زبان بولنے والے ممالک',
    'اللہ دتہ نے دکان کھولی',
  ])('control: «%s» is not held', async (text) => {
    expect(await Gen.religiousFilter(exam([mk(text)]), SST, { grade: 5, subject: 'social_studies' })).toEqual([]);
  });

  test('every Social Studies section prompt carries the premise line; no other subject does', () => {
    for (const sec of SST.sections) expect(prompt(SST, sec, 'social_studies')).toContain(PREMISE_RULE);
    for (const key of OTHERS) for (const sec of PRESET.subjects[key].sections) expect(prompt(PRESET.subjects[key], sec, key)).not.toContain(PREMISE_RULE);
  });
});

describe('2. a Q6 that only relays what a named child asks is recall', () => {
  const full1 = fixture('r17h-sst-sandbox-full_1');
  const full2 = fixture('r17h-sst-sandbox-full_2');
  const quake = items(full1, Q6)[4];
  const desert = items(full2, Q6)[3];

  test('setup: full_1 Q6 5 is «بلال نے پوچھا کہ زلزلہ کیا ہوتا ہے …», full_2 Q6 4 «حمزہ جاننا چاہتا ہے کہ …»', () => {
    expect(quake.question).toContain('بلال نے پوچھا کہ');
    expect(desert.question).toContain('حمزہ جاننا چاہتا ہے کہ');
  });

  test('full_1 Q6 5 is held, though the question it relays says «کیا کرنا چاہیے»', () => {
    expect(heldRules(lay(full1, true), quake.question)).toEqual(['asks_frame']);
  });

  test('full_2 Q6 4 is held', () => {
    expect(heldRules(lay(full2, true), desert.question)).toEqual(['asks_frame']);
  });

  test.each([
    // A decision of the child's own beside the relayed question.
    'علی وہاں کا موسم جاننا چاہتا ہے کہ لاہور سے مختلف کیوں ہوگا۔ علی کو کون سا نقشہ استعمال کرنا چاہیے اور کیوں؟',
    // «بغیر پوچھے» is no relayed question.
    'سارہ نے ہم جماعت کا پنسل بغیر پوچھے استعمال کیا اور وہ ٹوٹ گیا۔ سارہ کو اب کیا کرنا چاہیے؟ وضاحت کریں۔',
    // A relayed question the child is asked to help someone decide on.
    'احمد پوچھتا ہے کہ نقشے کی علامات کیسے پڑھیں۔ نقشے کے کون سے دو عناصر اس کی مدد کریں گے؟ وضاحت کریں۔',
  ])('control: «%s» is not held as relayed', (stem) => {
    const e = clone(full1);
    items(e, Q6)[4].question = stem;
    expect(heldRules(lay(e, true), stem)).not.toContain('asks_frame');
  });

  test('D\'s re-ask is told the relayed items were set aside, and why', () => {
    const laid = lay(full1, false);
    const D = SST.sections.find((s) => s.id === 'D');
    const note = takenNote(SST, D, laid.examJson, { held: laid.held });
    expect(note).toContain(quake.question.trim());
    expect(note).toContain('only relays what someone asks');
  });

  test('the D prompt carries the line; C does not', () => {
    const D = SST.sections.find((s) => s.id === 'D');
    expect(prompt(SST, D, 'social_studies')).toContain(Q6_ASKS);
    const C = SST.sections.find((s) => s.id === 'C');
    expect(prompt(SST, C, 'social_studies')).not.toContain(Q6_ASKS);
  });
});

describe('3. a Q1 item given away by a Section C/D stem, or asked again by a Q5, is held', () => {
  const ch2 = fixture('r17h-sst-sandbox-chapters_2');
  const q1 = items(ch2, Q1);
  const year = q1.find((q) => q.question.includes('قراردادِ پاکستان کس سال'));
  const why = q1.find((q) => q.question.includes('جمہوریت کو بہترین'));
  const founder = q1.find((q) => q.question.includes('دو قومی نظریے کی ابتدائی سوچ'));
  // Q1 items whose key a C/D stem names (a name or a term, any topic) are held by their own rule too.
  const named = (laid) => laid.held.filter((h) => h.slot === Q1 && h.rule === 'key_named_in_stem').length;

  test('setup: chapters_2 Q1 11 → 1940ء beside D.Q7 5 «قراردادِ پاکستان 23 مارچ 1940ء …»; Q1 9 beside C.Q5 5', () => {
    expect(year.answer).toContain('1940');
    expect(items(ch2, Q7).some((q) => q.question.includes('1940ء'))).toBe(true);
    expect(items(ch2, Q5).some((q) => q.question.includes('جمہوریت کو بہترین نظام حکومت کیوں'))).toBe(true);
  });

  test('before the re-ask both are held, and a third (C.Q5 «سرسید احمد خان کو دو قومی نظریے کا بانی …» names Q1 «… کس شخصیت …»\'s key), and Section A is short', () => {
    const laid = lay(ch2, false);
    expect(heldRules(laid, year.question)).toEqual(['key_in_stem']);
    expect(heldRules(laid, why.question)).toEqual(['asked_in_c']);
    expect(founder.answer).toContain('سرسید احمد خان');
    expect(heldRules(laid, founder.question)).toEqual(['key_in_stem']);
    expect(printed(laid, Q1)).not.toContain(year.question);
    expect(laid.shortfall).toEqual([{ slot: Q1, missing: 3 + named(laid) }]);
  });

  test('the C/D items are untouched: what they print does not change', () => {
    const e = clone(ch2);
    const base = applyLayout(clone(e), SST, scopeOf(e), { reasked: true, now: 'T' });
    for (const slot of [Q5, Q6, Q7]) expect(printed(base, slot)).toEqual(items(ch2, slot).map((q) => q.question));
  });

  test('after the re-ask, with no item to take its place, a held Q1 item never prints: Q1 is short', () => {
    const laid = lay(ch2, true);
    for (const q of [year, why, founder]) expect(printed(laid, Q1)).not.toContain(q.question);
    expect(laid.held.filter((h) => h.slot === Q1 && h.printed)).toEqual([]);
    expect(laid.shortfall).toEqual([{ slot: Q1, missing: 3 + named(laid) }]);
  });

  test('after the re-ask a new Q1 item takes a place; the held ones still never print', () => {
    const e = clone(ch2);
    e.unseen.objective.MCQs.push({ ...clone(q1[0]), question: 'پاکستان کا قومی پھول کون سا ہے؟', options: ['الف) چنبیلی', 'ب) گلاب', 'ج) سورج مکھی', 'د) کنول'], answer: 'الف) چنبیلی' });
    const laid = lay(e, true);
    expect(printed(laid, Q1)).toContain('پاکستان کا قومی پھول کون سا ہے؟');
    expect(laid.held.filter((h) => h.slot === Q1 && h.printed)).toEqual([]);
    expect(laid.shortfall).toEqual([{ slot: Q1, missing: 2 + named(laid) }]);
  });

  test('A\'s top-up is told what Sections C and D print, and the items set aside', () => {
    const laid = lay(ch2, false);
    const A = SST.sections.find((s) => s.id === 'A');
    const note = takenNote(SST, A, laid.examJson, { topUp: true, shortfall: laid.shortfall.filter((f) => f.slot === Q1), held: laid.held });
    expect(note).toContain('Sections C and D of this paper ask these questions');
    expect(note).toContain(items(ch2, Q7).find((q) => q.question.includes('1940ء')).question.trim());
    expect(note).toContain(year.question.trim());
  });

  // A concept term, or a key printed on another topic, was let through here; a C/D stem that names the key
  // now holds it whatever the topic (the name alone tells the child which option to pick), by its own rule.
  test.each([
    ['قوانین بنانے کا اختیار حکومت کے کس حصے کے پاس ہے؟', 'الف) مقننہ', 'مقننہ کے دو کام لکھیں۔'],
    ['پاکستان کا سب سے بڑا صوبہ رقبے کے لحاظ سے کون سا ہے؟', 'الف) بلوچستان', 'گوادر کی بندرگاہ بلوچستان کے کس ساحل پر ہے؟'],
  ])('Q1 «%s» → %s beside «%s» is held by the named-key rule, not by key_in_stem', (stem, key, c) => {
    const e = clone(ch2);
    Object.assign(items(e, Q1)[0], { question: stem, answer: key, options: [key, 'ب) سندھ', 'ج) پنجاب', 'د) سرحد'] });
    items(e, Q5)[0].question = c;
    expect(heldRules(lay(e, false), stem)).toEqual(['key_named_in_stem']);
  });

  test('the reader is told both shapes', () => {
    const { prompt: p } = Reader.buildReaderPrompt(lay(ch2, true).examJson, SST, {});
    expect(p).toContain('a Q5, Q6 or Q7 stem that prints a Q1 key');
    expect(p).toContain('a Q1 item that asks what a Q5 asks');
  });

  test('through the engine (a recorded chapters 1–2 reply): Section A is asked again, told what C and D print', async () => {
    const rec = fixture('r17g-sst-replies-chapters_2');
    const radio = 'ریڈیو اور ٹیلی وژن میں بنیادی فرق کیا ہے؟';
    const q5 = 'ٹیلی وژن اور ریڈیو میں کیا فرق ہے؟';
    expect(JSON.parse(rec.replies.A[0]).unseen.objective.MCQs.map((q) => q.question)).toContain(radio);
    expect(rec.replies.C[0]).toContain(q5);
    const { asked, out } = await replay(rec, { edit: (r) => r.replies.A.push(FRESH_A) });
    expect(out.error).toBeUndefined();
    const aPrompts = asked.filter((a) => a.sec === 'A');
    expect(aPrompts.length).toBeGreaterThanOrEqual(2);
    expect(aPrompts[0].text).not.toContain('Sections C and D of this paper ask these questions');
    expect(aPrompts[1].text).toContain('Sections C and D of this paper ask these questions');
    expect(aPrompts[1].text).toContain(`- ${q5}`);
    expect(aPrompts[1].text).toContain(`- ${radio} →`);
    const reasked = logged('[assessment] section re-asked').filter((l) => l.section === 'A');
    expect(reasked).toHaveLength(1);
    expect(reasked[0].why).toEqual([expect.objectContaining({ slot: Q1, held: { asked_in_c: 2, key_in_own_stem: 1, key_in_stem: 1, key_named_in_stem: 2 } })]);
    // Q1 is compulsory and full, and none of the items set aside prints.
    const q1 = items(out.examJson, Q1).map((q) => q.question);
    expect(q1).toHaveLength(20);
    expect(q1).not.toContain(radio);
  });

  test('through the engine: a re-ask that writes nothing new is followed by one more top-up of Section A, told the same; then the paper fails closed', async () => {
    const { asked, out } = await replay(fixture('r17g-sst-replies-chapters_2'));
    expect(out.error && out.error.code).toBe('PATTERN_SHORT_SLOT');
    expect(out.error.shortfall.map((f) => f.slot)).toEqual([Q1]);
    const aPrompts = asked.filter((a) => a.sec === 'A');
    expect(aPrompts).toHaveLength(3);
    expect(aPrompts[2].text).toContain('Sections C and D of this paper ask these questions');
    expect(logged('[assessment] section topped up again').map((l) => l.section)).toEqual(['A']);
  });

});

describe('4. Section B prints its topics once, and Q3\'s boxes come from the pattern', () => {
  const B3 = 'social_studies.B.Q3';
  const B4 = 'social_studies.B.Q4';
  const q3Line = SST.sections.find((s) => s.id === 'B').slots.find((s) => s.slot === B3).topic_line_ur;
  const stemOf = (name, slot) => items(lay(fixture(`r17h-sst-sandbox-${name}`), true).examJson, slot)[0].question;

  test('full_1 Q4: the instruction the model put in the topic is taken out', () => {
    expect(stemOf('full_1', B4)).toBe('اچھے شہری کی ذمہ داریاں');
  });

  test.each([
    ['اچھے شہری کی ذمہ داریاں۔ اس موضوع پر 4 سے 6 شاخوں والا ذہنی خاکہ (مائنڈ میپ) بنائیں۔', 'اچھے شہری کی ذمہ داریاں'],
    ['جمہوریت کی اہمیت\nاس عنوان پر 4 سے 6 شاخوں والا مائنڈ میپ بنائیں۔', 'جمہوریت کی اہمیت'],
    ['سیاسی جماعتوں کے افعال کے لیے ایک مائنڈ میپ (Mind Map) بنائیں اور اس کی کم از کم چار شاخیں مکمل کریں۔', 'سیاسی جماعتوں کے افعال'],
    ['ذرائع ابلاغ کے فوائد اور نقصانات کا ذہنی خاکہ بنائیں۔ مرکز میں موضوع لکھیں اور 4 سے 6 شاخوں میں اہم نکات درج کریں۔', 'ذرائع ابلاغ کے فوائد اور نقصانات'],
  ])('a recorded Q4 «%s» prints its topic «%s»', (stem, topic) => {
    const e = fixture('r17h-sst-sandbox-full_2');
    items(e, B4)[0].question = stem;
    expect(items(lay(e, true).examJson, B4)[0].question).toBe(topic);
  });

  test('a topic with no instruction is as written', () => {
    expect(stemOf('full_2', B4)).toBe('اچھے شہری کی ذمہ داریاں');
    expect(stemOf('chapters_2', B4)).toBe('جمہوریت اور اس کی اہمیت');
  });

  test('the pattern carries Q3\'s box line', () => {
    expect(q3Line).toContain('{q}');
    expect(q3Line).toContain('چار خانے');
    expect(q3Line).toContain('تیر');
  });

  test.each([
    ['chapters_1', 'تنازعات کے حل کے مراحل'],
    ['full_1', 'پاکستان کے طبعی خدوخال'],
    ['full_2', 'پاکستان کے طبعی خطے'],
    ['chapters_2', 'پاکستان میں حکومت کے تین اعضا اور ان کے افعال'],
  ])('%s Q3 is the topic in the pattern\'s box line', (name, topic) => {
    expect(stemOf(name, B3)).toBe(q3Line.replace('{q}', topic));
  });

  test('rendered: full_1 prints Q4\'s topic once inside FDE\'s instruction, and no stray count', () => {
    const html = R.renderPaper({ examJson: lay(fixture('r17h-sst-sandbox-full_1'), true).examJson, grade: 5, subject: 'social_studies', answerLines: true, allowShort: true });
    expect(html).toContain('اچھے شہری کی ذمہ داریاں\' پر مشتمل ذہنی خاکہ بنائیں۔');
    expect(html).not.toContain('شاخوں والا ذہنی خاکہ');
  });

  test('rendered: chapters_1 prints Q3\'s boxes, examples and arrows', () => {
    const html = R.renderPaper({ examJson: lay(fixture('r17h-sst-sandbox-chapters_1'), true).examJson, grade: 5, subject: 'social_studies', answerLines: true, allowShort: true });
    expect(html).toContain('تنازعات کے حل کے مراحل');
    expect(html).toContain('چار خانے');
  });
});

describe('5. Section A is told its thinking-level counts, and the engine logs how Q1 came out', () => {
  test('Section A carries the counts; B, C, D and every other subject do not', () => {
    const [A, B, C, D] = SST.sections.map((sec) => prompt(SST, sec, 'social_studies'));
    expect(A).toContain(Q1_BANDS);
    for (const p of [B, C, D]) expect(p).not.toContain(Q1_BANDS);
    for (const key of OTHERS) for (const sec of PRESET.subjects[key].sections) expect(prompt(PRESET.subjects[key], sec, key)).not.toContain(Q1_BANDS);
  });

  test('through the engine: one log line with the printed Q1 counts by level, and whether they meet the counts', async () => {
    const { out } = await replay(fixture('r17g-sst-replies-chapters_2'), { edit: (r) => r.replies.A.push(FRESH_A) });
    expect(out.error).toBeUndefined();
    const lines = logged('[assessment] q1 levels');
    expect(lines).toHaveLength(1);
    const q1 = items(out.examJson, Q1);
    const n = (b) => q1.filter((q) => q.blooms === b).length;
    expect(lines[0]).toEqual(expect.objectContaining({
      requestId: 'req-r17h', remember: n('Remember'), understand: n('Understand'), apply: n('Apply'),
      meets: n('Remember') >= 16 && n('Understand') <= 2,
    }));
  });
});

describe('6. Q7 never asks what every child knows without the book', () => {
  test('setup: chapters_1 D.Q7 1 asks the year Pakistan was made', () => {
    expect(items(fixture('r17h-sst-sandbox-chapters_1'), Q7)[0].question).toContain('کس سال');
  });

  test('the D prompt carries the line; A, B, C do not', () => {
    const [A, B, C, D] = SST.sections.map((sec) => prompt(SST, sec, 'social_studies'));
    expect(D).toContain(Q7_COMMON);
    for (const p of [A, B, C]) expect(p).not.toContain(Q7_COMMON);
  });
});
