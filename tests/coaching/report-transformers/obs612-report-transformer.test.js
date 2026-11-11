'use strict';
/**
 * bd-pni007 — the teacher's report for an FDE (obs612) visit: FDE's own result on FDE's own tool, scored by the coach.
 *
 * What the teacher receives when the coach confirms the send is generateHeroReport's image (observe-send preview →
 * deliver). For an FDE visit that call renders FDE's report, never the FICO hero:
 *   enur  % big, the band, "109 of 148 · FDE: score × 100 ÷ 148", one bar per section (score/max), Strengths / Areas
 *         for Improvement / Recommendations (Section 8);
 *   msci  one row per indicator "<n> · <short name>  Level N" with FDE's full wording below, "5 students checked:
 *         3-4 of 5 understood", the development plan "<area>: Level 0 → Level 1. <action>", and NO total;
 *   gen   "<Section> x of n Yes" per section, the feedback line, no score;
 *   all   footer "Scored by your coach on FDE's tool (Annexure G, 2026-27). Not a FICO score." and the label "FDE v1";
 *         no narrative model call, no FICO score bars, no journey line (the teacher's FICO history never beside it).
 * The reportData transformer (report records, any PDF consumer) and the renderer registry know the three ids too.
 *
 * The rendered HTML is written to outputs/obs612-report-render/ for a person to read (PNG: run render-png.js there).
 */

const fs = require('fs');
const path = require('path');
const F = require('../../fixtures/obs612-visits');

const OUT = path.join(__dirname, '..', '..', '..', 'outputs', 'obs612-report-render');
const IDS = ['obs612-enur-v1', 'obs612-msci-v1', 'obs612-gen-v1'];
const FOOTER = "Scored by your coach on FDE's tool (Annexure G, 2026-27). Not a FICO score.";

/** The words a reader sees: no <style>, no tags, entities decoded, isolates dropped. */
function textOf(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('report data (transformer)', () => {
  let getReportTransformer;
  let transformOECDToReportData;
  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    ({ getReportTransformer } = require('../../../bot/shared/services/coaching/report-transformers/report-transformer-dispatch'));
    ({ transformOECDToReportData } = require('../../../bot/shared/services/coaching/report-transformers/oecd-report-transformer'));
  });
  const SESSION = { created_at: '2026-11-11T09:31:00Z', users: { region: 'Sihala' } };

  test('each of the three ids has the FDE transformer, never the OECD fallback', () => {
    const t = getReportTransformer('obs612-enur-v1');
    expect(t).not.toBe(transformOECDToReportData);
    for (const id of IDS) expect(getReportTransformer(id)).toBe(t);
    for (const k of ['oecd', 'hots', 'teach', 'fico', 'fico17_v6', 'mewaka']) expect(typeof getReportTransformer(k)).toBe('function');
  });

  test('English & Urdu: FDE total, max and band; one goal per section; items 1-4; Section 8', () => {
    const rd = getReportTransformer('obs612-enur-v1')(SESSION, 'Ayesha Khan', F.enur());
    expect(rd).toMatchObject({
      framework: 'obs612-enur-v1', rubric: 'obs612-enur-v1', rubricLabel: 'FDE v1', teacherName: 'Ayesha Khan',
      totalScore: 109, maxScore: 148, percentage: 73.6, band: 'Proficient', noTotal: false,
    });
    expect(rd.goals).toHaveLength(15);
    const d = rd.goals.find((g) => g.title === 'D. Interest & Motivation');
    expect(d).toMatchObject({ score: 8, maxScore: 8 });
    expect(d.criteria.map((c) => c.score)).toEqual([4, 4]);
    expect(d.criteria[0]).toMatchObject({ name: 'Students show curiosity', max: 4, setBy: 'coach' });
    expect(rd.feedbackSections.map((f) => f.label)).toEqual(['Strengths', 'Areas for Improvement', 'Recommendations', 'Timeline']);
    expect(rd.footer).toBe(FOOTER);
    expect(JSON.stringify(rd)).not.toMatch(/FICO17|NaN/);
  });

  test('Maths & Science: levels per indicator, the 5-student check, the plan, and no total', () => {
    const rd = getReportTransformer('obs612-msci-v1')(SESSION, 'Ali', F.msci());
    expect(rd).toMatchObject({ framework: 'obs612-msci-v1', totalScore: null, maxScore: null, noTotal: true });
    const all = rd.goals.flatMap((g) => g.criteria);
    expect(all.find((c) => c.key === 'i9')).toMatchObject({ name: '9 · Wrapping up the lesson: Level 0', score: 0, max: 3 });
    expect(all.find((c) => c.key === 'i9').evidence).toMatch(/Wrapping up\/concluding the lesson/);
    expect(all.find((c) => c.key === 'students')).toMatchObject({ name: '5 students checked: 3-4 of 5 understood', score: 2 });
    expect(rd.goals.every((g) => g.score === null && g.maxScore === null)).toBe(true);
    expect(rd.developmentPlan[0]).toBe('Wrapping up the lesson: Level 0 → Level 1. Close with a two-minute summary and homework on the board.');
  });

  test('General form: Yes counts per section, the feedback line, no score', () => {
    const rd = getReportTransformer('obs612-gen-v1')(SESSION, 'Bilal', F.gen());
    expect(rd).toMatchObject({ framework: 'obs612-gen-v1', totalScore: null, maxScore: null, noTotal: true, yes: 29, of: 35 });
    const a = rd.goals.find((g) => g.title === 'STUDENT ASSESSMENT PROCESS');
    expect(a).toMatchObject({ yes: 0, of: 2, score: null, maxScore: null });
    expect(a.criteria.map((c) => c.evidence)).toEqual(['No', 'No']);
    expect(rd.feedback).toBe('A good start: add pair work, and check answers at the end.');
  });
});

describe('renderer registry', () => {
  test('an FDE visit renders its own report, on the NIETE brand; every other key keeps its renderer', () => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const { getReportRenderer, heroBrandFor } = require('../../../bot/shared/services/coaching/report-renderers/renderer-registry');
    for (const id of IDS) {
      expect(heroBrandFor(id)).toBe('niete');
      expect(getReportRenderer(id).key).toBe('obs612');
    }
    expect(getReportRenderer('fico').key).toBe('hero-niete');
    expect(getReportRenderer('fico17_v6').key).toBe('hero-niete');
    expect(getReportRenderer('oecd').key).toBe('hero');
    expect(getReportRenderer('obs612-enur-v9').key).toBe('pdfkit');
    expect(heroBrandFor('oecd')).toBeUndefined();
  });
});

describe('generateHeroReport on an FDE visit (the real generator, the page captured)', () => {
  let generateHeroReport;
  let heroBrandFor;
  let captured;
  let narrative;
  let trend;

  beforeAll(() => {
    jest.resetModules();
    captured = [];
    narrative = jest.fn(async () => { throw new Error('the narrative model must not run on an FDE report'); });
    trend = jest.fn(async () => { throw new Error('the FICO journey must not be read for an FDE report'); });
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../../bot/shared/utils/html-to-pdf', () => ({
      htmlToImage: jest.fn(async (html, opts) => { captured.push({ html, opts }); return Buffer.from('png'); }),
    }));
    jest.doMock('../../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      generateReportNarrative: narrative, subjectUnconfirmedNote: () => '',
    }));
    jest.doMock('../../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: trend, loadPriorAction: jest.fn() }));
    jest.doMock('../../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
    ({ generateHeroReport } = require('../../../bot/shared/services/coaching/report-v2/hero-report.service'));
    ({ heroBrandFor } = require('../../../bot/shared/services/coaching/report-renderers/renderer-registry'));
    fs.mkdirSync(OUT, { recursive: true });
  });

  async function render(analysis, name, language) {
    captured.length = 0;
    const session = F.sessionRow(analysis);
    const out = await generateHeroReport(session, analysis, {
      teacherName: 'Ayesha Khan', language, brand: heroBrandFor(analysis.framework), requireNarrative: true,
    });
    expect(captured).toHaveLength(1);
    const { html, opts } = captured[0];
    fs.writeFileSync(path.join(OUT, `${name}-${language}.html`), html);
    return { out, html, opts, text: textOf(html) };
  }

  const common = ({ out, html, opts, text }) => {
    expect(out.narrative).toBeNull();
    expect(Buffer.isBuffer(out.png)).toBe(true);
    expect(opts).toMatchObject({ selector: '.report', width: 794 });
    expect(text).toContain(FOOTER);
    expect(text).toContain('FDE v1');
    expect(text).toContain('Ayesha Khan');
    expect(text).not.toMatch(/\bNaN\b|\bundefined\b|\bnull\b/);
    expect(text.replace(FOOTER, '')).not.toMatch(/FICO/);
    expect(text).not.toMatch(/celebration|journey|Your next horizon/i);
    expect(html).toContain('#47BA7D'); // the NIETE palette
  };

  test('English & Urdu tool, en: the %, the band, FDE\'s arithmetic, a bar per section, Section 8', async () => {
    const r = await render(F.enur(), 'enur', 'en');
    common(r);
    expect(r.text).toContain('73.6%');
    expect(r.text).toContain('Proficient');
    expect(r.text).toContain('109 of 148 · FDE: score × 100 ÷ 148');
    expect(r.text).toMatch(/D\. Interest & Motivation 8\/8/);
    expect(r.text).toMatch(/C\. Reading Skills 4\/8/);
    expect((r.html.match(/class="pbar"/g) || []).length).toBe(15);
    for (const h of ['Strengths', 'Areas for Improvement', 'Recommendations']) expect(r.text).toContain(h);
    expect(r.text).toContain('Ask two why-questions after each paragraph.');
    expect(r.out.caption).toMatch(/Grade 7/);
  });

  test('Maths & Science tool, en: a row per indicator with FDE\'s wording, the students, the plan, no total', async () => {
    const r = await render(F.msci(), 'msci', 'en');
    common(r);
    expect(r.text).toMatch(/1 · Written work checked Level 2/);
    expect(r.text).toMatch(/9 · Wrapping up the lesson Level 0/);
    expect(r.text).toContain('Assigning and checking written work including formative assessments');
    expect(r.text).toContain('5 students checked: 3-4 of 5 understood');
    expect(r.text).toContain('Wrapping up the lesson: Level 0 → Level 1. Close with a two-minute summary and homework on the board.');
    expect(r.text).toContain('FDE gives no total for this tool.');
    expect(r.text).not.toMatch(/\d\s*%|\/\s*33\b/);
    expect(r.html).not.toContain('class="pbar"');
  });

  test('General form, en: "x of n Yes" per section, the feedback line, no score', async () => {
    const r = await render(F.gen(), 'gen', 'en');
    common(r);
    expect(r.text).toMatch(/CLASSROOM ENVIRONMENT 6 of 6 Yes/);
    expect(r.text).toMatch(/STUDENT ASSESSMENT PROCESS 0 of 2 Yes/);
    expect(r.text).toContain('A good start: add pair work, and check answers at the end.');
    expect(r.text).toContain('Yes on 29 of 35');
    expect(r.text).not.toMatch(/\d\s*%/);
  });

  // An Urdu teacher: the page is FDE's English tool, so it stays an English LTR page (a report's language is its
  // content's); the coach's Urdu words render RTL in their own first-strong block, on the embedded Nastaliq face.
  const URDU = {
    enur: { fb_strengths: 'واضح مقاصد، اور ہر طالب علم کے ساتھ نرم لہجہ۔' },
    msci: { dp_action: 'آخر میں دو منٹ کا خلاصہ کریں اور ہوم ورک بورڈ پر لکھیں۔', obs_i9: 'گھنٹی مثال کے دوران بج گئی۔' },
    gen: { fb_line: 'اچھا آغاز: جوڑیوں میں کام شامل کریں، اور آخر میں جوابات دیکھیں۔' },
  };
  test.each(['enur', 'msci', 'gen'])('%s, ur: FDE\'s English page, the coach\'s Urdu in its own RTL block, Nastaliq embedded', async (tool) => {
    const analysis = tool === 'enur' ? F.enur({ over: URDU.enur }) : F[tool](URDU[tool]);
    const r = await render(analysis, tool, 'ur');
    common(r);
    expect(r.html).toContain('<html dir="ltr" lang="en">');
    const urdu = Object.values(URDU[tool])[0];
    expect(r.html).toContain(`<div class="own" dir="auto">${urdu}</div>`);
    expect(r.html).toMatch(/\.own\{[^}]*unicode-bidi:plaintext/);
    expect(r.html).toMatch(/@font-face\{font-family:'NastaliqUrdu';font-weight:400;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{100,}/);
    expect(r.out.caption).toMatch(/[؀-ۿ]/);
  });

  test('an analysis stamped FDE but missing its answers still renders an FDE page, never 0% or FICO bars', async () => {
    const r = await render({ framework: 'obs612-gen-v1', rubric: 'obs612-gen-v1', scores: { rubric: 'obs612-gen-v1' } }, 'gen-bare', 'en');
    expect(r.text).toContain(FOOTER);
    expect(r.text).toContain('General form');
    expect(r.text).not.toMatch(/\b0%|\bNaN\b|\bundefined\b/);
  });

  test('no narrative model call and no FICO journey read, for any FDE report', () => {
    expect(narrative).not.toHaveBeenCalled();
    expect(trend).not.toHaveBeenCalled();
  });
});
