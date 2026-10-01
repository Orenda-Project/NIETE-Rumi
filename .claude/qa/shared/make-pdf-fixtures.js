#!/usr/bin/env node
'use strict';
/**
 * make-pdf-fixtures — the two coaching lesson-plan-step documents as REAL PDFs, written by pdfkit (the bot's own
 * PDF library), so the extraction worker's pdf-parse reads them. A hand-built PDF was refused with
 * "Command token too long" (run 20260930-0832) and the classifier never ran.
 *
 *   node .claude/qa/shared/make-pdf-fixtures.js      → fixtures/whatsapp/niete/media/{lesson_plan_fractions_g5,staff_meeting_notes}.pdf
 *
 * pdfkit is resolved from the bot's node_modules (this worktree's, else the main NIETE-Rumi checkout's).
 */
const path = require('path');
const fs = require('fs');
const here = __dirname;
const candidates = [path.resolve(here, '..', '..', '..', 'bot', 'node_modules', 'pdfkit'), path.resolve(here, '..', '..', '..', '..', '..', '..', 'NIETE-Rumi', 'bot', 'node_modules', 'pdfkit')];
const pk = candidates.find((p) => fs.existsSync(p));
if (!pk) { console.error('pdfkit not found in ' + candidates.join(' | ')); process.exit(2); }
const PDFDocument = require(pk);
const MEDIA = path.resolve(here, '..', 'fixtures', 'whatsapp', 'niete', 'media');
const LP = ['Lesson Plan - Grade 5 Mathematics - Fractions (Equivalent Fractions)', 'Teacher: E2E Driver    Duration: 40 minutes    Class: Grade 5', '',
  'Learning Objectives:', '1. Students will identify equivalent fractions using fraction strips.', '2. Students will explain why 1/2 equals 2/4 and 3/6.',
  '3. Students will generate two equivalent fractions for a given fraction.', '', 'Materials: fraction strips, chart paper, markers, whiteboard, student notebooks.', '',
  'Prior Knowledge: Students can read and write simple fractions (halves, quarters).', '', 'Activities:',
  '1. Warm-up (5 min): Show 1/2 shaded on the board; ask what fraction is shaded.', '2. Introduction (10 min): Fold paper strips into halves, quarters, eighths; compare.',
  '3. Pair work (15 min): Each pair finds three fractions equal to 1/2 using strips.', '4. Whole-class (5 min): Pairs share findings; teacher records on chart paper.', '',
  'Assessment: Exit ticket - write two fractions equivalent to 2/3 and explain one.', 'Planned questions: What happens to the numerator and denominator when we double both?', 'Homework: Textbook page 42, questions 1-5.'];
const NOTES = ['Staff meeting - Friday 2 pm - main hall', '', 'Agenda:', '1. Attendance registers must be submitted to the office every Monday.',
  '2. Sports day rota: Grade 4 and 5 teachers on the field, Grade 1-3 in the hall.', '3. Parent-teacher evening is on the 14th; bring the term reports.',
  '4. The new duty timetable starts next week; check the notice board.', '5. Leave forms for the winter break are due by Thursday noon.', '', 'Tea will be served after the meeting. Please be on time.', '',
  // pdf-parse refuses a PDF this short ("bad XRef entry" under ~1.7 KB, measured 2026-09-30) — the notices below keep it readable
  'Other notices:', 'The library will be closed on Wednesday for stock-taking.', 'Bus duty pairs are posted outside the staff room.', 'Please return the projector remote to the office after use.',
  'The canteen menu for next month is on the notice board.', 'Reminder: the fire drill is on Tuesday at 10 am.', 'Thank you for your cooperation.'];
function write(name, lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false, pdfVersion: '1.3' });   // plain, uncompressed: the extraction worker's pdf-parse rejected pdfkit's default output ("bad XRef entry")
    const out = fs.createWriteStream(path.join(MEDIA, name));
    doc.pipe(out); doc.font('Helvetica').fontSize(11);
    for (const ln of lines) doc.text(ln || ' ');
    doc.end(); out.on('finish', () => resolve(path.join(MEDIA, name))); out.on('error', reject);
  });
}
(async () => { for (const [n, l] of [['lesson_plan_fractions_g5.pdf', LP], ['staff_meeting_notes.pdf', NOTES]]) console.log(await write(n, l), fs.statSync(path.join(MEDIA, n)).size, 'bytes'); })();
