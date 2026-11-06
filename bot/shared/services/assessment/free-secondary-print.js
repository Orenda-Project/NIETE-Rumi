'use strict';
/**
 * bd-5jmnfj.38.31 — what a G6-12 free paper adds when it is printed. Pure, no I/O.
 *
 *   instructionsFor  A5g  the paper prints the minutes it was sized to, not "as specified by your teacher"
 *   markingHtml      A7c  the key prints each item's marking points, mark bands, what else to accept
 *                        and what not to accept
 *
 * A paper without `_timeMinutes`, or an item without those fields, prints exactly as before.
 */

const TIME_LINE = /^Time allowed:/;

function instructionsFor(examJson, base) {
  const minutes = Number(examJson && examJson._timeMinutes);
  if (!(minutes > 0)) return base;
  return base.map((line) => (TIME_LINE.test(line) ? `Time allowed: ${minutes} minutes.` : line));
}

function markingHtml(item, esc) {
  if (!item || typeof item !== 'object') return '';
  const out = [];
  const points = Array.isArray(item.marking_points) ? item.marking_points.filter((p) => p && p.point) : [];
  if (points.length) {
    out.push(`<ul class="points">${points.map((p) => `<li>${esc(p.point)}${p.marks != null ? ` (${esc(p.marks)})` : ''}</li>`).join('')}</ul>`);
  }
  const bands = Array.isArray(item.mark_bands) ? item.mark_bands.filter((b) => b && b.descriptor) : [];
  if (bands.length) {
    out.push(`<ul class="bands">${bands.map((b) => `<li>${esc(b.marks)}: ${esc(b.descriptor)}</li>`).join('')}</ul>`);
  }
  if (item.accept) {
    const note = String(item.accept);
    out.push(`<div class="accept">${/^accept\b/i.test(note) ? '' : 'Accept: '}${esc(note)}</div>`);
  }
  if (item.reject) {
    const note = String(item.reject);
    out.push(`<div class="reject">${/^do not accept\b/i.test(note) ? '' : 'Do not accept: '}${esc(note)}</div>`);
  }
  return out.join('');
}

module.exports = { instructionsFor, markingHtml };
