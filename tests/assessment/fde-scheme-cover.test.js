/**
 * bd-5jmnfj.4.50.5 — the marking scheme's cover and class record use the
 * paper's own words: the part names the paper prints, one bracket on the
 * "Covers" line, no file name, no "You add: nothing.", a spelling note only
 * on Maths and GK keys, and an oral column so written + oral has a total.
 */
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Cover = require('../../bot/shared/services/assessment/fde-scheme-cover');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const english = require('./fixtures/early/g1-english-exam.json');
const maths = require('./fixtures/early/g1-maths-exam.json');

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
const scheme = (exam, subject) => R.renderMarkingScheme({ examJson: exam, grade: 1, subject });
/** The class record's header cells, in order. */
function recordHead(html) {
  const rec = html.slice(html.indexOf('<section class="record"'));
  const row = rec.slice(rec.indexOf('<table class="rec">'), rec.indexOf('</tr>'));
  return [...row.matchAll(/<th>([\s\S]*?)<\/th>/g)].map((m) => visible(m[1]).trim());
}

describe('the cover of a topic-headed (Grade 1) scheme', () => {
  const html = scheme(english, 'english');
  const text = visible(html);

  it('the Covers line has one bracket and one full stop', () => {
    expect(text).toContain('Covers: The whole English book (pages 1-166). ');
    expect(text).not.toMatch(/\)\)|\.\)|\.\./);
  });

  it('tells the class the parts by the headings the paper prints, not Sections A, B and C', () => {
    expect(text).toContain('Tell the class: Reading, Writing (1) and Writing (2) on the question paper.');
    expect(text).not.toMatch(/Sections? A\b/);
  });

  it('prints no file name and no "You add: nothing." line', () => {
    expect(text).not.toMatch(/\.pdf|_FDE/);
    expect(text).toContain('This is the marking scheme for the question paper (');
    expect(text).not.toContain('You add');
  });

  it('the class record names each part as the paper does, adds the oral part, and totals both', () => {
    const head = recordHead(html);
    expect(head).toEqual(expect.arrayContaining(['Reading /24', 'Writing (1) /32', 'Writing (2) /28', 'Oral /16', 'Total /100']));
    expect(head).not.toContain('A /24');
    // Every row has a cell under every head.
    const rec = html.slice(html.indexOf('<table class="rec">'));
    const row = rec.slice(rec.indexOf('<tr class="rec-row">'), rec.indexOf('</tr>', rec.indexOf('<tr class="rec-row">')));
    expect((row.match(/<td/g) || []).length).toBe(head.length);
  });

  it('a paper with a small oral part still totals written + oral (Maths 45 + 5)', () => {
    const head = recordHead(scheme(maths, 'maths'));
    expect(head).toEqual(expect.arrayContaining(['Numbers and counting /25', 'Sums, shapes and measuring /20', 'Oral /5', 'Total /50']));
  });
});

describe('the spelling note is on Maths and GK keys only', () => {
  const line = (subject, lang) => Patterns.subjectOf('fde_g1_2026', subject).legend[`lines_${lang}`][0];

  it('an English or Urdu key says nothing about Maths or GK spelling', () => {
    for (const subject of ['english', 'urdu']) {
      expect(line(subject, 'en')).toBe('One mark per correct item unless the paper says otherwise.');
      expect(line(subject, 'en')).not.toMatch(/Maths|GK|Spelling/);
      expect(line(subject, 'ur')).not.toMatch(/ریاضی|املا/);
    }
  });

  it('a Maths or GK key keeps a spelling note that leaves room for a key that marks it', () => {
    for (const subject of ['maths', 'general_knowledge']) {
      expect(line(subject, 'en')).toBe('One mark per correct item unless the paper says otherwise. Spelling is not marked unless the key says so.');
      expect(line(subject, 'ur')).toMatch(/املا/);
    }
  });
});

describe('fde-scheme-cover helpers', () => {
  it('coversLine: label with the line in brackets; a line that brackets itself stands alone; a covers_* line wins', () => {
    const t = 'Covers: {scope}.';
    expect(Cover.coversLine({ label_en: 'FDE syllabus 2026–27', line_en: 'Units 1–10' }, t, 'en')).toBe('Covers: FDE syllabus 2026–27 (Units 1–10).');
    expect(Cover.coversLine({ label_en: 'Whole book', line_en: 'The whole English book (pages 1-166).' }, t, 'en')).toBe('Covers: The whole English book (pages 1-166).');
    expect(Cover.coversLine({ label_en: 'Whole book' }, t, 'en')).toBe('Covers: Whole book.');
    expect(Cover.coversLine({ covers_en: 'Covers: chapter 3.' }, t, 'en')).toBe('Covers: chapter 3.');
  });

  it('partName / joinParts: lettered sections keep "Section A", headed parts keep their heading', () => {
    const g5 = [{ id: 'A', label_en: 'SECTION - A' }, { id: 'B', label_en: 'Section-B' }, { id: 'C', label_en: 'Section-C' }];
    expect(Cover.joinParts(g5, 'en')).toBe('Sections A, B and C');
    expect(Cover.joinParts(g5.slice(0, 1), 'en')).toBe('Section A');
    expect(Cover.joinParts([{ id: 'A', label_en: 'Numbers and counting' }], 'en')).toBe('Numbers and counting');
    expect(Cover.joinParts([{ id: 'A', label_ur: 'حروف اور الفاظ' }, { id: 'B', label_ur: 'تحریر' }], 'ur')).toBe('حروف اور الفاظ اور تحریر');
    expect(Cover.partName({ id: 'A', label_ur: 'حصہ الف (معروضی)' }, 'ur')).toBe('حصہ الف');
  });

  it('recordColumns: no oral column when the paper has none', () => {
    const L = { sections: [{ id: 'A', label_en: 'Section A' }], oral: null };
    expect(Cover.recordColumns(L, 'en', () => 40)).toEqual([{ head: 'A', marks: 40 }]);
    expect(Cover.recordColumns({ ...L, oral: { marks: 40 } }, 'ur', () => 60)).toEqual([{ head: 'A', marks: 60 }, { head: 'زبانی', marks: 40 }]);
  });
});
