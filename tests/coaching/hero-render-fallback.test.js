/**
 * Hero render → PDFKit fallback (Wave 3 PR β / β.5).
 *
 * If the hero pipeline throws (Chromium crash, narrative LLM fatal, font miss,
 * etc.), the renderer falls back to PDFKit so the teacher still receives a
 * report. Locked by 2 cases below.
 */

// Hoist-safe mock factory variables (prefix `mock` per Jest hoisting rule).
const mockHeroRender = jest.fn();
jest.mock('../../bot/shared/services/coaching/report-v2/hero-report.service', () => ({
  generateHeroReport: (...args) => mockHeroRender(...args),
}));

const mockPdfkitRender = jest.fn().mockResolvedValue(Buffer.from('PDFKIT-OUTPUT'));
jest.mock('../../bot/shared/services/pdf-report.service', () => ({
  _generatePDFKitReport: (...args) => mockPdfkitRender(...args),
  _generateMEWAKAReport: () => Buffer.from('mewaka-pdf'),
}));

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { getReportRenderer } = require('../../bot/shared/services/coaching/report-renderers/renderer-registry');

describe('Hero render → PDFKit fallback', () => {
  beforeEach(() => {
    mockHeroRender.mockReset();
    mockPdfkitRender.mockClear();
  });

  it('hero throws → PDFKit fallback runs and returns a Buffer', async () => {
    mockHeroRender.mockRejectedValue(new Error('chromium crashed'));
    const reportData = {
      framework: 'oecd',
      teacherName: 'A',
      observationDate: '2026-05-15',
      subject: 'Math',
      _heroInput: { session: {}, analysis: { framework: 'oecd' }, opts: {} },
    };
    const out = await getReportRenderer('oecd').render(reportData);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString()).toBe('PDFKIT-OUTPUT');
    expect(mockPdfkitRender).toHaveBeenCalledWith(reportData);
  });

  it('hero succeeds → PDFKit is NEVER called', async () => {
    mockHeroRender.mockResolvedValue({ png: Buffer.from('PNG'), caption: 'c' });
    const out = await getReportRenderer('oecd').render({
      framework: 'oecd',
      _heroInput: { session: {}, analysis: { framework: 'oecd' }, opts: {} },
    });
    expect(out).toEqual({ png: expect.any(Buffer), caption: 'c' });
    expect(mockPdfkitRender).not.toHaveBeenCalled();
  });
});
