'use strict';
/**
 * bd-ra8xu.40 — the teacher report narrative of a FICO17 v6 /observe visit is written from the coach's final levels.
 *
 * On 11 Nov the v6 report rendered with empty "Your strength" and "Your next horizon" pills (that run's narrative call
 * failed on the local key, so the working-key path had never been seen). Nothing in it grounded those pills: the
 * prompt's per-section block was built only for V3 ('fico'), a v6 analysis has no strengths, focus_area or summary,
 * and the target resolver returned null. The v6 prompt now hands the model, per section, each indicator in plain words
 * with its final level (or "not applicable" / "couldn't tell") and the evidence as the coach submitted it; mandates the
 * strength from the strongest final level and the horizon from the resolved target; and asks domain_whys keyed
 * v6_teacher / v6_children / v6_subject under the same two-clause rules. It never shows a code, who set a level, or
 * Rumi's own evidence. (The V3 and /observe2 prompts are pinned in fico17-v6-report-pins.test.js.)
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const { buildPrompt } = require('../../bot/shared/services/coaching/report-v2/narrative.service');
const { resolveTarget } = require('../../bot/shared/services/coaching/target-resolver');
const { RUMI, RUMI_COMBINED_QUOTE, COACH, TRANSCRIPT, dcV6, reviewedV6 } = require('../fixtures/fico17-v6-reviewed');

const CODE = /\b[CDF][1-8]\b/;
const prompt = (a, opts = {}) => buildPrompt(a, { transcript: TRANSCRIPT, language: 'en', teacherName: 'Rabia', target: resolveTarget(a), ...opts });
const lineOf = (p, text) => p.split('\n').find((l) => l.includes(text));

describe('the v6 narrative prompt', () => {
  const p = prompt(reviewedV6());

  test('asks for domain_whys keyed by the three v6 sections, never the V3 keys', () => {
    expect(p).toMatch(/"domain_whys":\{ "v6_teacher":"\.\.\.", "v6_children":"\.\.\.", "v6_subject":"\.\.\." \}/);
    expect(p).not.toContain('high_leverage_practices');
    expect(p).not.toContain('lesson_plan_fidelity');
  });

  test('gives every indicator of each section in plain words with its final level and the coach-submitted evidence', () => {
    expect(p).toContain('v6_teacher (What the teacher does)');
    expect(p).toContain('v6_children (What the children do)');
    expect(p).toContain('v6_subject (Subject knowledge)');
    expect(lineOf(p, `${V6.indicator('C3').name}:`)).toContain('level 2 of 4');
    expect(lineOf(p, `${V6.indicator('C3').name}:`)).toContain(COACH.C3);
    expect(lineOf(p, `${V6.indicator('C4').name}:`)).toContain(COACH.EV_C4);
  });

  test('NA and couldn\'t-tell rows are named as such, never with a level, and are not low marks', () => {
    expect(lineOf(p, `${V6.indicator('C7').name}:`)).toMatch(/not applicable/i);
    expect(lineOf(p, `${V6.indicator('C7').name}:`)).not.toMatch(/level \d/);
    expect(lineOf(p, `${V6.indicator('C8').name}:`)).toMatch(/couldn't tell/i);
    expect(p).toMatch(/"not applicable" or "couldn't tell" is NOT a low mark/);
  });

  test('mandates the strength from the strongest final level, with its evidence', () => {
    const line = lineOf(p, 'MANDATORY strength');
    expect(line).toContain(`"${V6.indicator('C6').name}"`);
    expect(line).toContain(RUMI.C6[3]);
  });

  test('mandates the horizon from the resolved target, with the coach\'s evidence and what the next level asks', () => {
    const line = lineOf(p, 'MANDATORY horizon');
    expect(line).toContain(`"${V6.indicator('C4').name}"`);
    expect(line).toContain(COACH.EV_C4);
    expect(line).toContain(V6.levelText('C4', 2));
  });

  test('the horizon follows the caller\'s selected step, and the strength is never that same row', () => {
    const a = reviewedV6();
    const q = prompt(a, { target: { indicator: 'C6', name: 'x' } });
    expect(lineOf(q, 'MANDATORY horizon')).toContain(`"${V6.indicator('C6').name}"`);
    expect(lineOf(q, 'MANDATORY strength')).toContain(`"${V6.indicator('F1').name}"`);
  });

  test('never a code, who set a level, or Rumi\'s own evidence', () => {
    expect(p).not.toMatch(CODE);
    expect(p).not.toMatch(/set_by|rumi_evidence|combined_evidence|fico17_v6_review/);
    expect(p).not.toContain(RUMI.C4[1]); // the coach replaced Rumi's C4 text
    expect(p).not.toContain(RUMI_COMBINED_QUOTE); // Rumi's evidence for a combined indicator
    expect(p).toMatch(/never compare two sources of a level/i);
  });

  test('keeps the shared rules: two-clause domain whys, past tense, the moments and the language rules', () => {
    expect(p).toContain("it's not full marks because");
    expect(p).toMatch(/PAST TENSE/);
    expect(p).toMatch(/moments: EXACTLY 3/);
    expect(p).toContain('ADDRESS THE TEACHER DIRECTLY');
    expect(p).toContain(TRANSCRIPT);
  });

  test('Urdu: the Urdu rules and the same v6 keys', () => {
    const u = prompt(reviewedV6(), { language: 'ur' });
    expect(u).toMatch(/WRITE every string value in URDU/);
    expect(u).toContain('"v6_children":"..."');
    expect(u).toMatch(/مکمل نمبر اس لیے نہیں کیونکہ/);
    expect(u).not.toMatch(CODE);
  });
});

describe('a section with no level is not assessed', () => {
  test('its why is omitted, never invented', () => {
    const a = reviewedV6({ r_F1: 'IE', r_F2: 'NA', r_F3: 'IE', r_F4: 'NA' });
    const p = prompt(a);
    expect(lineOf(p, 'v6_subject (Subject knowledge)')).toMatch(/NOT ASSESSED/);
  });
});

describe('a DC v6 self-recording (no review)', () => {
  test('the six combined indicators show no level', () => {
    const p = prompt(dcV6());
    for (const code of V6.COMBINED_CODES) {
      const line = lineOf(p, `${V6.indicator(code).name}:`);
      expect(line).toBeDefined();
      expect(line).not.toMatch(/level \d of 4/);
    }
    expect(lineOf(p, 'MANDATORY horizon')).toContain(`"${V6.indicator('D5').name}"`);
  });
});

describe('the hero report of a v6 /observe visit asks the narrative for the v6 target', () => {
  test('generateHeroReport (as observe-send calls it, no target) hands the narrative the resolved v6 target', async () => {
    jest.resetModules();
    const seen = [];
    jest.doMock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      ...jest.requireActual('../../bot/shared/services/coaching/report-v2/narrative.service'),
      generateReportNarrative: async (_a, opts) => { seen.push(opts); return { strength_name: 'S', strength_note: 'N', horizon_title: 'H', horizon_note: 'Q', moments: [] }; },
    }));
    jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: async (html) => Buffer.from(String(html)) }));
    jest.doMock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: async () => [] }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    const { generateHeroReport } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    const out = await generateHeroReport({ id: 'cs', user_id: 't', created_at: '2026-11-12T05:00:00Z', transcript_text: TRANSCRIPT },
      reviewedV6(), { language: 'en', brand: 'niete', teacherName: 'Rabia', requireNarrative: true });
    expect(seen[0].target).toMatchObject({ indicator: 'C4', rubric: 'fico17_v6' });
    const html = out.png.toString();
    expect(html).toContain('>S<');
    expect(html).toContain('>H<');
  });
});
