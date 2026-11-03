/**
 * v29 blocker, G2 Urdu Q8 (bd-5jmnfj.4.58): the slot prints «دیے گئے موضوع پر پانچ جملے لکھیں۔» and the item's
 * `question` came back "" (the topic sat in main_question and in the key), so the child had no topic.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { topicLine, topicOk, fillTopics } = require('../../bot/shared/services/assessment/fde-early-urdu-topic');
const { earlyUrduFixes } = require('../../bot/shared/services/assessment/fde-early-urdu-fixes');
const { answerShortfall, answerNote } = require('../../bot/shared/services/assessment/fde-early-prompt');

const P = Patterns.subjectOf('fde_g2_2026', 'urdu');
const POINT = { text: 'ایک درست جملہ جو اسکول کے موضوع پر ہو', marks: 2, kind: 'K' };
const q8 = (over = {}) => ({
  slot: 'g2.urdu.B.Q8', main_question: 'اپنے اسکول کے بارے میں پانچ جملے لکھیں۔', question: '', marks: 10,
  answer: '1. میرا اسکول بڑا ہے۔', scheme: { points: [POINT, POINT], accept: [], common_error: '' }, ...over,
});
const paper = (item) => ({
  unseen: { subjective: { 'Topic Sentences': [item] } },
  _layout: { sections: [{ id: 'B', slots: [{ slot: 'g2.urdu.B.Q8', type: 'Topic Sentences' }] }] },
});
const first = (ex) => ex.unseen.subjective['Topic Sentences'][0];

describe('G2 Urdu Q8 topic line', () => {
  test('RED v29: an empty question gets the topic from main_question as a short topic line', () => {
    const { examJson, notes } = fillTopics(paper(q8()));
    expect(first(examJson).question).toBe('موضوع: میرا اسکول');
    expect(notes.join(' ')).toMatch(/g2\.urdu\.B\.Q8/);
  });
  test('a feminine possessive becomes میری', () => {
    expect(topicLine(q8({ main_question: 'اپنی پسندیدہ کتاب کے بارے میں پانچ جملے لکھیں۔' }))).toBe('موضوع: میری پسندیدہ کتاب');
  });
  test('with no topic in main_question the scheme names it', () => {
    expect(topicLine(q8({ main_question: 'دیے گئے موضوع پر پانچ جملے لکھیں۔' }))).toBe('موضوع: اسکول');
  });
  test('with a generic main_question and a generic scheme there is no topic', () => {
    const bare = q8({ main_question: 'دیے گئے موضوع پر پانچ جملے لکھیں۔', scheme: { points: [{ text: 'ایک درست جملہ', marks: 2, kind: 'K' }] } });
    expect(topicLine(bare)).toBe('');
    expect(topicOk(bare)).toBe(false);
  });
  test('a question that already names a topic is kept; the instruction restated is replaced', () => {
    expect(first(fillTopics(paper(q8({ question: 'موضوع: ہمارا ملک' }))).examJson).question).toBe('موضوع: ہمارا ملک');
    expect(first(fillTopics(paper(q8({ question: 'دیے گئے موضوع پر پانچ جملے لکھیں۔' }))).examJson).question).toBe('موضوع: میرا اسکول');
  });
  test('only a topic slot is touched', () => {
    const ex = { unseen: { subjective: { Verbs: [q8({ slot: 'g2.urdu.A.Q4' })] } }, _layout: { sections: [{ id: 'A', slots: [{ slot: 'g2.urdu.A.Q4', type: 'Verbs' }] }] } };
    expect(fillTopics(ex).examJson.unseen.subjective.Verbs[0].question).toBe('');
  });
  test('earlyUrduFixes runs it', () => {
    expect(first(earlyUrduFixes(paper(q8())).examJson).question).toBe('موضوع: میرا اسکول');
  });
});

describe('G2 Urdu Q8 re-ask route', () => {
  const slot = P.sections.flatMap((s) => s.slots).find((s) => s.slot === 'g2.urdu.B.Q8');
  test('the slot answer_ok accepts an item whose topic can be found and rejects one with none', () => {
    expect(slot.answer_ok(q8())).toBe(true);
    expect(slot.answer_ok(q8({ main_question: 'دیے گئے موضوع پر پانچ جملے لکھیں۔', scheme: { points: [] } }))).toBe(false);
  });
  test('answerShortfall flags the topicless item and the re-ask note carries the rule', () => {
    const none = q8({ main_question: 'دیے گئے موضوع پر پانچ جملے لکھیں۔', scheme: { points: [] } });
    const short = answerShortfall(paper(none), P);
    expect(short.map((f) => f.slot)).toEqual(['g2.urdu.B.Q8']);
    expect(answerNote(short, P)).toMatch(/topic goes in `question`/);
  });
  test('the prompt rule puts the topic in question', () => {
    expect(slot.prompt_rule).toMatch(/the topic goes in `question`/);
    expect(slot.prompt_rule).toMatch(/موضوع:/);
  });
});
