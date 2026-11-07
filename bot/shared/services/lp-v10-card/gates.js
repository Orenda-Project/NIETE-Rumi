/**
 * The build gates of the v10 card builder (port of gates and with_video in workbench/card/build_card.py; not its file
 * I/O or CLI). Pure: the caller reads the v9 page, writes the card, and decides what to do with the errors.
 */
const { validate } = require('./rules');
const C = require('./check');
const { missing } = require('./anchor');
const { a } = require('./render');

/**
 * Every reason this card may not ship; [] means it passes.
 * @param {object} card card.json (with its video already set by withVideo)
 * @param {string} html the rendered card
 * @param {string} v9Html the v9 page, after anchor.addIds
 * @param {string[]} must the v9 must-happen move ids
 */
function gates(card, html, v9Html, must) {
  const errs = [...validate(card)];
  C.uncovered(html, must).forEach((m) => errs.push(`v9 must-happen move not carried: ${m}`));
  if (C.cardPictures(html) < C.v9Diagrams(v9Html)) errs.push(`${C.cardPictures(html)} pictures for ${C.v9Diagrams(v9Html)} v9 diagrams`);
  C.badLinks(html, card.v9_html).forEach((h) => errs.push(`bad Full details link: ${h}`));
  const secs = new Set(card.sections.map((s) => s.sec));
  missing(v9Html).filter((s) => secs.has(s)).forEach((s) => errs.push(`v9 has no section to land on: ${s}`));
  const v = C.v9Video(v9Html);
  if (v && !html.includes(`href="${a(v[0])}"`)) errs.push(`v9 video not carried: ${v[1]}`);
  return errs;
}

/** The card with the v9 day's video link (taken from v9, never written by hand), or without one. Mutates and returns the card. */
function withVideo(card, v9Html) {
  delete card.video;
  const v = C.v9Video(v9Html);
  if (v) card.video = { href: v[0], title: v[1] };
  return card;
}

module.exports = { gates, withVideo };
