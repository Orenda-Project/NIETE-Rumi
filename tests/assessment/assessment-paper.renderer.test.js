/**
 * The paper a teacher prints and hands to thirty children.
 *
 * Layout follows the one teachers already use — school name, a marking header
 * with Roll No and Obtained Marks, standing instructions, then the questions —
 * rather than the coloured web preview the old service emitted. A gradient
 * banner and emoji headings are fine on a screen and wrong on a photocopier.
 *
 * The model returns six shapes of question and each needs its own treatment. A
 * matching question rendered as a plain paragraph is not a matching question.
 */

const R = require('../../bot/shared/services/assessment/assessment-paper.renderer');

const HEAD = {
  grade: 1,
  subject: 'Eng',
  schoolName: 'GOVT. GIRLS PRIMARY SCHOOL, G-9',
  pageReference: '4-14',
  chapterTitle: 'Hello World!',
};

const one = (type, q, section = 'objective') =>
  ({ unseen: { [section]: { [type]: [q] } } });

describe('the header block', () => {
  it('carries the school, the class and the marking table', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('MCQs', { question: 'q', marks: 1 }) });
    expect(html).toContain('GOVT. GIRLS PRIMARY SCHOOL, G-9');
    expect(html).toContain('Grade 1');
    expect(html).toContain('English');
    for (const field of ['Student Name', 'Roll No', 'Date', 'Total Marks', 'Obtained Marks']) {
      expect(html).toContain(field);
    }
  });

  it('omits the school line cleanly when we do not know it', () => {
    const html = R.renderPaper({ ...HEAD, schoolName: null, examJson: one('MCQs', { question: 'q', marks: 1 }) });
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
    expect(html).toContain('Student Name');
  });

  it('totals the marks it actually rendered', () => {
    const html = R.renderPaper({
      ...HEAD,
      examJson: { unseen: { objective: { MCQs: [{ question: 'a', marks: 2 }, { question: 'b', marks: 3 }] } } },
    });
    expect(html).toMatch(/Total Marks[\s\S]{0,120}>5</);
  });

  it('prints the standing instructions', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('MCQs', { question: 'q', marks: 1 }) });
    expect(html).toMatch(/Read all questions carefully/i);
  });
});

describe('the six question shapes', () => {
  it('multiple choice lists its options', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('MCQs', {
      question: 'Which is a living thing?', options: ['(a) Rock', '(b) Plant'], marks: 1,
    }) });
    expect(html).toContain('Which is a living thing?');
    expect(html).toContain('(a) Rock');
    expect(html).toContain('(b) Plant');
  });

  it('matching renders two columns as a table, not a sentence', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('Match the Column', {
      question: 'Match each animal to its home.',
      column_a: ['Dog', 'Bird'], column_b: ['Kennel', 'Nest'], marks: 2,
    }) });
    expect(html).toMatch(/<table/);
    expect(html).toContain('Dog');
    expect(html).toContain('Kennel');
  });

  it('matching pads the shorter column rather than dropping a row', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('Match the Column', {
      question: 'Match.', column_a: ['Dog', 'Bird', 'Fish'], column_b: ['Kennel'], marks: 3,
    }) });
    expect(html).toContain('Bird');
    expect(html).toContain('Fish');
  });

  it('word lists render as a list', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('Word Meanings', {
      words: ['benevolent', 'arid'], marks: 2,
    }, 'subjective') });
    expect(html).toContain('benevolent');
    expect(html).toContain('arid');
  });

  it('comprehension sets the passage apart and letters its sub-questions', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('Comprehension Passage', {
      passage: 'Ali went to the market.\nHe bought apples.',
      questions: [{ question: 'Who went?', marks: 2 }, { question: 'What did he buy?', marks: 3 }],
      marks: 5,
    }, 'subjective') });
    expect(html).toContain('Ali went to the market.');
    expect(html).toContain('Who went?');
    expect(html).toMatch(/\ba\)/);
    expect(html).toMatch(/\bb\)/);
  });

  it('a passage on its own keeps its section label', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('Listening', {
      section: 'Listening', passage: 'Birds fly south in winter.', marks: 2,
    }, 'subjective') });
    expect(html).toContain('Birds fly south in winter.');
    expect(html).toContain('Listening');
  });

  it('a plain question is just a question', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('Short Questions', {
      question: 'Why do animals need air?', marks: 2,
    }, 'subjective') });
    expect(html).toContain('Why do animals need air?');
  });
});

describe('numbering and marks', () => {
  it('numbers continuously across types and sections', () => {
    const html = R.renderPaper({ ...HEAD, examJson: {
      seen: { objective: { MCQs: [{ question: 'first', marks: 1 }] } },
      unseen: {
        objective: { 'True/False': [{ question: 'second', marks: 1 }] },
        subjective: { 'Short Questions': [{ question: 'third', marks: 2 }] },
      },
    } });
    expect(html).toMatch(/1\.[\s\S]{0,80}first/);
    expect(html).toMatch(/2\.[\s\S]{0,80}second/);
    expect(html).toMatch(/3\.[\s\S]{0,80}third/);
  });

  it('does not print a catch-all bucket name as a section heading', () => {
    // The model's schema has an "Other" bucket and questions land in it fairly.
    // "OTHER" above a child's questions says nothing the lead does not.
    const html = R.renderPaper({ ...HEAD, examJson: {
      unseen: { subjective: { Other: [
        { main_question: 'Answer the following short questions', question: 'Why?', marks: 2 },
      ] } },
    } });
    expect(html).not.toMatch(/<h3 class="type">Other<\/h3>/i);
    expect(html).toContain('Answer the following short questions');
    expect(html).toContain('Why?');
  });

  it('still prints a real type name as a heading', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('Match the Column', {
      question: 'Match.', column_a: ['a'], column_b: ['b'], marks: 1,
    }) });
    expect(html).toContain('<h3 class="type">Match the Column</h3>');
  });

  it('says mark for one and marks for more', () => {
    const html = R.renderPaper({ ...HEAD, examJson: {
      unseen: { objective: { MCQs: [{ question: 'a', marks: 1 }, { question: 'b', marks: 4 }] } },
    } });
    expect(html).toContain('1 mark]');
    expect(html).toContain('4 marks]');
  });

  it('shows a shared instruction once, not above every question under it', () => {
    const html = R.renderPaper({ ...HEAD, examJson: {
      unseen: { objective: { 'True/False': [
        { main_question: 'Write True or False.', question: 'Water boils.', marks: 1 },
        { main_question: 'Write True or False.', question: 'The moon is a star.', marks: 1 },
      ] } },
    } });
    expect(html.match(/Write True or False\./g)).toHaveLength(1);
  });
});

describe('answer lines', () => {
  // The class is always DEFINED in the stylesheet; what varies is whether any
  // element uses it. Assert on the element, or the CSS answers for the paper.
  const ruled = (html) => (html.match(/<div class="answer-line">/g) || []).length;

  it('gives a written answer room to write in', () => {
    const html = R.renderPaper({ ...HEAD, answerLines: true, examJson: one('Short Questions', {
      question: 'Describe the water cycle.', marks: 4,
    }, 'subjective') });
    expect(ruled(html)).toBeGreaterThan(0);
  });

  it('gives multiple choice none — she marks the option', () => {
    const html = R.renderPaper({ ...HEAD, answerLines: true, examJson: one('MCQs', {
      question: 'Which is prime?', options: ['(a) 4', '(b) 7'], marks: 1,
    }) });
    expect(ruled(html)).toBe(0);
  });

  it('gives a younger hand a taller line to write on', () => {
    const q = one('Short Questions', { question: 'Describe it.', marks: 4 }, 'subjective');
    const mm = (html) => Number(html.match(/\.answer-line \{[^}]*height: ([\d.]+)mm/)[1]);
    // A Grade 1 hand writes about twice the height a Grade 5 hand does, and a
    // line it cannot fit between makes neat work look untidy.
    expect(mm(R.renderPaper({ ...HEAD, grade: 1, answerLines: true, examJson: q })))
      .toBeGreaterThan(mm(R.renderPaper({ ...HEAD, grade: 5, answerLines: true, examJson: q })));
  });

  it('omits them entirely when she turned them off', () => {
    const html = R.renderPaper({ ...HEAD, answerLines: false, examJson: one('Short Questions', {
      question: 'Describe the water cycle.', marks: 4,
    }, 'subjective') });
    expect(ruled(html)).toBe(0);
  });
});

describe('fonts — the tofu-box guard', () => {
  // The Chromium that prints this has NO system fonts. A stylesheet that merely
  // NAMES a Nastaliq face gets no glyphs and every Urdu character renders as an
  // empty box. bd-2664 shipped hundreds of unreadable Urdu reports that way.
  const q = one('MCQs', { question: 'یہ ایک سوال ہے', marks: 1 });

  it('embeds real font data rather than naming a font and hoping', () => {
    const html = R.renderPaper({ ...HEAD, subject: 'Urdu', examJson: q });
    expect(html).toMatch(/@font-face/);
    expect(html).toMatch(/src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{500}/);
  });

  it('embeds the Urdu face for an Urdu paper, not only the Latin one', () => {
    const html = R.renderPaper({ ...HEAD, subject: 'Urdu', examJson: q });
    expect(html).toContain("font-family:'PaperUrdu'");
    expect(html).toMatch(/font-family: 'PaperUrdu'/);
  });

  it('never names a font that only exists on someone\'s laptop', () => {
    const html = R.renderPaper({ ...HEAD, subject: 'Urdu', examJson: q });
    expect(html).not.toMatch(/Jameel Noori|Segoe UI/);
  });

  it('isolates marks so digits do not reorder the Urdu around them', () => {
    const html = R.renderPaper({ ...HEAD, subject: 'Urdu', examJson: q });
    expect(html).toMatch(/\.marks[^}]*unicode-bidi: isolate/);
  });
});

describe('language', () => {
  it('sets the paper right-to-left for an Urdu-medium subject', () => {
    const html = R.renderPaper({ ...HEAD, subject: 'Urdu', examJson: one('MCQs', { question: 'سوال', marks: 1 }) });
    expect(html).toMatch(/dir="rtl"/);
  });

  it('leaves an English paper left-to-right', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('MCQs', { question: 'q', marks: 1 }) });
    expect(html).not.toMatch(/dir="rtl"/);
  });
});

describe('safety of the text itself', () => {
  it('escapes markup in question text rather than rendering it', () => {
    const html = R.renderPaper({ ...HEAD, examJson: one('Short Questions', {
      question: 'What does <script>alert(1)</script> mean?', marks: 1,
    }, 'subjective') });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps the answer out unless it was asked for', () => {
    const withKey = R.renderPaper({ ...HEAD, includeAnswerKey: true,
      examJson: one('MCQs', { question: 'q', options: ['(a) x'], marks: 1, answer: '(a) x' }) });
    const without = R.renderPaper({ ...HEAD, includeAnswerKey: false,
      examJson: one('MCQs', { question: 'q', options: ['(a) x'], marks: 1, answer: '(a) x' }) });
    expect(withKey).toMatch(/Answer/);
    expect(without).not.toMatch(/Answer:/);
  });
});
