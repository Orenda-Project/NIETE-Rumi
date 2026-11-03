/**
 * v29 should-fix, early Urdu (bd-5jmnfj.4.58): G1 Q1 repeats Q3 join-letters and tests few constructs; G2 Q1 vi-viii
 * are poet/event recall; G2 Q7-Q9 pay 2 marks a sentence with no guidance for a slip; G2 oral dialogue rubric has no
 * level descriptors; G1 project criterion «child's own» is not observable.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { g1Q1Ok, g2Q1Ok, recall, joinLetters } = require('../../bot/shared/services/assessment/fde-early-urdu-mcq');
const { writingMarking } = require('../../bot/shared/services/assessment/fde-early-urdu-marking');
const { earlyUrduFixes } = require('../../bot/shared/services/assessment/fde-early-urdu-fixes');

const slotOf = (key, id) => Patterns.subjectOf(key, 'urdu').sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const mcq = (q) => ({ question: q, options: ['الف) ا', 'ب) ب', 'ج) ج'], answer: 'الف) ا' });

describe('early Urdu MCQ checks', () => {
  test('RED v29 G2 Q1: poet, event and who-said recall items are rejected; a word item is kept', () => {
    expect(recall(mcq('نظم «صبح سویرے» کس شاعر نے لکھی؟'))).toBe(true);
    expect(recall(mcq('سبق میں بچہ کس نے کہا کہ چلو؟'))).toBe(true);
    expect(recall(mcq('کہانی میں بندر نے کیا کیا؟'))).toBe(true);
    expect(recall(mcq('لفظ "شاخ" کے معنی کیا ہیں؟'))).toBe(false);
    expect(g2Q1Ok(mcq('لفظ "شاخ" کے معنی کیا ہیں؟'))).toBe(true);
    expect(g2Q1Ok(mcq('نظم کس شاعر نے لکھی؟'))).toBe(false);
  });
  test('RED v29 G1 Q1: a join-letters item repeats Q3 and is rejected', () => {
    expect(joinLetters(mcq('حروف ب + ا + غ + کو جوڑ کر کون سا لفظ بنتا ہے؟'))).toBe(true);
    expect(joinLetters(mcq('حروف جوڑ کر لفظ بنائیں'))).toBe(true);
    expect(joinLetters(mcq('کون سا لفظ پھل ہے؟'))).toBe(false);
    expect(g1Q1Ok(mcq('کون سا لفظ پھل ہے؟'))).toBe(true);
    expect(g1Q1Ok(mcq('ب + ا + غ سے کون سا لفظ بنتا ہے؟'))).toBe(false);
  });
  test('the slot rules and hooks carry it', () => {
    expect(slotOf('fde_g2_2026', 'g2.urdu.A.Q1').answer_ok).toBe(g2Q1Ok);
    expect(slotOf('fde_g2_2026', 'g2.urdu.A.Q1').prompt_rule).toMatch(/no item asks a poet|never a poet/i);
    expect(slotOf('fde_g1_2026', 'g1.urdu.A.Q1').answer_ok).toBe(g1Q1Ok);
    expect(slotOf('fde_g1_2026', 'g1.urdu.A.Q1').prompt_rule).toMatch(/at least six kinds/);
    expect(slotOf('fde_g1_2026', 'g1.urdu.A.Q1').prompt_rule).toMatch(/Q3/);
  });
});

const writing = (type, slot) => ({ slot, type, marks: 10, answer: 'x', scheme: { points: [1, 2, 3, 4, 5].map((n) => ({ text: `جملہ ${n}`, marks: 2, kind: 'K' })), accept: [] } });
const paper = () => ({
  unseen: { subjective: { 'Picture Sentences': [writing('Picture Sentences', 'g2.urdu.B.Q7')], 'Topic Sentences': [writing('Topic Sentences', 'g2.urdu.B.Q8')], Dialogue: [writing('Dialogue', 'g2.urdu.B.Q9')] } },
  _layout: { sections: [{ id: 'B', slots: ['Q7:Picture Sentences', 'Q8:Topic Sentences', 'Q9:Dialogue'].map((s) => ({ slot: `g2.urdu.B.${s.split(':')[0]}`, type: s.split(':')[1] })) }] },
});

describe('G2 Urdu writing marking', () => {
  test('RED v29 Q7-Q9: every point states 2 / 1 / 0 for a slip, an unfinished sentence and an off-topic sentence', () => {
    const { examJson, notes } = writingMarking(paper());
    ['Picture Sentences', 'Topic Sentences', 'Dialogue'].forEach((t) => {
      examJson.unseen.subjective[t][0].scheme.points.forEach((p) => {
        expect(p.text).toMatch(/^جملہ \d/);
        expect(p.text).toMatch(/2 نمبر/);
        expect(p.text).toMatch(/1 نمبر/);
        expect(p.text).toMatch(/0 نمبر/);
        expect(p.text).toMatch(/املا/);
      });
    });
    expect(notes).toHaveLength(3);
  });
  test('the picture wording names the picture, the topic wording the topic, the dialogue the plan', () => {
    const s = writingMarking(paper()).examJson.unseen.subjective;
    expect(s['Picture Sentences'][0].scheme.points[0].text).toMatch(/تصویر/);
    expect(s['Topic Sentences'][0].scheme.points[0].text).toMatch(/موضوع/);
    expect(s.Dialogue[0].scheme.points[0].text).toMatch(/پچھلی بات|منصوبے/);
  });
  test('idempotent, and the one-sentence Grade 1 Q10 (2 marks) is left alone', () => {
    const once = writingMarking(paper()).examJson;
    expect(writingMarking(once).notes).toEqual([]);
    const g1 = { unseen: { subjective: { 'Picture Sentences': [{ ...writing('Picture Sentences', 'g1.urdu.B.Q10'), marks: 2 }] } }, _layout: { sections: [{ id: 'B', slots: [{ slot: 'g1.urdu.B.Q10', type: 'Picture Sentences' }] }] } };
    expect(writingMarking(g1).notes).toEqual([]);
  });
  test('earlyUrduFixes runs it', () => {
    expect(earlyUrduFixes(paper()).examJson.unseen.subjective.Dialogue[0].scheme.points[0].text).toMatch(/0 نمبر/);
  });
});

describe('oral rubrics and the G1 project criterion', () => {
  const oralTask = (key, id) => Patterns.subjectOf(key, 'urdu').oral.tasks.find((t) => t.id === id);
  test('RED v29 G2 dialogue rubric: each criterion has level descriptors, in both languages', () => {
    oralTask('fde_g2_2026', 'dialogue').rubric.forEach((r) => {
      expect(r.en).toMatch(/\b(?:full|most|some|little)\b/i);
      expect(r.ur).toMatch(/پورے|زیادہ|کچھ|بہت کم/);
    });
    expect(oralTask('fde_g2_2026', 'dialogue').ask).toMatch(/first turn.*never a reply/i);
  });
  test('RED v29 G1 project: the criterion is observable, not ownership', () => {
    const r = oralTask('fde_g1_2026', 'project').rubric;
    expect(r.map((x) => x.en).join(' ')).not.toMatch(/own/i);
    expect(r[0].marks).toBe(4);
    expect(r[0].en).toMatch(/two or more parts/);
  });
  test('G1 oral prompt rules: one ask per mother question; poem answers do not restate; read words avoid written ones', () => {
    expect(oralTask('fde_g1_2026', 'mother').ask).toMatch(/exactly one thing/);
    expect(oralTask('fde_g1_2026', 'poem').ask).toMatch(/never restates the question/);
    expect(oralTask('fde_g2_2026', 'poem').ask).toMatch(/never restates the question/);
    expect(oralTask('fde_g1_2026', 'read_words').ask).toMatch(/prints nowhere in the written paper/);
  });
  test('G1 Q10 rule: the model sentence names what `describe` shows', () => {
    expect(slotOf('fde_g1_2026', 'g1.urdu.B.Q10').prompt_rule).toMatch(/names the main thing in its own `describe`/);
  });
});
