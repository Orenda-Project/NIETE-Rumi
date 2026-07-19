/**
 * FEAT-093 bd-54 — the teacher-invite template is per-market CONFIG:
 * OBSERVE_REPORT_TEMPLATE / OBSERVE_REPORT_TEMPLATE_LANG (defaults keep
 * Tanzania byte-identical: observation_report_sw / sw).
 */
const { reportTemplateConfig } = require('../../shared/services/observe/observe-send.service');

describe('bd-54 — per-market report template config', () => {
  afterEach(() => { delete process.env.OBSERVE_REPORT_TEMPLATE; delete process.env.OBSERVE_REPORT_TEMPLATE_LANG; });
  test('defaults are the TZ template — byte-identical behaviour', () => {
    expect(reportTemplateConfig()).toEqual({ name: 'observation_report_sw', lang: 'sw' });
  });
  test('PK config routes to the Urdu template', () => {
    process.env.OBSERVE_REPORT_TEMPLATE = 'observation_report_ur';
    process.env.OBSERVE_REPORT_TEMPLATE_LANG = 'ur';
    expect(reportTemplateConfig()).toEqual({ name: 'observation_report_ur', lang: 'ur' });
  });
});
