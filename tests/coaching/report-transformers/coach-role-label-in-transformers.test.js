/**
 * Report transformers surface the region-scoped coach-role label on the
 * reportData.observerName field. Contract: every framework transformer
 * threads session.users?.region through coachRoleLabelForRegion().
 *
 * Historically observerName was hardcoded to 'Rumi Digital Coach' across
 * every transformer (OECD, HOTS, TEACH, FICO, MEWAKA). This test locks
 * the region routing without pulling the framework-specific analysis
 * fixtures — we only assert the observerName resolution shape.
 */

jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const ENV_KEYS = ['DEFAULT_COACH_ROLE_LABEL', 'REGION_COACH_ROLE_LABEL_MAP'];

function withEnv(envPatch, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(envPatch || {})) process.env[k] = v;
  jest.resetModules();
  try {
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.resetModules();
  }
}

const baseSession = { id: 'session-uuid', created_at: '2026-07-17T09:00:00Z' };

// Minimal-shape analyses — enough to exercise each transformer's return path
// without asserting anything framework-specific.
const emptyOECDAnalysis  = { areas: {}, scores: {}, executive_summary: 'ok' };
const emptyHOTSAnalysis  = { areas: {}, executive_summary: 'ok' };
const emptyTeachAnalysis = { areas: {}, time_on_task: {}, executive_summary: 'ok' };
const emptyFICOAnalysis  = { domains: {}, scores: {}, executive_summary: 'ok' };
const emptyMEWAKAAnalysis = { areas: {}, executive_summary: 'ok' };

describe('report transformers — region-scoped observerName', () => {
  test('OECD: region-less session → default "Rumi Digital Coach"', () => {
    withEnv({}, () => {
      const { transformOECDToReportData } = require('../../../bot/shared/services/coaching/report-transformers/oecd-report-transformer');
      const reportData = transformOECDToReportData({ ...baseSession, users: {} }, 'Hassan', emptyOECDAnalysis, false);
      expect(reportData.observerName).toBe('Rumi Digital Coach');
    });
  });

  test('OECD: ICT / NIETE region → "Human Coach" via REGION map', () => {
    withEnv({ REGION_COACH_ROLE_LABEL_MAP: '{"niete":"Human Coach"}' }, () => {
      const { transformOECDToReportData } = require('../../../bot/shared/services/coaching/report-transformers/oecd-report-transformer');
      const reportData = transformOECDToReportData({ ...baseSession, users: { region: 'niete' } }, 'Hassan', emptyOECDAnalysis, false);
      expect(reportData.observerName).toBe('Human Coach');
    });
  });

  test('HOTS: DEFAULT_COACH_ROLE_LABEL flows through', () => {
    withEnv({ DEFAULT_COACH_ROLE_LABEL: 'Human Coach' }, () => {
      const { transformHOTSToReportData } = require('../../../bot/shared/services/coaching/report-transformers/hots-report-transformer');
      const reportData = transformHOTSToReportData({ ...baseSession, users: { region: 'niete' } }, 'Hassan', emptyHOTSAnalysis);
      expect(reportData.observerName).toBe('Human Coach');
    });
  });

  test('TEACH: unknown region falls back to default env label', () => {
    withEnv({ DEFAULT_COACH_ROLE_LABEL: 'Human Coach' }, () => {
      const { transformTeachToReportData } = require('../../../bot/shared/services/coaching/report-transformers/teach-report-transformer');
      const reportData = transformTeachToReportData({ ...baseSession, users: { region: 'somewhere-new' } }, 'Hassan', emptyTeachAnalysis);
      expect(reportData.observerName).toBe('Human Coach');
    });
  });

  test('FICO: region map takes precedence over default', () => {
    withEnv({
      DEFAULT_COACH_ROLE_LABEL: 'Rumi Digital Coach',
      REGION_COACH_ROLE_LABEL_MAP: '{"niete":"Human Coach"}',
    }, () => {
      const { transformFICOToReportData } = require('../../../bot/shared/services/coaching/report-transformers/fico-report-transformer');
      const reportData = transformFICOToReportData({ ...baseSession, users: { region: 'niete' } }, 'Hassan', emptyFICOAnalysis);
      expect(reportData.observerName).toBe('Human Coach');
      const reportDataOther = transformFICOToReportData({ ...baseSession, users: { region: 'other' } }, 'Hassan', emptyFICOAnalysis);
      expect(reportDataOther.observerName).toBe('Rumi Digital Coach');
    });
  });

  test('MEWAKA: TZ preserved default via env-driven config (Rumi)', () => {
    withEnv({
      DEFAULT_COACH_ROLE_LABEL: 'Rumi Digital Coach',
      REGION_COACH_ROLE_LABEL_MAP: '{"tanzania":"Rumi"}',
    }, () => {
      const { transformMEWAKAToReportData } = require('../../../bot/shared/services/coaching/report-transformers/mewaka-report-transformer');
      const reportData = transformMEWAKAToReportData(
        { ...baseSession, users: { region: 'tanzania', preferred_language: 'sw' } },
        'Neema',
        emptyMEWAKAAnalysis,
      );
      expect(reportData.observerName).toBe('Rumi');
    });
  });
});
