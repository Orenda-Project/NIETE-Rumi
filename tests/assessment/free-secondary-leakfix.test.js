/**
 * bd-5jmnfj.38.35 — the a8b G8 Urdu paper shipped with Q1 still giving away Q11 although the targeted
 * round was kept (Q1 was rewritten and its key still printed Q11's answer). A leak that survives the
 * rewrites gets a follow-up that quotes the leaked phrase, then a repair in code, so none ships.
 */
const L = require('../../bot/shared/services/assessment/free-secondary-leakfix');
const C = require('../../bot/shared/services/assessment/free-secondary-checks');

const PHRASE = 'ایک چھوٹی ڈسپنسری قائم کی';
const q1 = (key) => ({ question: 'عبدالستار ایدھی نے اپنی فلاحی خدمات کا آغاز کس طرح کیا؟',
  options: ['الف) ایک امدادی ادارہ خریدا', 'ب) ایک بڑا ہسپتال بنایا', 'ج) ایک رفاہی اسکول کھولا', `د) ${key}`],
  answer: `د) ${key}`, marks: 1, blooms: 'Understand' });
const q2 = { question: 'ایدھی نے خدمتِ خلق کا آغاز کس طرح کیا تھا؟', marks: 2, blooms: 'Remember',
  answer: `انھوں نے اپنی جمع پونجی سے ${PHRASE}۔`,
  marking_points: [{ point: 'ڈسپنسری کا ذکر', marks: 1 }, { point: 'جمع پونجی کا ذکر', marks: 1 }],
  mark_bands: [{ marks: '2', descriptor: 'دونوں نکات' }, { marks: '1', descriptor: 'ایک نکتہ' }, { marks: '0', descriptor: 'غلط' }],
  accept: 'چھوٹی ڈسپنسری کہنا کافی ہے', reject: 'مبہم جواب' };
const paper = (key) => ({ seen: [], unseen: [{ title: 'MCQ', questions: [q1(key)] }, { title: 'SRQ', questions: [JSON.parse(JSON.stringify(q2))] }] });
const check = (e) => C.paperIssues(e, {});
const leaks = (e) => check(e).filter((i) => i.check === 'cross-leak');

describe('the a8b shape', () => {
  it('Q1 leaks Q2 (the fixture is a real leak)', () => {
    expect(leaks(paper(PHRASE)).map((i) => i.n)).toContain(1);
  });
});

describe('resolveLeaks', () => {
  it('does nothing and asks nothing for a clean paper', async () => {
    const ask = jest.fn();
    const r = await L.resolveLeaks({ examJson: paper('ایک بڑا کتب خانہ کھولا'), check, ask });
    expect(ask).not.toHaveBeenCalled();
    expect(r.dropped).toEqual([]);
  });

  it('re-asks only the leaking pair, quoting the leaked phrase and both numbers, and keeps a fixed reply', async () => {
    const ask = jest.fn(async () => ({ items: [{ n: 1, question: 'ایدھی کی ایمبولینس سروس کا آغاز کب ہوا؟',
      options: ['الف) ۱۹۴۷', 'ب) ۱۹۵۱', 'ج) ۱۹۵۷', 'د) ۱۹۶۵'], answer: 'ج) ۱۹۵۷' }] }));
    const r = await L.resolveLeaks({ examJson: paper(PHRASE), check, ask });
    expect(ask).toHaveBeenCalledTimes(1);
    const text = ask.mock.calls[0][0];
    expect(text).toContain(PHRASE);
    expect(text).toMatch(/Q1/);
    expect(text).toMatch(/Q2/);
    expect(leaks(r.exam)).toEqual([]);
    expect(r.dropped).toEqual([]);
  });

  it('repairs in code when the follow-up reply still contains the leaked phrase: no cross-leak ships', async () => {
    const ask = jest.fn(async () => ({ items: [{ n: 1, question: 'ایدھی نے آغاز کیسے کیا؟',
      options: ['الف) ایک امدادی ادارہ خریدا', 'ب) ایک بڑا ہسپتال بنایا', 'ج) ایک رفاہی اسکول کھولا', `د) ${PHRASE}`],
      answer: `د) ${PHRASE}` }] }));
    const r = await L.resolveLeaks({ examJson: paper(PHRASE), check, ask });
    expect(leaks(r.exam)).toEqual([]);
    expect(r.dropped).toEqual([expect.objectContaining({ n: 1, avoid: [2] })]);
    expect(C.items(r.exam)).toHaveLength(1);
  });

  it('repairs in code when the follow-up call fails', async () => {
    const onError = jest.fn();
    const r = await L.resolveLeaks({ examJson: paper(PHRASE), check, ask: async () => { throw new Error('boom'); }, onError });
    expect(onError).toHaveBeenCalled();
    expect(leaks(r.exam)).toEqual([]);
    expect(r.dropped).toHaveLength(1);
  });
});
