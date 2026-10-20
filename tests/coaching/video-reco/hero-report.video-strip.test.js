'use strict';
/**
 * bd-gzfdu9 §4.9: generateHeroReport hands opts.videoStrip to BOTH images it draws (the full hero and the C/D slim
 * one); without it neither image changes. Driven through the real service with the renderer and LLM stubbed (the
 * harness of bd-v0toag.57-slim-report.test.js).
 */
const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
function load(htmlToImage) {
  jest.resetModules();
  jest.doMock('../../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
    generateReportNarrative: jest.fn().mockResolvedValue({ affirmation: 'Well done', strength_name: 'Wait time' }),
    subjectUnconfirmedNote: () => '',
  }));
  jest.doMock('../../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn().mockResolvedValue([]) }));
  jest.doMock('../../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage }));
  jest.doMock('../../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn() }));
  return require('../../../bot/shared/services/coaching/report-v2/hero-report.service').generateHeroReport;
}
const session = { id: SID, user_id: UID, created_at: '2026-10-19T00:00:00Z', transcript_text: 't' };
const analysis = { framework: 'fico', grade: 3, subject: 'English', topic: 'Nouns', scores: { overall_percentage: 61, overall_marks: 30, max_marks: 49 }, domains: {}, strengths: ['Clear board work'] };
const base = { teacherName: 'Sana', language: 'en', commitmentAction: 'Commitment action', slim: { tryNext: 'x', step: null, tag: null } };
const STRIP = { thumbPath: '/nope.jpg', title: 'Asking why-questions', durationS: 134 };

test('with a strip: both the full and the slim image carry it', async () => {
  const htmlToImage = jest.fn(async () => Buffer.from('PNG'));
  await load(htmlToImage)(session, analysis, { ...base, videoStrip: STRIP });
  expect(htmlToImage).toHaveBeenCalledTimes(2);
  for (const [html] of htmlToImage.mock.calls) expect(html).toContain('class="vstrip"');
});

test('without one: neither image has it', async () => {
  const htmlToImage = jest.fn(async () => Buffer.from('PNG'));
  await load(htmlToImage)(session, analysis, base);
  for (const [html] of htmlToImage.mock.calls) expect(html).not.toContain('vstrip');
});
