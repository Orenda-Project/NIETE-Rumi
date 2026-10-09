/**
 * bd-fmf24g.10 — the hero report's narrative (headline, identity, moments, strength, horizon, the
 * per-section "why" lines) is written when the report is RENDERED and used to be thrown away, so the
 * teacher app's report page could not show it. narrative.service's own header says it is "stored at
 * analysis_data.report_narrative"; nothing ever stored it.
 *
 *   1. generateHeroReport hands back the narrative it rendered, beside { png, caption }.
 *   2. persistReportNarrative writes it at analysis_data.report_narrative by read-merge-write
 *      (no new column; every other analysis_data key survives; failure is non-fatal).
 *   3. The DC pipeline's generatePDFReport persists it when the hero renderer ran.
 */

const SID = 'cs-1';
const NARRATIVE = {
  topic: 'Fractions', affirmation: 'You made fractions feel easy', identity: 'A teacher who waits',
  moments: [{ title: 'Pair talk', quote: 'Tell your partner why', why: 'Every child spoke' }],
  strength_name: 'Wait time', strength_note: 'You waited.', horizon_title: 'Name one moment', horizon_note: 'Quote it.',
  domain_whys: { teacher_subject_knowledge: 'Clear examples.' }, journey_note: 'Up from last time', _language: 'en',
};

function fakeSupabase(row, { failUpdate = false, failRead = false } = {}) {
  const writes = [];
  const from = () => {
    const q = {};
    q.select = () => q; q.eq = () => q;
    q.single = async () => (failRead ? { data: null, error: { message: 'down' } } : { data: row, error: null });
    q.update = (patch) => { writes.push(patch); return { eq: async () => ({ error: failUpdate ? { message: 'write failed' } : null }) }; };
    return q;
  };
  return { from, writes };
}

describe('persistReportNarrative', () => {
  let store;
  const log = jest.fn();
  beforeEach(() => { jest.resetModules(); log.mockClear(); store = require('../../bot/shared/services/coaching/report-v2/narrative-store'); });

  test('merges the narrative into analysis_data and keeps every other key', async () => {
    const sb = fakeSupabase({ analysis_data: { framework: 'fico', scores: { overall_percentage: 61 }, voice_debrief_script: 'v' } });
    const ok = await store.persistReportNarrative(SID, NARRATIVE, { supabase: sb, log, now: () => new Date('2026-10-09T10:00:00Z') });
    expect(ok).toBe(true);
    expect(sb.writes).toHaveLength(1);
    expect(sb.writes[0].analysis_data).toEqual({
      framework: 'fico', scores: { overall_percentage: 61 }, voice_debrief_script: 'v',
      report_narrative: { ...NARRATIVE, generated_at: '2026-10-09T10:00:00.000Z' },
    });
  });

  test('an empty or missing narrative writes nothing (never clobbers a stored one with a hollow object)', async () => {
    const sb = fakeSupabase({ analysis_data: { report_narrative: { strength_name: 'old' } } });
    for (const bad of [null, undefined, {}, { moments: [] }, 'x']) {
      expect(await store.persistReportNarrative(SID, bad, { supabase: sb, log })).toBe(false);
    }
    expect(sb.writes).toHaveLength(0);
  });

  test('a failed read or write is non-fatal and logged at warn', async () => {
    for (const opts of [{ failRead: true }, { failUpdate: true }]) {
      log.mockClear();
      const sb = fakeSupabase({ analysis_data: {} }, opts);
      await expect(store.persistReportNarrative(SID, NARRATIVE, { supabase: sb, log })).resolves.toBe(false);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/report narrative/i), expect.objectContaining({ coachingSessionId: SID }), 'warn');
    }
  });
});

describe('generateHeroReport returns the narrative it rendered', () => {
  test('{ png, caption, narrative }', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      generateReportNarrative: jest.fn().mockResolvedValue({ ...NARRATIVE }),
      subjectUnconfirmedNote: () => '',
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn().mockResolvedValue([]) }));
    jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn().mockResolvedValue(Buffer.from('PNG')) }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    const { generateHeroReport } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    const analysis = { framework: 'fico', scores: { overall_percentage: 61, overall_marks: 30, max_marks: 49 }, domains: {} };
    const out = await generateHeroReport({ id: SID, user_id: 'u', created_at: '2026-10-09T00:00:00Z', transcript_text: 't' }, analysis, { teacherName: 'Ayesha', language: 'en' });
    expect(Buffer.isBuffer(out.png)).toBe(true);
    expect(out.narrative).toMatchObject({ affirmation: 'You made fractions feel easy', strength_name: 'Wait time' });
  });
});

describe('the DC pipeline persists it', () => {
  test('generatePDFReport stores the hero narrative on the session, and a null narrative stores nothing', async () => {
    jest.resetModules();
    const writes = [];
    jest.doMock('../../bot/shared/config/supabase', () => {
      const from = () => {
        const q = {};
        q.select = () => q; q.eq = () => q; q.neq = () => q;
        q.single = async () => ({ data: { analysis_data: { framework: 'fico', topic: 'T' } }, error: null });
        q.update = (p) => { writes.push(p); return { eq: async () => ({ error: null }) }; };
        q.then = (res) => Promise.resolve({ count: 0, error: null }).then(res);
        return q;
      };
      return { from };
    });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    let heroOut = { png: Buffer.from('PNG'), caption: 'c', narrative: { ...NARRATIVE } };
    jest.doMock('../../bot/shared/services/pdf-report.service', () => ({ generateClassroomObservationReport: jest.fn(async () => heroOut) }));
    for (const m of ['gpt5-mini', 'whatsapp', 'feature-linker']) jest.doMock(`../../bot/shared/services/${m}.service`, () => ({}));
    jest.doMock('../../bot/shared/services/tts', () => ({}));
    jest.doMock('../../bot/shared/storage/r2', () => ({ uploadVoiceDebrief: jest.fn(), uploadReportPDF: jest.fn(), uploadReportImage: jest.fn() }));
    jest.doMock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/x' }));
    jest.doMock('../../bot/shared/services/coaching/coaching-session.service', () => ({}));
    jest.doMock('../../bot/shared/services/coaching/coaching-helpers.service', () => ({}));
    const Svc = require('../../bot/shared/services/coaching/report-generator.service');
    const session = { id: SID, user_id: 'u', users: { preferred_language: 'en' }, analysis_data: { framework: 'fico' }, transcript_language: 'en' };
    const analysis = { framework: 'fico', topic: 'T', scores: { overall_percentage: 61 }, domains: {} };

    const out = await Svc.generatePDFReport(session, 'Ayesha', analysis, null, null);
    expect(out.png).toBeDefined();
    const stored = writes.find((w) => w.analysis_data && w.analysis_data.report_narrative);
    expect(stored.analysis_data.report_narrative).toMatchObject({ strength_name: 'Wait time', generated_at: expect.any(String) });

    writes.length = 0;
    heroOut = { png: Buffer.from('PNG'), caption: 'c', narrative: null };
    await Svc.generatePDFReport(session, 'Ayesha', analysis, null, null);
    expect(writes.find((w) => w.analysis_data)).toBeUndefined();
  });
});
