'use strict';

/**
 * Queue #184, bd-pkxzg9.4 (operator 19 Nov ~17:10): "in the HITL's teacher report now all the indicators are being
 * shown. We want just a one liner under each section's score, just like ... the FICO17v6 reports that are live for
 * primary right now."
 *
 * The live v6 line: the narrative model (narrative.service buildV6Prompt, its domain_whys rule) writes ONE past-tense
 * sentence per section from the section's levels and evidence; hero-report.service attachDomainWhys puts it under the
 * section's bar ("Why: …", hero-report.template). A FICO 6-12 report now does the same: one narrative call with the
 * SAME domain_whys rule over its five sections (the observer's final levels and evidence), the line under each of
 * A–E, and no indicator-by-indicator list. A failed call leaves the bars without a line (as v6), never a list.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: { chat: { completions: { create: (...a) => mockCreate(...a) } } } }));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn(async (html) => Buffer.from(html)) }));

const FS = require('../../bot/shared/services/observe/obs612/fico-s-flow');
const FicoS = require('../../bot/shared/services/coaching/frameworks/fico-s');
const Record = require('../../bot/shared/services/observe/obs612/record');
const Report = require('../../bot/shared/services/coaching/report-v2/obs612-report');
const Narrative = require('../../bot/shared/services/coaching/report-v2/narrative.service');
const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');

const EV = (code) => `In the room for ${code}: the teacher asked Sana why the ship floats.`;
function answersFor(screenId) {
  const s = FS.screenById(screenId);
  const out = {};
  for (const f of s.fields) {
    if (f.check === 'level') out[f.name] = f.code === 'C2' ? 'NA' : String((FicoS.CODES.indexOf(f.code) % 4) + 1);
    else if (f.check === 'evidence') out[f.name] = EV(s.code);
    else if (f.check === 'yes_no') out[f.name] = 'yes';
    else if (f.name === 'fs_focus') out[f.name] = 'C3';
    else if (f.name === 'fs_focus_2' || f.name === 'fs_action_2') out[f.name] = '';
    else out[f.name] = f.required ? `Words for ${f.name}` : '';
  }
  return out;
}
const draft = () => {
  const d = {};
  for (const s of FS.SCREENS) Object.assign(d, FS.mergeDraft({}, s.id, answersFor(s.id)));
  return d;
};
const analysis = () => Record.buildAnalysis({
  id: 'f1', rubric_version: 'fico_s_v1_1', observer_user_id: 'c1', teacher_user_id: 't1', visit_context: { grade: 7, subject: 'maths', via: 'observe' },
}, draft());
const SESSION = { created_at: '2026-11-19T10:00:00Z', transcript_text: '[00:10] Teacher (en): Why does a ship float?' };
const WHYS = {
  A: 'This is developing because the objective was said at the start — it is not full marks because it was not checked at the end.',
  B: 'B line.', C: 'C line.', D: 'D line.', E: 'E line.',
};
const sectionsOf = () => Report.buildObs612ReportVm(SESSION, analysis(), { language: 'en' }).view.ficos;

beforeEach(() => mockCreate.mockReset());

describe('the same rule as the live v6 line', () => {
  test('v6 and FICO 6-12 ask for the line in the same words', () => {
    expect(typeof Narrative.DOMAIN_WHYS_RULE).toBe('string');
    expect(Narrative.DOMAIN_WHYS_RULE).toMatch(/^domain_whys: ONE sentence per section, in the report language, in the PAST TENSE/);
    const p = Narrative.buildFicoSWhysPrompt(sectionsOf(), { transcript: SESSION.transcript_text, language: 'en', teacherName: 'Rabia' });
    expect(p).toContain(Narrative.DOMAIN_WHYS_RULE);
    expect(p).toContain('"domain_whys":{ "A":"...", "B":"...", "C":"...", "D":"...", "E":"..." }');
    expect(p).toContain(SESSION.transcript_text);
  });

  test("each section's marks, then every indicator's level, the observer's evidence and what the next level asks", () => {
    const p = Narrative.buildFicoSWhysPrompt(sectionsOf(), { transcript: '', language: 'en' });
    const a1 = FicoS.indicatorText('A1', 'en');
    expect(p).toMatch(/- A \(Lesson planning[^)]*\): \d+ of \d+ over \d+ levelled indicators?\./i);
    expect(p).toContain(`  · ${a1.name}: level 1 of 4 — evidence: "${EV('A1')}" — the next level asks: "${a1.levels[1]}"`);
    expect(p).toMatch(/· [^:\n]+: not applicable in this lesson — not a low mark/); // C2 NA
    expect(p).not.toMatch(/\b[A-E][1-8]\b: level/); // never a code as prose
  });

  test('v6\'s own prompt still carries the rule word for word', () => {
    const { reviewedV6 } = require('../fixtures/fico17-v6-reviewed');
    const v6a = reviewedV6();
    expect(require('../../bot/shared/services/coaching/target-resolver').isV6Levelled(v6a)).toBe(true);
    for (const language of ['en', 'ur']) {
      expect(Narrative.buildPrompt(v6a, { transcript: 'x', language, teacherName: 'T' })).toContain(`${Narrative.DOMAIN_WHYS_RULE}\nSECTION LEVELS (diagnose each):`);
    }
  });
});

describe('the narrative call', () => {
  test('one call on the narrative model; only A–E strings are kept', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ domain_whys: { ...WHYS, Z: 'x', B: 7 } }) } }] });
    const whys = await Narrative.generateFicoSDomainWhys(sectionsOf(), { transcript: 't', language: 'en' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ job: 'coaching.narrative', response_format: { type: 'json_object' } });
    expect(whys).toEqual({ A: WHYS.A, C: WHYS.C, D: WHYS.D, E: WHYS.E });
  });
  test('a failed call is retried once, then null', async () => {
    mockCreate.mockRejectedValue(new Error('timeout'));
    expect(await Narrative.generateFicoSDomainWhys(sectionsOf(), { language: 'en' })).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

describe('the teacher report: one line under each section, no indicator list', () => {
  test('the line goes under its section\'s bar; no indicator-by-indicator list', () => {
    const vm = Report.buildObs612HeroVm(SESSION, analysis(), { language: 'en', domainWhys: WHYS });
    expect(vm.groups.map((g) => g.why)).toEqual(['A', 'B', 'C', 'D', 'E'].map((k) => WHYS[k]));
    expect(vm.evidence).toBeUndefined();
    const html = buildHeroReportHtml(vm);
    expect(html).toContain('This is developing because the objective was said at the start');
    expect(html).not.toContain(EV('A1'));
    expect(html).not.toMatch(/Indicator by indicator/i);
  });

  test('no line when the call failed: the bars alone, still no list', () => {
    const vm = Report.buildObs612HeroVm(SESSION, analysis(), { language: 'en' });
    expect(vm.groups.every((g) => !g.why)).toBe(true);
    expect(vm.evidence).toBeUndefined();
  });

  test('the render asks the narrative model once and draws its lines', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ domain_whys: WHYS }) } }] });
    const out = await Report.generateObs612Report(SESSION, analysis(), { language: 'en', teacherName: 'Rabia' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(String(out.png)).toContain('This is developing because the objective was said at the start');
    expect(out.narrative).toEqual({ domain_whys: WHYS });
  });

  test('an FDE (non FICO 6-12) report never calls the model', async () => {
    const fde = { framework: 'obs612-gen-v1', rubric: 'obs612-gen-v1', obs612: { rubric_id: 'obs612-gen-v1', answers: {}, feedback: { line: 'ok' } } };
    await Report.generateObs612Report(SESSION, fde, { language: 'en' }).catch(() => null);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
