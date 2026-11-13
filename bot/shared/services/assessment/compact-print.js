'use strict';
/**
 * "Save paper" print for a regular paper (bd-ipoxhx.5, ICT Feedback AG row 30).
 *
 * Teachers pay for every sheet they print. The same A4 page, packed tighter: smaller margins, type
 * and gaps. The ruled answer lines keep their height, because a child's handwriting does not shrink.
 * The CSS is appended after the paper's own style, so it wins the cascade and a paper printed
 * without the option is unchanged. Pure.
 */

function compactCss({ rtl = false } = {}) {
  return `
<style>
  @page { size: A4; margin: 8mm 9mm; }
  body { font-size: ${rtl ? '12pt' : '10.5pt'}; line-height: ${rtl ? 1.75 : 1.3}; }
  .class-line { margin: 1px 0 5px; }
  .chapter { margin-bottom: 5px; }
  table.marks-header { margin-bottom: 6px; font-size: 10pt; }
  table.marks-header td { padding: 3px 6px; height: 18px; }
  .instructions { padding: 4px 8px; font-size: 9.5pt; margin-bottom: 7px; }
  h3.type { font-size: 10.5pt; margin: 9px 0 5px; padding-bottom: 2px; break-after: avoid; page-break-after: avoid; }
  .lead { margin: 4px 0 3px; }
  .q { margin-bottom: 5px; }
  .q p { margin: 0 0 2px; }
  .opt { margin: 1px 0; }
  .word { margin: 3px 0; }
  .passage { padding: 5px 8px; margin: 4px 0 5px; }
  .sub { margin: 3px 0 2px; }
  table.match th, table.match td { padding: 3px 6px; }
</style>`;
}

module.exports = { compactCss };
