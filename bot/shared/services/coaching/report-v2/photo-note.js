/**
 * bd-8s2xb → bd-1mcpe — the caption under each framed classroom photo in the hero report.
 *
 * One caption PER framed photo, taken from THAT photo's own vision description
 * (analysis_data.photo_analysis holds one "Classroom photo N (submitted by the teacher): …"
 * block per photo, N = the photo's original position). Only the first clause is used:
 * the descriptions are written for the scorer — a description, then "but lacks …" /
 * "However, … worn" critique — and the critique must never sit under a teacher's own photo.
 *
 * Seen on the sandbox E2E (14 Sep 2026): a single caption on frame 1 only, cut mid-clause at
 * 110 chars ("… with vocabulary and polite"), and a blank panel under frame 2. 93% of prod
 * descriptions have a first sentence over 110 chars; the first clause fits in 90%.
 *
 * The scorer's "Photo:"-prefixed indicator evidence is NOT used here: it does not say which
 * photo it came from, so it cannot be placed under the right picture.
 *
 * Pure: no I/O, no LLM. The template esc()'s the caption into an LTR block (.pcap).
 */
// The report's chrome is English on every report by design (9f1e0b61); the label follows it.
const LABEL = 'From your photo: ';
const CAP = 110;
const BLOCK_RE = /Classroom photo (\d+) \(submitted by the teacher\):\s*([\s\S]*?)(?=\n\s*\n\s*Classroom photo \d+ \(submitted by the teacher\):|$)/g;
// Where the descriptive half ends and the scorer's critique/elaboration begins.
const CLAUSE_BREAK = /,\s*(?:but|however|with|suggesting|though|although|while|yet|and there)\b|;\s*|\s+[—–]\s+/i;

/** The first clause of a description's first sentence, capped at a word boundary, ending in a full stop. */
function firstClause(desc) {
  const text = String(desc || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentence = (text.match(/^[^.!?۔]+[.!?۔]?/) || [text])[0].trim();
  let clause = sentence.split(CLAUSE_BREAK)[0].trim().replace(/[.!?۔\s,;:—–-]+$/, '');
  if (clause.length > CAP - 1) {
    const cut = clause.slice(0, CAP - 1);
    const at = cut.lastIndexOf(' ');
    clause = (at > 40 ? cut.slice(0, at) : cut).replace(/[\s,;:—–-]+$/, '');
  }
  return clause ? `${clause}.` : '';
}

/** { [photoIndex0]: caption } from analysis.photo_analysis, keyed by the photo's ORIGINAL index. */
function buildPhotoCaptions(analysis) {
  const out = {};
  const pa = analysis && typeof analysis === 'object' ? String(analysis.photo_analysis || '') : '';
  if (!pa) return out;
  for (const m of pa.matchAll(BLOCK_RE)) {
    const idx = Number(m[1]) - 1;
    const clause = firstClause(m[2]);
    if (idx >= 0 && clause && out[idx] === undefined) out[idx] = LABEL + clause;
  }
  return out;
}

/**
 * Put each caption under the frame whose ORIGINAL photo index matches (frames carry `index`
 * from buildClassroomPhotoVm; a photo that failed to download is simply absent). A frame with
 * no description is left exactly as it was.
 */
function applyPhotoCaptions(framed, analysis) {
  if (!Array.isArray(framed) || !framed.length) return Array.isArray(framed) ? framed : [];
  const captions = buildPhotoCaptions(analysis);
  return framed.map((p, i) => {
    const idx = Number.isInteger(p && p.index) ? p.index : i;
    return captions[idx] ? { ...p, caption: captions[idx] } : p;
  });
}

module.exports = { firstClause, buildPhotoCaptions, applyPhotoCaptions };
