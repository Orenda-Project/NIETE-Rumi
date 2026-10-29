'use strict';
/**
 * The question stems a teacher can tick on a topic paper (bd-6clakk.12), by subject, grade band
 * and question type: each [id, text]. Taken from the item instructions of the FDE model papers
 * (Drive 1JVReBscTMR7RdsiDNmGYCvc54VoOC2DP; research in bd-5jmnfj v1_research/fde-patterns-g1-g2.md
 * and fde-patterns-g3-g5.md). The English, Maths and Science lines are the papers' own wording;
 * the Urdu PDFs extract garbled, so the Urdu lines are the standard Urdu paper instruction for the
 * same FDE item, not a verbatim copy.
 *
 * Maths and Science use one list for both bands ('1-5'). The text is data (language is data, not
 * code), so it lives in stem-bank.json; edit the stems there.
 */
module.exports = { BANK: require('./stem-bank.json') };
