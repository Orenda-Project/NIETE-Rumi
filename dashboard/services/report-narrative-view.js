'use strict';
/**
 * bd-fmf24g.10 — the stored report narrative (analysis_data.report_narrative, written by the bot's
 * report-v2/narrative-store when the report is rendered) as the teacher app's report page reads it.
 *
 * A pure mapper with no requires: the portal serves ONLY these fields of the blob, so nothing else in
 * analysis_data (the voice script, the coach's debrief, the model's own side fields) can ride along.
 * Null when there is nothing a page could show — an older session, or one whose narrative never
 * generated — so the page leaves the sections out rather than draw empty ones.
 */

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * @param {object|null} analysisData coaching_sessions.analysis_data
 * @returns {null|{headline:string, identity:string,
 *   moments:Array<{title:string,quote:string,why:string}>,
 *   strength:{title:string,note:string}|null, horizon:{title:string,note:string}|null,
 *   domainWhys:Object<string,string>, language:string|null}}
 */
function narrativeView(analysisData) {
  const n = analysisData && analysisData.report_narrative;
  if (!n || typeof n !== 'object' || Array.isArray(n)) return null;

  const moments = (Array.isArray(n.moments) ? n.moments : [])
    .filter((m) => m && typeof m === 'object' && text(m.quote))
    .map((m) => ({ title: text(m.title), quote: text(m.quote), why: text(m.why) }));
  const pair = (title, note) => (text(title) ? { title: text(title), note: text(note) } : null);
  const strength = pair(n.strength_name, n.strength_note);
  const horizon = pair(n.horizon_title, n.horizon_note);
  const headline = text(n.affirmation);
  const identity = text(n.identity);

  const domainWhys = {};
  if (n.domain_whys && typeof n.domain_whys === 'object' && !Array.isArray(n.domain_whys)) {
    for (const [k, v] of Object.entries(n.domain_whys)) {
      if (typeof v === 'string' && v.trim()) domainWhys[k] = v.trim();
    }
  }

  if (!headline && !identity && !moments.length && !strength && !horizon) return null;
  return {
    headline, identity, moments, strength, horizon, domainWhys,
    language: typeof n._language === 'string' ? n._language : null,
  };
}

module.exports = { narrativeView };
