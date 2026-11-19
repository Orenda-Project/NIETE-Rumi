'use strict';

/**
 * Superseded for the IMAGE 19 Nov ~17:10 (one line per section, v6's way); the portal block below still shows it.
 * Queue #184 (operator 19 Nov ~11:40): "In the FICOS's teacher's observation report, we are not showing the reasoning
 * ... Whatever the case, we want that." A FICO 6-12 visit's teacher report shows, indicator by indicator, the level the
 * observer set and the evidence the observer submitted, word for word (the 11 Nov rule for v6 HITL reports: what the
 * teacher reads is what the observer submitted). Before the Digital Coach change that is the observer's own evidence
 * (the form requires 20+ characters on each indicator); after it, the Evidence box as the observer submitted it.
 *
 * Where: the report image (the FICO hero page, report-v2/obs612-report.js + hero-report.template.js) and the portal's
 * FICO 6-12 block (observe/obs612/view.js portalSummary → Obs612Block), where it used to be a hover title only.
 * No model writes any of it. Every other report is unchanged.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const FS = require('../../bot/shared/services/observe/obs612/fico-s-flow');
const FicoS = require('../../bot/shared/services/coaching/frameworks/fico-s');
const Record = require('../../bot/shared/services/observe/obs612/record');
const View = require('../../bot/shared/services/observe/obs612/view');
const Report = require('../../bot/shared/services/coaching/report-v2/obs612-report');
const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');

const EV = (code) => `In the room for ${code}: the teacher asked Sana why the ship floats.`;
const UR_EV = 'استاد نے بچوں سے پوچھا کہ جہاز کیوں تیرتا ہے، اور جواب کا انتظار کیا۔';

function answersFor(screenId) {
  const s = FS.screenById(screenId);
  const out = {};
  for (const f of s.fields) {
    if (f.check === 'level') out[f.name] = f.code === 'C2' ? 'NA' : String((FicoS.CODES.indexOf(f.code) % 4) + 1);
    else if (f.check === 'evidence') out[f.name] = s.code === 'B2' ? UR_EV : EV(s.code);
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
const SESSION = { created_at: '2026-11-19T10:00:00Z' };

describe('the teacher report image: no indicator-by-indicator list (operator 19 Nov ~17:10)', () => {
  // "now all the indicators are being shown. We want just a one liner under each section's score": the list that was
  // here (19 Nov ~11:40) is replaced by one line per section, v6's way (tests/observe/q184-fico-s-report-section-lines).
  test('the hero view model carries no list, in either language', () => {
    for (const language of ['en', 'ur']) {
      const vm = Report.buildObs612HeroVm(SESSION, analysis(), { language, teacherName: 'Rabia' });
      expect(vm.evidence).toBeUndefined();
      expect(buildHeroReportHtml(vm)).not.toContain(EV('A1'));
    }
  });

  test('a report with no evidence block (every other report) draws none', () => {
    const vm = Report.buildObs612HeroVm(SESSION, analysis(), { language: 'en' });
    expect(buildHeroReportHtml(vm)).not.toContain('class="evi"');
  });
});

describe('the portal block: the evidence is shown, not a hover title', () => {
  test('each indicator row carries the observer\'s evidence as a note', () => {
    const p = View.portalSummary(analysis());
    const a1 = p.rows.find((r) => r.name.startsWith('A1 '));
    expect(a1.note).toBe(EV('A1'));
    expect(p.rows.find((r) => r.name.startsWith('B2 ')).note).toBe(UR_EV);
    // section rows carry none
    expect(p.rows.find((r) => r.name.startsWith('A · ')).note).toBeUndefined();
  });
});
