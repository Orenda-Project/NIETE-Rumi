/**
 * v25 render-layout fixes (v24 review, items 1-3).
 * 1. G1 Urdu Q5 iv: the wide label 'iv)' sits ~2pt from the text, so ببلو's first dot reads as a
 *    full stop. Urdu hanging labels get a width-independent gap (border-box + padding 1.2mm).
 * 2. G1 Urdu roman labels print '(iv' (the ')' is mirrored inside the RTL box). A Latin roman label
 *    in an Urdu paper is isolated as LTR: <bdi class="ltr" dir="ltr">iv)</bdi>.
 * 3. G2 English Q16: the model numbers the story sentences ('1. Finally…') and the renderer letters
 *    them too, so the paper prints '(a) 1. Finally'. bareSub drops a model-written leading numeral,
 *    and the slot's prompt stops asking for numbers.
 */
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const urdu = require('./fixtures/early/g1-urdu-exam.json');
const english = require('./fixtures/early/g1-english-exam.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const styleOf = (html) => (html.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [])[1] || '';
const ruleOf = (css, sel) => (css.match(new RegExp(`${sel.replace(/\./g, '\\.')} \\{[^}]*\\}`)) || [])[0] || '';
// A label may hold one nested element (Urdu digits <span class="num">, or the LTR <bdi>).
const LABEL = '((?:<(span|bdi)[^>]*>[^<]*</\\2>|[^<])*)</span>';
const labelsOf = (html, slot) => [...html.matchAll(new RegExp(`data-slot="${slot.replace(/\./g, '\\.')}"><span class="n">${LABEL}`, 'g'))].map((m) => m[1]);
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v'];
const GAP = /box-sizing:\s*border-box[^}]*padding-left:\s*1\.2mm/;

const urduHtml = R.renderPaper({ examJson: clone(urdu), grade: 1, subject: 'urdu', answerLines: true });
const englishHtml = R.renderPaper({ examJson: clone(english), grade: 1, subject: 'english', answerLines: true });

describe('v25 item 1: G1 Urdu hanging label keeps a gap however wide it is', () => {
  const css = styleOf(urduHtml);

  test('Urdu .q .n is border-box with a 1.2mm inner gap', () => {
    expect(ruleOf(css, '.q .n')).toMatch(GAP);
  });

  test('Urdu .sub .n is border-box with a 1.2mm inner gap', () => {
    expect(ruleOf(css, '.sub .n')).toMatch(GAP);
  });

  test('control: English .q .n and .sub .n rules are unchanged byte for byte', () => {
    const ecss = styleOf(englishHtml);
    expect(ruleOf(ecss, '.q .n')).toBe('.q .n { display: inline-block; min-width: 6mm; margin-left: -6mm; }');
    expect(ruleOf(ecss, '.sub .n')).toBe('.sub .n { display: inline-block; min-width: 6mm; margin-left: -6mm; }');
  });

  test('control: Q5 item iv keeps the ordinary space between label and Urdu stem', () => {
    const m = urduHtml.match(/data-slot="g1\.urdu\.B\.Q5"><span class="n">(?:(?!<\/span>).)*iv\)(?:<\/bdi>)?<\/span>(.)/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(' ');
  });
});

describe('v25 item 2: G1 Urdu roman labels print "iv)", bracket on the outside', () => {
  test('Q4 (picture_only) labels are LTR-isolated roman labels', () => {
    expect(labelsOf(urduHtml, 'g1.urdu.B.Q4')).toEqual(ROMAN.map((r) => `<bdi class="ltr" dir="ltr">${r})</bdi>`));
  });

  test('Q5 (labels beside Urdu text) use the same isolated markup', () => {
    expect(labelsOf(urduHtml, 'g1.urdu.B.Q5')).toEqual(ROMAN.map((r) => `<bdi class="ltr" dir="ltr">${r})</bdi>`));
  });

  test('control: English roman labels stay bare, with no <bdi> in any label', () => {
    expect(englishHtml).toContain('<span class="n">i)</span>');
    expect(englishHtml).not.toMatch(/<span class="n"><bdi/);
  });

  test('control: an Urdu slot numbered "urdu" (۱۔) gets no <bdi> wrapper', () => {
    const exam = clone(urdu);
    exam._layout.sections.forEach((s) => s.slots.forEach((sl) => { if (sl.slot === 'g1.urdu.B.Q5') sl.numbering = 'urdu'; }));
    const labels = labelsOf(R.renderPaper({ examJson: exam, grade: 1, subject: 'urdu', answerLines: true }), 'g1.urdu.B.Q5');
    expect(labels.length).toBe(5);
    labels.forEach((l) => {
      expect(l).toContain('۔');
      expect(l).not.toContain('<bdi');
    });
  });
});

describe('v25 item 3: G2 English story order prints letters only, not letters and numbers', () => {
  const SLOT = 'g1.english.C.Q13';
  const SENTENCES = ['Finally, they ate the sweet cake together.', 'Hina and her mother wanted to bake a cake.',
    'First, they mixed flour and eggs in a bowl.', 'Next, they poured the mixture into a tin.',
    'Then, they put the tin in the oven.', 'Hina smiled when she smelled the cake.'];
  // Real v24 g2-english Q16 item: the model numbered the sentences itself.
  const STORY = {
    slot: SLOT, lines: 3, marks: 6, answer: '2, 3, 4, 5, 6, 1', blooms: 'Understand',
    scheme: { accept: ['2, 3, 4, 5, 6, 1'], checked: null,
      points: [2, 3, 4, 5, 6, 1].map((n) => ({ kind: 'K', text: `Sentence ${n} placed`, marks: 1 })) },
    question: 'Arrange the sentences to make a story.',
    questions: SENTENCES.map((s, i) => `${i + 1}. ${s}`),
  };
  function paper(item) {
    const exam = clone(english);
    exam._layout.sections.forEach((s) => s.slots.forEach((sl) => {
      if (sl.slot === SLOT) Object.assign(sl, { type: 'Story Order', generate: 1, attempt: 1, marks_each: 6, lines: 3 });
    }));
    Object.values(exam.unseen).forEach((c) => Object.keys(c).forEach((k) => {
      if (c[k][0] && c[k][0].slot === SLOT) c[k] = [clone(item)];
    }));
    return R.renderPaper({ examJson: exam, grade: 2, subject: 'english', answerLines: true });
  }

  test('model-written "1. " is dropped, so (a) and (f) lead straight into the sentence', () => {
    const html = paper(STORY);
    expect(html).toContain('<span class="n">(a)</span> Finally, they ate the sweet cake together.');
    expect(html).toContain('<span class="n">(f)</span> Hina smiled');
    expect(html).not.toMatch(/<span class="n">\([a-f]\)<\/span> \d\. /);
  });

  test('control: an un-numbered story renders the same lettered sentences today', () => {
    const html = paper({ ...STORY, questions: SENTENCES });
    expect(html).toContain('<span class="n">(a)</span> Finally, they ate the sweet cake together.');
  });

  test('control: a sub-question that opens with a number as content ("3.5 kg") is kept', () => {
    const html = paper({ ...STORY, questions: ['3.5 kg of rice was in the bag.', ...SENTENCES.slice(1)] });
    expect(html).toContain('<span class="n">(a)</span> 3.5 kg of rice was in the bag.');
  });

  test('the g2.english.C.Q16 prompt rule asks for un-numbered sentences', () => {
    const slot = Patterns.subjectOf('fde_g2_2026', 'english').sections.flatMap((s) => s.slots).find((s) => s.slot === 'g2.english.C.Q16');
    expect(slot.prompt_rule).not.toMatch(/numbered in "questions"/);
    expect(slot.prompt_rule).toMatch(/no number or letter/i);
  });
});
