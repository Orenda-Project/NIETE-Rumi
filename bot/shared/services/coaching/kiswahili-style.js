/**
 * Kiswahili style directive — natural, accurate Kiswahili sanifu for the
 * teacher-facing coaching text (hero report narrative, voice debrief, MEWAKA analysis,
 * reflection enhancement).
 *
 * Seeded from native-speaker review: the auto-generated Swahili was grammatically
 * valid but read as over-literal / English-calqued in places, e.g.
 * "uliwapa watoto taratibu thabiti" (you gave the children procedures) where a
 * native Tanzanian educator would say the teacher *established* a routine. This is
 * a living directive — append confirmed corrections to PREFERRED_PHRASINGS as more
 * Kiswahili reviews come in.
 *
 * Inject `KISWAHILI_STYLE` into any prompt branch that emits teacher-facing Kiswahili.
 */

// Confirmed do/don't corrections from native-speaker review. Append over time.
const PREFERRED_PHRASINGS = [
  '• For a teacher\'s systematic routine/orderliness use the abstract noun "utaratibu" and describe what she ESTABLISHED — e.g. "ulianzisha utaratibu thabiti" / "ulikuwa na utaratibu thabiti" (you established / had a firm routine). AVOID "uliwapa watoto taratibu thabiti" (you gave the children procedures) — it reads unnatural and shifts the meaning.',
];

const KISWAHILI_STYLE = `KISWAHILI QUALITY — write as a Tanzanian educator actually speaks and writes (Kiswahili sanifu reviewed with Tanzanian teachers):
- NOT a word-for-word translation from English. Avoid English-calque word order and stilted/over-literal constructions. Reread each sentence and ask: "would a Tanzanian teacher really say it this way?"
- Choose the precise noun form and natural verb collocations; favour describing what the teacher DID or ESTABLISHED in natural Swahili over literal "gave them X" phrasings.
- Confirmed phrasing corrections (follow these):
${PREFERRED_PHRASINGS.join('\n')}`;

module.exports = { KISWAHILI_STYLE, PREFERRED_PHRASINGS };
