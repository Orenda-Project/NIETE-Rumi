/**
 * bd-gfsja — every teacher-flow report rendered ENGLISH, even for an
 * Urdu-locked teacher (Annie 923016669553, preferred_language='ur',
 * sessions 4de964bf/48171de5).
 *
 * Root cause, two halves:
 *   1. The session load in processReportGeneration selects
 *      `users!inner(phone_number, first_name, last_name)` — preferred_language
 *      is ABSENT from the join, so `session.users.preferred_language` is
 *      undefined for EVERY report.
 *   2. generatePDFReport then computes
 *      `session?.users?.preferred_language || 'en'` and hands that to the hero
 *      renderer as opts.language. 'en' is an OFFERED language, so it wins
 *      resolveReportLanguage's candidate chain unconditionally — the chain
 *      never gets to ask the analysis, the transcript, or the offer default.
 *
 * The fix: add preferred_language to the join, and resolve through
 * resolveReportLanguage (whose fallback is offerDefaultLanguage() — 'ur' on
 * this single Urdu-medium tenant) instead of flooring to 'en' inline.
 */

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
}));

jest.mock('../../bot/shared/services/whatsapp.service');

jest.mock('../../bot/shared/utils/constants', () => ({
  TEMP_DIR: '/tmp/rumi-test-bd-gfsja',
}));

jest.mock('../../bot/shared/storage/r2', () => ({
  uploadReportPDF: jest.fn().mockResolvedValue('https://r2.example/report.pdf'),
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.mp3'),
  uploadReportImage: jest.fn().mockResolvedValue('https://r2.example/report.png'),
}));

// Every awaited supabase chain in generatePDFReport resolves benignly:
// the prior-sessions count query ends on .neq(), the timestamp update on .eq().
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'update', 'insert', 'single']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.then = (resolve) => resolve({ data: null, error: null, count: 0 });
  return { from: jest.fn(() => chain) };
});

jest.mock('../../bot/shared/config/coaching-messages', () => ({
  getCoachingMessage: jest.fn(() => 'mock message'),
}));

// The renderer is the capture point: generatePDFReport hands it the finished
// reportData (language + _heroInput). Return a Buffer so the PDF branch runs.
jest.mock('../../bot/shared/services/pdf-report.service', () => ({
  generateClassroomObservationReport: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

// A stub transformer keeps the test independent of real framework shapes.
jest.mock(
  '../../bot/shared/services/coaching/report-transformers/report-transformer-dispatch',
  () => ({ getReportTransformer: jest.fn(() => () => ({})) })
);

const fs = require('fs');
const path = require('path');

const ReportGeneratorService = require('../../bot/shared/services/coaching/report-generator.service');
const PDFReportService = require('../../bot/shared/services/pdf-report.service');

const SERVICE_SRC = path.join(
  __dirname, '../../bot/shared/services/coaching/report-generator.service.js'
);

/** Strip // and multi-line comments so assertions can never match prose. */
function strippedSource() {
  return fs.readFileSync(SERVICE_SRC, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const makeSession = (users) => ({
  id: 'sess-bd-gfsja',
  user_id: 'user-bd-gfsja',
  analysis_data: { framework: 'fico' },
  transcript_language: null,
  users,
});

async function renderedLanguageFor(users) {
  PDFReportService.generateClassroomObservationReport.mockClear();
  await ReportGeneratorService.generatePDFReport(
    makeSession(users), 'Annie', { framework: 'fico' }, null
  );
  const [reportData] = PDFReportService.generateClassroomObservationReport.mock.calls[0];
  return reportData;
}

describe('bd-gfsja — report language comes from the teacher, not an inline English floor', () => {
  it('the session load joins preferred_language (the column the resolver reads)', () => {
    // The exact select that feeds generatePDFReport's session object. Without
    // preferred_language here, every downstream read is undefined by construction.
    //
    // Anchored on `phone_number`, not on `first_name`. The original anchor went
    // stale when the split name columns were dropped from the schema: the join
    // stopped mentioning `first_name`, `find()` returned undefined, and the
    // assertion failed on a service that was in fact correct. A guard that
    // cannot tell "the column is missing" from "my anchor moved" reports the
    // wrong thing, which is worse than not guarding.
    const joins = strippedSource().match(/users!inner\(([^)]*)\)/g) || [];
    const mainJoin = joins.find((j) => j.includes('phone_number') && j.includes('name'));
    expect(mainJoin).toBeDefined();
    expect(mainJoin).toContain('preferred_language');
  });

  it('a users row WITHOUT preferred_language lands on the offer default, not English', async () => {
    // This is what production saw fleet-wide: the join omitted the column, so
    // even an Urdu-locked teacher's row arrived without it — and the old
    // `|| 'en'` floor made English win the whole candidate chain.
    const reportData = await renderedLanguageFor({
      phone_number: '923016669553', name: 'Annie',
    });
    expect(reportData.language).toBe('ur');
    expect(reportData._heroInput.opts.language).toBe('ur');
  });

  it("preferred_language='ur' renders Urdu", async () => {
    const reportData = await renderedLanguageFor({
      phone_number: '923016669553', name: 'Annie', preferred_language: 'ur',
    });
    expect(reportData.language).toBe('ur');
    expect(reportData._heroInput.opts.language).toBe('ur');
  });

  it("an explicit preferred_language='en' is still honoured", async () => {
    const reportData = await renderedLanguageFor({
      phone_number: '923001234567', name: 'Sana', preferred_language: 'en',
    });
    expect(reportData.language).toBe('en');
    expect(reportData._heroInput.opts.language).toBe('en');
  });
});
