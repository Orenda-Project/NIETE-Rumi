'use strict';
/**
 * Observation scores reach a teacher as a BAND, never as a number, a
 * percentage or a "points out of" (operator, 2026-09-29).
 *
 * Every bot surface that tells a teacher how her lesson scored, one test each:
 *   1. the coaching report image (report-v2 hero template — the one FICO/NIETE
 *      routes to; the PDFKit renderer is only the fallback)
 *   2. the coaching card's focus line
 *   3. the 90-second voice note — whose prompt carries the whole observation
 *      as data, scores included, so the rule has to be SAID, not assumed
 *   4. the score breakdown the portal renders, which must carry its own scale
 *      so an indicator's raw 0/1/2 can be banded instead of printed
 *
 * "Visible text" below means the rendered report with <style> and every
 * style="" attribute removed: a bar's CSS width is a length, not a number the
 * teacher reads, and the bars stay.
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

const PERCENT = /\d+(?:\.\d+)?\s*%/;
const OUT_OF = /\b\d+\s*\/\s*\d+\b/;

describe('1 · the coaching report image', () => {
  test.each(['en', 'ur'])('%s: no percentage and no "x/y" anywhere she reads', (language) => {
    const text = visibleText(buildHeroReportHtml(vm({ language })));
    expect(text).not.toMatch(PERCENT);
    expect(text).not.toMatch(OUT_OF);
    expect(text).not.toMatch(/\bmarks\b|نمبر/);
  });

  test('English: the overall and each section carry their band', () => {
    const text = visibleText(buildHeroReportHtml(vm({ language: 'en' })));
    expect(text).toMatch(/Good/);           // overall 75, and B 78
    expect(text).toMatch(/Below average/);  // D 32
  });

  test('Urdu: the bands are in Urdu', () => {
    const text = visibleText(buildHeroReportHtml(vm({ language: 'ur' })));
    expect(text).toMatch(/اچھا/);
    expect(text).toMatch(/اوسط سے کم/);
  });

  test('the trend peak is labelled with its band, not its percentage', () => {
    const html = buildHeroReportHtml(vm({ language: 'en' }));
    const svgText = [...html.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(svgText.join(' ')).not.toMatch(PERCENT);
  });

  test('the section bars stay — a bar is a length, not a number she reads', () => {
    expect(buildHeroReportHtml(vm())).toMatch(/class="pfill"/);
  });
});

describe('2 · the coaching card', () => {
  const fico = {
    framework: 'fico',
    scores: { overall_percentage: 61 },
    domains: {
      student_engagement: { indicators: [
        { id: 'D1', name: 'Every student participates', score: 1 },
        { id: 'D2', name: 'Students ask questions', score: 2 },
      ] },
    },
  };

  test('the focus line names the band of the weakest indicator, not its score', async () => {
    const out = await generatePrioritizedAction(fico, 'Sadia');
    expect(out.action).not.toMatch(OUT_OF);
    expect(out.action).not.toMatch(PERCENT);
    expect(out.action).toMatch(/Every student participates/);
    expect(out.action).toMatch(/currently average\./);   // 1 of FICO's 0-2 scale = 50
  });
});

describe('3 · the voice note', () => {
  jest.resetModules();
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: 'Assalam-o-alaikum.' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
  const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
  GPT5MiniService.openai = { chat: { completions: { create } } };

  const prompt = () => create.mock.calls[create.mock.calls.length - 1][0].messages[0].content;

  test('the lesson-plan figure is handed over as a band word, never a percentage', async () => {
    await GPT5MiniService.summarizeForVoiceDebrief({ analysis: {}, fidelityScore: 60, fidelityBand: 'partial' }, 'en');
    const rule = prompt().split('LESSON PLAN:')[1].split('\n\n')[0];
    expect(rule).not.toMatch(PERCENT);
    expect(rule).not.toMatch(/\b60\b/);
    expect(rule).toMatch(/Good/);     // 60 → Good
  });

  test('every voice note is told never to say a score, a percentage or "out of"', async () => {
    await GPT5MiniService.summarizeForVoiceDebrief({ analysis: {} }, 'ur');
    expect(prompt()).toMatch(/never (say|state|speak)[^.]*(score|percent)/i);
    expect(prompt()).toMatch(/Excellent/);
    expect(prompt()).toMatch(/Needs support/);
  });
});

describe('4 · the breakdown carries its scale', () => {
  test('a FICO breakdown says its indicators are scored out of 2', () => {
    const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
    const C = fico.getScoringConstants();
    const domains = {};
    for (const [key, def] of Object.entries(C.domains)) {
      domains[key] = { domain_score: 2, domain_max: 4, indicators: [{ id: `${def.key}1`, score: 1 }, { id: `${def.key}2`, score: 1 }] };
    }
    const b = buildBreakdown({ framework: 'fico', scores: { overall_percentage: 50 }, domains }, 'en');
    expect(b.scaleMax).toBe(C.scaleMax);
    expect(C.scaleMax).toBe(2);
  });
});
