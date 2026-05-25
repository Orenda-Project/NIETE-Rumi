#!/usr/bin/env node
/**
 * render-sample-report.js — regenerate the sample coaching report in docs/samples/.
 *
 * Renders the MEWAKA "hero" celebration report (the current shipped design) from
 * HAND-AUTHORED, representative data — IN-MEMORY, no DB, no LLM, no PII. The hero report
 * is a single tall card delivered in production as an inline image; here we render it to
 * docs/samples/coaching-report-sample.pdf so adopters can see a real report.
 *
 * Pipeline: authored view-model → buildHeroReportHtml() → HTML → (headless browser
 * screenshot) → trim → single-page PDF. The HTML step is pure Node; the image step needs a
 * browser, so:
 *   - `node scripts/render-sample-report.js`            → writes the HTML to a temp file + prints the render recipe
 *   - `CHROME_BIN=/path/to/chrome node scripts/render-sample-report.js`  → renders the PDF end-to-end
 *
 * Why authored data, not a real session: a coaching report renders free-text quotes drawn
 * from the lesson transcript, which carry teacher/student names — unanonymisable for a public
 * repo. Authored data gives authentic pipeline output with zero PII risk.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildHeroReportHtml } = require('../bot/shared/services/coaching/report-v2/hero-report.template');

// A representative MEWAKA report (6 domains / 75 marks). Fake teacher, generic lesson,
// authored narrative — nothing drawn from a real transcript.
const vm = {
  language: 'en',
  teacherName: 'Mwalimu Amina',
  topic: 'Fractions · Grade 5',
  date: '29 April 2026',
  score: { overall: 76, marks: 57, max: 75 },
  groups: [
    { name: 'Introduction',         score: 5,  max: 6,  pct: 83 },
    { name: 'Content Delivery',     score: 19, max: 24, pct: 79 },
    { name: 'Teaching Methods',     score: 14, max: 21, pct: 67 },
    { name: 'Learner Involvement',  score: 7,  max: 9,  pct: 78 },
    { name: 'Classroom Management', score: 8,  max: 9,  pct: 89 },
    { name: 'Conclusion',           score: 4,  max: 6,  pct: 67 },
  ],
  narrative: {
    affirmation: 'You turned a fractions lesson into a room full of thinkers.',
    identity: 'Your classroom runs on curiosity — you ask, you wait, and you let students reach the idea themselves.',
    moments: [{
      quote: 'Who can show us another way to split this into equal parts?',
      why: 'You opened the floor instead of handing over the answer — and several students jumped in. That is the moment the lesson became theirs.',
    }],
    strength_name: 'Questions that make students think',
    strength_note: 'Your open questions pushed the class past recall into real reasoning — the heart of strong teaching.',
    horizon_title: 'Reach every corner of the room',
    horizon_note: 'A few quieter students stayed on the edges. A quick think-pair-share would draw them in next time.',
    journey_note: 'Four lessons in, your scores keep climbing — especially in how you involve your learners.',
  },
  trend: [
    { date: '2026-03-04', pct: 61 },
    { date: '2026-03-18', pct: 68 },
    { date: '2026-04-08', pct: 72 },
    { date: '2026-04-29', pct: 76 },
  ],
  tryNext: 'Next class, try a 30-second think-pair-share before you take answers — it gives every student a way in.',
};

const OUT = path.resolve(__dirname, '..', 'docs', 'samples', 'coaching-report-sample.pdf');
const htmlPath = path.join(os.tmpdir(), 'rumi-hero-sample.html');

let html = buildHeroReportHtml(vm);
html = html.replace('</style>', 'body{background:#fff!important}</style>'); // white page for the still
fs.writeFileSync(htmlPath, html);
console.log(`HTML written: ${htmlPath} (${Math.round(html.length / 1024)} KB)`);

// Find a Chromium-family browser (env first, then common locations).
const candidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const browser = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });

if (!browser) {
  console.log('\nNo browser found. To finish the render, set CHROME_BIN and re-run, e.g.:');
  console.log('  CHROME_BIN="/path/to/chrome" node scripts/render-sample-report.js');
  process.exit(0);
}

const shot = path.join(os.tmpdir(), 'rumi-hero-shot.png');
execFileSync(browser, ['--headless', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=2', '--window-size=794,2400', `--screenshot=${shot}`, htmlPath], { stdio: 'pipe' });

(async () => {
  // sharp + pdfkit are bot dependencies — resolve them from bot/node_modules.
  const botModules = path.resolve(__dirname, '..', 'bot', 'node_modules');
  const sharp = require(path.join(botModules, 'sharp'));
  const PDFDocument = require(path.join(botModules, 'pdfkit'));
  const trimmed = await sharp(shot).trim({ background: '#ffffff', threshold: 6 }).toBuffer();
  const m = await sharp(trimmed).metadata();
  const ptW = (m.width / 2) * 0.75, ptH = (m.height / 2) * 0.75; // 2x device px → CSS px → 72dpi pt
  const doc = new PDFDocument({ size: [ptW, ptH], margin: 0 });
  doc.pipe(fs.createWriteStream(OUT));
  doc.image(trimmed, 0, 0, { width: ptW, height: ptH });
  doc.end();
  console.log(`Wrote ${OUT} (${Math.round(ptW)}×${Math.round(ptH)} pt)`);
})().catch((e) => { console.error(e); process.exit(1); });
