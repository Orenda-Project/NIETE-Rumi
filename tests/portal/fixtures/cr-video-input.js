'use strict';
// bd-gzfdu9: the /cr report fixture the "no video → byte-identical" golden was rendered from (on origin/sandbox
// 24312266a8, before the video card existed). Shared by coaching-report-page.video.test.js.
const S = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
module.exports = (language) => ({
  language,
  session: {
    id: S,
    created_at: '2026-10-19T05:30:00Z',
    analysis_data: {
      subject: 'Maths', topic: 'Adding <tens>', scores: { overall_percentage: 62 },
      domains: { lesson_plan_fidelity: { domain_score: 26, domain_max: 40 } },
      report_narrative: { domain_whys: { lesson_plan_fidelity: 'Order kept, game not played.' } },
    },
    prioritized_action: { action: 'Ask two children by name.', thing_to_try: { text: 'After each question, count silently to three.', tag: 'C9' } },
    report_pdf_url: 'https://r2.example.com/reports/u/s_report.png',
    voice_debrief_url: 'https://r2.example.com/voice/s.ogg',
  },
  quizMessage: 'Class 2, try this quiz: https://portal.example.pk/q/ABC123',
  firstName: 'Sadia',
  trend: [{ pct: 40 }, { pct: 72 }, { pct: 61 }],
});
