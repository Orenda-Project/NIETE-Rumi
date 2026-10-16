'use strict';
/**
 * v10 coaching test (bd-v0toag.79). Amena, 16 Oct: "The 'do you agree' is a leading question -- can we frame it
 * more neutrally? What do you think of the report? Its accurate, It's inaccurate etc. No leading questions pls."
 * The question asks what she thinks; the two answers are Accurate / Not accurate. Stored values stay 1 / 0
 * (coaching_quality_metrics.user_satisfaction_rating), so the live test's measure reads the same before and after.
 */
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { PING } = require('../../dashboard/services/coach-ping-page');
const { renderReportPage } = require('../../dashboard/services/coaching-report-page');
const { buildReportView } = require('../../dashboard/services/coaching-report-view');

const ux = (k, language) => resolveUx(k, { language });
const LEADING = /agree|متفق|\byes\b|\bno\b|ہاں|نہیں؟?$/i;

describe.each(['en', 'ur'])('%s', (language) => {
  test('the question asks what she thinks, it does not ask her to agree', () => {
    const ask = ux('coachingSurveyAsk', language);
    expect(ask).not.toMatch(/agree|متفق/i);
    expect(ask).toMatch(/[?؟]$/);
  });

  test('the answers say what the report is, not yes or no', () => {
    expect(ux('coachingSurveyYesButton', language)).not.toMatch(LEADING);
    expect(ux('coachingSurveyNoButton', language)).not.toMatch(/agree|متفق|\bno\b|^👎/i);
  });

  test('each answer fits a WhatsApp reply button (20 code points)', () => {
    for (const k of ['coachingSurveyYesButton', 'coachingSurveyNoButton']) {
      expect([...ux(k, language)].length).toBeLessThanOrEqual(20);
    }
  });

  test('the link to her coach does not say "agree"', () => {
    expect(PING[language].help).not.toMatch(/agree|متفق/i);
  });
});

test('exact wording, EN and UR', () => {
  expect(ux('coachingSurveyAsk', 'en')).toBe('What do you think of this report?');
  expect(ux('coachingSurveyYesButton', 'en')).toBe('Accurate');
  expect(ux('coachingSurveyNoButton', 'en')).toBe('Not accurate');
  expect(ux('coachingSurveyAsk', 'ur')).toBe('اس رپورٹ کے بارے میں آپ کی کیا رائے ہے؟');
  expect(ux('coachingSurveyYesButton', 'ur')).toBe('درست');
  expect(ux('coachingSurveyNoButton', 'ur')).toBe('درست نہیں');
});

test('the C/D report page asks it neutrally and still posts yes / no (stored 1 / 0)', () => {
  const view = buildReportView({ session: { created_at: '2026-10-19T20:30:00Z', analysis_data: { scores: {} } }, firstName: 'S', language: 'en', trend: [] });
  const html = renderReportPage(view, {}, { detail: '/d', card: '/c', useful: '/cr/T/useful', coach: '/cr/T/coach' });
  expect(html).toContain('What do you think of this report?');
  expect(html).not.toMatch(/agree/i);
  expect(html).toMatch(/name="useful" value="yes">Accurate</);
  expect(html).toMatch(/name="useful" value="no">Not accurate</);
});
