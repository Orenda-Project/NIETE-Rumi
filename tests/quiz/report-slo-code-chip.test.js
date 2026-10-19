'use strict';
/**
 * bd-v0toag.9 — the WhatsApp PDF report's hardest-question chip shows the curriculum SLO code
 * in front of the goal statement when the report hands it one (only with the switch on), and
 * is unchanged without it.
 */
const render = require('../../bot/shared/templates/video-quiz-report.template');

const base = (h) => render({ topic: 'x', language: 'en', started: 3, finished: 3, average: 50, students: [], unfinished: [],
  hardest: [{ question_text: 'q', wrong: 2, total: 3, slo: 'Write half as a fraction', ...h }] });

test('no code → the statement alone', () => {
  const html = base({});
  expect(html).toContain('Write half as a fraction');
  expect(html).not.toContain('slo-code');
});

test('a code → shown before the statement, escaped', () => {
  const html = base({ sloCode: 'M-02-NO-04' });
  expect(html).toMatch(/slo-code[^>]*>M-02-NO-04<\/span>/);
  expect(base({ sloCode: '<x>' })).not.toContain('<x>');
});
