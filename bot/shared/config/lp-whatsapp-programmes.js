'use strict';
/**
 * The per-programme WhatsApp switches for lesson plans (pure: no I/O, so the portal can require it too).
 *
 *   lp_whatsapp_pdf_off     a programme on the list gets no lesson-plan PDF on WhatsApp (the plan is in the app)
 *   lp_whatsapp_survey_off  a programme on the list gets no "Was this useful?" survey on WhatsApp
 *
 * Value: a JSON list of programme names from PROGRAMMES, e.g. ["gb"] or ["ict","gb"] (jsonb, or its JSON string).
 * No row = today (no programme is off). Anything else — true, "true", a bare string, an object, a list holding an
 * unknown name or a non-string, bad JSON — is OFF, which also means today. A teacher's programme is "gb" when she is a
 * GB teacher (lp-own-gb isGbTeacher), else "ict"; never the book's curriculum.
 */

const LP_WHATSAPP_PDF_OFF_KEY = 'lp_whatsapp_pdf_off';
const LP_WHATSAPP_SURVEY_OFF_KEY = 'lp_whatsapp_survey_off';
const PROGRAMMES = Object.freeze(['ict', 'gb']);

/** The programmes a stored value lists, lower-cased and deduped; [] for no row or any malformed value. */
function parseProgrammeList(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { return []; }
  }
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return [];
    const name = entry.trim().toLowerCase();
    if (!PROGRAMMES.includes(name)) return [];
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

module.exports = { LP_WHATSAPP_PDF_OFF_KEY, LP_WHATSAPP_SURVEY_OFF_KEY, PROGRAMMES, parseProgrammeList };
