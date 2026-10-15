/**
 * The answer key says what each question is worth.
 *
 * A teacher marks forty copies from the key, and until now it held the answer but not the marks:
 * she had to keep the question paper open beside it to know that the word problem is worth five
 * and the MCQ one. The key now carries a fourth column with each question's marks, written the
 * way the paper writes them ("[5 marks]"), and every part of a comprehension passage carries its
 * own part marks beside its answer.
 *
 * On an Urdu key the table reads right to left. The marks are a Latin run inside it and are
 * isolated left-to-right, or "[2 marks]" prints as "[marks 2]" (the defect the paper already
 * fixed the same way).
 *
 * The paper itself does not change: its golden is unchanged by this.
 */

const fs = require('fs');
const path = require('path');

const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');

const exam = (subject) => JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'golden', `exam.${subject}.json`), 'utf8'));

/** The key's rows as [number, question, answer, marks] cell HTML. */
function keyRows(html) {
  const rows = [];
  const re = /<tr><td class="num">([^<]*)<\/td><td class="qt">([\s\S]*?)<\/td><td class="ans">([\s\S]*?)<\/td>(?:<td class="mk">([\s\S]*?)<\/td>)?<\/tr>/g;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(html))) rows.push({ n: m[1], q: m[2], a: m[3], mk: m[4] });
  return rows;
}

describe('renderAnswerKey: marks', () => {
  const html = Renderer.renderAnswerKey({ examJson: exam('maths'), grade: 5, subject: 'maths' });
  const rows = keyRows(html);

  test('key prints each question\'s marks', () => {
    const printed = Renderer.collectQuestions(exam('maths'));
    expect(rows).toHaveLength(printed.length);
    rows.forEach((row, i) => {
      const marks = Number(printed[i].question.marks);
      const label = `[${marks} ${marks === 1 ? 'mark' : 'marks'}]`;
      expect(row.mk).toBe(`<span class="marks">${label}</span>`);
    });
    expect(rows.find((r) => r.q.startsWith('A shop sold')).mk).toContain('[5 marks]');
    expect(rows.find((r) => r.q.startsWith('Match each shape')).mk).toContain('[4 marks]');
  });

  test('a type heading spans all four columns', () => {
    expect(html).toContain('<tr class="type"><td colspan="4">MCQs</td></tr>');
    expect(html).not.toContain('colspan="3"');
  });

  test('the four columns share the width and the marks never wrap', () => {
    expect(html).toMatch(/table\.key td\.mk \{[^}]*white-space: nowrap/);
  });

  test('a question that carries no marks gets an empty cell, never a 0', () => {
    const science = Renderer.renderAnswerKey({ examJson: exam('science'), grade: 5, subject: 'science' });
    const bare = keyRows(science).find((r) => r.q === 'Write one use of a magnet.');
    expect(bare.mk).toBe('');
  });

  test('a nested question is worth the sum of its parts, as the paper totals it', () => {
    const science = Renderer.renderAnswerKey({ examJson: exam('science'), grade: 5, subject: 'science' });
    const nested = keyRows(science).find((r) => r.q === 'Describe how a seed grows into a plant.');
    expect(nested.mk).toContain('[3 marks]');
  });
});

describe('renderAnswerKey: comprehension', () => {
  const html = Renderer.renderAnswerKey({ examJson: exam('urdu'), grade: 5, subject: 'urdu' });
  const rows = keyRows(html);

  test('comprehension parts print part marks', () => {
    const passage = rows.find((r) => r.a.includes('ایک بڑا درخت۔'));
    expect(passage.a).toContain('a)</b> ایک بڑا درخت۔ <span class="marks">[2 marks]</span>');
    expect(passage.a).toContain('b)</b> ب) کتابیں پڑھتے ہیں <span class="marks">[1 mark]</span>');
    // A part written as a bare string carries no marks and no answer: a dash, and no label.
    expect(passage.a).toMatch(/c\)<\/b> —<\/div>/);
    expect(passage.mk).toBe('<span class="marks">[3 marks]</span>');
  });

  test('an answer written once on the passage keeps the total in the marks column', () => {
    const whole = rows.find((r) => r.a.includes('صبح سویرے'));
    expect(whole.mk).toBe('<span class="marks">[2 marks]</span>');
  });

  test('RTL key isolates the part letters, so "c) —" never prints as "—(c"', () => {
    const passage = rows.find((r) => r.a.includes('ایک بڑا درخت۔'));
    expect(passage.a).toContain('<b class="num">a)</b>');
    expect(passage.a).toContain('<b class="num">c)</b> —');
    expect(passage.a).not.toMatch(/<b>[a-z]\)<\/b>/);
  });

  test('RTL key isolates marks', () => {
    expect(html).toContain('dir="rtl"');
    expect(html).toMatch(/\.num, \.marks \{ direction: ltr; unicode-bidi: isolate; \}/);
    const labels = html.match(/\[\d+ marks?\]/g) || [];
    const isolated = html.match(/<span class="marks">\[\d+ marks?\]<\/span>/g) || [];
    expect(labels.length).toBeGreaterThan(0);
    expect(isolated).toHaveLength(labels.length);
  });
});

describe('renderPaper is untouched', () => {
  test('the paper has no marks column', () => {
    const html = Renderer.renderPaper({ examJson: exam('maths'), grade: 5, subject: 'maths' });
    expect(html).not.toContain('class="mk"');
  });
});

describe('shared helpers for a second renderer', () => {
  test('exports fontFaces: the same embedded @font-face rules the paper uses', () => {
    expect(typeof Renderer.fontFaces).toBe('function');
    const faces = Renderer.fontFaces();
    expect(faces).toContain("@font-face{font-family:'PaperLatin'");
    expect(faces).toContain("@font-face{font-family:'PaperUrdu'");
    const paper = Renderer.renderPaper({ examJson: exam('maths'), grade: 5, subject: 'maths' });
    expect(paper).toContain(faces);
  });

  test('exports esc: model text is printed as text, never as markup', () => {
    expect(typeof Renderer.esc).toBe('function');
    expect(Renderer.esc('<b>"a" & b</b>')).toBe('&lt;b&gt;&quot;a&quot; &amp; b&lt;/b&gt;');
    expect(Renderer.esc(null)).toBe('');
  });
});
