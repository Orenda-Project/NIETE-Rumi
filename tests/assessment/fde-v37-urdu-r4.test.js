/**
 * Round 4 Urdu panel (G1/G2): the oral poem is never a hamd or any poem that names God, the poem box is labelled a
 * poem, a keyed opposite takes its true synonym, and the G2 Q9 dialogue descriptors pay the speaker's name.
 */
const fs = require('fs');
const A = '../../bot/shared/services/assessment/';
const { urduOralBad } = require(`${A}fde-early-urdu-oral`);
const Prompt = require(`${A}fde-early-prompt`);
const { oralSheet } = require(`${A}fde-oral-sheet`);
const { mendUrduOpposites, poemPage, citePoemPage } = require(`${A}fde-urdu-r4`);
const { writingMarking } = require(`${A}fde-early-urdu-marking`);
const g1 = require(`${A}patterns/early/g1-urdu`);
const g2 = require(`${A}patterns/early/g2-urdu`);

const HAMD = 'پیڑ اور پودے\nسب کو بنایا میرے خدا نے';
const NATURE = 'چاند اور تارے\nرات کو چمکتے ہیں';
const items = [{ ask: 'رات کو کیا چمکتا ہے؟', answer: 'چاند' }];
const HAMD_ITEMS = [['بڑے سبز درخت کا کیا نام ہے؟', 'پیڑ'], ['چھوٹی ہری چیزوں کو کیا کہتے ہیں؟', 'پودے'], ['کس نے بنایا؟', 'میرے'], ['بنانے والا کون؟', 'خدا'], ['کتنوں کو بنایا؟', 'سب']].map(([ask, answer]) => ({ ask, answer }));
const task = (g, id) => g.oral.tasks.find((t) => t.id === id);

describe('1. the oral poem is never religious', () => {
  test('RED a poem whose script names God is flagged religious-poem', () => {
    expect(urduOralBad('poem', HAMD_ITEMS, HAMD).map((f) => f.reason)).toContain('religious-poem');
  });
  test('a nature poem is not flagged religious-poem', () => {
    expect(urduOralBad('poem', items, NATURE).map((f) => f.reason)).not.toContain('religious-poem');
  });
  test('RED oralContent flags the hamd so the poem slot is asked again', () => {
    const tree = { oral: g1.oral.tasks.map((t) => ({ id: t.id, script: t.id === 'poem' ? HAMD : 'x', items: t.id === 'poem' ? HAMD_ITEMS : Array.from({ length: t.n }, (_, i) => ({ ask: `سوال ${i + 1}`, answer: `جواب ${i + 1}` })) })) };
    expect(Prompt.oralContent(tree, g1.oral, { saidCheck: false }).flagged).toContain('poem');
  });
  test('RED the re-ask note tells the model to pick a non-religious book poem', () => {
    const src = fs.readFileSync(require.resolve(`${A}fde-early-writer`), 'utf8');
    expect(src).toMatch(/non-religious book poem/);
  });
  test('RED both poem asks carry the nature / family rule', () => {
    const rule = 'Choose a book poem about nature, family, school, animals or play; never a hamd, naat, prayer or a poem that names God.';
    expect(task(g1, 'poem').ask).toContain(rule);
    expect(task(g2, 'poem').ask).toContain(rule);
  });
  test('RED the page of the poem is cited from the book page markers; none when it is not found', () => {
    const book = '=== Page 12 ===\nکچھ اور\n=== Page 13 ===\nچاند اور تارے\nرات کو چمکتے ہیں\n=== Page 14 ===\nآگے';
    expect(poemPage(NATURE, book)).toBe(13);
    expect(poemPage(NATURE, 'no markers here')).toBeNull();
    const cited = citePoemPage([{ id: 'poem', script: NATURE, items }, { id: 'likes', items }], book);
    expect(cited[0].page).toBe(13);
    expect(cited[1].page).toBeUndefined();
  });
});

describe('2. the poem box says poem', () => {
  const oral = (id, page) => ({ title_ur: 'x', marks: 5, tasks: [{ id, kind: 'listening', label_en: id, label_ur: id, marks: 5, scoring: 'each', rubric: [{ marks: 1, en: 'Each', ur: 'ہر' }] }], content: [{ id, script: NATURE, ...(page ? { page } : {}), items }] });
  const ctx = { medium: 'ur', text: (s) => String(s) };
  test('RED the poem slot reads «سننے کی نظم»', () => {
    const html = oralSheet(oral('poem'), ctx);
    expect(html).toContain('سننے کی نظم (استاد پڑھ کر سنائیں)');
    expect(html).not.toContain('سننے کی کہانی');
  });
  test('a story slot keeps «سننے کی کہانی»', () => {
    expect(oralSheet(oral('story'), ctx)).toContain('سننے کی کہانی (استاد پڑھ کر سنائیں)');
  });
  test('RED a cited page prints on the poem box', () => {
    expect(oralSheet(oral('poem', 42), ctx)).toContain('صفحہ 42');
  });
});

describe('3. opposites take their true synonym', () => {
  const ex = (answer, extra = {}) => ({ unseen: { s: { Opposites: [{ slot: 'g1.urdu.B.Q8', question: 'گرم', answer, ...extra }] } } });
  const first = (r) => r.examJson.unseen.s.Opposites[0];
  test('RED گرم keyed سرد also accepts ٹھنڈا', () => {
    const q = first(mendUrduOpposites(ex('سرد')));
    expect(q.scheme.accept).toEqual(expect.arrayContaining(['سرد', 'ٹھنڈا']));
  });
  test('keeps an accept list the writer made and never duplicates', () => {
    const q = first(mendUrduOpposites(ex('سرد', { scheme: { accept: ['سرد', 'ٹھنڈا', 'یخ'] } })));
    expect(q.scheme.accept).toEqual(['سرد', 'ٹھنڈا', 'یخ']);
  });
  test('an answer with no synonym is untouched, and the input is not mutated', () => {
    const input = ex('چھوٹا');
    const r = mendUrduOpposites(input);
    expect(r.examJson).toBe(input);
    const keyed = ex('سرد');
    mendUrduOpposites(keyed);
    expect(keyed.unseen.s.Opposites[0].scheme).toBeUndefined();
  });
  test('only Opposites slots are touched', () => {
    const r = mendUrduOpposites({ unseen: { s: { 'Fill in the Blanks': [{ slot: 'g1.urdu.B.Q5', question: 'x', answer: 'سرد' }] } } });
    expect(r.notes).toEqual([]);
  });
});

describe('4. G2 Q9 dialogue descriptors pay the name', () => {
  const dlg = (text) => ({ unseen: { s: { Dialogue: [{ slot: 'g2.urdu.B.Q9', marks: 10, answer: 'x', scheme: { points: [{ text, marks: 2, kind: 'K' }] } }] } }, _layout: { sections: [{ id: 'B', slots: [{ slot: 'g2.urdu.B.Q9', type: 'Dialogue' }] }] } });
  const text = (r) => r.examJson.unseen.s.Dialogue[0].scheme.points[0].text;
  test('RED 2 = name and sentence, 1 = one of the two, 0 = neither', () => {
    const t = text(writingMarking(dlg('بات 1: نام (1) + جملہ (1)')));
    expect(t).toMatch(/2 نمبر:[^؛]*نام[^؛]*جملہ/);
    expect(t).toMatch(/1 نمبر:[^؛]*ان میں سے ایک/);
    expect(t).toMatch(/0 نمبر:[^؛]*دونوں نہیں/);
  });
  test('RED a point already carrying the sentence-only descriptors is rewritten, once', () => {
    const old = 'بات 1: نام (1) + جملہ (1) — 2 نمبر: مکمل جملہ منصوبے اور پچھلی بات کے مطابق، املا درست یا ایک غلطی؛ 1 نمبر: ادھورا جملہ؛ 0 نمبر: جملہ نہیں';
    const once = writingMarking(dlg(old));
    expect(text(once)).toMatch(/ان میں سے ایک/);
    expect(text(once).match(/2 نمبر/g)).toHaveLength(1);
    expect(writingMarking(once.examJson).notes).toEqual([]);
  });
  test('RED the G2 Q9 prompt rule states the three levels', () => {
    const rule = g2.sections[1].slots.find((s) => s.slot === 'g2.urdu.B.Q9').prompt_rule;
    expect(rule).toMatch(/2 = the name and a correct sentence, 1 = one of the two, 0 = neither/);
  });
});
