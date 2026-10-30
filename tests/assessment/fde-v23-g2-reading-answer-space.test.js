/**
 * bd-5jmnfj.4.51.8: G2 English Q1 (a passage and ten questions, (a)-(j), 20 marks) printed
 * the ten questions and then ONE 12 mm write-box. Each answer needs its own writing space,
 * so the space scales with the number of sub-questions. Item shape from the v23 g2-english
 * exam.json (each question carries lines: 2, marks: 2).
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-29T07:00:00.000Z';
const P = Patterns.get('fde_g2_2026').subjects.english;
const QS = ['Where do Sara and Omar live?', 'On which day do they go to the market?', 'What does Sara like to buy?',
  "What fell from the old woman's basket?", 'Why did the old woman smile?', 'Why did Sara and Omar feel happy all day?',
  'What kind of children are Sara and Omar? Tell why you think so.', 'What did the old woman give to Sara and Omar?',
  "Sara and Omar see a friend's pencil fall in the class. What can they do?", 'Write one sentence about a kind thing you can do for a neighbour.'];
const q = (question) => ({ lines: 2, marks: 2, answer: 'x', blooms: 'Remember', scheme: { accept: ['x'], points: [{ kind: 'K', text: 'k', marks: 2 }], common_error: 'e' }, question });
const ITEM = {
  slot: 'g2.english.A.Q1', lines: 0, marks: 20, blooms: 'Understand',
  passage: 'Sara and her brother Omar live in a small town near a river. Every Sunday, they go to the market with their father.',
  questions: QS.map(q),
};

function q1Html(questions) {
  const item = { ...ITEM, questions };
  const exam = normaliseScheme(applyLayout({ unseen: { subjective: { 'Read and Answer': [item] } } }, P, { kind: 'fde' }, { now: NOW }).examJson).examJson;
  const html = R.renderPaper({ examJson: exam, grade: 2, subject: 'english', answerLines: true, allowShort: true });
  const at = html.indexOf('data-slot="g2.english.A.Q1"');
  return html.slice(at, html.indexOf('</section>', at));
}
const heights = (html) => [...html.matchAll(/class="(?:write-box|work-box|answer-line)[^"]*" style="height:(\d+(?:\.\d+)?)mm/g)].map((m) => Number(m[1]));

describe('G2 reading answers each get their own space (bd-5jmnfj.4.51.8)', () => {
  it('prints a writing space after every one of the ten sub-questions, before the next sub-question', () => {
    const html = q1Html(QS.map(q));
    const subs = html.split('<div class="sub">').slice(1);
    expect(subs).toHaveLength(10);
    for (const s of subs) expect(s).toMatch(/class="(?:write-box|work-box|answer-line)/);
  });

  it('the total answer space is at least ten boxes, not one', () => {
    expect(heights(q1Html(QS.map(q))).length).toBeGreaterThanOrEqual(10);
  });

  it('space scales with the number of sub-questions: five questions print five spaces', () => {
    expect(heights(q1Html(QS.slice(0, 5).map(q))).length).toBe(5);
  });

  it('a two-line answer (lines: 2) gets a taller space than a one-line answer', () => {
    const one = heights(q1Html([{ ...q(QS[0]), lines: 1 }]))[0];
    const two = heights(q1Html([{ ...q(QS[0]), lines: 2 }]))[0];
    expect(two).toBeGreaterThan(one);
  });
});
