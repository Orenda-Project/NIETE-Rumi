/**
 * bd-f01ob (v6) — the printed file is TWO pages: the whole lesson on one, the support on the next.
 *
 * Operator, 2026-09-24: "keep it 2 pages, 1 page teaching, next page teacher suppport, dont mix it
 * up" — and "approved" on the v6 mockup, whose PDF is one tall phone-width page per part.
 *
 * Pagination into phone pages still runs first, and its count is still the length gate (PAGE
 * COUNT / PAGE TARGET, the author ladder). This module only changes what is PRINTED: each part is
 * rebuilt with no breaks — one footer, no "…continued" strip — and printed on a named @page whose
 * height is that part's measured height, so nothing is cut and nothing is padded.
 */

// Runs in the page. Returns [{part, h}] in paint order, or null when a page has no height —
// the caller then prints the phone pages, never a blank or zero-height page.
// The `lp612-continuous` id is also what the tests dispatch on.
const CONTINUOUS = `() => {
  const pages = Array.from(document.querySelectorAll('.page[data-part]'));
  if (!pages.length) return null;
  const free = document.createElement('style');
  free.id = 'lp612-continuous';
  free.textContent = '.page{height:auto!important;min-height:0!important;overflow:visible!important}';
  document.head.appendChild(free);
  const sizes = pages.map((el) => ({
    part: el.getAttribute('data-part'),
    h: Math.ceil(el.getBoundingClientRect().height) + 2,
  }));
  if (sizes.some((s) => !(s.h > 2))) return null;
  const w = Math.ceil(pages[0].getBoundingClientRect().width);
  free.textContent += sizes.map((s) =>
    '@page ' + s.part + '{size:' + w + 'px ' + s.h + 'px;margin:0}' +
    '.page[data-part=' + s.part + ']{page:' + s.part + ';height:' + s.h + 'px!important}'
  ).join('');
  return sizes;
}`;

/** True when every part came back with a usable height. */
function usableSizes(sizes) {
  return Array.isArray(sizes) && sizes.length > 0 && sizes.every((s) => s && s.part && s.h > 2);
}

/**
 * Rebuild `htmlPath` with no breaks, load it and size a page per part.
 * @returns {Promise<Array<{part:string,h:number}>|null>} null → the caller restores the phone pages.
 */
async function joinParts(page, load, htmlPath, rebuild, writeFile) {
  writeFile(htmlPath, rebuild({ teach: [], support: [] }).html);
  await load(htmlPath);
  const sizes = await page.evaluate(`(${CONTINUOUS})()`);
  return usableSizes(sizes) ? sizes : null;
}

module.exports = { CONTINUOUS, usableSizes, joinParts };
