/**
 * Round-15 Social Studies (eight local papers on the round-14 head: full scope clean, every T6-A
 * item on chapter scopes, 11 of 13 a contained point set):
 *
 *   1. The point-set hold is a list of rows: D.Q6 against C.Q5 (as before), D.Q7 against C.Q5 and
 *      D.Q6 (a one-fact Q7 whose answer is one point of a longer item: chapters_1 Q7 ۸ «برقی توانائی»
 *      in Q5 ۹'s points, chapters_2 Q7 ۷ «سلام کرنا» in Q6 ۶'s), and D.Q6 against the Q6 items
 *      already placed (chapters_2 Q6 ۱ and ۴, one online disagreement with the same four points).
 *   2. D's first prompt names C's Q5 topics, and asks for Q6 situations on other topics.
 *   3. D's re-ask is told the items the layout set aside, with their points, as items never to write.
 *   4. Before a held D item is put back, D is asked once more (a top-up told what was held). An item
 *      still held after that prints, and every hold is logged.
 *   5. Q6 needs two different ideas applied; never one fact twice, a computation or a recall list.
 *
 * The papers are local model output (people in them are the model's own fictional ones).
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
const mockLog = jest.fn();
// These tests pin the held-item re-ask on recorded replies. A giveaway on a recorded paper never clears, so the
// giveaway re-ask (v23) would add D asks they do not count; fde-v23-repeats pins giveaways.
jest.mock('../../bot/shared/services/assessment/fde-answer-repeats', () => ({
  ...jest.requireActual('../../bot/shared/services/assessment/fde-answer-repeats'), answerRepeats: () => [],
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 40 ===\nسبق کا متن', pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, takenNote, firstAskNote } = require('../../bot/shared/services/assessment/fde-layout');

const ALL = Patterns.get('fde_g5_2027').subjects;
const SST = ALL.social_studies;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const LOCAL = ['chapters_1', 'chapters_2', 'chapters_3', 'chapters_4', 'full_1', 'full_2', 'full_3', 'full_4'];
const paper = (p) => fixture(`r15-sst-local-${p}`);
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t)).flat().filter((q) => q && q.slot === slot);
const lay = (exam, opts) => applyLayout(JSON.parse(JSON.stringify(exam)), SST, scopeOf(exam), opts);
const C5 = 'social_studies.C.Q5';
const D6 = 'social_studies.D.Q6';
const D7 = 'social_studies.D.Q7';
const kept = (exam, slot) => items(lay(exam, { reasked: false }).examJson, slot).map((q) => q.question);
const section = (id) => SST.sections.find((s) => s.id === id);

// One section's reply as the model writes it: unseen → category → type → [items].
function replyOf(exam, sectionId) {
  const tree = { unseen: {} };
  for (const slot of section(sectionId).slots) {
    const list = items(exam, slot.slot).map((q) => ({ ...q }));
    ((tree.unseen[slot.category] ||= {})[slot.type] ||= []).push(...list);
  }
  return JSON.stringify(tree);
}
const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));
const withItems = (json, slot, list) => {
  const tree = JSON.parse(json);
  for (const types of Object.values(tree.unseen)) for (const [t, l] of Object.entries(types)) {
    if (l.some((q) => q.slot === slot)) types[t] = [...l.filter((q) => q.slot !== slot), ...list];
  }
  return JSON.stringify(tree);
};

// The engine on chapters_1's recorded sections, D answering with `dReplies` in turn.
async function run(dReplies, CH1 = paper('chapters_1')) {
  const replies = { A: [replyOf(CH1, 'A')], B: [replyOf(CH1, 'B')], C: [replyOf(CH1, 'C')], D: [...dReplies] };
  const asked = [];
  mockCreate.mockReset();
  mockLog.mockReset();
  mockCreate.mockImplementation(async (req) => {
    const text = req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    const sec = sectionOf(text);
    asked.push({ sec, text });
    const content = replies[sec].length > 1 ? replies[sec].shift() : replies[sec][0];
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  });
  const out = await Gen.generatePatternExam({
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027',
    scope: scopeOf(CH1), pageRanges: '1-20', requestId: 'req-r15',
  }).catch((e) => ({ error: e }));
  return { asked, out };
}
const dAsks = (asked) => asked.filter((a) => a.sec === 'D');

describe('1. the point-set hold is a list: Q6 ← Q5, Q7 ← Q5 / Q6, Q6 ← Q6', () => {
  const CH1 = paper('chapters_1');
  const CH2 = paper('chapters_2');

  test('the fixtures are the pairs gen-local named', () => {
    expect(items(CH1, D7)[7].answer).toContain('برقی توانائی');
    expect(items(CH1, C5)[8].scheme.points.map((p) => p.text).join(' ')).toContain('برقی توانائی');
    expect(items(CH2, D7)[6].answer).toContain('سلام');
    expect(items(CH2, D6)[5].scheme.points[0].text).toContain('سلام کرنے');
  });

  test('chapters_1 Q7 ۸ «برقی توانائی» (a point of Q5 ۹) is held before the re-ask', () => {
    expect(kept(CH1, D7)).not.toContain(items(CH1, D7)[7].question);
  });

  // Q6 ۶ is itself held (its points restate a Q5), and a held Social Studies item never prints, so it
  // gives the Q7 nothing away.
  test('chapters_2 Q7 ۷ «سلام کرنا» (a point of Q6 ۶) prints: Q6 ۶ is held and never prints', () => {
    const laid = lay(CH2, { reasked: false });
    expect(laid.held.some((h) => h.slot === D6 && h.q.question === items(CH2, D6)[5].question)).toBe(true);
    expect(kept(CH2, D7)).toContain(items(CH2, D7)[6].question);
  });

  test('chapters_2 Q6 ۴ restates Q6 ۱ (the same four points): the later one is held, the first kept', () => {
    // Q5 here is another paper's (Ch 4+6), so only the in-slot row can see the pair.
    const other = items(paper('chapters_4'), C5);
    const exam = JSON.parse(withItems(JSON.stringify(CH2), C5, other));
    const q6 = items(CH2, D6);
    const laidQ6 = kept(exam, D6);
    expect(laidQ6).toContain(q6[0].question);
    expect(laidQ6).not.toContain(q6[3].question);
  });

  test('the layout reports each hold with its slot and rule', () => {
    const { held } = lay(CH1, { reasked: false });
    const q7 = held.filter((h) => h.slot === D7).map((h) => [h.q.question, h.rule]);
    expect(q7).toContainEqual([items(CH1, D7)[7].question, 'key_in_points']);
    for (const h of held) {
      expect(typeof h.rule).toBe('string');
      expect(h.printed).toBe(false);
    }
    // Since round 17 nothing held is put back after the re-ask either.
    const after = lay(CH1, { reasked: true }).held;
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((h) => h.printed)).toBe(false);
  });

  test('a one-word Q7 key that a Q5 answer only names, on another fact, is not held', () => {
    const exam = JSON.parse(JSON.stringify(CH2));
    const q5 = items(exam, C5)[0];
    q5.answer = `${q5.answer} مثلاً سندھ کے لوگ بھی یہی کرتے ہیں۔`;
    const q7 = { slot: D7, question: 'بیگم رعنا لیاقت علی خان کس صوبے کی گورنر بنیں؟', answer: 'سندھ', scheme: { points: [{ text: 'سندھ درست لکھنا', marks: 2 }] } };
    for (const types of Object.values(exam.unseen)) for (const l of Object.values(types)) {
      if (l.some((q) => q.slot === D7)) l.unshift(q7);
    }
    expect(kept(exam, D7)).toContain(q7.question);
  });

  test('another subject\'s layout carries no point-set hold', () => {
    for (const key of ['science', 'english', 'maths', 'urdu']) {
      const laid = applyLayout({ unseen: {} }, ALL[key], { kind: 'fde' }, { reasked: false });
      expect(laid.held).toBeUndefined();
    }
  });
});

describe('2. D\'s first prompt names C\'s Q5 topics and asks for other topics', () => {
  const CH1 = paper('chapters_1');
  const tree = JSON.parse(replyOf(CH1, 'C'));

  test('the note lists the topics as nouns and the rule', () => {
    const note = firstAskNote(SST, tree);
    expect(note).toContain('Every Q6 situation must need a DIFFERENT topic');
    expect(note).toContain('ماس میڈیا اور سوشل میڈیا');
    expect(note).toContain('ڈیجیٹل شہری');
    // A topic is a noun phrase, not the question.
    expect(note).not.toMatch(/Q5 topics:[^\n]*کیا فرق ہے/);
  });

  test('no other subject is told anything', () => {
    for (const key of ['science', 'english', 'maths', 'urdu']) expect(firstAskNote(ALL[key], tree)).toBeNull();
  });
});

describe('3. D\'s re-ask is told the held items\' points as never these', () => {
  const CH1 = paper('chapters_1');

  test('the held Q7 and its points are listed under never these', () => {
    const laid = lay(CH1, { reasked: false });
    const note = takenNote(SST, section('D'), laid.examJson, { topUp: true, shortfall: laid.shortfall, held: laid.held });
    expect(note).toContain('set aside');
    expect(note).toContain(items(CH1, D7)[7].question.trim());
  });

  test('the engine\'s D re-ask carries them (D short on its first reply)', async () => {
    const d = replyOf(CH1, 'D');
    const { asked } = await run([d, d]);
    const ds = dAsks(asked);
    expect(ds.length).toBeGreaterThanOrEqual(2);
    expect(ds[0].text).not.toContain('These items were set aside');
    expect(ds[1].text).toContain('These items were set aside');
    expect(ds[1].text).toContain(items(CH1, D7)[7].question.trim());
  });

  test('without held items, and for C and every other subject, the note is unchanged', () => {
    const laid = lay(CH1, { reasked: false });
    const base = takenNote(SST, section('C'), laid.examJson, { topUp: true, shortfall: laid.shortfall });
    expect(takenNote(SST, section('C'), laid.examJson, { topUp: true, shortfall: laid.shortfall, held: laid.held })).toBe(base);
    const plainD = takenNote(SST, section('D'), laid.examJson, { topUp: true, shortfall: laid.shortfall });
    expect(takenNote(SST, section('D'), laid.examJson, { topUp: true, shortfall: laid.shortfall, held: [] })).toBe(plainD);
    for (const key of ['english', 'urdu']) {
      const P = ALL[key];
      for (const s of P.sections) {
        expect(takenNote(P, s, laid.examJson, { held: laid.held })).toBe(takenNote(P, s, laid.examJson));
      }
    }
  });
});

describe('4. one more D-only re-ask before a held D item is put back', () => {
  const CH1 = paper('chapters_1');
  const point = (text, marks) => ({ kind: 'K', text, marks });
  const FRESH_Q7 = [
    { slot: D7, question: 'پاکستان کا قومی پھول کون سا ہے؟', answer: 'چنبیلی', scheme: { points: [point('چنبیلی', 2)] } },
    { slot: D7, question: 'پاکستان کا قومی جانور کون سا ہے؟', answer: 'مارخور', scheme: { points: [point('مارخور', 2)] } },
    { slot: D7, question: 'پاکستان کا قومی پرندہ کون سا ہے؟', answer: 'چکور', scheme: { points: [point('چکور', 2)] } },
  ];


  test('D still holds after its re-ask: it is asked a third time, told what was held, and the paper prints', async () => {
    const d = replyOf(CH1, 'D');
    const { asked } = await run([d, d, d]);
    const ds = dAsks(asked);
    expect(ds).toHaveLength(3);
    expect(ds[2].text).toContain('set aside');
    expect(ds[2].text).toContain(items(CH1, D7)[7].question.trim());
    const holds = mockLog.mock.calls.filter(([m]) => m === '[assessment] held items');
    expect(holds.length).toBeGreaterThan(0);
    const row = holds[holds.length - 1][1];
    expect(Array.isArray(row.held)).toBe(true);
    for (const h of row.held) {
      expect(h).toEqual(expect.objectContaining({ slot: expect.any(String), rule: expect.any(String), held: expect.any(Number) }));
    }
  });

  test('a D re-ask that fills the slot with clean items is not asked again', async () => {
    const d = replyOf(CH1, 'D');
    // Q6 ۶ (a playground quarrel, Q5 ۵ again) and Q7 ۳ / ۸ (Q5 ۹'s points) are what D's first reply had held.
    const FRESH_Q6 = { slot: D6, question: 'آپ کے اسکول کے باغ کے پودے گرمیوں میں سوکھ رہے ہیں۔ آپ اور آپ کے ساتھی پانی کی کمی میں انھیں کیسے بچائیں گے؟ دو طریقے اور ان کی وجہ بتائیں۔', answer: 'صبح یا شام پانی دیں تاکہ دھوپ میں پانی نہ اڑے، اور پودوں کے گرد پتے بچھائیں تاکہ مٹی کی نمی باقی رہے۔', scheme: { points: [point('صبح یا شام پانی دینا', 2), point('پتوں سے مٹی کی نمی بچانا', 2), point('ہر طریقے کی وجہ', 2)] } };
    const clean = withItems(withItems(d, D7, [...items(CH1, D7).filter((_, i) => i !== 1 && i !== 2 && i !== 7), ...FRESH_Q7]),
      D6, [...items(CH1, D6).filter((_, i) => i !== 5), FRESH_Q6]);
    const { asked } = await run([d, clean]);
    expect(dAsks(asked)).toHaveLength(2);
  });

  test('every other subject is asked as before (no extra section call)', async () => {
    for (const subject of ['science', 'english', 'maths', 'urdu']) {
      mockCreate.mockReset();
      let calls = 0;
      mockCreate.mockImplementation(async () => {
        calls += 1;
        return { choices: [{ message: { content: '{"unseen":{}}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
      });
      await Gen.generatePatternExam({ grade: 5, subject, pattern: 'fde_g5_2027', scope: { kind: 'pages', chapters: null, pages: '10-20' }, pageRanges: '10-20' }).catch(() => null);
      // One first ask and one re-ask per section, nothing more (Urdu: plus Section A's own second
      // top-up, which is Urdu's and not this one).
      expect(calls).toBeLessThanOrEqual(2 * ALL[subject].sections.length + (subject === 'urdu' ? 1 : 0));
    }
  });
});

describe('5. Q6: two different ideas applied, never one fact twice, a computation or a recall list', () => {
  const prompt = (subject, id, scope) => {
    const S = ALL[subject];
    const sec = S.sections.find((s) => s.id === id);
    return Gen.buildPatternUserPrompt({ grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20', section: sec, slots: sec.slots, lang: S.medium, P: S, scope });
  };
  const SCOPES = [{ kind: 'fde', chapters: null, pages: null }, { kind: 'chapters', chapters: [1, 2], pages: null }, { kind: 'pages', chapters: null, pages: '26-33' }];

  test('D carries the tightened Q6 line on every scope; C does not', () => {
    for (const scope of SCOPES) {
      const d = prompt('social_studies', 'D', scope);
      expect(d).toMatch(/two different ideas/);
      expect(d).toMatch(/never one fact said twice/i);
      expect(d).toMatch(/no computation/i);
      expect(prompt('social_studies', 'C', scope)).not.toMatch(/two different ideas/);
    }
  });

  test('no other subject carries it', () => {
    for (const subject of ['science', 'english', 'maths', 'urdu']) {
      for (const s of ALL[subject].sections) expect(prompt(subject, s.id, SCOPES[1])).not.toMatch(/two different ideas/);
    }
  });
});

describe('the eight local papers: what the new rows hold', () => {
  test('full scope holds no D item that the round-14 head kept', () => {
    // Recorded on the round-14 head: full_1–4 were clean by the by-points test; a hold there is a false flag.
    const flags = [];
    for (const p of LOCAL.filter((n) => n.startsWith('full'))) {
      const exam = paper(p);
      for (const slot of [D6]) {
        const k = new Set(kept(exam, slot));
        flags.push(...items(exam, slot).filter((q) => !k.has(q.question)).map((q) => `${p} ${q.question.slice(0, 40)}`));
      }
    }
    expect(flags.length).toBeLessThanOrEqual(2);
  });
});
