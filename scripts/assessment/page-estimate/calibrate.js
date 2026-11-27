#!/usr/bin/env node
'use strict';
/**
 * bd-nr8mrm.8 — FEAT-209: how much page does each question type take, so Check and make can say
 * "these questions need about N pages" BEFORE the paper is made.
 *
 *     node scripts/assessment/page-estimate/calibrate.js <papers.json> <out.json>
 *
 * <papers.json> is [{ id, exam_json, request: { grade_code, subject_code } }] read from prod
 * assessment_requests. It is teacher exam content: keep it OUT of the repo. Only the fitted
 * numbers (portal pageEstimate.ts) are committed.
 *
 * Each plain paper is rendered by the real renderer at the TIGHTEST fit step (compact, two
 * columns, trimmed lines), because the estimate warns only when even that overflows. It is laid
 * out at the PDF's content width (A4 minus the 50px margins), measured in print media, and
 * printed to count real PDF pages. `fit.js` then fits height = base + Σ count·perType.
 */

const BOARD_KEY = /^[a-z_]+$/; // board papers use lowercase keys (mcq, srq, erq…): not plain

function typeCounts(exam) {
  const out = {};
  for (const src of ['seen', 'unseen']) {
    for (const cat of ['objective', 'subjective']) {
      const block = exam?.[src]?.[cat];
      if (!block || typeof block !== 'object') continue;
      for (const [type, qs] of Object.entries(block)) {
        if (Array.isArray(qs) && qs.length) out[type] = (out[type] || 0) + qs.length;
      }
    }
  }
  return out;
}

const isPlain = (counts) => Object.keys(counts).length > 0
  && !Object.keys(counts).some((k) => BOARD_KEY.test(k));

async function main([inFile, outFile]) {
  const fs = require('fs');
  const { chromium } = require('playwright-core');
  const Renderer = require('../../../bot/shared/services/assessment/assessment-paper.renderer');
  const papers = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 694, height: 100 } });
  await page.emulateMedia({ media: 'print' });
  const rows = [];
  for (const p of papers) {
    const counts = typeCounts(p.exam_json);
    if (!isPlain(counts)) continue;
    const exam = { ...p.exam_json, _print: { compact: true, fit: { twoCol: true, trimLines: true } } };
    const grade = Number(String(p.request.grade_code).replace(/\D/g, '')) || 3;
    const subject = p.request.subject_code;
    try {
      const html = Renderer.renderPaper({ examJson: exam, grade, subject, chapterTitle: 'Chapter', pageReference: 'p. 1-10' });
      await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const pdf = await page.pdf({ format: 'A4', printBackground: true,
        margin: { top: '50px', right: '50px', bottom: '50px', left: '50px' } });
      const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      rows.push({ grade, subject, counts, height, pdfPages });
      process.stderr.write('.');
    } catch (e) { process.stderr.write('x'); }
  }
  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify(rows));
  console.error(`\n${rows.length} plain papers measured → ${outFile}`);
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
module.exports = { typeCounts, isPlain };
