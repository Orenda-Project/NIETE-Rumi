/**
 * coaching.cjs — the delivered report is recognised when its caption carries the Step 5/5 line (bd-05v2sn).
 *
 * Since the Meta bill cut (8d85965b5, 2026-10-01, NC2) the bot sends the coaching report IMAGE with the
 * "🔄 Step 5/5: Creating your personalized voice debrief..." line in its caption. The walker's report
 * detector was written when that line was its own text message and rejects any row matching the
 * pipeline-noise pattern (/Step \d\/5/), so the report row is never recognised, the commit card that
 * depends on obs.report is ignored, and every run "goes silent" until the stall budget expires:
 * COA04/05/07/15 BLOCKED on every run since, 240 s per coaching shard.
 *
 * Red-first: fails on the branch — coaching.cjs exports no isReportRow, and the predicate rejects the row.
 */
const { isReportRow } = require('../../.claude/qa/shared/features/coaching.cjs');

// the row exactly as the mock Graph API handed it to the walker in run 20261026-1505-par
const REPORT_IMAGE = { img: true, txt: '📋 Your coaching report · Types of Fractions · 2026-10-26\n🔄 Step 5/5: Creating your personalized voice debrief...', btns: [] };
const STEP_TEXT = { txt: '🔄 Step 4/5: Generating your comprehensive observation report with visualizations...', btns: [] };
const REPORT_PDF = { pdf: true, doc: true, txt: 'coaching report', btns: [] };
const PHOTO_ACK = { img: false, txt: '📸 Photo 1 of 3 received. Would you like to add another photo?', btns: ['Add another', 'Done'] };

test('the report image is the report even with the Step 5/5 line in its caption', () => {
  expect(isReportRow(REPORT_IMAGE, ['2', '3'])).toBe(true);
});
test('a text-only step announcement is still noise, not the report', () => {
  expect(isReportRow(STEP_TEXT, ['2', '3'])).toBe(false);
});
test('a PDF report counts; a photo acknowledgement does not', () => {
  expect(isReportRow(REPORT_PDF, ['2'])).toBe(true);
  expect(isReportRow(PHOTO_ACK, ['2'])).toBe(false);
});
test('nothing counts as the report before any pipeline step was seen', () => {
  expect(isReportRow(REPORT_IMAGE, [])).toBe(false);
});
