/**
 * G5 Science: a Section A give-away with no spare is re-asked alone, with a "do not mention" note, not kept
 * (v37r4 panel, bd-5jmnfj.4.58; the v37 run kept two "no spare").
 */
const { settleScienceGivers } = require('../../bot/shared/services/assessment/fde-science-mcq-reask');
const { scienceGivers } = require('../../bot/shared/services/assessment/fde-science-giveaway-drop');

const pts = (...t) => ({ points: t.map((text) => ({ text, marks: 1, kind: 'K' })), accept: [] });
const mcq = (question, options, answer) => ({ slot: 'science.A.Q1a', question, options, answer, marks: 1 });
const layout = () => ({ sections: [{ slots: [{ slot: 'science.A.Q1a', attempt: 20, generate: 20 }, { slot: 'science.C.Q3a', attempt: 8, generate: 10 }] }] });
const filler = (n) => Array.from({ length: n }, (_, i) => mcq(`Which organ is number ${i} in the plan?`, ['a) lens', 'b) fin', 'c) stalk', 'd) hinge'], 'b) fin'));
const c = { slot: 'science.C.Q3a', question: 'Name the gas fossil fuels release that traps heat.', answer: 'x', marks: 5, scheme: pts('Carbon dioxide', 'Traps the Sun\'s heat in the atmosphere') };
const giver = mcq('Which gas does coal release that traps the Sun\'s heat in the atmosphere?', ['a) carbon dioxide', 'b) helium', 'c) neon', 'd) argon'], 'a) carbon dioxide');
const clean = mcq('Which part of a flower makes seeds?', ['a) pistil', 'b) root', 'c) leaf', 'd) bud'], 'a) pistil');
const exam = () => ({ _layout: layout(), unseen: { objective: { MCQs: [giver, ...filler(19)] }, subjective: { 'Brief Answers': [c] } } });
const treeOf = (...items) => ({ unseen: { objective: { MCQs: items } } });

describe('a kept Section A giver', () => {
  it('is re-asked alone, told the words not to mention, and replaced in place', async () => {
    const notes = [];
    const out = await settleScienceGivers(exam(), { ask: async (n) => { notes.push(n); return treeOf(clean); } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/Do not mention/);
    expect(notes[0]).toMatch(/carbon/);
    expect(notes[0]).toMatch(/coal release/);
    const mcqs = out.examJson.unseen.objective.MCQs;
    expect(mcqs).toHaveLength(20);
    expect(mcqs[0].question).toBe(clean.question);
    expect(out.replaced).toEqual([expect.objectContaining({ slot: 'science.A.Q1a' })]);
    expect(out.kept).toEqual([]);
    expect(scienceGivers(out.examJson)).toEqual([]);
  });

  it('keeps the giver when the new item gives something away too', async () => {
    const out = await settleScienceGivers(exam(), { ask: async () => treeOf(giver) });
    expect(out.kept).toHaveLength(1);
    expect(out.replaced).toEqual([]);
    expect(out.examJson.unseen.objective.MCQs[0].question).toBe(giver.question);
  });

  it('keeps the giver when the re-ask fails or returns nothing', async () => {
    const failed = await settleScienceGivers(exam(), { ask: async () => { throw new Error('boom'); } });
    expect(failed.kept).toHaveLength(1);
    const empty = await settleScienceGivers(exam(), { ask: async () => ({}) });
    expect(empty.kept).toHaveLength(1);
  });

  it('does not ask without an ask function, or when nothing is kept', async () => {
    expect((await settleScienceGivers(exam(), {})).kept).toHaveLength(1);
    let calls = 0;
    const clean20 = { _layout: layout(), unseen: { objective: { MCQs: filler(20) }, subjective: { 'Brief Answers': [c] } } };
    await settleScienceGivers(clean20, { ask: async () => { calls += 1; return treeOf(clean); } });
    expect(calls).toBe(0);
  });

  it('prefers a spare to a re-ask and never changes its input', async () => {
    const input = exam();
    const copy = JSON.parse(JSON.stringify(input));
    let calls = 0;
    const out = await settleScienceGivers(input, { spares: [clean], ask: async () => { calls += 1; return treeOf(clean); } });
    expect(calls).toBe(0);
    expect(out.dropped).toHaveLength(1);
    expect(input).toEqual(copy);
  });

  it('asks for at most three givers on one paper', async () => {
    const topics = ['coal', 'oil', 'gas', 'wood'].map((w) => mcq(`Which gas does ${w} release that traps the Sun's heat in the atmosphere?`, [`a) ${w}dioxide gas`, 'b) helium', 'c) neon', 'd) argon'], `a) ${w}dioxide gas`));
    const many = { _layout: layout(), unseen: { objective: { MCQs: [...topics, ...filler(16)] }, subjective: { 'Brief Answers': topics.map((t, i) => ({ ...c, question: `Name the gas ${i} that traps heat.`, scheme: pts(`${['coal', 'oil', 'gas', 'wood'][i]}dioxide gas`, 'Traps heat') })) } } };
    let calls = 0;
    const out = await settleScienceGivers(many, { ask: async () => { calls += 1; return treeOf({ ...clean, question: `Which part number ${calls} makes seeds?` }); } });
    expect(calls).toBeLessThanOrEqual(3);
    expect(out.replaced.length).toBeLessThanOrEqual(3);
  });

  it('logs what it did through the given logger', async () => {
    const logs = [];
    await settleScienceGivers(exam(), { ask: async () => treeOf(clean), log: (m, d) => logs.push([m, d]) });
    expect(logs.map((l) => l[0])).toEqual(expect.arrayContaining([expect.stringMatching(/re-asked/)]));
  });
});
