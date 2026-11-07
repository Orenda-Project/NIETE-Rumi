/**
 * Give each v9 section a stable id (v9-open ... v9-hw) so a v10 card's Full details can link straight to it.
 * Port of workbench/card/anchor.py. Pure.
 */
const { W } = require('./pytext');

const BAR = { 's-i': 'open', 's-d': 'explain', 's-we': 'we', 's-a': 'you', 's-c': 'check', 's-h': 'hw' };
const ORDER = ['open', 'explain', 'we', 'you', 'check', 'hw'];

/** The html with each v9 section's first block tagged id="v9-<sec>" (idempotent). */
function addIds(html) {
  const seen = new Set([...html.matchAll(new RegExp(`id="v9-(${W}+)"`, 'gu'))].map((m) => m[1]));
  return html.replace(/<div data-atom class="([^"]*)"/g, (all, cls) => {
    const sec = cls.split(/\s+/).filter(Boolean).map((c) => (Object.prototype.hasOwnProperty.call(BAR, c) ? BAR[c] : null))
      .find((s) => s !== null);
    if (sec === undefined || seen.has(sec)) return all;
    seen.add(sec);
    return `<div data-atom id="v9-${sec}" class="${cls}"`;
  });
}

/** The sections that have no v9 anchor. */
const missing = (html) => ORDER.filter((s) => !html.includes(`id="v9-${s}"`));

module.exports = { addIds, missing, ORDER, BAR };
