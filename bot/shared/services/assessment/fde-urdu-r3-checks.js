'use strict';
/**
 * Round 6 loop-2 Urdu panel (G1/G2):
 *  - G2 Q1 v «کھڑکی» کی جمع offered کھڑکیاں, کھڑکے and کھڑکیوں: the oblique plural (…وں) is also a plural, so two options
 *    are right. obliquePluralShortfall flags it as `{slot, reason:'answer', items}`, the shape keyShortfall returns.
 *  - G1 Q10 picture `describe` said «A girl named Banu …» and the key began «بانو»: no picture shows a name.
 *    mendPictureNames puts لڑکی / لڑکا / بچہ at the start of the key and drops «named X» from the describe.
 *
 * Pure: exam JSON in, flags or a mended copy out; never throws, never mutates.
 */

const ARABIC = /[؀-ۿ]/;
const DIRECT = /(?:ایاں|ائیں|یاں|یں|اں)$/u;
const OBLIQUE = /(?:یوں|اؤں|وں)$/u;
const NAMED = /\b(girl|boy|child|woman|man|lady|kid)?\s*named\s+[A-Z][a-z]+/;

const label = (o) => String(o == null ? '' : o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim().normalize('NFC').replace(/\p{M}/gu, '');

function eachItem(examJson, fn) {
  ['seen', 'unseen'].forEach((b) => Object.values((examJson && examJson[b]) || {}).forEach((types) => {
    Object.values(types || {}).forEach((l) => { if (Array.isArray(l)) l.forEach((q) => q && typeof q === 'object' && fn(q)); });
  }));
}

/** A singular/plural MCQ whose options hold X…اں/…یں and X…وں of one stem. */
function obliquePluralShortfall(examJson) {
  try {
    const out = new Map();
    eachItem(examJson, (q) => {
      const opts = Array.isArray(q.options) ? q.options.map(label).filter((o) => ARABIC.test(o)) : [];
      if (opts.length < 2 || !/جمع|واحد/.test(String(q.question))) return;
      const stems = (re) => opts.filter((o) => re.test(o)).map((o) => ({ o, stem: o.replace(re, '') }));
      const direct = stems(DIRECT);
      const hit = stems(OBLIQUE).find((ob) => [...ob.stem].length >= 2 && direct.some((d) => d.stem === ob.stem));
      if (!hit) return;
      const line = `${String(q.question).trim()} → ${String(q.answer).trim()} (the options hold both «${direct.find((d) => d.stem === hit.stem).o}» and the oblique plural «${hit.o}», so two options are plurals; never offer a …وں form as a distractor)`;
      out.set(q.slot, (out.get(q.slot) || []).concat(line));
    });
    return [...out].map(([slot, items]) => ({ slot, reason: 'answer', items }));
  } catch (e) { return []; }
}

const WORD = { girl: 'لڑکی', woman: 'لڑکی', lady: 'لڑکی', boy: 'لڑکا', man: 'لڑکا' };

/** Early Urdu Q10: a picture that names a person gets a key that opens with لڑکی / لڑکا / بچہ, never the name. */
function mendPictureNames(examJson) {
  const notes = [];
  try {
    if (!examJson || typeof examJson !== 'object') return { examJson, notes };
    const copy = JSON.parse(JSON.stringify(examJson));
    eachItem(copy, (q) => {
      const d = q.picture && q.picture.describe;
      if (!/\.urdu\.B\.Q10$/.test(String(q.slot)) || typeof d !== 'string' || typeof q.answer !== 'string') return;
      const m = NAMED.exec(d);
      if (!m) return;
      const word = WORD[m[1]] || 'بچہ';
      const rest = q.answer.trim().replace(/^\S+\s*/, '');
      notes.push(`${q.slot}: the describe names a person; the key opens with «${word}» instead of «${q.answer.trim().split(/\s+/)[0]}»`);
      q.answer = `${word} ${rest}`.trim();
      q.picture.describe = d.replace(/\s+named\s+[A-Z][a-z]+/, '');
    });
    return { examJson: notes.length ? copy : examJson, notes };
  } catch (e) { return { examJson, notes: [] }; }
}

module.exports = { obliquePluralShortfall, mendPictureNames };
