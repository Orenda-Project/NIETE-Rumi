#!/usr/bin/env node
/**
 * Render the FICO 5-page PDF fallback from an authored sample. Bypasses the
 * hero PNG dispatch by calling PDFReportService._generatePDFKitReport directly
 * with reportData already shaped by the FICO transformer. Used to iterate on
 * the fallback PDF's visual design without touching production data.
 *
 *   node scripts/render-sample-pdf-report.js [en|ur]
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BOT_ROOT = path.join(ROOT, 'bot');

// Minimum env so requires don't throw.
process.env.NODE_ENV ||= 'production';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'placeholder';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.OPENROUTER_API_KEY ||= 'placeholder';
process.env.OPENAI_API_KEY ||= 'placeholder';
process.env.TEMP_DIR ||= '/tmp';

const lang = (process.argv[2] || 'en').toLowerCase();
const sampleFile = lang === 'ur' ? 'pdf-sample-fico-urdu.json' : 'pdf-sample-fico.json';
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'samples', sampleFile), 'utf8'));

(async () => {
  const { transformFICOToReportData } = require(path.join(
    BOT_ROOT, 'shared/services/coaching/report-transformers/fico-report-transformer'
  ));
  const PDFReportService = require(path.join(BOT_ROOT, 'shared/services/pdf-report.service'));

  const reportData = transformFICOToReportData(sample.session, sample.teacherName, sample.analysis);
  reportData.language = sample.language || 'en';
  reportData.commitmentAction = sample.commitmentAction || '';

  const start = Date.now();
  const buf = await PDFReportService._generatePDFKitReport(reportData);
  const outDir = path.join(ROOT, 'docs/samples');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `pdf-fico-${lang}.pdf`);
  fs.writeFileSync(outFile, buf);
  console.log(`Rendered ${outFile}`);
  console.log(`  size    : ${Math.round(buf.length / 1024)} KB`);
  console.log(`  elapsed : ${Date.now() - start} ms`);
})().catch((e) => {
  console.error('Render failed:', e);
  process.exit(1);
});
