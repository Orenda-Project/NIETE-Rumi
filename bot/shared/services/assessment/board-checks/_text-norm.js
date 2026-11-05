'use strict';
/**
 * Text helpers shared by the slice-6b members (figure-ban, tag-complete, key-leak, readability).
 * `fold` is the same fold `fde-mcq-key-tells.js:16` uses (Arabic marks removed, ي ى -> ی, ك -> ک),
 * plus NFKC and lower case. Pure.
 */

const MARKS = /[ً-ٰٟـ]/g;

const str = (x) => {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  if (typeof x === 'object' && typeof x.text === 'string') return x.text;
  return '';
};

const fold = (s) => str(s).normalize('NFKC').replace(MARKS, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').toLowerCase().replace(/\s+/g, ' ').trim();

/** "A) twelve", "(b) 5 cm", "الف) پانچ" -> the option body. */
const stripLabel = (s) => str(s).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim();

const tokens = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const wordCount = (s) => str(s).split(/\s+/).filter(Boolean).length;

/** The member-interface Issue (registry.md section 1). `check` is the member id, `code` the issue name. */
const issue = (check, code, item_ref, msg, hard) => ({ check, code, item_ref, msg: `${code}: ${msg}`, hard: !!hard });

const excerpt = (s, n = 60) => str(s).replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = { fold, stripLabel, tokens, wordCount, str, issue, excerpt };
