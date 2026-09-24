"use strict";
/**
 * VENDOR DIVERGENCE (bd-blxml, 2026-09-24). PER-LESSON PAGE-CAP EXEMPTIONS.
 *
 * THE RULING. The operator was given three ways to reconcile "nothing may be CUT" with "we cant
 * go beyond 8": (a) raise the cap for the 40 measured over-8 lessons only, (b) re-segment those
 * 40 into more, shorter lessons, (c) hold 8 as a target for the compliant 88% and accept the 40.
 * She answered "a". So the cap in render_lp.js came down to the 8 she named, and this file is the
 * only way past it.
 *
 * AN EXEMPTION IS A LICENCE FOR A KNOWN LESSON AT A KNOWN HEIGHT. A list of bare names would be a
 * blanket amnesty: a lesson listed at 9 pages grows to 14 three weeks later and nothing in the
 * system says so, because "is it listed?" is the only question being asked. So every entry
 * carries the teach height that was MEASURED for that lesson, and the gate `pageCapsFor` builds
 * from it is `n > thatHeight`. An exempt lesson one page taller than its record fails exactly as
 * loudly as an unlisted one.
 *
 * IT IS DATA, NOT A LITERAL, AND TODAY'S 40 ARE PROVISIONAL. Three changes that move page counts
 * were in flight the day this was seeded -- sentence splitting (~+0.25 pages/lesson), the packer
 * fix (767 -> 757 pages over 112 lessons) and the duplicate board figure (~61 pages). Hard-coding
 * today's 40 would exempt the wrong lessons and let a regressed one through. The file is
 * regenerated from a measured render by
 * `10_Grades 1-5 LP Rebuild/ch9-10-build/regen_cap_exemptions.py`, which is also what cleared
 * (or did not clear) the `provisional` flag it carries.
 *
 * THE KEY IS THE RENDER STEM. Measured over the 335 built renders: `lesson_id` is NOT unique --
 * g5_ch9_Science_seg1 and g5_ch9_Science_seg10 both carry GRADE_5_GENERAL_SCIENCE_CH9_SEG1 -- and
 * 107 of 335 stems do not map to their id by any rule. One id-keyed entry would have licensed two
 * different lessons.
 *
 * A MALFORMED LIST THROWS. The failure mode this design must not have is "the file could not be
 * read, so nothing is exempt" (every over-8 lesson fails at once, loudly but wrongly) or its
 * mirror "the file could not be read, so everything passes". Both are silent policy changes, so
 * the loader refuses to guess: it throws, and the render stops with the reason.
 */

const fs = require("fs");
const path = require("path");

const EXEMPTIONS_PATH = path.join(__dirname, "..", "page_cap_exemptions.json");

const _cache = new Map();

function bad(msg) {
  const e = new Error(`page_cap_exemptions: ${msg}`);
  e.code = "EXEMPTIONS_INVALID";
  return e;
}

/**
 * Read and validate the exemption document.
 * @returns {{provisional: boolean, baseCap: {teach: number}, measured: object,
 *            entries: Object<string, {teach: number}>, path: string}}
 * @throws  Error (.code 'EXEMPTIONS_INVALID') on any shape this file cannot stand behind.
 */
function loadExemptions(file = EXEMPTIONS_PATH) {
  const abs = path.resolve(file);
  if (_cache.has(abs)) return _cache.get(abs);

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") throw bad(`ENOENT — ${abs} not found. A missing list is not an empty one.`);
    throw bad(`${abs} is not readable JSON: ${e.message}`);
  }

  if (!raw || typeof raw !== "object") throw bad(`${abs} is not an object`);
  if (!raw.base_cap || !Number.isInteger(raw.base_cap.teach)) {
    throw bad("base_cap.teach must be an integer — it is what every entry is checked against");
  }
  if (typeof raw.provisional !== "boolean") throw bad("provisional must be true or false");
  const measured = raw.measured || {};
  if (!measured.source || !measured.at) {
    throw bad("measured.source and measured.at are required — an exemption nobody can re-measure is an amnesty");
  }
  const rawEntries = raw.entries;
  if (!rawEntries || typeof rawEntries !== "object" || Array.isArray(rawEntries)) {
    throw bad("entries must be an object of stem -> { teach }");
  }

  const entries = {};
  for (const [stem, e] of Object.entries(rawEntries)) {
    if (!/^[A-Za-z0-9_]+$/.test(stem)) throw bad(`"${stem}" is not a render stem`);
    if (!e || typeof e !== "object" || !("teach" in e)) {
      throw bad(`"${stem}" has no teach height — an exemption records a HEIGHT, not just a name`);
    }
    if (!Number.isInteger(e.teach)) throw bad(`"${stem}".teach must be an integer, got ${JSON.stringify(e.teach)}`);
    if (e.teach <= raw.base_cap.teach) {
      throw bad(`"${stem}".teach is ${e.teach}, which is not above the base cap of ${raw.base_cap.teach} — `
        + "an entry that raises nothing is dead weight and hides the ones that do");
    }
    entries[stem] = { teach: e.teach };
  }

  const doc = { provisional: raw.provisional, baseCap: { teach: raw.base_cap.teach }, measured, entries, path: abs };
  _cache.set(abs, doc);
  return doc;
}

/**
 * The exemption for one render stem, or null. `null` means "held to the ordinary cap" — it is
 * never the answer to "the list could not be read", which throws.
 * @returns {{stem: string, teach: number, provisional: boolean}|null}
 */
function exemptionFor(stem, file = EXEMPTIONS_PATH) {
  if (!stem) return null;
  const doc = loadExemptions(file);
  const e = doc.entries[stem];
  return e ? { stem, teach: e.teach, provisional: doc.provisional } : null;
}

/** Test seam only: drop the memoised documents. */
function clearCache() { _cache.clear(); }

module.exports = { EXEMPTIONS_PATH, loadExemptions, exemptionFor, clearCache };
