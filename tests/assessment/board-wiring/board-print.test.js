/**
 * How a G9-12 board paper prints (bd-5jmnfj.38.25.3): Chromium's own footer carries "Page n of N" (the
 * in-body placeholder is gone), in the paper's medium, with its font embedded; the paper's total is the
 * sum of its sections' marks (halves and quarters kept).
 */
const Print = require('../../../bot/shared/services/assessment/board-render/print');
const { renderBoardPaper } = require('../../../bot/shared/services/assessment/assessment-paper-board.renderer');
const F = require('../board-render/_fixtures');

describe('pdfOptions', () => {
  test('English: A4, footer "Page n of N" from Chromium page counters, empty header', () => {
    const o = Print.pdfOptions(F.fbise50(), 'paper');
    expect(o.format).toBe('A4');
    expect(o.printBackground).toBe(true);
    expect(o.displayHeaderFooter).toBe(true);
    expect(o.headerTemplate).toBe('<span></span>');
    expect(o.footerTemplate).toContain('Page <span class="pageNumber"></span> of <span class="totalPages"></span>');
    expect(o.footerTemplate).not.toContain('dir="rtl"');
    expect(o.footerTemplate).not.toContain('Marking Scheme');
    expect(o.margin).toEqual({ top: '14mm', right: '14mm', bottom: '18mm', left: '14mm' });
    expect(o.footerTemplate).toContain(`<div style="width:100%;font-family:'PaperLatin';font-size:7.5pt;text-align:center;color:#333;padding:0 14mm">Page <span`);
  });

  test('no kind given → the paper footer', () => {
    expect(Print.pdfOptions(F.fbise50()).footerTemplate).toBe(Print.pdfOptions(F.fbise50(), 'paper').footerTemplate);
  });

  test('the scheme footer names the scheme', () => {
    expect(Print.pdfOptions(F.fbise50(), 'scheme').footerTemplate).toContain('Marking Scheme · Page <span class="pageNumber">');
  });

  test('Urdu: right to left, Urdu words, the Urdu font embedded in the footer, a taller bottom margin', () => {
    const o = Print.pdfOptions(F.urdu(), 'scheme');
    expect(o.footerTemplate).toContain('dir="rtl"');
    expect(o.footerTemplate).toContain('مارکنگ اسکیم · صفحہ <span class="pageNumber"></span> از <span class="totalPages"></span>');
    expect(o.footerTemplate).toContain(`<div dir="rtl" style="width:100%;font-family:'PaperUrdu';font-size:8.5pt;line-height:1.7;text-align:center;`);
    expect(o.footerTemplate).toMatch(/@font-face\{font-family:'PaperUrdu'/);
    expect(o.margin.bottom).toBe('22mm');
  });

  test('not a board paper → NO_LAYOUT, even when its layout is a printable FDE one', () => {
    expect(() => Print.pdfOptions({ _layout: { sections: [] } })).toThrow(expect.objectContaining({ code: 'NO_LAYOUT' }));
    const fde = F.fbise50();
    fde._layout.profile = 'fde';
    expect(() => Print.pdfOptions(fde, 'paper')).toThrow(expect.objectContaining({ code: 'NO_LAYOUT' }));
    expect(() => Print.totalMarks(fde)).toThrow(expect.objectContaining({ code: 'NO_LAYOUT' }));
  });
});

describe('totalMarks', () => {
  test('the sum of the sections, quarters kept', () => {
    const exam = F.fbise50();
    exam._layout.sections = [{ id: 'A', marks: 12.25 }, { id: 'B', marks: 37.5 }, { id: 'C', marks: 25.25 }];
    expect(Print.totalMarks(exam)).toBe(75);
    exam._layout.sections[2].marks = 25;
    expect(Print.totalMarks(exam)).toBe(74.75);
  });

  test('the real SSC-I physics paper totals its declared marks', () => {
    const exam = F.fbise50();
    const declared = exam._layout.sections.reduce((n, s) => n + s.marks, 0);
    expect(Print.totalMarks(exam)).toBe(declared);
    expect(declared).toBeGreaterThan(0);
  });
});

test('the paper HTML no longer prints the {n}/{N} placeholder: the PDF footer does', () => {
  expect(renderBoardPaper(F.fbise50())).not.toContain('{n}');
  expect(renderBoardPaper(F.urdu())).not.toContain('{N}');
});
