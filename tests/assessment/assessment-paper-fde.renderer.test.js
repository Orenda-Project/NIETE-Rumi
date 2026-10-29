/**
 * The board-pattern paper and its marking scheme, as printed.
 *
 * A board rehearsal is only worth handing out if every printed count is true:
 * FDE's own lines with the arithmetic recomputed after a teacher removes a
 * question, a header total that is the pattern's 100 and not the sum of
 * whatever the model wrote, options laid out the way the board lays them out,
 * room to work in Section A and nowhere else, no picture the page does not
 * hold, and an Urdu paper whose numbers are Urdu digits read in the right
 * order. The marking scheme opens with what the teacher must do before the
 * exam and ends with a class record on its own page.
 *
 * Pure: HTML strings and PDF options, no browser.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const ID = 'fde_g5_2027';
const P = Patterns.get(ID);
const NOW = '2026-10-20T07:12:00.000Z';

function items(n, slot, make) {
  return Array.from({ length: n }, (_, i) => ({ slot, ...make(i) }));
}

const mcq = (i) => ({ question: `Pick option ${i + 1}`, options: ['red', 'blue', 'green', 'pink'], answer: 'b', blooms: 'Remember' });
const solve = (i) => ({ question: `Find the sum of ${i + 2} and 3.`, answer: String(i + 5), blooms: 'Understand',
  scheme: { points: [{ text: 'adds', marks: 1, kind: 'M' }, { text: String(i + 5), marks: 1, kind: 'A' }] } });
const problem = (i) => ({ question: `A shop sells ${i + 2} pens. Find the cost.`, answer: `Rs. ${(i + 2) * 10}`, blooms: 'Apply',
  scheme: { points: [{ text: 'a correct method', marks: 3, kind: 'M' }, { text: `Rs. ${(i + 2) * 10}`, marks: 2, kind: 'A' }] } });

// A full Maths paper, laid out the way the engine will lay it out.
function mathsPaper({ mutate } = {}) {
  const raw = { unseen: {
    objective: { MCQs: items(20, 'maths.A.Q1a', mcq) },
    subjective: {
      'Short Questions': [...items(9, 'maths.A.Q1b', solve),
        { slot: 'maths.A.Q1b', question: 'Draw an angle of 120° with a protractor.', answer: 'An angle of 120°.', blooms: 'Apply',
          scheme: { points: [{ text: 'arms from one vertex', marks: 1, kind: 'L' }, { text: '120° within 2°', marks: 1, kind: 'A' }] } }],
      'Word Problems': [...items(10, 'maths.B.Q2', problem),
        { slot: 'maths.B.Q2', question: 'Subtract: 8 2/5 − 3 3/4', answer: '4 13/20', blooms: 'Understand',
          scheme: { points: [{ text: 'improper fractions', marks: 2, kind: 'M' }, { text: 'common denominator', marks: 1, kind: 'M' }, { text: '4 13/20', marks: 2, kind: 'A' }] } },
        { slot: 'maths.B.Q2', question: 'Divide 52.8 by 1.2.', answer: '44.5', blooms: 'Understand',
          scheme: { points: [{ text: 'both made whole', marks: 3, kind: 'M' }, { text: '44.5', marks: 2, kind: 'A' }] } }],
      'Graphs & Geometric Problems': [
        { slot: 'maths.C.Q3', question: 'The table shows books read in one week. Draw a bar graph to represent the given data.',
          table: { headers: ['Day', 'Books read'], rows: [['Monday', '12'], ['Tuesday', '18'], ['Wednesday', '9'], ['Thursday', '15'], ['Friday', '21']] },
          answer: 'A bar graph with five bars.', blooms: 'Apply',
          scheme: { points: [{ text: 'title', marks: 1, kind: 'K' }, { text: 'axes', marks: 1, kind: 'L' }, { text: 'scale', marks: 1, kind: 'K' }, { text: 'bars', marks: 2, kind: 'A' }] } },
        ...items(5, 'maths.C.Q4-8', (i) => ({ question: `Geometry question ${i + 1}.`, answer: `${i + 60}°`, blooms: 'Apply',
          scheme: { points: [{ text: 'method', marks: 3, kind: 'M' }, { text: `${i + 60}°`, marks: 2, kind: 'A' }] } })),
      ],
    } } };
  if (mutate) mutate(raw);
  let exam = applyLayout(raw, P.subjects.maths, { kind: 'fde' }, { now: NOW }).examJson;
  exam = normaliseScheme(exam).examJson;
  exam = mathsCheck(exam).examJson;
  return exam;
}

function remove(exam, slot, n) {
  let left = n;
  for (const types of Object.values(exam.unseen)) {
    for (const list of Object.values(types)) {
      list.forEach((q) => { if (left > 0 && q.slot === slot && !q.removed) { q.removed = true; left -= 1; } });
    }
  }
  return exam;
}

// Text a reader sees: tags stripped, entities decoded.
function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

function paperHtml(exam, subject = 'maths') {
  return R.renderPaper({ examJson: exam, grade: 5, subject, answerLines: true });
}

describe('the board-pattern paper', () => {
  it("prints FDE's choice line verbatim and (8×5=40)", () => {
    const text = visible(paperHtml(mathsPaper()));
    expect(text).toContain('Attempt any eight questions. All questions carry equal marks.');
    expect(text).toContain('(8×5=40)');
    expect(text).toContain('Marks: (2×10=20)');
    expect(text).toContain('Note: Q3 is compulsory. Attempt any three from the remaining questions. All questions carry 5 marks each. (4 × 5 = 20)');
    expect(text).toContain('Time Allowed: 1 Hr.');
    expect(text).toContain('SECTION - A');
    expect(text).toContain('Total Marks: 40');
  });

  it('header Total Marks is 100 not 130', () => {
    // The model wrote 9 marks on every item; the pattern decides.
    const exam = mathsPaper({ mutate: (raw) => { for (const t of Object.values(raw.unseen)) for (const l of Object.values(t)) l.forEach((q) => { q.marks = 9; }); } });
    const text = visible(paperHtml(exam));
    expect(text).toContain('Time Allowed: 3 Hrs.');
    expect(text).toContain('Total Marks: 100');
    expect(text).not.toMatch(/Total Marks: (130|432)/);
    expect(R.totalMarks(exam)).toBe(100);
  });

  it('Section A items carry a working box, Section B none', () => {
    const html = paperHtml(mathsPaper());
    const a = html.slice(html.indexOf('data-section="A"'), html.indexOf('data-section="B"'));
    const b = html.slice(html.indexOf('data-section="B"'), html.indexOf('data-section="C"'));
    expect((a.match(/class="work-box"/g) || []).length).toBe(9);
    expect((a.match(/class="work-square"/g) || []).length).toBe(1);
    expect(b).not.toMatch(/work-box|work-square|answer-line/);
  });

  it('Q1(a) numbered i…xx', () => {
    const html = paperHtml(mathsPaper());
    const nums = [...html.matchAll(/data-slot="maths\.A\.Q1a"[^>]*><span class="n">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(nums[0]).toBe('i)');
    expect(nums[19]).toBe('xx)');
    expect(nums).toHaveLength(20);
  });

  it('options four across; 2×2 when one is long', () => {
    const exam = mathsPaper({ mutate: (raw) => { raw.unseen.objective.MCQs[1].options = ['a very long option text here', 'b', 'c', 'd']; } });
    const html = paperHtml(exam);
    expect((html.match(/class="opts four"/g) || []).length).toBe(19);
    expect((html.match(/class="opts two"/g) || []).length).toBe(1);
    expect(html).toContain('(a)');
  });

  it('strips a model-written "a) " from an option before printing its own label', () => {
    const exam = mathsPaper({ mutate: (raw) => { raw.unseen.objective.MCQs[0].options = ['a) 6', 'b) 60', 'c) 600', 'd) 6,000']; } });
    const text = visible(paperHtml(exam));
    expect(text).toContain('(a) 6 (b) 60');
    expect(text).not.toContain('(a) a) 6');
  });

  it("a frame slot prints the frame and never 'look at the picture'", () => {
    const exam = applyLayout({ unseen: { subjective: { 'Label the Diagram': [{ slot: 'science.A.Q1b', question: 'Layers of the Earth', answer: 'crust, mantle, outer core, inner core, surface', book_page: 168 }] } } },
      P.subjects.science, { kind: 'fde' }, { now: NOW }).examJson;
    const html = R.renderPaper({ examJson: exam, grade: 5, subject: 'science', answerLines: true, allowShort: true });
    expect(html).toMatch(/class="frame"[^>]*id="fde-frame-science\.A\.Q1b"/);
    expect(html).toContain('style="height:70mm"');
    expect(visible(html)).toContain('Layers of the Earth');
    expect(visible(html)).not.toMatch(/look at the (picture|figure)/i);
  });

  it("removing one Q2 item prints 'eleven' and keeps (8×5=40)", () => {
    const text = visible(paperHtml(remove(mathsPaper(), 'maths.B.Q2', 1)));
    expect(text).toContain('Attempt any eight of the following eleven questions. All questions carry equal marks.');
    expect(text).toContain('(8×5=40)');
    expect(text).toContain('Total Marks: 100');
  });

  it('removing five prints (7×5=35) and total 95', () => {
    const exam = remove(mathsPaper(), 'maths.B.Q2', 5);
    const text = visible(paperHtml(exam));
    expect(text).toContain('Attempt any seven questions. All questions carry equal marks.');
    expect(text).toContain('(7×5=35)');
    expect(text).toContain('Section-B (35 marks)');
    expect(text).toContain('Total Marks: 95');
    expect(R.totalMarks(exam)).toBe(95);
  });

  it('a table prints its header row', () => {
    const html = paperHtml(mathsPaper());
    expect(html).toMatch(/<table class="data"><tr><th>Day<\/th><th>Books read<\/th><\/tr><tr><td>Monday<\/td><td>12<\/td><\/tr>/);
  });

  it('8 2/5 is typeset as a stacked fraction with no slash glyph between the parts', () => {
    const html = paperHtml(mathsPaper());
    expect(html).toContain('8<span class="frac"><sup>2</sup><sub>5</sub></span>');
    expect(html).not.toContain('⁄');
  });

  it('symbols the embedded fonts lack print as drawings, never as a fallback glyph', () => {
    // Lexend and Noto Nastaliq have no arrows, ticks, ≤ ≥ ≠ ≈ or ∠; the printing container has no other font.
    const exam = mathsPaper({ mutate: (raw) => { raw.unseen.subjective['Word Problems'][0].question = 'grass → goat → lion; 3 ≤ 4; ∠ABC ≠ 90° ✓'; } });
    const html = paperHtml(exam);
    const body = html.slice(html.indexOf('<body'));
    expect((body.match(/<svg class="sym"/g) || []).length).toBe(6);
    expect(visible(body)).not.toMatch(/[→≤∠≠✓]/);
  });

  it('vulgar fractions are typeset like a/b (Lexend has no ⅓ glyph)', () => {
    const exam = mathsPaper({ mutate: (raw) => { raw.unseen.subjective['Word Problems'][0].question = 'Subtract: 7⅓ − 3⅕'; } });
    const html = paperHtml(exam);
    expect(html).toContain('7<span class="frac"><sup>1</sup><sub>3</sub></span>');
    expect(html).toContain('3<span class="frac"><sup>1</sup><sub>5</sub></span>');
    expect(visible(html)).not.toMatch(/[⅓⅕]/);
  });

  it('the key prints no checked badge and no tick glyph (bd-5jmnfj.4.51.6)', () => {
    const html = R.renderMarkingScheme({ examJson: mathsPaper(), grade: 5, subject: 'maths' });
    expect(html).not.toContain('class="chip checked"');
    expect(visible(html.slice(html.indexOf('<body')))).not.toContain('✓');
  });

  it('the school line is blank and there is no letterhead', () => {
    const text = visible(paperHtml(mathsPaper()));
    expect(text).toContain('School: ____________');
    expect(text).not.toMatch(/MODEL PAPER FOR|Federal Directorate/i);
    expect(text).not.toMatch(/official/i); // bd-5jmnfj.4.26
  });

  it('counts printed per slot equal generate', () => {
    const html = paperHtml(mathsPaper());
    for (const slot of P.subjects.maths.sections.flatMap((s) => s.slots)) {
      const n = (html.match(new RegExp(`data-slot="${slot.slot.replace(/\./g, '\\.')}"`, 'g')) || []).length;
      expect({ slot: slot.slot, n }).toEqual({ slot: slot.slot, n: slot.generate });
    }
  });

  it('never types a page total into the HTML', () => {
    const html = paperHtml(mathsPaper());
    expect(visible(html)).not.toMatch(/Page \d+ of \d+/);
  });

  it('renderer throws on review/filler text', () => {
    // Item text: the English markers only. «مسودہ» / «اسی طرح» in item text are real Urdu (fde-r7-render.test.js).
    for (const bad of ['needs review', 'filler', '⚠', 'Islamabad Model School', 'MODEL PAPER FOR']) {
      const exam = mathsPaper({ mutate: (raw) => { raw.unseen.objective.MCQs[3].question = `x ${bad} y`; } });
      expect(() => paperHtml(exam)).toThrow(/REVIEW_TEXT/);
      expect(() => R.renderMarkingScheme({ examJson: exam, grade: 5, subject: 'maths' })).toThrow(/REVIEW_TEXT/);
    }
  });

  it('throws PATTERN_SHORT_SLOT when a slot holds fewer items than it must answer', () => {
    const exam = mathsPaper({ mutate: (raw) => { raw.unseen.subjective['Word Problems'] = raw.unseen.subjective['Word Problems'].slice(0, 7); } });
    expect(() => paperHtml(exam)).toThrow(/PATTERN_SHORT_SLOT/);
  });

  it('refuses a paper without _layout (that is the old renderer\'s job)', () => {
    expect(() => R.renderPaper({ examJson: { unseen: {} }, grade: 5, subject: 'maths' })).toThrow(/NO_LAYOUT/);
  });
});

describe('choiceLine', () => {
  const q2 = P.subjects.maths.sections[1].slots[0];
  it('unremoved: the data line with the atoms stripped', () => {
    expect(R.choiceLine(q2, 12, 'en')).toEqual({
      instruction: 'Attempt any eight questions. All questions carry equal marks.',
      marksLine: '(8×5=40)',
      text: 'Attempt any eight questions. All questions carry equal marks. (8×5=40)',
    });
  });

  it('every FDE line in the pattern renders verbatim when nothing is removed', () => {
    for (const S of Object.values(P.subjects)) {
      for (const slot of S.sections.flatMap((s) => s.slots)) {
        const lang = S.medium;
        const strip = (s) => (s == null ? null : String(s).replace(/\{[wntg]:([^}]*)\}/g, '$1').replace(/\{q\}/g, '{q}'));
        const out = R.choiceLine(slot, slot.generate, lang);
        expect({ slot: slot.slot, i: out.instruction }).toEqual({ slot: slot.slot, i: strip(slot[`instruction_${lang}`]) });
        expect({ slot: slot.slot, m: out.marksLine }).toEqual({ slot: slot.slot, m: strip(slot[`marks_line_${lang}`]) });
      }
    }
  });

  it('upper-case word atoms stay upper case', () => {
    const q2b = P.subjects.science.sections[1].slots[1];
    expect(R.choiceLine(q2b, 1, 'en').instruction).toBe('Read and attempt any ONE of the following given situations carefully.');
    expect(R.choiceLine(q2b, 1, 'en').marksLine).toBe('(1 × 5 = 5)');
  });

  it('"of the following" already in the line takes the count after it', () => {
    const q3a = P.subjects.science.sections[2].slots[0];
    expect(R.choiceLine(q3a, 9, 'en').instruction).toBe('Answer any eight of the following nine questions briefly.');
  });

  it('urdu: the word atom is an Urdu number word and the removal phrase follows it', () => {
    const q5 = P.subjects.social_studies.sections[2].slots[0];
    expect(R.choiceLine(q5, 9, 'ur').instruction).toBe('دیے گئے سوالات میں سے کوئی سے چھ کے مختصر جواب لکھیں۔');
    expect(R.choiceLine(q5, 8, 'ur').instruction).toBe('دیے گئے سوالات میں سے کوئی سے چھ (دیے گئے 8 میں سے) کے مختصر جواب لکھیں۔');
    expect(R.choiceLine(q5, 5, 'ur').instruction).toBe('دیے گئے سوالات میں سے کوئی سے پانچ کے مختصر جواب لکھیں۔');
  });
});

describe('the Urdu paper', () => {
  function urduPaper() {
    const raw = { unseen: {
      objective: { MCQs: items(20, 'urdu.A.Q1', (i) => ({ question: `سوال ${i + 1} کا جواب کیا ہے؟`, options: ['ایک', 'دو', 'تین', 'چار'], answer: 'ب' })) },
      subjective: {
        'Comprehension Passage': [{ slot: 'urdu.B.Q2', passage: 'احمد اور سارہ ایک باغ میں گئے۔ وہاں 5 بڑے درخت تھے۔ ہوا نرم تھی۔',
          parts: [{ key: 'questions', questions: items(5, 'x', (i) => ({ question: `سوال ${i + 1}؟`, answer: 'جواب' })) },
            { key: 'pick', pick: { 'اسم معرفہ': ['احمد', 'سارہ'], 'اسم نکرہ': ['باغ', 'درخت'], 'اسم صفت': ['بڑے', 'نرم'], 'فعل': ['گئے', 'تھے'] } },
            { key: 'antonyms', antonyms: [['بڑے', 'چھوٹے'], ['نرم', 'سخت']] }] }],
        'Word Meanings': items(1, 'urdu.C.Q3', () => ({ words: ['سانحہ', 'شاطر', 'بوسیدہ', 'ہول ناک', 'کڑا', 'اعانت', 'تعیناتی'], answer: 'معنی' })),
        'Rewrite Sentences': items(4, 'urdu.C.Q4', (i) => ({ question: `ہدایت ${i + 1}`, answer: 'جواب' })),
        'Word Sentences': items(1, 'urdu.C.Q5', () => ({ words: ['باغ', 'پانی', 'شام', 'دوست', 'آگ بگولا ہونا', 'آنکھ کا تارا', 'ہاتھ بٹانا'], answer: 'جملے' })),
        'Poem Explanation': items(1, 'urdu.C.Q6', () => ({ question: 'درج ذیل اشعار کا مفہوم واضح کریں۔', passage: 'سطر ایک\nسطر دو\nسطر تین\nسطر چار', answer: 'مفہوم' })), // needs fluent-Urdu review (four lines: Q6 prints four verses)
        'Picture Description': items(1, 'urdu.C.Q7', () => ({ question: 'باغ کی سیر', words: ['باغ', 'بچے', 'پھول'], answer: 'تصویر' })),
        'Paragraph Writing': items(2, 'urdu.C.Q8', (i) => ({ question: i ? 'دو دوستوں کے درمیان صفائی پر مکالمہ تحریر کریں۔' : 'میرا وطن', answer: 'خاکہ' })),
        'Story Writing': items(2, 'urdu.C.Q9', (i) => ({ question: i ? 'ایک دن…' : '"اتفاق میں برکت ہے"', answer: 'کہانی' })),
        'Letter Writing': items(2, 'urdu.C.Q10', (i) => ({ question: i ? 'فیس معافی کی درخواست لکھیں۔' : 'اپنے دوست کے نام خط لکھیں۔', answer: 'خط' })),
      } } };
    return applyLayout(raw, P.subjects.urdu, { kind: 'fde' }, { now: NOW }).examJson;
  }

  it('Urdu paper: dir=rtl, every numeric atom isolated, no ASCII digit in prose', () => {
    const html = R.renderPaper({ examJson: urduPaper(), grade: 5, subject: 'urdu', answerLines: true });
    expect(html).toMatch(/<html[^>]*dir="rtl"/);
    const body = html.slice(html.indexOf('<body'));
    // Machine atoms (the grade band line) are the only ASCII digits allowed.
    const prose = body.replace(/<span class="ascii"[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, ' ');
    expect(prose).not.toMatch(/[0-9]/);
    expect(body).toContain('<span class="num">۲۰</span>');
    expect(visible(html)).toContain('حصہ الف معروضی');
    expect(visible(html)).toContain('نام طالب علم');
    expect(visible(html)).not.toMatch(/[۰-۹]\s*·|·\s*[۰-۹]/);
  });

  it('urdu Q6 prints only the lesson-7 lines, with no Naat and no OR (bd-5jmnfj.4.51.11)', () => {
    const text = visible(R.renderPaper({ examJson: urduPaper(), grade: 5, subject: 'urdu', answerLines: true }));
    expect(text).toContain('درج ذیل اشعار کا مفہوم واضح کریں۔ سطر ایک');
    expect(text).not.toContain('نعت');
  });

  it('Urdu footer template has Urdu digits', () => {
    const exam = urduPaper();
    const opts = R.pdfOptions(exam, 'paper');
    expect(opts).toEqual(expect.objectContaining({ format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>' }));
    expect(opts.footerTemplate).toMatch(/font-family:'FdeUrduDigits'/);
    expect(opts.footerTemplate).toMatch(/class="pageNumber"/);
    expect(opts.footerTemplate).toMatch(/class="totalPages"/);
    expect(opts.footerTemplate).not.toContain('سرکاری'); // bd-5jmnfj.4.26
    // A footer font loads only when the page declares the same face: every face in the footer is in the page.
    const html = R.renderPaper({ examJson: exam, grade: 5, subject: 'urdu', answerLines: true });
    const faces = opts.footerTemplate.match(/@font-face\{[^}]*\}/g);
    expect(faces.length).toBeGreaterThanOrEqual(2);
    faces.forEach((f) => expect(html).toContain(f));
    expect(opts.footerTemplate).not.toMatch(/>\s*\d+\s*</);
  });

  it('the English footer names the page atoms and is not typed', () => {
    const opts = R.pdfOptions(mathsPaper(), 'scheme');
    expect(opts.footerTemplate).toMatch(/Page <span class="pageNumber"><\/span> of <span class="totalPages"><\/span>/);
    expect(opts.footerTemplate).not.toMatch(/official/i); // bd-5jmnfj.4.26
    expect(opts.margin).toEqual({ top: '12mm', right: '12mm', bottom: '18mm', left: '12mm' });
  });

  it('toUrduDigits maps every ASCII digit', () => {
    expect(R.toUrduDigits('Q 10, 2.5 × 4')).toBe('Q ۱۰, ۲.۵ × ۴');
  });
});

describe('the marking scheme', () => {
  function scheme(exam, extra = {}) {
    return R.renderMarkingScheme({ examJson: exam, grade: 5, subject: 'maths', ...extra });
  }

  it('scheme prints the band, the box with the page count (no file name), the six legend lines', () => {
    const exam = mathsPaper();
    exam._layout.pages = { paper: 4, scheme: 5 };
    const text = visible(scheme(exam));
    expect(text).toContain("TEACHER'S COPY · Do not give to children");
    expect(text).toContain('MARKING SCHEME');
    expect(text).toContain('Teacher: before the exam');
    expect(text).toContain('This is the marking scheme for the question paper (4 pages). Do not give it to children.');
    expect(text).toContain('Photocopy the question paper, all 4 pages, one per child.');
    expect(text).not.toContain('You add');
    expect(text).toContain('Q2: attempt any 8 of 12');
    expect(text).toContain('Time: 3 hrs.');
    for (const line of P.subjects.maths.legend.lines_en) expect(text).toContain(line);
  });

  it('an unknown page count says so instead of guessing', () => {
    const text = visible(scheme(mathsPaper()));
    expect(text).toContain('This is the marking scheme for the question paper. Do not give it to children.');
    expect(text).not.toMatch(/\(\s*pages\)|null pages|undefined/);
  });

  it('the MCQ strip, no checked badge on an ok row, and the notes block', () => {
    const html = scheme(mathsPaper());
    const text = visible(html);
    // The layout spreads MCQ keys over the letters, so the strip is no longer all (b).
    expect(text).toMatch(/Q1 \(a\) i [a-d] · ii [a-d] · iii [a-d]/);
    expect(html).not.toContain('class="chip checked"');
    expect(text).toContain('Notes');
    expect(text).toContain('Q2 (xii): key corrected by code; the model wrote 44.5.');
    expect(text).not.toMatch(/⚠/);
  });

  it('every written row prints the answer first and its marks as chips', () => {
    const html = scheme(mathsPaper());
    expect(html).toMatch(/<td class="ans"><b>Rs\. 20<\/b>/);
    expect(html).toMatch(/<span class="chip">M3<\/span> a correct method/);
  });

  it('scheme rows equal paper items after a removal', () => {
    const exam = remove(mathsPaper(), 'maths.B.Q2', 2);
    const html = scheme(exam);
    expect((html.match(/data-row="maths\.B\.Q2"/g) || []).length).toBe(10);
    expect(visible(html)).toContain('Q2: attempt any 8 of 10');
  });

  it('a 40-row record on its own page', () => {
    const html = scheme(mathsPaper());
    const rec = html.slice(html.indexOf('class="record"'));
    expect(html).toMatch(/<section class="record" style="break-before:page">/);
    expect((rec.match(/<tr class="rec-row">/g) || []).length).toBe(40);
    expect(visible(rec)).toContain('A /40');
    expect(visible(rec)).toContain('Total /100');
  });

  it('criteria for Q7 summing to 10 (composition rows come from code)', () => {
    const raw = { unseen: { subjective: { 'Application Writing': [
      { slot: 'english.C.Q7', question: 'Write an application to your principal for sick leave.', answer: 'outline' },
      { slot: 'english.C.Q7', question: 'Write a letter to your friend about your favourite book.', answer: 'outline' }] } } };
    const exam = applyLayout(raw, P.subjects.english, { kind: 'fde' }, { now: NOW }).examJson;
    const html = R.renderMarkingScheme({ examJson: exam, grade: 5, subject: 'english', allowShort: true });
    const box = html.slice(html.indexOf('data-row="english.C.Q7"'));
    const marks = [...box.slice(0, box.indexOf('</tr>')).matchAll(/<span class="crit-m">([\d.]+)<\/span>/g)].map((m) => Number(m[1]));
    expect(marks.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('scheme sections flow: none is forced onto a new page (no half-blank pages); the record always is', () => {
    const html = scheme(mathsPaper());
    expect((html.match(/<section class="s-sec"/g) || []).length).toBe(3);
    expect(html).not.toMatch(/<section class="s-sec"[^>]*break-before/);
    expect(html).toMatch(/<section class="record" style="break-before:page">/);
  });

  it('the class record fits one A4 page: two tables of 20 rows side by side, rows 9 mm', () => {
    const html = scheme(mathsPaper());
    const rec = html.slice(html.indexOf('class="record"'));
    expect((rec.match(/<table class="rec"/g) || []).length).toBe(2);
    expect(html).toMatch(/table\.rec th, table\.rec td \{[^}]*height: 9mm/);
    expect(visible(rec)).toMatch(/\b20\b[\s\S]*\b21\b[\s\S]*\b40\b/);
  });

  it('a long question stem in the scheme is cut at a word, not mid-word', () => {
    // The key column repeats up to 200 characters of a stem (bd-5jmnfj.4.58.3), so this one runs to 246.
    const exam = mathsPaper({ mutate: (raw) => { raw.unseen.subjective['Word Problems'][0].question = 'A school had Rs. 750,000 for the year. It spent Rs. 286,450 on furniture, Rs. 135,800 on books and Rs. 92,300 on sports kit for the junior classes, then set aside Rs. 50,000 for repairs to the library roof. How much money is left over at the end?'; } });
    const text = visible(scheme(exam));
    expect(text).toContain('Rs. 50,000 for repairs to the…');
    expect(text).not.toMatch(/to the l…/);
  });

  it('framePages is exported for the engine', () => {
    expect(typeof R.framePages).toBe('function');
  });
});
