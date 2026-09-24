// bd-f01ob — the FBISE status of each SLO, printed inside the outcome box.
//
// Operator, 2026-09-24: *"drop the Internal tag; show Summative/Formative"*. One chip per SLO, each
// with its own status, from `doc.fbise_slos` — attached at render time from prod's catalogue, never
// the author model's `slo.assessment_status` guess (that one stays unpainted, bd-a8veu.14). A null
// status prints the code alone: an unresolved status is not guessed. Grades 6-8 get one line in the
// label instead, because FBISE does not examine them.
const { esc } = require("./rich");

/** The chip row under the outcome, or "" when the lesson carries no linked SLO. */
function fbiseRow(doc, L) {
  const tags = Array.isArray(doc.fbise_slos) ? doc.fbise_slos : [];
  if (!tags.length) return "";
  const chip = (t) => {
    const status = t.status && L.boardStatus[t.status];
    return `<span class="fchip"><b>${esc(t.code)}</b>${status ? ` ${esc(status)}` : ""}</span>`;
  };
  return `<div class="fbise">${tags.map(chip).join(" ")}</div>`;
}

/** " · No board exam" for grades 6-8, appended to the outcome label; "" otherwise. */
function noBoardExam(doc, L) {
  const grade = Number(doc.provenance && doc.provenance.grade);
  return grade && grade < 9 ? ` &middot; ${esc(L.noBoardExam)}` : "";
}

module.exports = { fbiseRow, noBoardExam };
