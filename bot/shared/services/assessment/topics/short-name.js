'use strict';
/**
 * Teacher-facing topic names and topic-id slugs. Pure, Unicode-safe (Urdu counted in code points).
 */
const MAX_NAME = 40;
const MAX_SLUG = 48;
const TRAILING_JUNK = /[\s+&:—–\-,/;·|]+$/u;
const SUFFIX = /\(([^()]*)\)$/;
const SPACE = /\s/;
const MARK = /\p{M}/u;
const CLAUSE = /, | \+ | & | \/ |; /g;
const MIN_CLAUSE = 15;
const CONNECTOR = /\s+(?:the|of|and|or|a|an|to|in|on|for|with|at|by|from|into|using|between|that|when|while|which|about|as|کا|کی|کے|اور|سے|میں|کو|نے)$/iu;

const pieces = (s) => s.split(/[+/]/).map((p) => p.trim().toLowerCase()).filter(Boolean);

/** Drop a trailing "(…)" only when it names the row's section, e.g. "(Memory Lane)". */
function stripSectionSuffix(text, section) {
  const m = text.match(SUFFIX);
  if (!m || !section) return text;
  const sec = pieces(section);
  return pieces(m[1]).some((p) => sec.includes(p)) ? text.slice(0, m.index) : text;
}

/** Cut to MAX_NAME code points at the last space; a single long word is hard-cut off a mark. */
function cap(text) {
  const cps = Array.from(text);
  if (cps.length <= MAX_NAME) return text;
  let cut = -1;
  for (let i = MAX_NAME; i > 0; i -= 1) {
    if (SPACE.test(cps[i])) { cut = i; break; }
  }
  if (cut < 0) {
    cut = MAX_NAME;
    while (cut > 1 && MARK.test(cps[cut])) cut -= 1;
  }
  return stripConnectors(dropOpenParen(atLastClause(cps.slice(0, cut).join(''))));
}

/** A cut that keeps a later clause (", " " + " " & " " / " "; " at code point ≥15) ends at that clause. */
function atLastClause(text) {
  const last = [...text.matchAll(CLAUSE)].pop();
  if (!last || Array.from(text.slice(0, last.index)).length < MIN_CLAUSE) return text;
  return text.slice(0, last.index);
}

/** Strip dangling connector words ("the", "and", "using", "اور" …) left by a cut; never to empty. */
function stripConnectors(text) {
  let out = text;
  for (;;) {
    const next = out.replace(TRAILING_JUNK, '').replace(CONNECTOR, '');
    if (next === out || !next.replace(TRAILING_JUNK, '')) return out;
    out = next;
  }
}

/** A cut inside "( … )" leaves a dangling "(": drop it and what follows, if text remains. */
function dropOpenParen(text) {
  const open = text.lastIndexOf('(');
  return open > 0 && !text.slice(open).includes(')') ? text.slice(0, open) : text;
}

function shortName(text, section) {
  const clean = String(text == null ? '' : text).trim();
  return cap(stripSectionSuffix(clean, section)).replace(TRAILING_JUNK, '');
}

function slugify(text) {
  const base = String(text == null ? '' : text).normalize('NFC').toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-|-$/g, '');
  return Array.from(base).slice(0, MAX_SLUG).join('').replace(/-$/, '');
}

module.exports = { shortName, slugify, MAX_NAME };
