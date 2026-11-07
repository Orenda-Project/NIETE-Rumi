/**
 * Pure checks for a v10 card's HTML (v20, 12 Oct 2026). Port of workbench/card/card_check.py. No I/O.
 */
const { unesc, W } = require('./pytext');

const SECTIONS = new Set(['open', 'explain', 'we', 'you', 'check', 'hw']);
const MOVE = /<div class="mv"([^>]*)>\s*<span class="n">([0-9]+)<\/span>/g;

/** Each numbered move: [number, Set of the v9 move ids it carries]. */
function moves(html) {
  return [...html.matchAll(MOVE)].map((m) => {
    const cov = /data-covers="([^"]*)"/.exec(m[1]);
    return [parseInt(m[2], 10), new Set(cov ? cov[1].split(/\s+/).filter(Boolean) : [])];
  });
}

/** v9 must-happen move ids that no card move carries, in numeric order. */
function uncovered(html, mustHappen) {
  const carried = new Set(moves(html).flatMap(([, c]) => [...c]));
  return [...new Set(mustHappen)].filter((s) => !carried.has(s)).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
}

/** Section minutes from the time bar, in order: [[section, minutes]]. */
function minutes(html) {
  return [...html.matchAll(new RegExp(`<span data-sec="(${W}+)" style="flex:([0-9]+)`, 'gu'))]
    .map((m) => [m[1], parseInt(m[2], 10)]);
}

/** The star slot exists, is hidden, and no section is ringed for it. */
function starHidden(html) {
  const slot = /<div class="star"[^>]*>/.exec(html);
  return !!slot && slot[0].includes(' hidden') && !html.includes('class="sec mark"');
}

/** Full-details links that do not point at a v9 section id. */
function badLinks(html, v9Name) {
  return [...html.matchAll(/<a class="fd" href="([^"]*)"/g)].map((m) => m[1])
    .filter((h) => !(h.startsWith(`${v9Name}#v9-`) && SECTIONS.has(h.split('#v9-')[1])));
}

/** True if the on-screen page box has a fixed pixel width (not phone-fluid). Print rules do not count. */
function fixedWidth(html) {
  const screen = html.replace(/@media print\{.*?\}\}/gs, '');
  return /\.page\{[^}]*(?<!max-)width:[0-9]+px/.test(screen);
}

/** How many diagrams (board, flowchart, maths picture) the v9 lesson draws. */
const v9Diagrams = (v9Html) => v9Html.split('<figure class="dg"').length - 1;

/** Pictures on the card that stand for a v9 diagram: blocks tagged data-pic, drawn not described. */
const cardPictures = (html) => html.split(' data-pic=').length - 1;

/** The v9 "Video resource" link as [href, title], or null when the day has no video. */
function v9Video(v9Html) {
  const m = /<div class="vres">.*?<a href="([^"]+)"[^>]*>(.*?)<\/a>/s.exec(v9Html);
  return m ? [unesc(m[1]), unesc(m[2])] : null;
}

module.exports = { moves, uncovered, minutes, starHidden, badLinks, fixedWidth, v9Diagrams, cardPictures, v9Video, SECTIONS };
