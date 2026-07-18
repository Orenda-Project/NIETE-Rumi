/**
 * FEAT-098: Report Delivery Shape Dispatch
 *
 * Locks the two-shape return contract from PDFReportService.generateClassroomObservationReport
 * and the corresponding delivery-path branching inside ReportGeneratorService:
 *
 *   { png, caption }  (hero renderer, e.g. FICO)  → WhatsAppService.sendImage    (image + caption)
 *   Buffer            (PDFKit / HTML renderers)   → WhatsAppService.sendDocument (PDF file)
 *
 * The bug being locked out:
 *   Previously the caller flattened the hero return into a bare `pdfBuffer`
 *   named variable and always sent it via sendDocument as application/pdf.
 *   WhatsApp delivered a "PDF" that was actually PNG bytes → every PDF reader
 *   rejected it as corrupt. This test would have caught that on introduction.
 */

// Mock logger
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
}));

// Mock WhatsAppService via __mocks__ folder
jest.mock('../../bot/shared/services/whatsapp.service');

// Mock TEMP_DIR to a Jest-safe path
jest.mock('../../bot/shared/utils/constants', () => ({
  TEMP_DIR: '/tmp/rumi-test-report-delivery',
}));

// Mock R2 upload so no network
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadReportPDF: jest.fn().mockResolvedValue('https://r2.example/report.pdf'),
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.mp3'),
}));

// Mock supabase — call chains used by sendPDFReport / sendHeroImageReport paths
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  return { from: jest.fn(() => chain) };
});

// Mock the coaching messages / features so we don't chase down copy
jest.mock('../../bot/shared/config/coaching-messages', () => ({
  getCoachingMessage: jest.fn(() => 'mock message'),
}));

const path = require('path');
const fs = require('fs');

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const ReportGeneratorService = require(
  '../../bot/shared/services/coaching/report-generator.service'
);

describe('FEAT-098: report delivery branches on generatePDFReport return shape', () => {
  beforeEach(() => {
    WhatsAppService._resetAllMocks();
    // sendImage returns TRUTHY on success (the real impl returns `true`);
    // sendHeroImageReport treats a falsy return as failure and throws.
    WhatsAppService.sendImage.mockResolvedValue(true);
    WhatsAppService.sendDocument.mockResolvedValue({ success: true });
  });

  describe('sendHeroImageReport (hero renderer path)', () => {
    test('writes PNG to a .png temp file and calls WhatsAppService.sendImage with the caption', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG magic
      const caption = 'Report caption from hero renderer';

      await ReportGeneratorService.sendHeroImageReport(
        '923016669553',
        'session-uuid-hero',
        png,
        caption,
        'Aisha',
        '2026-07-17T09:00:00Z'
      );

      // sendImage called exactly once
      expect(WhatsAppService.sendImage).toHaveBeenCalledTimes(1);
      const [to, filePath, captionArg] = WhatsAppService.sendImage.mock.calls[0];
      expect(to).toBe('923016669553');
      expect(captionArg).toBe(caption);

      // temp file path must end in .png so WhatsAppService.sendImage's
      // extension-based Content-Type detection tags it as image/png (not jpeg)
      expect(filePath.endsWith('.png')).toBe(true);

      // sendDocument must NOT be called — that would be the old corrupt-PDF path
      expect(WhatsAppService.sendDocument).not.toHaveBeenCalled();
    });

    test('cleans up the temp file after send', async () => {
      let capturedPath = null;
      WhatsAppService.sendImage.mockImplementation(async (_to, filePath) => {
        capturedPath = filePath;
        // File should exist WHILE sendImage runs
        expect(fs.existsSync(filePath)).toBe(true);
        return true;
      });

      await ReportGeneratorService.sendHeroImageReport(
        '923016669553',
        'session-uuid-cleanup',
        Buffer.from('png-bytes'),
        'caption'
      );

      // File should be cleaned up after
      expect(capturedPath).not.toBeNull();
      expect(fs.existsSync(capturedPath)).toBe(false);
    });

    test('throws when sendImage returns false (delivery is critical)', async () => {
      WhatsAppService.sendImage.mockResolvedValue(false);

      await expect(
        ReportGeneratorService.sendHeroImageReport(
          '923016669553',
          'session-uuid-fail',
          Buffer.from('png-bytes'),
          'caption'
        )
      ).rejects.toThrow(/sendImage returned false/);
    });
  });

  describe('sendPDFReport (Buffer path — regression guard)', () => {
    test('calls WhatsAppService.sendDocument (NOT sendImage) with a .pdf filename', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 fake-pdf-body');

      await ReportGeneratorService.sendPDFReport(
        '923016669553',
        'session-uuid-pdf',
        pdfBuffer,
        'Aisha',
        '2026-07-17T09:00:00Z',
        'en'
      );

      expect(WhatsAppService.sendDocument).toHaveBeenCalledTimes(1);
      const [to, filePath, filename] = WhatsAppService.sendDocument.mock.calls[0];
      expect(to).toBe('923016669553');
      expect(filePath.endsWith('.pdf')).toBe(true);
      expect(filename).toMatch(/^Classroom Observation_Aisha_\d{8}\.pdf$/);

      // sendImage must NOT be called on the buffer path
      expect(WhatsAppService.sendImage).not.toHaveBeenCalled();
    });
  });
});
