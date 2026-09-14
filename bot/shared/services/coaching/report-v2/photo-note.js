/**
 * bd-8s2xb — the one line under the report's photo strip that says what was READ from
 * the teacher's photo. Until now the hero report framed the raw photo and nothing the
 * model saw in it reached the teacher (analysis_data.photo_analysis had zero readers).
 *
 * Source order:
 *   1. the first indicator whose evidence the scorer prefixed "Photo:" (the prefix stripped)
 *   2. else the first sentence of the vision description
 *   3. else null → no caption, strip renders exactly as before
 *
 * Capped at ~110 chars, word-boundary, so it fits the 11px caption row in two lines. Pure: no I/O, no LLM.
 * The template HTML-escapes it via T() (untrusted content — it is LLM prose) and .pcap
 * already carries the RTL font branch (bd-osmk0), so an Urdu quote inside it shapes correctly.
 */
// The report's chrome (section labels) is English on every report by design (9f1e0b61);
// this label follows that policy. The note text itself is whatever the scorer wrote.
const LABEL = 'From your photo: ';
const CAP = 110;

function firstSentence(s) {
  const t = String(s || '').replace(/^Classroom photo \d+ \(submitted by the teacher\):\s*/i, '').trim();
  const m = t.match(/^[^.!?۔]+[.!?۔]?/);
  return (m ? m[0] : t).trim();
}
// Cut at a word boundary, no trailing ellipsis: under an RTL base direction the UBA paints a
// trailing "…" on the wrong side of the last Latin word (seen on the first sample render).
function cap(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= CAP) return t;
  const cut = t.slice(0, CAP);
  const at = cut.lastIndexOf(' ');
  return (at > 40 ? cut.slice(0, at) : cut).replace(/[\s,;:—-]+$/, '');
}

function buildPhotoNote(analysis) {
  if (!analysis || typeof analysis !== 'object') return null;
  const label = LABEL;
  for (const d of Object.values(analysis.domains || {})) {
    for (const ind of (d && d.indicators) || []) {
      // "Photo:" is asked for at the head of the evidence, but the scorer also writes it
      // mid-sentence ("… Photo: board shows the title …") — take the sentence after it.
      const ev = String((ind && ind.evidence) || '');
      const m = ev.match(/Photo:\s*([^]+)/i);
      if (m && m[1].trim()) return label + cap(firstSentence(m[1]));
    }
  }
  const desc = firstSentence(analysis.photo_analysis);
  return desc ? label + cap(desc) : null;
}

module.exports = { buildPhotoNote };
