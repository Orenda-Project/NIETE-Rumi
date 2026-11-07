'use strict';
// Part of assessment-paper-fde.renderer.js (see its header); split for the 300-line limit, bd-5jmnfj.37.

/**
 * The paper page each frame landed on, read from the finished PDF: every frame
 * is a named destination `fde-frame-<slot>`. Returns { [slot]: page } (1-based);
 * a frame it cannot find is left out.
 */
async function framePages(pdfBuffer) {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRef } = require('pdf-lib');
  const out = {};
  try {
    const doc = await PDFDocument.load(pdfBuffer, { updateMetadata: false });
    const pageRefs = doc.getPages().map((p) => p.ref.toString());
    const pageOf = (dest) => {
      let arr = dest;
      if (arr instanceof PDFRef) arr = doc.context.lookup(arr);
      if (arr instanceof PDFDict) arr = arr.lookup(PDFName.of('D'));
      if (!(arr instanceof PDFArray)) return null;
      const first = arr.get(0);
      const idx = first ? pageRefs.indexOf(first.toString()) : -1;
      return idx >= 0 ? idx + 1 : null;
    };
    const decode = (k) => {
      if (k instanceof PDFName) return k.decodeText ? k.decodeText() : k.asString().replace(/^\//, '');
      if (k instanceof PDFString || k instanceof PDFHexString) return k.decodeText();
      return String(k);
    };
    const record = (name, dest) => {
      const m = /^fde-frame-(.+)$/.exec(name);
      if (!m) return;
      const page = pageOf(dest);
      if (page) out[m[1]] = page;
    };
    const catalog = doc.catalog;
    const dests = catalog.lookup(PDFName.of('Dests'));
    if (dests instanceof PDFDict) {
      for (const [k, v] of dests.entries()) record(decode(k).replace(/^\//, ''), v);
    }
    const names = catalog.lookup(PDFName.of('Names'));
    const tree = names instanceof PDFDict ? names.lookup(PDFName.of('Dests')) : null;
    const walk = (node) => {
      if (!(node instanceof PDFDict)) return;
      const leaf = node.lookup(PDFName.of('Names'));
      if (leaf instanceof PDFArray) {
        for (let i = 0; i + 1 < leaf.size(); i += 2) record(decode(leaf.lookup(i)), leaf.lookup(i + 1));
      }
      const kids = node.lookup(PDFName.of('Kids'));
      if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i += 1) walk(kids.lookup(i));
    };
    walk(tree);
  } catch {
    return out;
  }
  return out;
}

module.exports = {
  framePages,
};
