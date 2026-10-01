'use strict';
/**
 * Observation-score BANDS are a PORTAL change only (operator, 2026-10-01:
 * "those changes were supposed to be portal only"). On 2026-09-29 they leaked
 * into what a teacher receives on WhatsApp, reached 230 teachers in production,
 * and were reverted. These tests pin the WhatsApp surfaces to their numbers:
 *   1. the coaching report image — marks, section scores, the trend percentage
 *   2. the coaching card's focus line — "currently x/y"
 *   3. the voice note — the exact lesson-plan percentage
 * and keep the one bot change the PORTAL does read:
 *   4. the score breakdown carries its scale, so the portal can band it.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');
const { generatePrioritizedAction } = require('../../bot/shared/services/coaching/coaching-card/prioritized-action.service');
const { buildBreakdown } = require('../../bot/shared/services/coaching/coaching-breakdown.service');

function vm(extra = {}) {
  return {
    language: 'en',
    teacherName: 'Sadia Tabassum',
    topic: 'Fractions',
    date: '2026-08-01',
    score: { overall: 75, marks: 111, max: 148 },
    groups: [
      { key: 'B', name: 'Lesson Plan Fidelity', score: 31, max: 40, pct: 78 },
      { key: 'D', name: 'Student Engagement', score: 9, max: 28, pct: 32 },
    ],
    narrative: {
      affirmation: 'Your class was full of questions',
      strength_name: 'Wait time', strength_note: 'note',
      horizon_title: 'Cold call', horizon_note: 'note',
      moments: [{ quote: 'Three plus seven makes ten', why: 'why' }],
    },
    tryNext: 'Try one thing',
    trend: [{ date: '2026-07-10', pct: 62 }, { date: '2026-07-24', pct: 75 }],
    photoB64: '',
    ...extra,
  };
}

function visibleText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/\sstyle="[^"]*"/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

describe('1 · the coaching report image keeps its numbers', () => {
  test.each(['en', 'ur'])('%s: the overall marks line is printed', (language) => {
    const text = visibleText(buildHeroReportHtml(vm({ language })));
    expect(text).toMatch(/111\/148/);
  });

  test('each section shows its score out of its max', () => {
    const text = visibleText(buildHeroReportHtml(vm({ language: 'en' })));
    expect(text).toMatch(/31\/40/);
    expect(text).toMatch(/9\/28/);
  });

  test('no band word replaces a score on the report', () => {
    const text = visibleText(buildHeroReportHtml(vm({ language: 'en' })));
    expect(text).not.toMatch(/Below average|Needs support/);
  });

  test('the trend peak is labelled with its percentage', () => {
    const html = buildHeroReportHtml(vm({ language: 'en' }));
    const svgText = [...html.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(svgText.join(' ')).toMatch(/75%/);
  });

  test('the section bars stay', () => {
    expect(buildHeroReportHtml(vm())).toMatch(/class="pfill"/);
  });
});

describe('2 · the coaching card keeps its score', () => {
  // The rubric's own scale: FICO has been 0-4 and 0-2 on different branches.
  const MAX = require('../../bot/shared/services/coaching/frameworks/fico-framework').getScoringConstants().scaleMax;
  const fico = {
    framework: 'fico',
    scores: { overall_percentage: 61 },
    domains: {
      student_engagement: { indicators: [
        { id: 'D1', name: 'Every student participates', score: MAX / 2 },
        { id: 'D2', name: 'Students ask questions', score: MAX },
      ] },
    },
  };

  test('the focus line names the weakest indicator with its score out of the scale', async () => {
    const out = await generatePrioritizedAction(fico, 'Sadia');
    expect(out.action).toMatch(/Every student participates/);
    expect(out.action).toContain(`currently ${MAX / 2}/${MAX}`);
    expect(out.action).not.toMatch(/currently (average|good|excellent|below average|needs support)/i);
  });
});

describe('3 · the voice note keeps the lesson-plan percentage', () => {
  jest.resetModules();
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: 'Assalam-o-alaikum.' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
  const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
  GPT5MiniService.openai = { chat: { completions: { create } } };

  const prompt = () => create.mock.calls[create.mock.calls.length - 1][0].messages[0].content;

  test('the lesson-plan figure is handed over as the exact percentage', async () => {
    await GPT5MiniService.summarizeForVoiceDebrief({ analysis: {}, fidelityScore: 60, fidelityBand: 'partial' }, 'en');
    const rule = prompt().split('LESSON PLAN:')[1].split('\n\n')[0];
    expect(rule).toMatch(/60%/);
  });

  test('no voice note is told to swap scores for band words', async () => {
    await GPT5MiniService.summarizeForVoiceDebrief({ analysis: {} }, 'ur');
    expect(prompt()).not.toMatch(/Needs support/);
  });
});

describe('4 · the breakdown carries its scale', () => {
  test('a FICO breakdown says its indicators are scored out of the rubric\'s own scale', () => {
    const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
    const C = fico.getScoringConstants();
    const domains = {};
    for (const [key, def] of Object.entries(C.domains)) {
      domains[key] = { domain_score: 2, domain_max: 4, indicators: [{ id: `${def.key}1`, score: 1 }, { id: `${def.key}2`, score: 1 }] };
    }
    const b = buildBreakdown({ framework: 'fico', scores: { overall_percentage: 50 }, domains }, 'en');
    expect(b.scaleMax).toBe(C.scaleMax);
    expect(C.scaleMax).toBeGreaterThan(0);
  });
});
