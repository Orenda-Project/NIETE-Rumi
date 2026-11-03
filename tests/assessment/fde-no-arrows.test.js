/**
 * No arrows anywhere a child or a teacher reads (bd-5jmnfj.4.50.1). v22 printed «… موسلادھار ←
 * یہ سب الفاظ…» in a Grade 5 Urdu question, «جلدی ← دیر» in the Urdu answer key, and a Grade 1
 * clock whose hands were arrows.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { noArrows, unarrow } = require('../../bot/shared/services/assessment/fde-no-arrows');
const { matchAnswer } = require('../../bot/shared/services/assessment/fde-match-block');
const { renderMarkingScheme } = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const { promptFor } = require('../../bot/shared/services/assessment/fde-picture-kie');
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const r21 = require('./fixtures/fde/r21-urdu-sandbox-full_1.json');

const ANY_ARROW = /[←→⟵⟶➔➜⇐⇒]|->/;
const SVC = path.join(__dirname, '../../bot/shared/services/assessment');

describe('noArrows: the exam JSON guard', () => {
  const Q = 'بادل، بجلی، گھٹا، موسلادھار ← یہ سب الفاظ کس سے تعلق رکھتے ہیں؟';

  it('rewrites the v22 Grade 5 Urdu question without its arrow, keeping the words', () => {
    const exam = { unseen: { Grammar: { 'Rewrite Sentences': [{ slot: 'g5.urdu.C.Q4', question: Q, answer: 'بارش' }] } } };
    const q = noArrows(exam).unseen.Grammar['Rewrite Sentences'][0];
    expect(q.question).toBe(Q.replace(' ← ', ' – '));
    expect(q.question).not.toMatch(ANY_ARROW);
  });

  it('cleans every arrow kind in question, options, answer, scheme and parts', () => {
    const exam = { unseen: { Science: { 'Draw and Label': [{
      slot: 'g5.science.D.Q2',
      question: 'Show the flow: sun ⇒ plant',
      options: ['a ➜ b', 'c ⟶ d', 'e -> f'],
      answer: 'Sun → grass → goat',
      scheme: { accept: ['grass→goat'], points: ['x ← y'] },
      parts: [{ antonyms: [['جلدی ← دیر']] }],
    }] } } };
    const q = noArrows(exam).unseen.Science['Draw and Label'][0];
    expect(q.answer).toBe('Sun – grass – goat');
    expect(JSON.stringify(q)).not.toMatch(ANY_ARROW);
  });

  it('leaves arrow-free text, the input and _layout as they were', () => {
    const layout = { sections: [] };
    const exam = { _layout: layout, unseen: { A: { B: [{ slot: 's', question: 'Write 3 – 1 = ?', marks: 2 }] } } };
    const before = JSON.stringify(exam);
    const out = noArrows(exam);
    expect(out.unseen.A.B[0]).toEqual(exam.unseen.A.B[0]);
    expect(JSON.stringify(exam)).toBe(before);
    expect(out._layout).toBe(layout);
    expect(unarrow('no arrow here')).toBe('no arrow here');
  });

  it('keeps a match item answer whole, so the paper still prints only its Column B side', () => {
    const exam = {
      _layout: { sections: [{ slots: [{ slot: 'g1.gk.B.Q4', shape: 'match' }] }] },
      unseen: { GK: { Match: [{ slot: 'g1.gk.B.Q4', question: 'اونٹ', answer: 'اونٹ → صحرا' }] } },
    };
    const q = noArrows(exam).unseen.GK.Match[0];
    expect(q.answer).toBe('اونٹ → صحرا');
    expect(matchAnswer(q)).toBe('صحرا');
  });

  it('runs in both writers', () => {
    expect(fs.readFileSync(path.join(SVC, 'fde-early-writer.js'), 'utf8')).toMatch(/noArrows\(dealScrambles\(dealOrders\(examJson\)\)\)/);
    expect(fs.readFileSync(path.join(SVC, 'assessment-generation.service.js'), 'utf8')).toMatch(/noArrows\(scheme\.examJson\)/);
  });
});

describe('answer keys print pairs colon-style', () => {
  it('the Urdu antonym rows read «گرم: ٹھنڈا» with no arrow and no full stop', () => {
    const html = renderMarkingScheme({ examJson: r21, grade: 5, subject: 'urdu' });
    expect(html).toContain('<b>گرم: ٹھنڈا</b>');
    expect(html).toContain('<b>سچ: جھوٹ</b>');
    expect(html).not.toMatch(/aria-label="[←→]"/);
  });

  it('the Match the Column key in assessment-changes and the system prompt use "left: right"', () => {
    const src = fs.readFileSync(path.join(SVC, 'assessment-changes.js'), 'utf8');
    expect(src).toContain('`${l}: ${right[i]}`');
    expect(src).not.toContain('`${l} → ${right[i]}`');
    expect(Gen.buildSystemPrompt({ subject: 'urdu', includeAnswerKey: true })).toContain('"left: right"');
  });
});

describe('the Urdu group-word rule carries no arrow example', () => {
  it('urdu section C keeps the example words with no arrow next to Urdu', () => {
    const P = Patterns.get('fde_g5_2027');
    const S = P.subjects.urdu;
    const section = S.sections.find((s) => s.slots.some((x) => /\.Q4$/.test(x.slot)));
    const prompt = Gen.buildPatternUserPrompt({
      grade: 5, subject: 'urdu', pageContent: 'PAGE', pageReference: 'p', section, slots: section.slots,
      lang: S.medium, P: S, scope: { kind: 'fde', chapters: null, pages: null },
    });
    expect(prompt).toContain('تھرمامیٹر، نبض، دوا اور ڈاکٹر');
    expect(prompt).not.toMatch(/[؀-ۿ]\s*[←→]|[←→]\s*[؀-ۿ]/);
  });
});

describe('clock pictures: plain hands', () => {
  it('a clock or watch prompt says the hands carry no arrowheads', () => {
    expect(promptFor({ kind: 'object', name: 'clock' })).toMatch(/no arrowheads/i);
    expect(promptFor({ kind: 'scene', describe: 'a wall clock showing three o\'clock' })).toMatch(/no arrowheads/i);
    expect(promptFor({ kind: 'count', name: 'watch' })).toMatch(/no arrowheads/i);
  });

  it('other pictures are unchanged', () => {
    expect(promptFor({ kind: 'object', name: 'apple' })).not.toMatch(/hands/i);
  });
});
