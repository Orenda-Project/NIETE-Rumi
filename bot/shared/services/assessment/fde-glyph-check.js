'use strict';
/**
 * bd-5jmnfj.4.58.7.7: a printed string holding U+FFFD or a control character (v35 G5 Urdu Q4 item 2 option ج
 * printed «مگر، کیوں ک�ہ»). Every string of an item the child or teacher reads is scanned; the picture
 * description (the artist's brief) and the `checked` note are skipped, as fde-placeholder-check does.
 * Flagged: U+FFFD, U+FFFE, U+FFFF, a lone surrogate, a C0 control other than \n \t \r, a C1 control.
 * ZWNJ and ZWJ (U+200C, U+200D) are real Urdu letters-joiners and are not flagged.
 *
 * Pure: exam JSON in, shortfall rows out in the shape fde-placeholder-check uses; never throws.
 * The check never authors content: the note says what to rewrite, never with what.
 */

const BAD = /[�￾￿\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const SKIP = new Set(['picture', 'checked']);

const strings = (v, out) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) if (!SKIP.has(k)) strings(x, out);
  }
  return out;
};

const codePoint = (ch) => `U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

/** `[{slot, reason:'glyph', items:['<slot>: «<text>» holds U+XXXX']}]`, one row a slot; [] when clean. */
function glyphShortfall(examJson) {
  if (!examJson || typeof examJson !== 'object') return [];
  const bySlot = new Map();
  for (const branch of ['seen', 'unseen']) {
    const cats = examJson[branch];
    if (!cats || typeof cats !== 'object') continue;
    for (const types of Object.values(cats)) {
      if (!types || typeof types !== 'object') continue;
      for (const list of Object.values(types)) {
        if (!Array.isArray(list)) continue;
        for (const q of list) {
          if (!q || typeof q !== 'object' || q.removed === true) continue;
          for (const text of strings(q, [])) {
            const found = [...new Set(text.match(BAD) || [])].map(codePoint);
            if (!found.length) continue;
            const row = bySlot.get(q.slot) || { slot: q.slot, reason: 'glyph', items: [] };
            row.items.push(`${q.slot}: «${text.trim()}» holds ${found.join(', ')}`);
            bySlot.set(q.slot, row);
          }
        }
      }
    }
  }
  return [...bySlot.values()];
}

/** The re-ask's note, one sentence a flagged string; '' when the shortfall holds no glyph row. */
function glyphNote(shortfall) {
  const rows = (Array.isArray(shortfall) ? shortfall : []).filter((r) => r && r.reason === 'glyph');
  const items = rows.flatMap((r) => r.items || []);
  if (!items.length) return '';
  return `${items.map((i) => `${i}.`).join(' ')} `
    + 'Rewrite each of these strings without the broken character, in ordinary letters with no replacement or '
    + 'control character, keeping its meaning, and leave every other item unchanged.';
}

module.exports = { glyphShortfall, glyphNote };
