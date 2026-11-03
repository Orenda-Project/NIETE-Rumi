/**
 * bd-5jmnfj.4.51.2: the key's picture line. A rhyming item carries picture {name:'fan'} and the
 * question 'fan' (the word). The v23 key printed "Picture: fan. fan" -- the word twice, with a stray stop.
 */
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const english = require('./fixtures/early/g1-english-exam.json');

const SLOT = 'g1.english.B.Q6';
const WORDS = [['fan', 'man'], ['pig', 'wig'], ['log', 'fog'], ['hen', 'ten']];

function paper(question) {
  const exam = JSON.parse(JSON.stringify(english));
  let k = 0;
  Object.values(exam.unseen).forEach((c) => Object.keys(c).forEach((t) => {
    c[t].forEach((q) => {
      if (q.slot !== SLOT) return;
      const [name, answer] = WORDS[k++];
      Object.assign(q, { answer, picture: { kind: 'object', name }, question: question || name });
    });
  }));
  return exam;
}
const qLines = (html) => [...html.matchAll(/data-row="g1\.english\.B\.Q6"[\s\S]*?<div class="q-line">([\s\S]*?)<\/div>/g)]
  .map((m) => m[1].replace(/<[^>]+>/g, '').trim());

describe('bd-5jmnfj.4.51.2 the picture line names the picture once', () => {
  test('question equal to the picture word: "Picture: fan", no repeat, no stray full stop', () => {
    const lines = qLines(R.renderMarkingScheme({ examJson: paper(), grade: 1, subject: 'english', allowShort: true }));
    expect(lines).toHaveLength(4);
    lines.forEach((l, i) => {
      expect(l).toContain(`Picture: ${WORDS[i][0]}`);
      expect(l).not.toMatch(new RegExp(`${WORDS[i][0]}\\.\\s*${WORDS[i][0]}`));
      expect(l.split(WORDS[i][0]).length - 1).toBe(1);
    });
  });

  test('a question that says more than the picture word keeps both', () => {
    const lines = qLines(R.renderMarkingScheme({ examJson: paper('Rhyme with the word'), grade: 1, subject: 'english', allowShort: true }));
    expect(lines[0]).toBe('Picture: fan. Rhyme with the word');
  });
});
